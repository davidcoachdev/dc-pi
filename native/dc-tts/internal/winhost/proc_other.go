//go:build !windows

package winhost

import "os/exec"

func configureHiddenProcess(_ *exec.Cmd) {}
