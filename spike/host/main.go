package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const (
	maxMessage      = 64 * 1024
	protocolVersion = 1
)

type request struct {
	Cmd  string      `json:"cmd"`
	Open OpenRequest `json:"open"`
}

func main() {
	cfg, dir, cfgErr := loadConfig()
	logFile := openLog(dir)
	defer logFile.Close()
	logger := log.New(logFile, "", log.LstdFlags|log.Lmicroseconds)
	// os.Args[0] es la ruta del binario y contiene el nombre de usuario: no se registra.
	logger.Printf("start argv=%q ppid=%d", os.Args[1:], os.Getppid())

	raw, err := readMessage(os.Stdin, maxMessage)
	if err != nil {
		logger.Printf("read error: %v", err)
		_ = writeMessage(os.Stdout, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	var req request
	if err := json.Unmarshal(raw, &req); err != nil {
		logger.Printf("bad json")
		_ = writeMessage(os.Stdout, map[string]any{"ok": false, "error": "bad json"})
		return
	}
	if cfgErr != nil {
		logger.Printf("config error: %s", safeErr(cfgErr))
		_ = writeMessage(os.Stdout, map[string]any{"ok": false, "error": "config: " + safeErr(cfgErr)})
		return
	}
	if err := writeMessage(os.Stdout, handle(req, cfg, logger)); err != nil {
		logger.Printf("write error: %v", err)
	}
}

func handle(req request, cfg config, logger *log.Logger) map[string]any {
	switch req.Cmd {
	case "ping":
		return map[string]any{"ok": true, "version": protocolVersion, "browser": cfg.Browser, "argv": os.Args}
	case "listProfiles":
		profiles, err := readProfiles(cfg.localStatePath())
		if err != nil {
			return fail(logger, "profiles", err)
		}
		return map[string]any{"ok": true, "profiles": profiles}
	case "open":
		if req.Open.V != protocolVersion {
			return map[string]any{"ok": false, "error": "unsupported protocol version"}
		}
		profiles, err := readProfiles(cfg.localStatePath())
		if err != nil {
			return fail(logger, "profiles", err)
		}
		// Los contenedores son de cada perfil: solo se leen del perfil de destino, y solo si ya es válido.
		var containers map[string]bool
		if req.Open.Container != "" && knownProfile(req.Open.ProfileDirectory, profiles) {
			containers, err = readContainers(cfg.preferencesPath(req.Open.ProfileDirectory))
			if err != nil {
				return fail(logger, "containers", err)
			}
		}
		u, err := validateOpen(req.Open, profiles, containers)
		if err != nil {
			logger.Printf("open rejected: %v", err) // err es un error fijo de validate.go, sin datos del mensaje
			return map[string]any{"ok": false, "error": err.Error()}
		}
		args := buildArgs(req.Open.ProfileDirectory, req.Open.Container, u)
		start := time.Now()
		err = launch(cfg, args)
		elapsed := time.Since(start).Milliseconds()
		// Privacidad: solo el host de la URL; ni la ruta, ni la consulta, ni el nombre del contenedor.
		logger.Printf("open profile=%q container=%t host=%q mode=%s spawnMs=%d err=%v",
			req.Open.ProfileDirectory, req.Open.Container != "", urlHost(u), cfg.LaunchMode, elapsed, errText(err))
		if err != nil {
			return map[string]any{"ok": false, "error": "launch: " + safeErr(err)}
		}
		return map[string]any{"ok": true, "args": args, "spawnMs": elapsed}
	default:
		return map[string]any{"ok": false, "error": "unknown command"}
	}
}

func fail(logger *log.Logger, what string, err error) map[string]any {
	msg := what + ": " + safeErr(err)
	logger.Printf("error %s", msg)
	return map[string]any{"ok": false, "error": msg}
}

// safeErr quita las rutas de los errores de fichero y de exec: contienen el nombre de usuario.
func safeErr(err error) string {
	var pe *fs.PathError
	if errors.As(err, &pe) {
		return pe.Op + ": " + pe.Err.Error()
	}
	var ee *exec.Error
	if errors.As(err, &ee) {
		return "exec: " + ee.Err.Error()
	}
	return err.Error()
}

func errText(err error) string {
	if err == nil {
		return "<nil>"
	}
	return safeErr(err)
}

func urlHost(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

func openLog(dir string) *os.File {
	if dir == "" {
		dir = os.TempDir()
	}
	f, err := os.OpenFile(filepath.Join(dir, "host.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		f, _ = os.OpenFile(os.DevNull, os.O_WRONLY, 0)
	}
	return f
}
