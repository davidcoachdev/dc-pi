package winhost

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/dc-studio/dc-tts/internal/orchestrator"
	"github.com/dc-studio/dc-tts/internal/protocol"
)

// HTTPBridge provides the REST endpoints on 127.0.0.1:9877 consumed by dc-face
// (TtsBridgeClient) and Pi voice-assistant workflows.
type HTTPBridge struct {
	engine Engine

	navMu      sync.Mutex
	paragraphs [][]string
	currentIdx int
}

// NewHTTPHandler constructs an http.Handler exposing TTS, paragraph navigation,
// and dc-transcription voice-assistant endpoints.
func NewHTTPHandler(engine Engine) http.Handler {
	b := &HTTPBridge{engine: engine}
	mux := http.NewServeMux()

	mux.HandleFunc("/health", b.handleHealth)
	mux.HandleFunc("/status", b.handleStatus)
	mux.HandleFunc("/voices", b.handleVoices)
	mux.HandleFunc("/speak", b.handleSpeak)
	mux.HandleFunc("/read", b.handleRead)
	mux.HandleFunc("/nav", b.handleNav)
	mux.HandleFunc("/pause", b.handleSimpleCmd("pause"))
	mux.HandleFunc("/resume", b.handleSimpleCmd("resume"))
	mux.HandleFunc("/stop", b.handleSimpleCmd("stop"))
	mux.HandleFunc("/toggle", b.handleSimpleCmd("toggle"))
	mux.HandleFunc("/autoread", b.handleSimpleCmd("autoread"))
	mux.HandleFunc("/voice", b.handleVoice)
	mux.HandleFunc("/rate", b.handleRate)
	mux.HandleFunc("/volume", b.handleVolume)
	mux.HandleFunc("/beep", b.handleBeep)
	mux.HandleFunc("/listen", b.handleListen)
	mux.HandleFunc("/ask", b.handleAsk)

	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (b *HTTPBridge) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "dc-tts"})
}

func (b *HTTPBridge) handleStatus(w http.ResponseWriter, _ *http.Request) {
	st, err := b.engine.Command("status")
	if err != nil {
		writeJSON(w, http.StatusBadGateway, protocol.StatusResponse{Status: "idle", Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (b *HTTPBridge) handleVoices(w http.ResponseWriter, _ *http.Request) {
	voices, err := b.engine.Voices()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, protocol.VoicesResponse{Voices: voices})
}

func (b *HTTPBridge) handleSpeak(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Text) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing text"})
		return
	}
	st, err := b.engine.Command("speak:" + body.Text)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (b *HTTPBridge) speakParagraphLocked(idx int) (protocol.StatusResponse, int, error) {
	if idx < 0 || idx >= len(b.paragraphs) {
		st, err := b.engine.Command("status")
		return st, 0, err
	}
	_, _ = b.engine.Command("stop")
	chunks := b.paragraphs[idx]
	var lastSt protocol.StatusResponse
	var err error
	for _, ch := range chunks {
		lastSt, err = b.engine.Command("speak:" + ch)
		if err != nil {
			return lastSt, 0, err
		}
	}
	return lastSt, len(chunks), nil
}

func (b *HTTPBridge) handleRead(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text      string `json:"text"`
		Agent     string `json:"agent,omitempty"`
		Kind      string `json:"kind,omitempty"`
		IsThought bool   `json:"isThought,omitempty"`
		Force     bool   `json:"force,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Text) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing text"})
		return
	}

	if !body.Force {
		if curSt, serr := b.engine.Command("status"); serr == nil && !curSt.AutoRead {
			writeJSON(w, http.StatusOK, map[string]any{
				"status":   curSt.Status,
				"autoRead": false,
				"skipped":  true,
			})
			return
		}
	}

	meta := orchestrator.MessageMeta{
		Role:      "assistant",
		Agent:     body.Agent,
		Kind:      body.Kind,
		IsThought: body.IsThought,
	}
	if !orchestrator.IsFinalResponse(body.Text, meta) {
		_, _ = b.engine.Command("beep:info")
		writeJSON(w, http.StatusOK, map[string]any{
			"status":   "idle",
			"filtered": true,
		})
		return
	}

	paras := orchestrator.BuildParagraphPieces(body.Text, 180)
	b.navMu.Lock()
	b.paragraphs = paras
	b.currentIdx = 0
	st, chunks, err := b.speakParagraphLocked(0)
	b.navMu.Unlock()

	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":         st.Status,
		"paragraphs":     len(paras),
		"paragraphIndex": 0,
		"chunks":         chunks,
		"voice":          st.Voice,
	})
}

func (b *HTTPBridge) handleNav(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Direction string `json:"direction"` // "prev" | "next" | "replay"
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}

	b.navMu.Lock()
	defer b.navMu.Unlock()

	if body.Direction == "replay" {
		b.currentIdx = 0
		st, _, err := b.speakParagraphLocked(0)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"action": "speak", "target": 0, "status": st.Status})
		return
	}

	dir := orchestrator.NavNext
	if body.Direction == "prev" {
		dir = orchestrator.NavPrev
	}
	nav := orchestrator.Navigate(b.currentIdx, len(b.paragraphs), dir)
	b.currentIdx = nav.Target
	if nav.Action == "speak" {
		st, _, err := b.speakParagraphLocked(b.currentIdx)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"action": nav.Action,
			"target": nav.Target,
			"status": st.Status,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"action": nav.Action,
		"target": nav.Target,
	})
}

func (b *HTTPBridge) handleSimpleCmd(cmd string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		st, err := b.engine.Command(cmd)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, st)
	}
}

func (b *HTTPBridge) handleVoice(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Voice string `json:"voice"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Voice) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing voice"})
		return
	}
	st, err := b.engine.Command("voice " + strings.TrimSpace(body.Voice))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (b *HTTPBridge) handleRate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Rate float64 `json:"rate"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid rate"})
		return
	}
	st, err := b.engine.Command(fmt.Sprintf("rate %g", body.Rate))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (b *HTTPBridge) handleVolume(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Volume int `json:"volume"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid volume"})
		return
	}
	st, err := b.engine.Command(fmt.Sprintf("volume %d", body.Volume))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (b *HTTPBridge) handleBeep(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Kind string `json:"kind"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Kind == "" {
		body.Kind = "info"
	}
	st, err := b.engine.Command("beep:" + body.Kind)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (b *HTTPBridge) handleListen(w http.ResponseWriter, r *http.Request) {
	var req protocol.TranscriptionCommand
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.Language == "" {
		req.Language = "es-MX"
	}
	if req.WakeWord == "" {
		req.WakeWord = "dc"
	}
	text, conf, err := b.engine.TranscribeOnce(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, protocol.TranscriptionEvent{
			Event:       "stt.error",
			Mode:        req.Mode,
			ChoiceIndex: -1,
			Error:       err.Error(),
		})
		return
	}
	choiceIdx := -1
	if len(req.Choices) > 0 {
		if idx, ok := protocol.MatchVoiceChoice(text, req.Choices); ok {
			choiceIdx = idx
		}
	}
	wakeMatched, wakeCmd := protocol.ExtractWakeCommand(text, req.WakeWord)
	writeJSON(w, http.StatusOK, protocol.TranscriptionEvent{
		Event:       "stt.recognized",
		Mode:        req.Mode,
		Text:        text,
		Command:     wakeCmd,
		WakeMatched: wakeMatched,
		ChoiceIndex: choiceIdx,
		Confidence:  conf,
		Language:    req.Language,
	})
}

// handleAsk speaks a Pi question and its numbered options via TTS, then immediately
// listens for the user's spoken answer (or choice ordinal) via dc-transcription.
func (b *HTTPBridge) handleAsk(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Question string   `json:"question"`
		Choices  []string `json:"choices"`
		Language string   `json:"language,omitempty"`
		TimeoutS int      `json:"timeoutS,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Question) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing question"})
		return
	}

	var promptBuilder strings.Builder
	promptBuilder.WriteString(orchestrator.StripMarkdown(body.Question))
	for i, ch := range body.Choices {
		promptBuilder.WriteString(fmt.Sprintf(". Opción %d: %s", i+1, orchestrator.StripMarkdown(ch)))
	}
	_, _ = b.engine.Command("speak:" + promptBuilder.String())

	lang := body.Language
	if lang == "" {
		lang = "es-MX"
	}
	timeoutS := body.TimeoutS
	if timeoutS <= 0 {
		timeoutS = 8
	}

	text, conf, err := b.engine.TranscribeOnce(protocol.TranscriptionCommand{
		Action:   "once",
		Mode:     protocol.ListenModeQuestionReply,
		Language: lang,
		Choices:  body.Choices,
		TimeoutS: timeoutS,
	})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, protocol.TranscriptionEvent{
			Event:       "stt.error",
			Mode:        protocol.ListenModeQuestionReply,
			ChoiceIndex: -1,
			Error:       err.Error(),
		})
		return
	}

	choiceIdx := -1
	if len(body.Choices) > 0 {
		if idx, ok := protocol.MatchVoiceChoice(text, body.Choices); ok {
			choiceIdx = idx
		}
	}

	writeJSON(w, http.StatusOK, protocol.TranscriptionEvent{
		Event:       "stt.recognized",
		Mode:        protocol.ListenModeQuestionReply,
		Text:        text,
		ChoiceIndex: choiceIdx,
		Confidence:  conf,
		Language:    lang,
	})
}
