package main

import (
	"bytes"
	"errors"
	"io"
	"path/filepath"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
	"github.com/DanielSantos495/launcher/native-host/internal/framing"
	"github.com/DanielSantos495/launcher/native-host/internal/host"
	"github.com/DanielSantos495/launcher/native-host/internal/hostlog"
	"github.com/DanielSantos495/launcher/native-host/internal/launch"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// lockTimeout es lo que espera el host a que otro proceso suelte shared.lock.
const lockTimeout = 5 * time.Second

// serveDeps es todo lo que serve toma del sistema; las pruebas pasan valores falsos.
type serveDeps struct {
	ExeDir  string // carpeta del binario: config.json, shared.json, icons/ y host.log
	Origin  string // primer argumento del navegador: chrome-extension://<id>/
	PPID    int
	Lookup  caller.ParentLookup
	Chain   *caller.Chain // solo Windows: cmd.exe intermedio y PID reutilizado (nil en macOS)
	Stdin   io.Reader
	Stdout  io.Writer
	Now     func() time.Time
	Rand    io.Reader
	Starter launch.Starter
}

// serve atiende un mensaje de native messaging. Devuelve 0 si respondió y 1 si no había mensaje o no pudo escribir la
// respuesta.
//
// Las comprobaciones del llamador (configuración, origen y proceso padre) van ANTES de leer el marco: el navegador
// escribe en la tubería sin esperar la respuesta, y un llamador que no es el navegador configurado no consigue que el
// host procese nada suyo.
func serve(d serveDeps) int {
	start := d.Now()
	cfg, err := loadConfig(d.ExeDir)
	if err != nil {
		// Sin configuración no se sabe si hay registro: se responde internal sin registrar.
		return write(d, nil, start, "-", protocol.Failure(protocol.Fail(protocol.Internal)))
	}
	logger := hostlog.Open(d.ExeDir, cfg.Log, d.Now)
	defer logger.Close()

	if !caller.CheckOrigin(d.Origin, cfg) {
		return write(d, logger, start, "-", protocol.Failure(protocol.Fail(protocol.UnsupportedBrowser)))
	}
	switch err := caller.CheckParentChain(cfg, d.PPID, d.Lookup, d.Chain); {
	case err == nil:
	case errors.Is(err, caller.ErrParentMismatch):
		return write(d, logger, start, "-", protocol.Failure(protocol.Fail(protocol.UnsupportedBrowser)))
	default:
		// ErrUnsupported (fuera de macOS y Windows) o una consulta del padre que falla: se cierra en falso.
		return write(d, logger, start, "-", protocol.Failure(protocol.Fail(protocol.Internal)))
	}

	body, err := framing.ReadMessage(d.Stdin, protocol.MaxRequestBytes)
	switch {
	case errors.Is(err, io.EOF):
		return 1 // nadie escribió nada
	case errors.Is(err, framing.ErrTooLarge):
		return write(d, logger, start, "-", protocol.Failure(protocol.Fail(protocol.TooLarge)))
	case err != nil:
		return 1 // marco incompleto
	}
	req, perr := protocol.Validate(body)
	if perr != nil {
		return write(d, logger, start, "-", protocol.Failure(perr))
	}
	env := host.Env{
		Config:      cfg,
		DataDir:     d.ExeDir,
		Version:     Version,
		Now:         d.Now,
		Rand:        d.Rand,
		Starter:     d.Starter,
		Exists:      launch.PathExists,
		LockTimeout: lockTimeout,
	}
	return write(d, logger, start, req.Cmd, host.Handle(env, req))
}

// loadConfig lee config.json de la carpeta del binario. Una carpeta que no es absoluta (os.Executable falló) no se
// busca: leería config.json del directorio actual.
func loadConfig(dir string) (caller.Config, error) {
	if !filepath.IsAbs(dir) {
		return caller.Config{}, errors.New("carpeta del binario desconocida")
	}
	return caller.LoadConfig(dir)
}

// write codifica y escribe la respuesta, y registra una línea con el comando validado (o "-"), el código y los
// milisegundos. Devuelve 0 si escribió y 1 si no pudo.
func write(d serveDeps, logger *hostlog.Logger, start time.Time, cmd string, resp protocol.Response) int {
	out := protocol.Encode(resp)
	werr := framing.WriteMessage(d.Stdout, out, protocol.MaxResponseBytes)
	logger.Record(cmd, codeOf(resp, out), d.Now().Sub(start))
	if werr != nil {
		return 1
	}
	return 0
}

// codeOf es el código que quedó escrito: "ok", o el del error. Encode sustituye por internal una respuesta correcta
// que no cabe, así que se mira el cuerpo y no solo la respuesta.
func codeOf(resp protocol.Response, encoded []byte) string {
	switch {
	case bytes.HasPrefix(encoded, []byte(`{"ok":true,`)):
		return "ok"
	case resp.Err != nil && bytes.Contains(encoded, []byte(`"code":"`+string(resp.Err.Code)+`"`)):
		return string(resp.Err.Code)
	}
	return string(protocol.Internal)
}
