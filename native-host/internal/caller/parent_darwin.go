//go:build darwin

package caller

import (
	"context"
	"errors"
	"os/exec"
	"strconv"
	"time"
)

// lsofTimeout es el tiempo máximo que se espera a lsof.
const lsofTimeout = 2 * time.Second

// ParentExe devuelve la ruta del ejecutable del proceso pid, leída con `lsof -a -p <pid> -d txt -Fn`. Sin shell: el
// pid es un entero y la ruta de lsof es fija. Un pid <= 1 se rechaza: si el padre murió, el host queda colgado de
// launchd.
func ParentExe(pid int) (string, error) {
	if pid <= 1 {
		return "", errors.New("caller: no hay proceso padre")
	}
	ctx, cancel := context.WithTimeout(context.Background(), lsofTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/sbin/lsof", "-a", "-p", strconv.Itoa(pid), "-d", "txt", "-Fn").Output()
	if err != nil {
		return "", err
	}
	return parseLsofTxt(out)
}
