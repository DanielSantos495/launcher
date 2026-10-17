package caller

import (
	"errors"
	"slices"
	"testing"
)

func TestWindowsPathKey(t *testing.T) {
	for in, want := range map[string]string{
		`C:\Program Files\Brave\brave.exe`:    `C:/PROGRAM FILES/BRAVE/BRAVE.EXE`,
		`c:/Program Files//Brave/./brave.exe`: `C:/PROGRAM FILES/BRAVE/BRAVE.EXE`,
		`C:\a\b\..\c.exe`:                     `C:/A/C.EXE`,
		`\\?\C:\Program Files\x.exe`:          `C:/PROGRAM FILES/X.EXE`,
		`\\Servidor\Recurso\x.exe`:            `//SERVIDOR/RECURSO/X.EXE`,
		`C:\`:                                 `C:`,
	} {
		if got, ok := windowsPathKey(in); !ok || got != want {
			t.Errorf("windowsPathKey(%q) = %q, %v; quiero %q", in, got, ok, want)
		}
	}
	for _, in := range []string{"", `brave.exe`, `\x\y.exe`, `C:x.exe`, `C:\..`, "C:\\a\x00", `\\`, `\\?\UNC\s\r`, `/usr/bin/x`} {
		if got, ok := windowsPathKey(in); ok {
			t.Errorf("windowsPathKey(%q) = %q, debería rechazarla", in, got)
		}
	}
}

func TestSameWindowsPath(t *testing.T) {
	if !SameWindowsPath(`C:\Program Files\Brave\brave.exe`, `c:\PROGRAM FILES\brave\..\Brave\BRAVE.EXE`) {
		t.Fatal("misma ruta con otras mayúsculas y un ..")
	}
	for _, c := range [][2]string{
		{`C:\a\brave.exe`, `C:\b\brave.exe`},
		{`C:\a\brave.exe`, `D:\a\brave.exe`},
		{`C:\a\brave.exe`, `C:\a\brave.exe.bak`},
		{`brave.exe`, `brave.exe`},
		{``, ``},
	} {
		if SameWindowsPath(c[0], c[1]) {
			t.Errorf("%q y %q no son la misma ruta", c[0], c[1])
		}
	}
}

func TestSameWindowsPathUsesUpperCase(t *testing.T) {
	// El signo Kelvin (U+212A) pasa a "k" con ToLower pero no con ToUpper; Windows compara en mayúsculas, así que no
	// es la misma ruta que una con "k".
	if SameWindowsPath(`C:\a\k.exe`, "C:\\a\\\u212a.exe") {
		t.Fatal("k y el signo Kelvin no son la misma ruta en Windows")
	}
}

const (
	winBrave = `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`
	winCmd   = `C:\Windows\System32\cmd.exe`
	hostPID  = 50
)

// winProcs es una tabla de procesos falsa para Chain: exe, padre y hora de creación por PID. Apunta los PIDs por los
// que se pregunta a lookup.
type winProcs struct {
	exe     map[int]string
	info    map[int]ProcInfo
	infoErr map[int]error
	looked  []int
}

func (w *winProcs) lookup(pid int) (string, error) {
	w.looked = append(w.looked, pid)
	exe, ok := w.exe[pid]
	if !ok {
		return "", errors.New("no existe")
	}
	return exe, nil
}

func (w *winProcs) getInfo(pid int) (ProcInfo, error) {
	if err := w.infoErr[pid]; err != nil {
		return ProcInfo{}, err
	}
	info, ok := w.info[pid]
	if !ok {
		return ProcInfo{}, errors.New("no existe")
	}
	return info, nil
}

func (w *winProcs) chain() *Chain { return &Chain{Self: hostPID, Info: w.getInfo, CmdExe: winCmd} }

// newWinProcs: el host (50) es hijo de 40, que es hijo de 30. Los tres se crearon en orden: 30, 40, 50.
func newWinProcs(parentExe, grandExe string) *winProcs {
	return &winProcs{
		exe:     map[int]string{40: parentExe, 30: grandExe},
		info:    map[int]ProcInfo{hostPID: {PPID: 40, Created: 300}, 40: {PPID: 30, Created: 200}, 30: {PPID: 20, Created: 100}},
		infoErr: map[int]error{},
	}
}

func useWindowsPaths(t *testing.T) {
	old := windowsPaths
	windowsPaths = true
	t.Cleanup(func() { windowsPaths = old })
}

func TestCheckParentWindows(t *testing.T) {
	useWindowsPaths(t)
	cfg := Config{Exe: winBrave}
	other := `C:\Users\x\AppData\Local\Temp\brave.exe`
	boom := errors.New("sin acceso")
	cases := []struct {
		name   string
		procs  func() *winProcs
		chain  func(*winProcs) *Chain
		want   error // nil = aceptado
		looked []int
	}{
		{name: "padre = navegador, con otras mayúsculas", procs: func() *winProcs {
			return newWinProcs(`c:\program files\bravesoftware\brave-browser\application\BRAVE.EXE`, "")
		}, looked: []int{40}},
		{name: "padre = cmd y abuelo = navegador", procs: func() *winProcs { return newWinProcs(winCmd, winBrave) },
			looked: []int{40, 30}},
		{name: "padre = cmd en minúsculas y abuelo = navegador", procs: func() *winProcs {
			return newWinProcs(`c:\windows\system32\CMD.EXE`, winBrave)
		}, looked: []int{40, 30}},
		{name: "padre = cmd y abuelo = otro", procs: func() *winProcs { return newWinProcs(winCmd, other) },
			want: ErrParentMismatch, looked: []int{40, 30}},
		{name: "padre = cmd y abuelo = cmd", procs: func() *winProcs { return newWinProcs(winCmd, winCmd) },
			want: ErrParentMismatch, looked: []int{40, 30}},
		{name: "cmd fuera de System32", procs: func() *winProcs { return newWinProcs(`C:\Users\x\cmd.exe`, winBrave) },
			want: ErrParentMismatch, looked: []int{40}},
		{name: "padre = otro", procs: func() *winProcs { return newWinProcs(other, winBrave) },
			want: ErrParentMismatch, looked: []int{40}},
		{name: "padre con ruta vacía", procs: func() *winProcs { return newWinProcs("", winBrave) },
			want: ErrParentMismatch, looked: []int{40}},
		{name: "sin CmdExe, cmd no se acepta", procs: func() *winProcs { return newWinProcs(winCmd, winBrave) },
			chain: func(w *winProcs) *Chain { c := w.chain(); c.CmdExe = ""; return c },
			want:  ErrParentMismatch, looked: []int{40}},
		{name: "padre creado después que el host (PID reutilizado)", procs: func() *winProcs {
			w := newWinProcs(winBrave, "")
			w.info[40] = ProcInfo{PPID: 30, Created: 301}
			return w
		}, want: ErrParentMismatch},
		{name: "padre creado a la vez que el host", procs: func() *winProcs {
			w := newWinProcs(winBrave, "")
			w.info[40] = ProcInfo{PPID: 30, Created: 300}
			return w
		}, looked: []int{40}},
		{name: "abuelo creado después que cmd (PID reutilizado)", procs: func() *winProcs {
			w := newWinProcs(winCmd, winBrave)
			w.info[30] = ProcInfo{PPID: 20, Created: 201}
			return w
		}, want: ErrParentMismatch, looked: []int{40}},
		{name: "abuelo creado a la vez que cmd", procs: func() *winProcs {
			w := newWinProcs(winCmd, winBrave)
			w.info[30] = ProcInfo{PPID: 20, Created: 200}
			return w
		}, looked: []int{40, 30}},
		{name: "hora de creación del padre desconocida", procs: func() *winProcs {
			w := newWinProcs(winBrave, "")
			w.info[40] = ProcInfo{PPID: 30}
			return w
		}, want: ErrParentMismatch},
		{name: "hora de creación del host desconocida", procs: func() *winProcs {
			w := newWinProcs(winBrave, "")
			w.info[hostPID] = ProcInfo{PPID: 40}
			return w
		}, want: ErrParentMismatch},
		{name: "cmd sin abuelo", procs: func() *winProcs {
			w := newWinProcs(winCmd, winBrave)
			w.info[40] = ProcInfo{PPID: 0, Created: 200}
			return w
		}, want: ErrParentMismatch, looked: []int{40}},
		{name: "error al consultar el host", procs: func() *winProcs {
			w := newWinProcs(winBrave, "")
			w.infoErr[hostPID] = boom
			return w
		}, want: boom},
		{name: "error al consultar el padre", procs: func() *winProcs {
			w := newWinProcs(winBrave, "")
			w.infoErr[40] = boom
			return w
		}, want: boom},
		{name: "error al consultar el abuelo", procs: func() *winProcs {
			w := newWinProcs(winCmd, winBrave)
			w.infoErr[30] = boom
			return w
		}, want: boom, looked: []int{40}},
		{name: "sin chain", procs: func() *winProcs { return newWinProcs(winBrave, "") },
			chain: func(*winProcs) *Chain { return nil }, want: ErrUnsupported},
		{name: "chain sin Info", procs: func() *winProcs { return newWinProcs(winBrave, "") },
			chain: func(*winProcs) *Chain { return &Chain{Self: hostPID, CmdExe: winCmd} }, want: ErrUnsupported},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := tc.procs()
			ch := w.chain()
			if tc.chain != nil {
				ch = tc.chain(w)
			}
			err := CheckParentChain(cfg, 40, w.lookup, ch)
			if tc.want == nil && err != nil {
				t.Fatalf("CheckParentChain = %v, quiero nil", err)
			}
			if tc.want != nil && !errors.Is(err, tc.want) {
				t.Fatalf("CheckParentChain = %v, quiero %v", err, tc.want)
			}
			if !slices.Equal(w.looked, tc.looked) {
				t.Fatalf("lookup de %v, quiero %v", w.looked, tc.looked)
			}
		})
	}
}

func TestCheckParentWindowsLookupError(t *testing.T) {
	useWindowsPaths(t)
	w := newWinProcs(winCmd, winBrave)
	delete(w.exe, 30)
	if err := CheckParentChain(Config{Exe: winBrave}, 40, w.lookup, w.chain()); err == nil || errors.Is(err, ErrParentMismatch) {
		t.Fatalf("error del lookup del abuelo = %v", err)
	}
	if err := CheckParentChain(Config{Exe: winBrave}, 0, w.lookup, w.chain()); !errors.Is(err, ErrParentMismatch) {
		t.Fatalf("ppid 0 = %v", err)
	}
	if err := CheckParent(Config{Exe: winBrave}, 40, w.lookup); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("CheckParent sin chain en Windows = %v", err)
	}
}

func TestParentOf(t *testing.T) {
	rows := []procEntry{{pid: 4, ppid: 0}, {pid: 100, ppid: 4}, {pid: 200, ppid: 100}, {pid: 300, ppid: 100}}
	iter := func(rows []procEntry) func() (procEntry, bool) {
		i := 0
		return func() (procEntry, bool) {
			if i >= len(rows) {
				return procEntry{}, false
			}
			i++
			return rows[i-1], true
		}
	}
	if got, err := parentOf(200, iter(rows)); err != nil || got != 100 {
		t.Fatalf("parentOf(200) = %d, %v", got, err)
	}
	if _, err := parentOf(999, iter(rows)); err == nil {
		t.Fatal("proceso ausente sin error")
	}
	if _, err := parentOf(4, iter(rows)); err == nil {
		t.Fatal("padre 0 sin error")
	}
	if _, err := parentOf(1, iter(nil)); err == nil {
		t.Fatal("instantánea vacía sin error")
	}
}
