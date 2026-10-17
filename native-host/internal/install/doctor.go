package install

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
	"github.com/DanielSantos495/launcher/native-host/internal/launch"
	"github.com/DanielSantos495/launcher/native-host/internal/pairing"
	"github.com/DanielSantos495/launcher/native-host/internal/profiles"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

const (
	// verifyWait es lo que espera doctor --verify a que una instalación quede verificada: la vida de la prueba
	// (60 s) más un margen (D21).
	verifyWait = 65 * time.Second
	verifyPoll = time.Second
	// maxManifestBytes es el tamaño máximo del manifest que lee doctor.
	maxManifestBytes = 64 << 10
)

// report escribe una línea por comprobación: OK o FALLO. Nunca lleva nombres de perfil, tokens ni el código de
// emparejamiento.
type report struct {
	out    io.Writer
	failed bool
}

func (r *report) ok(format string, a ...any) {
	fmt.Fprintf(r.out, "OK     "+format+"\n", a...)
}

func (r *report) fail(format string, a ...any) {
	r.failed = true
	fmt.Fprintf(r.out, "FALLO  "+format+"\n", a...)
}

// Doctor comprueba la instalación de cada navegador (los indicados o, si no hay ninguno, los instalados): permisos,
// hash del binario (T9), config.json, ejecutable del navegador, manifest, almacén y Local State. Con verify abre
// whoami en el perfil declarado de cada instalación emparejada y espera hasta 65 s a que quede verificada (D21).
// Devuelve true si no hay ningún FALLO.
func Doctor(o Options, verify bool) bool {
	o = o.defaults()
	r := &report{out: o.Out}
	if err := checkOS(); err != nil {
		r.fail("%v", err)
		return false
	}
	reg, err := registryFor(o)
	if err != nil {
		r.fail("%v", err)
		return false
	}
	o.Registry = reg
	targets, err := existing(o.Home, o.Browsers)
	if err != nil {
		r.fail("%v", err)
		return false
	}
	if len(targets) == 0 {
		r.fail("no hay nada instalado")
		return false
	}
	for _, b := range targets {
		checkBrowser(r, o, b, verify)
	}
	return !r.failed
}

func checkBrowser(r *report, o Options, b Browser, verify bool) {
	name := b.Name
	app := AppDir(o.Home, name)
	binPath := filepath.Join(app, binaryName())
	cfgPath := filepath.Join(app, caller.ConfigFile)
	if !exists(binPath) && !exists(cfgPath) && !exists(manifestPath(b)) {
		r.fail("%s: no está instalado", name)
		return
	}

	checkAppDir(r, name, app)
	cfg, cfgOK := checkConfig(r, name, app)
	checkBinary(r, name, binPath, cfg, cfgOK)
	if cfgOK {
		if regularFile(cfg.Exe) {
			r.ok("%s: ejecutable del navegador presente", name)
		} else {
			r.fail("%s: no existe el ejecutable del navegador (%s)", name, cfg.Exe)
		}
		checkManifest(r, b, binPath, cfg)
		checkRegistry(r, o.Registry, b)
	}
	st := checkStore(r, name, app)

	var ls *profiles.LocalState
	if cfgOK {
		ls = checkBrowserData(r, name, cfg)
	}
	if st != nil {
		verified := 0
		for _, in := range st.Paired {
			if in.VerifiedAt != "" {
				verified++
			}
		}
		r.ok("%s: instalaciones emparejadas: %d, verificadas: %d", name, len(st.Paired), verified)
	}
	if verify {
		if !cfgOK || ls == nil {
			r.fail("%s: no se puede verificar sin una configuración y un Local State válidos", name)
			return
		}
		verifyInstallations(r, o, name, app, cfg, ls)
	}
}

// private dice si un archivo o carpeta no da ningún permiso a su grupo ni a otros.
//
// En Windows los bits de permiso no significan nada (os.Stat inventa 0666 o 0444): la protección es la ACL de
// %LOCALAPPDATA%, que es del usuario, y esta comprobación se da por buena.
func private(mode fs.FileMode) bool { return goos == "windows" || mode.Perm()&0o077 == 0 }

func checkAppDir(r *report, name, app string) {
	fi, err := os.Stat(app)
	switch {
	case err != nil || !fi.IsDir():
		r.fail("%s: falta la carpeta de instalación", name)
	case !private(fi.Mode()):
		r.fail("%s: carpeta de instalación con permisos %04o (debe ser 0700)", name, fi.Mode().Perm())
	default:
		r.ok("%s: carpeta de instalación (0700)", name)
	}
}

// checkConfig lee config.json. Devuelve la configuración y si es válida (las comprobaciones que dependen de ella se
// saltan si no lo es).
func checkConfig(r *report, name, app string) (caller.Config, bool) {
	fi, err := os.Stat(filepath.Join(app, caller.ConfigFile))
	if err != nil {
		r.fail("%s: falta config.json", name)
		return caller.Config{}, false
	}
	cfg, err := caller.LoadConfig(app)
	switch {
	case err != nil:
		r.fail("%s: config.json no es válido", name)
		return caller.Config{}, false
	case cfg.Browser != name:
		r.fail("%s: config.json es de otro navegador", name)
		return caller.Config{}, false
	case !private(fi.Mode()):
		r.fail("%s: config.json con permisos %04o (debe ser 0600)", name, fi.Mode().Perm())
	default:
		r.ok("%s: config.json válido (0600)", name)
	}
	return cfg, true
}

// checkBinary comprueba el binario instalado: que exista, sus permisos y su hash contra el de config.json (T9: un
// binario cambiado después de instalarlo no pasa).
func checkBinary(r *report, name, binPath string, cfg caller.Config, cfgOK bool) {
	fi, err := os.Stat(binPath)
	switch {
	case err != nil:
		r.fail("%s: falta %s", name, binaryName())
		return
	case !fi.Mode().IsRegular():
		r.fail("%s: %s no es un archivo normal", name, binaryName())
		return
	case !private(fi.Mode()) || (goos != "windows" && fi.Mode().Perm()&0o100 == 0):
		r.fail("%s: %s con permisos %04o (debe ser 0700)", name, binaryName(), fi.Mode().Perm())
	default:
		r.ok("%s: %s (0700)", name, binaryName())
	}
	if !cfgOK {
		return
	}
	sum, err := fileSHA256(binPath)
	switch {
	case err != nil:
		r.fail("%s: no se pudo leer %s para comprobar su hash", name, binaryName())
	case sum != cfg.BinarySHA256:
		r.fail("%s: el hash de %s no coincide con config.json (modificado o sustituido): vuelve a ejecutar install", name, binaryName())
	default:
		r.ok("%s: el hash de %s coincide con config.json", name, binaryName())
	}
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// checkManifest compara el manifest instalado con el que Install escribiría.
func checkManifest(r *report, b Browser, binPath string, cfg caller.Config) {
	raw, err := jsonx.ReadFileLimit(manifestPath(b), maxManifestBytes)
	if err != nil {
		r.fail("%s: falta el manifest o no se puede leer (%s)", b.Name, manifestPath(b))
		return
	}
	var got manifestFile
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var extra json.RawMessage
	if dec.Decode(&got) != nil || !errors.Is(dec.Decode(&extra), io.EOF) {
		r.fail("%s: el manifest no es válido", b.Name)
		return
	}
	want := wantManifest(b.Name, binPath, cfg.ExtensionID)
	bad := false
	if got.Name != want.Name {
		r.fail("%s: el manifest tiene otro nombre de host", b.Name)
		bad = true
	}
	if got.Path != want.Path {
		r.fail("%s: el manifest apunta a otra ruta (%s)", b.Name, got.Path)
		bad = true
	}
	if got.Type != want.Type {
		r.fail("%s: el manifest no es de tipo stdio", b.Name)
		bad = true
	}
	if !slices.Equal(got.AllowedOrigins, want.AllowedOrigins) {
		r.fail("%s: allowed_origins del manifest no coincide con la extensión configurada", b.Name)
		bad = true
	}
	if !bad {
		r.ok("%s: manifest correcto (nombre, ruta y allowed_origins)", b.Name)
	}
}

// checkRegistry (solo Windows) comprueba que cada clave de HKCU del navegador apunte al manifest, sin distinguir
// mayúsculas. La clave se lee en UTF-16 con la API del registro (RegExe.Get), así que una ruta no ASCII sale tal cual.
func checkRegistry(r *report, reg Registry, b Browser) {
	if reg == nil {
		return
	}
	want := manifestPath(b)
	for _, key := range b.RegistryKeys {
		got, found, err := reg.Get(key)
		switch {
		case err != nil:
			r.fail("%s: no se pudo leer la clave de registro %s", b.Name, key)
		case !found:
			r.fail("%s: falta la clave de registro %s", b.Name, key)
		case got != want && !caller.SameWindowsPath(got, want):
			r.fail("%s: la clave de registro %s apunta a otro manifest (%s)", b.Name, key, got)
		default:
			r.ok("%s: clave de registro %s correcta", b.Name, key)
		}
	}
}

// checkStore comprueba shared.json (permisos y contenido). Devuelve el estado si se pudo cargar, o nil.
func checkStore(r *report, name, app string) *store.State {
	path := filepath.Join(app, store.FileName)
	fi, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		r.ok("%s: almacén compartido aún sin crear (se crea con el primer emparejamiento)", name)
		return nil
	}
	if err != nil {
		r.fail("%s: no se puede leer shared.json", name)
		return nil
	}
	permsOK := private(fi.Mode())
	if !permsOK {
		r.fail("%s: shared.json con permisos %04o (debe ser 0600)", name, fi.Mode().Perm())
	}
	st, err := loadState(app)
	switch {
	case errors.Is(err, store.ErrLocked):
		r.fail("%s: el almacén está bloqueado por otro proceso", name)
		return nil
	case err != nil || st == nil:
		r.fail("%s: shared.json no es válido", name)
		return nil
	}
	if permsOK {
		r.ok("%s: shared.json válido (0600)", name)
	}
	return st
}

// loadState abre el almacén, lo carga y lo suelta. Sin shared.json devuelve nil.
func loadState(app string) (*store.State, error) {
	s, err := store.Open(app, storeLockTimeout)
	if err != nil {
		return nil, err
	}
	defer s.Close()
	return s.Load()
}

// checkBrowserData lee Local State y Last Version: informa del número de perfiles (nunca de sus nombres), de la
// versión del navegador y de si admite contenedores temporales. Devuelve Local State o nil si no se pudo leer.
func checkBrowserData(r *report, name string, cfg caller.Config) *profiles.LocalState {
	ls, err := profiles.ReadLocalState(cfg.UserDataDir)
	if err != nil {
		r.fail("%s: no se puede leer el Local State del navegador (%s)", name, cfg.UserDataDir)
		return nil
	}
	version, ok := profiles.ReadLastVersion(cfg.UserDataDir)
	if !ok {
		version = "desconocida"
	}
	temporary := "no"
	if launch.SupportsTemporaryContainer(cfg.Browser, version) {
		temporary = "sí"
	}
	r.ok("%s: perfiles: %d; versión del navegador: %s; contenedores temporales: %s", name, len(ls.List()), version, temporary)
	return ls
}

// verifyInstallations hace doctor --verify (D21): para cada instalación emparejada emite una prueba, abre whoami en
// su perfil declarado y espera a que aparezca verifiedAt. El almacén se suelta antes de lanzar el navegador: whoami
// hace pair.prove enseguida y necesita abrirlo.
func verifyInstallations(r *report, o Options, name, app string, cfg caller.Config, ls *profiles.LocalState) {
	st, err := loadState(app)
	if err != nil || st == nil || len(st.Paired) == 0 {
		r.fail("%s: no hay instalaciones emparejadas que verificar", name)
		return
	}
	ids := make([]string, len(st.Paired))
	for i, in := range st.Paired {
		ids[i] = in.InstallationID
	}
	for i, id := range ids {
		label := fmt.Sprintf("%s: instalación %d de %d", name, i+1, len(ids))
		issuedAt := o.Now()
		proof, perr, err := issueProof(o, app, id, ls)
		switch {
		case err != nil:
			r.fail("%s: no se pudo preparar la verificación (almacén)", label)
			continue
		case perr != nil && perr.Code == protocol.NotFound:
			r.fail("%s: sin perfil declarado (pair.declare), no se puede verificar", label)
			continue
		case perr != nil && perr.Code == protocol.UnknownProfile:
			r.fail("%s: su perfil declarado ya no está en Local State", label)
			continue
		case perr != nil:
			r.fail("%s: no se pudo preparar la verificación (%s)", label, perr.Code)
			continue
		}
		args, err := launch.WhoamiArgs(proof.ProfileDirectory, cfg.ExtensionID, proof.Nonce)
		if err != nil {
			r.fail("%s: no se pudo armar la orden de whoami", label)
			continue
		}
		if err := o.Starter.Start(cfg.Exe, args); err != nil {
			r.fail("%s: no se pudo abrir el navegador", label)
			continue
		}
		switch awaitVerified(o, app, id, issuedAt) {
		case verifiedYes:
			r.ok("%s: verificada", label)
		case verifiedNo:
			r.fail("%s: sin verificar tras %d s (¿está cargada la extensión en ese perfil?)", label, int(verifyWait/time.Second))
		default:
			r.fail("%s: no se pudo leer el almacén mientras se esperaba", label)
		}
	}
}

// issueProof emite la prueba de la instalación id y guarda el estado. Devuelve el error del protocolo (sin perfil
// declarado, perfil desaparecido…) o el del almacén por separado.
func issueProof(o Options, app, id string, ls *profiles.LocalState) (pairing.ProofRequest, *protocol.Error, error) {
	s, err := store.Open(app, storeLockTimeout)
	if err != nil {
		return pairing.ProofRequest{}, nil, err
	}
	defer s.Close()
	st, err := s.Load()
	if err != nil {
		return pairing.ProofRequest{}, nil, err
	}
	if st == nil {
		return pairing.ProofRequest{}, nil, errors.New("sin almacén")
	}
	index := slices.IndexFunc(st.Paired, func(in store.Installation) bool { return in.InstallationID == id })
	if index < 0 {
		return pairing.ProofRequest{}, nil, errors.New("instalación desaparecida")
	}
	proof, perr := pairing.IssueProof(st, index, pairing.Clock{Now: o.Now, Rand: o.Rand}, ls.Known)
	if perr != nil {
		return pairing.ProofRequest{}, perr, nil
	}
	if err := s.Save(st); err != nil {
		return pairing.ProofRequest{}, nil, err
	}
	return proof, nil, nil
}

type verifyResult int

const (
	verifiedYes verifyResult = iota
	verifiedNo
	verifiedError
)

// awaitVerified espera a que la instalación id tenga un verifiedAt posterior a issuedAt (una verificación vieja no
// cuenta), hasta verifyWait. Comprueba antes de dormir, así que una verificación inmediata no espera.
func awaitVerified(o Options, app, id string, issuedAt time.Time) verifyResult {
	since := issuedAt.UTC().Truncate(time.Millisecond)
	deadline := issuedAt.Add(verifyWait)
	for {
		st, err := loadState(app)
		if err != nil || st == nil {
			return verifiedError
		}
		if i := slices.IndexFunc(st.Paired, func(in store.Installation) bool { return in.InstallationID == id }); i >= 0 {
			if t, ok := protocol.ParseTime(st.Paired[i].VerifiedAt); ok && !t.Before(since) {
				return verifiedYes
			}
		}
		if !o.Now().Before(deadline) {
			return verifiedNo
		}
		o.Sleep(verifyPoll)
	}
}
