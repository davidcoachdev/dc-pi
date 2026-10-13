// Command dc-tts-win is the Windows host daemon that listens on TCP :9876
// speaking the binary envelope protocol and driving Windows SAPI TTS + WinRT STT.
package main

import (
	"context"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/dc-studio/dc-tts/internal/winhost"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:9876", "TCP binary-envelope listen address")
	httpAddr := flag.String("http", "127.0.0.1:9877", "HTTP REST bridge listen address for dc-face & Pi")
	psBin := flag.String("ps", "", "PowerShell binary path (auto-detected on WSL2/Windows)")
	flag.Parse()

	eng, err := winhost.NewPowerShellEngine(*psBin)
	if err != nil {
		log.Fatalf("[dc-tts-win] failed to initialize speech engine: %v", err)
	}
	defer eng.Close()

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatalf("[dc-tts-win] failed to listen on %s: %v", *addr, err)
	}
	defer ln.Close()
	log.Printf("[dc-tts-win] listening TCP on %s (binary envelope protocol)", *addr)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if *httpAddr != "" {
		httpSrv := &http.Server{
			Addr:              *httpAddr,
			Handler:           winhost.NewHTTPHandler(eng),
			ReadHeaderTimeout: 5 * time.Second,
		}
		go func() {
			log.Printf("[dc-tts-win] listening HTTP on %s (dc-face & assistant bridge)", *httpAddr)
			if herr := httpSrv.ListenAndServe(); herr != nil && herr != http.ErrServerClosed {
				log.Printf("[dc-tts-win] HTTP server error: %v", herr)
			}
		}()
		go func() {
			<-ctx.Done()
			shutCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_ = httpSrv.Shutdown(shutCtx)
		}()
	}

	srv := winhost.NewServer(eng)
	if err := srv.Serve(ctx, ln); err != nil {
		log.Fatalf("[dc-tts-win] server error: %v", err)
	}
}
