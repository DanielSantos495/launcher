package main

import "os/exec"

func buildArgs(profileDir, container, u string) []string {
	args := []string{"--profile-directory=" + profileDir}
	if container != "" {
		args = append(args, "--container="+container)
	}
	return append(args, "--", u)
}

// launch ejecuta el navegador sin shell. No espera: la invocación secundaria reenvía la orden y termina.
// Stdin, stdout y stderr del hijo quedan en el dispositivo nulo (exec.Cmd con valores nil), así que
// el navegador no hereda la tubería de native messaging.
// security: sin shell; el ejecutable sale de config.json (ruta absoluta, nunca .bat/.cmd) y los argumentos
// ya pasaron por validateOpen (perfil y contenedor en lista blanca, URL re-serializada tras "--").
func launch(c config, args []string) error {
	var cmd *exec.Cmd
	if c.LaunchMode == "open" {
		cmd = exec.Command("/usr/bin/open", append([]string{"-n", "-a", c.AppPath, "--args"}, args...)...)
	} else {
		cmd = exec.Command(c.Exe, args...)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
