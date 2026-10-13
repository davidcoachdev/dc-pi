package client_test

import (
	"context"
	"encoding/json"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/dc-studio/dc-tts/internal/core"
	"github.com/dc-studio/dc-tts/internal/protocol"
	"github.com/dc-studio/dc-tts/internal/transport"
	"github.com/dc-studio/dc-tts/pkg/client"
)

func startMockWindowsServer(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen failed: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })

	go func() {
		for {
			conn, aerr := ln.Accept()
			if aerr != nil {
				return
			}
			go func(c net.Conn) {
				tun := transport.NewConnTunnel(c)
				defer tun.Close()
				for {
					env, rerr := tun.Recv()
					if rerr != nil {
						return
					}
					switch env.Type {
					case core.Control:
						cmd := string(env.Payload)
						var resp any
						switch {
						case cmd == "status":
							resp = protocol.StatusResponse{
								Status:     "idle",
								Queue:      0,
								AutoRead:   true,
								Voice:      "Microsoft Sabina Desktop",
								Rate:       1.0,
								Volume:     100,
								ListenMode: protocol.ListenModeOff,
								WakeWord:   "dc",
								Language:   "es-MX",
							}
						case strings.HasPrefix(cmd, "speak:"):
							resp = protocol.StatusResponse{
								Status: "playing",
								Queue:  1,
								Voice:  "Microsoft Sabina Desktop",
								Rate:   1.0,
								Volume: 100,
							}
						case cmd == "voices":
							resp = protocol.VoicesResponse{
								Voices: []protocol.VoiceInfo{
									{Name: "Microsoft Sabina Desktop", Culture: "es-MX", Gender: "Female"},
									{Name: "Microsoft Helena Desktop", Culture: "es-ES", Gender: "Female"},
								},
							}
						default:
							resp = protocol.StatusResponse{Status: "idle"}
						}
						b, _ := json.Marshal(resp)
						_ = tun.Send(core.Envelope{Type: core.Control, Payload: b})

					case core.Transcription:
						var req protocol.TranscriptionCommand
						_ = json.Unmarshal(env.Payload, &req)
						var ev protocol.TranscriptionEvent
						if req.Mode == protocol.ListenModeQuestionReply && len(req.Choices) > 0 {
							idx, _ := protocol.MatchVoiceChoice("opción 1", req.Choices)
							ev = protocol.TranscriptionEvent{
								Event:       "stt.recognized",
								Mode:        req.Mode,
								Text:        "opción 1",
								ChoiceIndex: idx,
								Confidence:  0.96,
								Language:    "es-MX",
							}
						} else {
							matched, wakeCmd := protocol.ExtractWakeCommand("dc corre los test del proyecto", req.WakeWord)
							ev = protocol.TranscriptionEvent{
								Event:       "stt.recognized",
								Mode:        req.Mode,
								Text:        "dc corre los test del proyecto",
								Command:     wakeCmd,
								WakeMatched: matched,
								ChoiceIndex: -1,
								Confidence:  0.94,
								Language:    "es-MX",
							}
						}
						b, _ := json.Marshal(ev)
						_ = tun.Send(core.Envelope{Type: core.Transcription, Payload: b})
					}
				}
			}(conn)
		}
	}()

	return ln.Addr().String()
}

func TestClientTtsAndTranscriptionFlow(t *testing.T) {
	addr := startMockWindowsServer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	c := client.New(addr)

	st, err := c.Status(ctx)
	if err != nil {
		t.Fatalf("Status error: %v", err)
	}
	if st.Voice != "Microsoft Sabina Desktop" || st.Status != "idle" {
		t.Fatalf("unexpected status: %+v", st)
	}

	speakSt, err := c.Speak(ctx, "Hola mundo desde DC Studio")
	if err != nil {
		t.Fatalf("Speak error: %v", err)
	}
	if speakSt.Status != "playing" {
		t.Fatalf("expected status playing after Speak, got %q", speakSt.Status)
	}

	voices, err := c.Voices(ctx)
	if err != nil {
		t.Fatalf("Voices error: %v", err)
	}
	if len(voices) != 2 {
		t.Fatalf("expected 2 voices, got %d", len(voices))
	}

	// Test Question Reply mode ("dc-face asks a question and waits for spoken answer")
	choiceEv, err := c.ListenQuestionReply(ctx, []string{"Ir con Go", "Ir con Rust"}, 5)
	if err != nil {
		t.Fatalf("ListenQuestionReply error: %v", err)
	}
	if choiceEv.ChoiceIndex != 0 || choiceEv.Text != "opción 1" {
		t.Fatalf("unexpected choice event: %+v", choiceEv)
	}

	// Test Wake Word mode ("dc corre los test del proyecto")
	wakeEv, err := c.ListenWakeWordOnce(ctx, "dc", 5)
	if err != nil {
		t.Fatalf("ListenWakeWordOnce error: %v", err)
	}
	if !wakeEv.WakeMatched || wakeEv.Command != "corre los test del proyecto" {
		t.Fatalf("unexpected wake event: %+v", wakeEv)
	}
}
