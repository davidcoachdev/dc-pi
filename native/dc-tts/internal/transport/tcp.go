package transport

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/dc-studio/dc-tts/internal/core"
)

const dialTimeout = 5 * time.Second

type tcpTunnel struct {
	conn    net.Conn
	writeMu sync.Mutex
	closeMu sync.RWMutex
	closed  bool
}

// NewConnTunnel wraps an existing net.Conn (server or client side) into a thread-safe core.Tunnel.
func NewConnTunnel(conn net.Conn) core.Tunnel {
	return &tcpTunnel{conn: conn}
}

// Dial connects to addr over TCP and returns a thread-safe core.Tunnel.
func Dial(ctx context.Context, addr string) (core.Tunnel, error) {
	dctx := ctx
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		dctx, cancel = context.WithTimeout(ctx, dialTimeout)
		defer cancel()
	}

	var d net.Dialer
	conn, err := d.DialContext(dctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	return NewConnTunnel(conn), nil
}

func (t *tcpTunnel) isClosed() bool {
	t.closeMu.RLock()
	defer t.closeMu.RUnlock()
	return t.closed
}

func (t *tcpTunnel) markClosed() {
	t.closeMu.Lock()
	t.closed = true
	t.closeMu.Unlock()
}

// Send writes a binary Envelope atomically to the underlying TCP connection.
func (t *tcpTunnel) Send(env core.Envelope) error {
	if t.isClosed() {
		return core.ErrTunnelClosed
	}

	data := core.Encode(env)
	t.writeMu.Lock()
	_, err := t.conn.Write(data)
	t.writeMu.Unlock()

	if err != nil {
		if isClosedErr(err) {
			t.markClosed()
			return core.ErrTunnelClosed
		}
		return err
	}
	return nil
}

// Recv reads the next binary Envelope from the underlying TCP connection.
func (t *tcpTunnel) Recv() (core.Envelope, error) {
	if t.isClosed() {
		return core.Envelope{}, core.ErrTunnelClosed
	}

	env, err := core.Decode(t.conn)
	if err != nil {
		if errors.Is(err, core.ErrInvalidEnvelope) {
			return core.Envelope{}, fmt.Errorf("%w: %v", core.ErrInvalidEnvelope, err)
		}
		if isClosedErr(err) {
			t.markClosed()
			return core.Envelope{}, core.ErrTunnelClosed
		}
		return core.Envelope{}, err
	}
	return env, nil
}

// Close closes the underlying TCP connection idempotently.
func (t *tcpTunnel) Close() error {
	t.closeMu.Lock()
	if t.closed {
		t.closeMu.Unlock()
		return nil
	}
	t.closed = true
	t.closeMu.Unlock()
	return t.conn.Close()
}

func isClosedErr(err error) bool {
	if errors.Is(err, net.ErrClosed) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "use of closed network connection") ||
		strings.Contains(msg, "connection reset by peer") ||
		strings.Contains(msg, "broken pipe") ||
		strings.Contains(msg, "closed")
}
