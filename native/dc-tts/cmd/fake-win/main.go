// Command fake-win simulates the Windows TTS + dc-transcription binary envelope
// server on Linux/WSL for deterministic local testing.
package main

import (
	"encoding/json"
	"flag"
	"log"
	"net"
	"strings"

	"github.com/dc-studio/dc-tts/internal/core"
	"github.com/dc-studio/dc-tts/internal/protocol"
	"github.com/dc-studio/dc-tts/internal/transport"
)

func main() {
	port := flag.String("port", "9876", "TCP port to listen on")
	simPhrase := flag.String("phrase", "dc corre los test del proyecto", "Simulated spoken phrase for dc-transcription")
	flag.Parse()

	ln, err := net.Listen("tcp", "127.0.0.1:"+*port)
	if err != nil {
		log.Fatalf("[fake-win] listen error on :%s: %v", *port, err)
	}
	defer ln.Close()
	log.Printf("[fake-win] listening on 127.0.0.1:%s (binary envelope protocol)", *port)

	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		go handleConn(conn, *simPhrase)
	}
}

func handleConn(conn net.Conn, simPhrase string) {
	tun := transport.NewConnTunnel(conn)
	defer tun.Close()

	for {
		env, err := tun.Recv()
		if err != nil {
			return
		}
		resp := buildResponse(env, simPhrase)
		if err := tun.Send(resp); err != nil {
			return
		}
	}
}

func buildResponse(env core.Envelope, simPhrase string) core.Envelope {
	switch env.Type {
	case core.Control:
		cmd := string(env.Payload)
		var out any
		switch {
		case cmd == "status" || cmd == "wsl-bridge-handshake":
			out = protocol.StatusResponse{
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
		case cmd == "voices":
			out = protocol.VoicesResponse{
				Voices: []protocol.VoiceInfo{
					{Name: "Microsoft Sabina Desktop", Culture: "es-MX", Gender: "Female"},
					{Name: "Microsoft Helena Desktop", Culture: "es-ES", Gender: "Female"},
				},
			}
		case strings.HasPrefix(cmd, "speak:"):
			out = protocol.StatusResponse{
				Status: "playing",
				Queue:  1,
				Voice:  "Microsoft Sabina Desktop",
				Rate:   1.0,
				Volume: 100,
			}
		case cmd == "pause", cmd == "resume", cmd == "stop", cmd == "toggle", strings.HasPrefix(cmd, "beep:"):
			out = protocol.StatusResponse{Status: "idle", Queue: 0}
		default:
			out = protocol.StatusResponse{Status: "idle"}
		}
		b, _ := json.Marshal(out)
		return core.Envelope{Type: core.Control, Payload: b}

	case core.Transcription:
		var req protocol.TranscriptionCommand
		_ = json.Unmarshal(env.Payload, &req)
		phrase := simPhrase
		idx := -1
		if req.Mode == protocol.ListenModeQuestionReply && len(req.Choices) > 0 {
			idx, _ = protocol.MatchVoiceChoice(phrase, req.Choices)
		}
		matched, wakeCmd := protocol.ExtractWakeCommand(phrase, req.WakeWord)
		ev := protocol.TranscriptionEvent{
			Event:       "stt.recognized",
			Mode:        req.Mode,
			Text:        phrase,
			Command:     wakeCmd,
			WakeMatched: matched,
			ChoiceIndex: idx,
			Confidence:  0.95,
			Language:    req.Language,
		}
		b, _ := json.Marshal(ev)
		return core.Envelope{Type: core.Transcription, Payload: b}

	default:
		return core.Envelope{Type: env.Type, Payload: env.Payload}
	}
}
