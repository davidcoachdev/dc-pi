package core

import (
	"encoding/binary"
	"fmt"
	"io"
)

const headerLen = 5

// MaxPayloadBytes bounds single envelope allocations (32 MiB) to prevent OOM on corrupted streams.
const MaxPayloadBytes = 32 * 1024 * 1024

// Envelope is the binary transport unit: [1B Type][4B BigEndian Length][Payload].
type Envelope struct {
	Type    PayloadType
	Payload []byte
}

// Encode serializes an Envelope into its wire representation.
func Encode(env Envelope) []byte {
	buf := make([]byte, headerLen+len(env.Payload))
	buf[0] = byte(env.Type)
	binary.BigEndian.PutUint32(buf[1:5], uint32(len(env.Payload)))
	copy(buf[headerLen:], env.Payload)
	return buf
}

// Decode reads a single Envelope from r.
func Decode(r io.Reader) (Envelope, error) {
	header := make([]byte, headerLen)
	if _, err := io.ReadFull(r, header); err != nil {
		return Envelope{}, fmt.Errorf("core: incomplete header: %w", err)
	}

	typ := PayloadType(header[0])
	if !typ.Valid() {
		return Envelope{}, fmt.Errorf("%w: unknown payload type %d", ErrInvalidEnvelope, uint8(typ))
	}

	length := binary.BigEndian.Uint32(header[1:5])
	if length > MaxPayloadBytes {
		return Envelope{}, fmt.Errorf("%w: payload length %d exceeds limit %d", ErrInvalidEnvelope, length, MaxPayloadBytes)
	}

	payload := make([]byte, int(length))
	if length > 0 {
		if _, err := io.ReadFull(r, payload); err != nil {
			return Envelope{}, fmt.Errorf("core: incomplete payload (expected %d bytes): %w", length, err)
		}
	}

	return Envelope{Type: typ, Payload: payload}, nil
}
