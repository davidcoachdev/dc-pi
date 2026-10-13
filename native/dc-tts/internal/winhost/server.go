// Package winhost implements the Windows host binary-envelope server and
// hexagonal speech engine port (TTS synthesis + dc-transcription STT).
package winhost

import (
	"context"
	"encoding/json"
	"net"
	"strings"

	"github.com/dc-studio/dc-tts/internal/core"
	"github.com/dc-studio/dc-tts/internal/protocol"
	"github.com/dc-studio/dc-tts/internal/transport"
)

// Engine is the hexagonal port for Windows native TTS and dc-transcription.
// Any backend (Windows SAPI/WinRT, custom dc-transcription ONNX/GGUF, or mock)
// implements this contract without coupling to TCP or binary envelopes.
type Engine interface {
	Command(cmd string) (protocol.StatusResponse, error)
	Voices() ([]protocol.VoiceInfo, error)
	TranscribeOnce(req protocol.TranscriptionCommand) (text string, confidence float64, err error)
	Close() error
}

// Server serves the binary envelope protocol over TCP :9876.
type Server struct {
	engine Engine
}

// NewServer creates a Server backed by the provided Engine.
func NewServer(engine Engine) *Server {
	return &Server{engine: engine}
}

// Serve accepts incoming connections on ln until ctx is canceled or ln is closed.
func (s *Server) Serve(ctx context.Context, ln net.Listener) error {
	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		go s.handleConn(conn)
	}
}

func (s *Server) handleConn(conn net.Conn) {
	tun := transport.NewConnTunnel(conn)
	defer tun.Close()

	for {
		env, err := tun.Recv()
		if err != nil {
			return
		}
		resp := s.dispatch(env)
		if err := tun.Send(resp); err != nil {
			return
		}
	}
}

func (s *Server) dispatch(env core.Envelope) core.Envelope {
	switch env.Type {
	case core.Control:
		cmd := strings.TrimSpace(string(env.Payload))
		if cmd == "voices" {
			voices, err := s.engine.Voices()
			if err != nil {
				b, _ := json.Marshal(protocol.StatusResponse{Error: err.Error()})
				return core.Envelope{Type: core.Control, Payload: b}
			}
			b, _ := json.Marshal(protocol.VoicesResponse{Voices: voices})
			return core.Envelope{Type: core.Control, Payload: b}
		}

		st, err := s.engine.Command(cmd)
		if err != nil {
			st.Error = err.Error()
		}
		b, _ := json.Marshal(st)
		return core.Envelope{Type: core.Control, Payload: b}

	case core.Transcription:
		var req protocol.TranscriptionCommand
		if err := json.Unmarshal(env.Payload, &req); err != nil {
			b, _ := json.Marshal(protocol.TranscriptionEvent{
				Event:       "stt.error",
				ChoiceIndex: -1,
				Error:       "invalid transcription request JSON: " + err.Error(),
			})
			return core.Envelope{Type: core.Transcription, Payload: b}
		}
		if req.Language == "" {
			req.Language = "es-MX"
		}
		if req.WakeWord == "" {
			req.WakeWord = "dc"
		}

		text, conf, err := s.engine.TranscribeOnce(req)
		if err != nil {
			b, _ := json.Marshal(protocol.TranscriptionEvent{
				Event:       "stt.error",
				Mode:        req.Mode,
				Language:    req.Language,
				ChoiceIndex: -1,
				Error:       err.Error(),
			})
			return core.Envelope{Type: core.Transcription, Payload: b}
		}

		choiceIdx := -1
		if len(req.Choices) > 0 {
			if idx, ok := protocol.MatchVoiceChoice(text, req.Choices); ok {
				choiceIdx = idx
			}
		}

		wakeMatched, wakeCmd := protocol.ExtractWakeCommand(text, req.WakeWord)

		ev := protocol.TranscriptionEvent{
			Event:       "stt.recognized",
			Mode:        req.Mode,
			Text:        text,
			Command:     wakeCmd,
			WakeMatched: wakeMatched,
			ChoiceIndex: choiceIdx,
			Confidence:  conf,
			Language:    req.Language,
		}
		b, _ := json.Marshal(ev)
		return core.Envelope{Type: core.Transcription, Payload: b}

	default:
		return core.Envelope{Type: env.Type, Payload: env.Payload}
	}
}
