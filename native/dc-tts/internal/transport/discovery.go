package transport

import (
	"net"
	"os"
	"os/exec"
	"strings"
	"time"
)

const envHostKey = "WSL_BRIDGE_WIN_HOST"

var ipRouteCmd = func() ([]byte, error) {
	return exec.Command("ip", "route", "show", "default").Output()
}

// ResolveHost determines the target host IP for the tunnel.
// Priority: explicit arg > env WSL_BRIDGE_WIN_HOST > local daemon (127.0.0.1:9876) > default route gateway > 127.0.0.1.
func ResolveHost(arg string) string {
	if strings.TrimSpace(arg) != "" {
		return strings.TrimSpace(arg)
	}
	if env := strings.TrimSpace(os.Getenv(envHostKey)); env != "" {
		return env
	}
	if isLocalPortOpen("127.0.0.1:9876") {
		return "127.0.0.1"
	}
	if gw := gatewayIP(); gw != "" {
		return gw
	}
	return "127.0.0.1"
}

func isLocalPortOpen(addr string) bool {
	conn, err := net.DialTimeout("tcp", addr, 50*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func gatewayIP() string {
	out, err := ipRouteCmd()
	if err != nil {
		return ""
	}
	fields := strings.Fields(string(out))
	for i, f := range fields {
		if f == "via" && i+1 < len(fields) {
			if ip := net.ParseIP(fields[i+1]); ip != nil {
				return fields[i+1]
			}
		}
	}
	return ""
}

// Addr joins host and port into "host:port".
func Addr(host, port string) string {
	return net.JoinHostPort(host, port)
}
