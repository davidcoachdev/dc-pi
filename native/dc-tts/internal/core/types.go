// Package core defines the transport-agnostic binary envelope and domain contracts.
package core

import "fmt"

// PayloadType identifies the wire format payload category.
type PayloadType uint8

const (
	// Control carries TTS/STT control commands and synchronous JSON responses.
	Control PayloadType = 1
	// Audio carries raw or WAV audio bytes.
	Audio PayloadType = 2
	// Image carries image payloads (e.g., screenshots/clipboard).
	Image PayloadType = 3
	// File carries arbitrary file chunks.
	File PayloadType = 4
	// Event carries asynchronous push events (tts.state, tts.viseme, stt.recognized).
	Event PayloadType = 5
	// Clipboard carries clipboard synchronization data.
	Clipboard PayloadType = 6
	// Transcription carries dc-transcription (STT/dictation/wake-word) payloads.
	Transcription PayloadType = 7
)

// String returns the canonical human-readable name for the PayloadType.
func (t PayloadType) String() string {
	switch t {
	case Control:
		return "control"
	case Audio:
		return "audio"
	case Image:
		return "image"
	case File:
		return "file"
	case Event:
		return "event"
	case Clipboard:
		return "clipboard"
	case Transcription:
		return "transcription"
	default:
		return fmt.Sprintf("unknown(%d)", uint8(t))
	}
}

// Valid reports whether the PayloadType is recognized in the wire protocol.
func (t PayloadType) Valid() bool {
	return t >= Control && t <= Transcription
}
