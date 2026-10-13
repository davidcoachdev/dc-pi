package core_test

import (
	"bytes"
	"errors"
	"testing"

	"github.com/dc-studio/dc-tts/internal/core"
)

func TestPayloadTypeValidAndString(t *testing.T) {
	cases := []struct {
		pt   core.PayloadType
		name string
		ok   bool
	}{
		{core.Control, "control", true},
		{core.Audio, "audio", true},
		{core.Image, "image", true},
		{core.File, "file", true},
		{core.Event, "event", true},
		{core.Clipboard, "clipboard", true},
		{core.Transcription, "transcription", true},
		{core.PayloadType(0), "unknown(0)", false},
		{core.PayloadType(99), "unknown(99)", false},
	}

	for _, tc := range cases {
		if got := tc.pt.Valid(); got != tc.ok {
			t.Errorf("PayloadType(%d).Valid() = %v, want %v", tc.pt, got, tc.ok)
		}
		if got := tc.pt.String(); got != tc.name {
			t.Errorf("PayloadType(%d).String() = %q, want %q", tc.pt, got, tc.name)
		}
	}
}

func TestEncodeDecodeRoundTrip(t *testing.T) {
	original := core.Envelope{
		Type:    core.Transcription,
		Payload: []byte(`{"mode":"wake_word","wakeWord":"dc","text":"dc corre los test del proyecto"}`),
	}

	wire := core.Encode(original)
	if len(wire) != 5+len(original.Payload) {
		t.Fatalf("wire len = %d, want %d", len(wire), 5+len(original.Payload))
	}

	decoded, err := core.Decode(bytes.NewReader(wire))
	if err != nil {
		t.Fatalf("Decode unexpected error: %v", err)
	}
	if decoded.Type != original.Type {
		t.Errorf("decoded.Type = %v, want %v", decoded.Type, original.Type)
	}
	if !bytes.Equal(decoded.Payload, original.Payload) {
		t.Errorf("decoded.Payload = %q, want %q", decoded.Payload, original.Payload)
	}
}

func TestDecodeEmptyPayload(t *testing.T) {
	wire := core.Encode(core.Envelope{Type: core.Control, Payload: nil})
	if len(wire) != 5 {
		t.Fatalf("expected 5-byte header for empty payload, got %d", len(wire))
	}
	decoded, err := core.Decode(bytes.NewReader(wire))
	if err != nil {
		t.Fatalf("Decode empty payload failed: %v", err)
	}
	if decoded.Type != core.Control || len(decoded.Payload) != 0 {
		t.Fatalf("unexpected decoded envelope: %+v", decoded)
	}
}

func TestDecodeErrorsOnMalformedInput(t *testing.T) {
	// 1. Short header (< 5 bytes)
	if _, err := core.Decode(bytes.NewReader([]byte{0x01, 0x00})); err == nil {
		t.Fatal("expected error for short header, got nil")
	}

	// 2. Invalid PayloadType (0x00)
	if _, err := core.Decode(bytes.NewReader([]byte{0x00, 0x00, 0x00, 0x00, 0x00})); !errors.Is(err, core.ErrInvalidEnvelope) {
		t.Fatalf("expected ErrInvalidEnvelope for type 0x00, got %v", err)
	}

	// 3. Truncated payload (declares 10 bytes, gives 2)
	if _, err := core.Decode(bytes.NewReader([]byte{byte(core.Control), 0x00, 0x00, 0x00, 0x0A, 'h', 'i'})); err == nil {
		t.Fatal("expected error for truncated payload, got nil")
	}
}
