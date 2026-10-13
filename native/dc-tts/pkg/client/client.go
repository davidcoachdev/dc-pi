// Package client provides a high-level Go client for the dc-tts and dc-transcription
// binary envelope tunnel between WSL2 and Windows.
package client

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/dc-studio/dc-tts/internal/core"
	"github.com/dc-studio/dc-tts/internal/protocol"
	"github.com/dc-studio/dc-tts/internal/transport"
)

// DefaultPort is the default TCP port for the Windows TTS/STT sidecar.
const DefaultPort = "9876"

// Client communicates with the Windows host daemon over the binary envelope tunnel.
type Client struct {
	addr string
}

// New creates a Client targeting the given "host:port" address.
// If addr is empty, it resolves the Windows host automatically on DefaultPort.
func New(addr string) *Client {
	if strings.TrimSpace(addr) == "" {
		addr = transport.Addr(transport.ResolveHost(""), DefaultPort)
	}
	return &Client{addr: addr}
}

// Addr returns the target "host:port" address.
func (c *Client) Addr() string {
	return c.addr
}

func (c *Client) roundTrip(ctx context.Context, req core.Envelope) (core.Envelope, error) {
	tun, err := transport.Dial(ctx, c.addr)
	if err != nil {
		return core.Envelope{}, err
	}
	defer tun.Close()

	if err := tun.Send(req); err != nil {
		return core.Envelope{}, err
	}
	return tun.Recv()
}

func (c *Client) sendControl(ctx context.Context, cmd string) (protocol.StatusResponse, error) {
	clean := strings.ReplaceAll(strings.ReplaceAll(cmd, "\r", " "), "\n", " ")
	env, err := c.roundTrip(ctx, core.Envelope{
		Type:    core.Control,
		Payload: []byte(clean),
	})
	if err != nil {
		return protocol.StatusResponse{}, err
	}

	var st protocol.StatusResponse
	if err := json.Unmarshal(env.Payload, &st); err != nil {
		return protocol.StatusResponse{}, fmt.Errorf("client: invalid status JSON %q: %w", env.Payload, err)
	}
	if st.Error != "" {
		return st, fmt.Errorf("client: remote error: %s", st.Error)
	}
	return st, nil
}

// Status queries the current TTS and dc-transcription status from Windows.
func (c *Client) Status(ctx context.Context) (protocol.StatusResponse, error) {
	return c.sendControl(ctx, "status")
}

// Speak enqueues text for speech synthesis on Windows.
func (c *Client) Speak(ctx context.Context, text string) (protocol.StatusResponse, error) {
	return c.sendControl(ctx, "speak:"+text)
}

// Pause pauses active speech synthesis.
func (c *Client) Pause(ctx context.Context) (protocol.StatusResponse, error) {
	return c.sendControl(ctx, "pause")
}

// Resume resumes paused speech synthesis.
func (c *Client) Resume(ctx context.Context) (protocol.StatusResponse, error) {
	return c.sendControl(ctx, "resume")
}

// Stop cancels active speech and clears the queue.
func (c *Client) Stop(ctx context.Context) (protocol.StatusResponse, error) {
	return c.sendControl(ctx, "stop")
}

// Toggle toggles between playing and paused states.
func (c *Client) Toggle(ctx context.Context) (protocol.StatusResponse, error) {
	return c.sendControl(ctx, "toggle")
}

// SetVoice selects the active Windows SAPI voice by name.
func (c *Client) SetVoice(ctx context.Context, voiceName string) (protocol.StatusResponse, error) {
	return c.sendControl(ctx, "voice "+strings.TrimSpace(voiceName))
}

// SetRate sets the speech rate multiplier (0.25 .. 2.0).
func (c *Client) SetRate(ctx context.Context, rate float64) (protocol.StatusResponse, error) {
	return c.sendControl(ctx, fmt.Sprintf("rate %g", rate))
}

// SetVolume sets the speech volume (0 .. 100).
func (c *Client) SetVolume(ctx context.Context, volume int) (protocol.StatusResponse, error) {
	return c.sendControl(ctx, fmt.Sprintf("volume %d", volume))
}

// Beep triggers a native Windows system sound ("alert", "result", "error", "info").
func (c *Client) Beep(ctx context.Context, kind string) (protocol.StatusResponse, error) {
	return c.sendControl(ctx, "beep:"+strings.TrimSpace(kind))
}

// Voices lists all installed TTS voices on the Windows host.
func (c *Client) Voices(ctx context.Context) ([]protocol.VoiceInfo, error) {
	env, err := c.roundTrip(ctx, core.Envelope{
		Type:    core.Control,
		Payload: []byte("voices"),
	})
	if err != nil {
		return nil, err
	}

	var vr protocol.VoicesResponse
	if err := json.Unmarshal(env.Payload, &vr); err != nil {
		return nil, fmt.Errorf("client: invalid voices JSON %q: %w", env.Payload, err)
	}
	return vr.Voices, nil
}

// ListenOnce sends a dc-transcription command and awaits the recognized speech event.
func (c *Client) ListenOnce(ctx context.Context, cmd protocol.TranscriptionCommand) (protocol.TranscriptionEvent, error) {
	if cmd.Action == "" {
		cmd.Action = "once"
	}
	if cmd.Language == "" {
		cmd.Language = "es-MX"
	}
	if cmd.WakeWord == "" {
		cmd.WakeWord = "dc"
	}

	payload, err := json.Marshal(cmd)
	if err != nil {
		return protocol.TranscriptionEvent{}, err
	}

	env, err := c.roundTrip(ctx, core.Envelope{
		Type:    core.Transcription,
		Payload: payload,
	})
	if err != nil {
		return protocol.TranscriptionEvent{}, err
	}

	var ev protocol.TranscriptionEvent
	if err := json.Unmarshal(env.Payload, &ev); err != nil {
		return protocol.TranscriptionEvent{}, fmt.Errorf("client: invalid transcription JSON %q: %w", env.Payload, err)
	}
	if ev.Error != "" {
		return ev, fmt.Errorf("client: transcription error: %s", ev.Error)
	}
	return ev, nil
}

// ListenQuestionReply listens for a user's spoken answer to a Pi question and matches it against choices.
func (c *Client) ListenQuestionReply(ctx context.Context, choices []string, timeoutS int) (protocol.TranscriptionEvent, error) {
	return c.ListenOnce(ctx, protocol.TranscriptionCommand{
		Action:   "once",
		Mode:     protocol.ListenModeQuestionReply,
		Language: "es-MX",
		Choices:  choices,
		TimeoutS: timeoutS,
	})
}

// ListenWakeWordOnce listens for a wake-word command (e.g. "dc corre los test del proyecto").
func (c *Client) ListenWakeWordOnce(ctx context.Context, wakeWord string, timeoutS int) (protocol.TranscriptionEvent, error) {
	return c.ListenOnce(ctx, protocol.TranscriptionCommand{
		Action:   "once",
		Mode:     protocol.ListenModeWakeWord,
		Language: "es-MX",
		WakeWord: wakeWord,
		TimeoutS: timeoutS,
	})
}
