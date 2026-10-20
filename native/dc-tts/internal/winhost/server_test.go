package winhost_test

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/dc-studio/dc-tts/internal/protocol"
	"github.com/dc-studio/dc-tts/internal/winhost"
	"github.com/dc-studio/dc-tts/pkg/client"
)

type stubEngine struct {
	status protocol.StatusResponse
	voices []protocol.VoiceInfo
	spoken []string
	phrase string
}

func newStubEngine() *stubEngine {
	return &stubEngine{
		status: protocol.StatusResponse{
			Status:     "idle",
			Queue:      0,
			AutoRead:   true,
			Voice:      "Microsoft Sabina Desktop",
			Rate:       1.0,
			Volume:     100,
			ListenMode: protocol.ListenModeOff,
			WakeWord:   "dc",
			Language:   "es-MX",
		},
		voices: []protocol.VoiceInfo{
			{Name: "Microsoft Sabina Desktop", Culture: "es-MX", Gender: "Female"},
			{Name: "Microsoft Helena Desktop", Culture: "es-ES", Gender: "Female"},
		},
		phrase: "dc en que nos quedamos",
	}
}

func (s *stubEngine) Command(cmd string) (protocol.StatusResponse, error) {
	switch {
	case cmd == "status" || cmd == "wsl-bridge-handshake":
		return s.status, nil
	case len(cmd) > 6 && cmd[:6] == "speak:":
		s.spoken = append(s.spoken, cmd[6:])
		s.status.Status = "playing"
		s.status.Queue = len(s.spoken)
		return s.status, nil
	case cmd == "pause":
		s.status.Status = "paused"
		return s.status, nil
	case cmd == "resume":
		s.status.Status = "playing"
		return s.status, nil
	case cmd == "stop":
		s.status.Status = "idle"
		s.status.Queue = 0
		return s.status, nil
	case cmd == "toggle":
		if s.status.Status == "playing" {
			s.status.Status = "paused"
		} else {
			s.status.Status = "playing"
		}
		return s.status, nil
	case cmd == "autoread":
		s.status.AutoRead = !s.status.AutoRead
		return s.status, nil
	case cmd == "autoread on":
		s.status.AutoRead = true
		return s.status, nil
	case cmd == "autoread off":
		s.status.AutoRead = false
		return s.status, nil
	default:
		return s.status, nil
	}
}

func (s *stubEngine) Voices() ([]protocol.VoiceInfo, error) {
	return s.voices, nil
}

func (s *stubEngine) TranscribeOnce(req protocol.TranscriptionCommand) (string, float64, error) {
	return s.phrase, 0.93, nil
}

func (s *stubEngine) Close() error {
	return nil
}

func TestWinHostServerFullLifecycle(t *testing.T) {
	eng := newStubEngine()
	srv := winhost.NewServer(eng)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen error: %v", err)
	}
	defer ln.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = srv.Serve(ctx, ln)
	}()

	c := client.New(ln.Addr().String())
	callCtx, callCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer callCancel()

	// 1. Status
	st, err := c.Status(callCtx)
	if err != nil {
		t.Fatalf("Status error: %v", err)
	}
	if st.Voice != "Microsoft Sabina Desktop" {
		t.Fatalf("got voice %q, want Microsoft Sabina Desktop", st.Voice)
	}

	// 2. Speak -> Pause -> Resume -> Stop
	st, err = c.Speak(callCtx, "Probando el motor de voz")
	if err != nil || st.Status != "playing" {
		t.Fatalf("Speak got (%+v, %v), want playing", st, err)
	}
	st, err = c.Pause(callCtx)
	if err != nil || st.Status != "paused" {
		t.Fatalf("Pause got (%+v, %v), want paused", st, err)
	}
	st, err = c.Resume(callCtx)
	if err != nil || st.Status != "playing" {
		t.Fatalf("Resume got (%+v, %v), want playing", st, err)
	}
	st, err = c.Stop(callCtx)
	if err != nil || st.Status != "idle" {
		t.Fatalf("Stop got (%+v, %v), want idle", st, err)
	}

	// 3. Wake word transcription ("dc en que nos quedamos")
	ev, err := c.ListenWakeWordOnce(callCtx, "dc", 5)
	if err != nil {
		t.Fatalf("ListenWakeWordOnce error: %v", err)
	}
	if !ev.WakeMatched || ev.Command != "en que nos quedamos" {
		t.Fatalf("unexpected wake event: %+v", ev)
	}

	// 4. Question reply transcription ("la segunda")
	eng.phrase = "la segunda"
	qev, err := c.ListenQuestionReply(callCtx, []string{"Opción A", "Opción B"}, 5)
	if err != nil {
		t.Fatalf("ListenQuestionReply error: %v", err)
	}
	if qev.ChoiceIndex != 1 {
		t.Fatalf("expected ChoiceIndex 1, got %d (%+v)", qev.ChoiceIndex, qev)
	}
}
