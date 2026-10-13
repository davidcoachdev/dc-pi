package core

import "errors"

// Tunnel is the bidirectional binary transport port.
type Tunnel interface {
	Send(Envelope) error
	Recv() (Envelope, error)
	Close() error
}

// ErrTunnelClosed is returned when operating on a closed tunnel.
var ErrTunnelClosed = errors.New("core: tunnel closed")

// ErrInvalidEnvelope is returned when an envelope has an unknown type or corrupted header.
var ErrInvalidEnvelope = errors.New("core: invalid envelope")
