package transport_test

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/dc-studio/dc-tts/internal/core"
	"github.com/dc-studio/dc-tts/internal/transport"
)

func TestResolveHostPriority(t *testing.T) {
	t.Setenv("WSL_BRIDGE_WIN_HOST", "10.20.30.40")

	if got := transport.ResolveHost("192.168.1.99"); got != "192.168.1.99" {
		t.Fatalf("ResolveHost explicit arg = %q, want 192.168.1.99", got)
	}
	if got := transport.ResolveHost(""); got != "10.20.30.40" {
		t.Fatalf("ResolveHost env = %q, want 10.20.30.40", got)
	}
}

func TestTCPTunnelBidirectionalAndEvents(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen error: %v", err)
	}
	defer ln.Close()

	errCh := make(chan error, 1)
	go func() {
		conn, aerr := ln.Accept()
		if aerr != nil {
			errCh <- aerr
			return
		}
		serverTun := transport.NewConnTunnel(conn)
		defer serverTun.Close()

		env, rerr := serverTun.Recv()
		if rerr != nil {
			errCh <- rerr
			return
		}
		// Reply with an Event envelope
		errCh <- serverTun.Send(core.Envelope{
			Type:    core.Event,
			Payload: env.Payload,
		})
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	clientTun, err := transport.Dial(ctx, ln.Addr().String())
	if err != nil {
		t.Fatalf("Dial error: %v", err)
	}
	defer clientTun.Close()

	if err := clientTun.Send(core.Envelope{Type: core.Control, Payload: []byte("status")}); err != nil {
		t.Fatalf("Send error: %v", err)
	}

	reply, err := clientTun.Recv()
	if err != nil {
		t.Fatalf("Recv error: %v", err)
	}
	if reply.Type != core.Event || string(reply.Payload) != "status" {
		t.Fatalf("unexpected reply: %+v", reply)
	}

	if serr := <-errCh; serr != nil {
		t.Fatalf("server error: %v", serr)
	}

	// Closing and sending again must return core.ErrTunnelClosed
	_ = clientTun.Close()
	if err := clientTun.Send(core.Envelope{Type: core.Control, Payload: []byte("ping")}); !errors.Is(err, core.ErrTunnelClosed) {
		t.Fatalf("expected ErrTunnelClosed after Close(), got %v", err)
	}
}
