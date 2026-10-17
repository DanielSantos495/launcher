//go:build windows

package launch

import (
	"os/exec"
	"syscall"
)

// detachedProcess es DETACHED_PROCESS: el navegador no hereda la consola del host.
const detachedProcess = 0x00000008

// detach separa el navegador del host: sin consola y en su propio grupo de procesos. No pide CREATE_BREAKAWAY_FROM_JOB
// (falla si el Job object del navegador no lo permite): si el Job mata a los hijos al salir el host, es una de las
// pruebas de F0 pendientes en Windows.
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: detachedProcess | syscall.CREATE_NEW_PROCESS_GROUP}
}
