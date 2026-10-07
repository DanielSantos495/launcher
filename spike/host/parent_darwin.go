package main

import (
	"context"
	"errors"
	"os/exec"
	"strconv"
	"time"
)

// parentExe devuelve la ruta del ejecutable del proceso pid. Sin shell: el pid es un entero.
// pid <= 1 se rechaza: si el padre murió, el host queda colgado de launchd.
func parentExe(pid int) (string, error) {
	if pid <= 1 {
		return "", errors.New("no parent process")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/sbin/lsof", "-a", "-p", strconv.Itoa(pid), "-d", "txt", "-Fn").Output()
	if err != nil {
		return "", err
	}
	return parseLsofTxt(out)
}
