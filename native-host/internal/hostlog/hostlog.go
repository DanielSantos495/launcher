// Package hostlog escribe el registro opcional del host (host.log, D19): una línea por mensaje con la fecha, el
// comando validado, el código de la respuesta y los milisegundos. Nunca lleva datos del mensaje (URLs, carpetas,
// tokens): solo valores que el host mismo fijó. Un registro desactivado o que no se puede abrir no hace nada: el
// host funciona igual.
package hostlog

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

const (
	// FileName es el registro activo y RotatedName el anterior.
	FileName    = "host.log"
	RotatedName = "host.log.1"
	// MaxBytes es el tamaño a partir del cual (estrictamente más) Open rota el registro.
	MaxBytes = 1 << 20
)

// Logger escribe líneas en host.log. El cero (y el nil) es un registro inactivo.
type Logger struct {
	f   *os.File
	now func() time.Time
}

// Open abre <dir>/host.log para añadir (0600). Si enabled es false, o el archivo no se puede abrir, devuelve un
// registro inactivo. Si el archivo ya pesa más de MaxBytes, antes lo renombra a host.log.1 (sustituyendo al anterior).
func Open(dir string, enabled bool, now func() time.Time) *Logger {
	if !enabled || now == nil {
		return &Logger{}
	}
	path := filepath.Join(dir, FileName)
	if fi, err := os.Lstat(path); err == nil && fi.Size() > MaxBytes {
		// Si el renombrado falla, se sigue añadiendo al mismo archivo: no se pierde nada.
		_ = os.Rename(path, filepath.Join(dir, RotatedName))
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return &Logger{}
	}
	return &Logger{f: f, now: now}
}

// Record escribe una línea. cmd es un comando ya validado o "-"; code es "ok" o un protocol.Code. Cualquier otro
// valor se escribe como "-": el registro no puede llevar texto que no haya fijado el host.
func (l *Logger) Record(cmd, code string, d time.Duration) {
	if l == nil || l.f == nil {
		return
	}
	if cmd != "-" && !slices.Contains(protocol.Commands, cmd) {
		cmd = "-"
	}
	if code != "ok" && !slices.Contains(protocol.AllCodes, protocol.Code(code)) {
		code = "-"
	}
	// Una sola escritura por línea: con O_APPEND, dos procesos del host no mezclan sus líneas.
	line := fmt.Sprintf("%s cmd=%s code=%s ms=%d\n", protocol.FormatTime(l.now()), cmd, code, max(d.Milliseconds(), 0))
	_, _ = l.f.WriteString(line)
}

// Close cierra el archivo. Se puede llamar sobre un registro inactivo o nil.
func (l *Logger) Close() error {
	if l == nil || l.f == nil {
		return nil
	}
	f := l.f
	l.f = nil
	return f.Close()
}
