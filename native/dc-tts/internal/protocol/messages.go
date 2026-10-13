// Package protocol defines the JSON schemas and voice-assistant matching logic
// for TTS synthesis and dc-transcription (STT / wake-word / question answers).
package protocol

// ListenMode defines how dc-transcription captures user speech.
type ListenMode string

const (
	ListenModeOff           ListenMode = "off"
	ListenModeToggle        ListenMode = "toggle"
	ListenModePushToTalk    ListenMode = "push_to_talk"
	ListenModeWakeWord      ListenMode = "wake_word"
	ListenModeQuestionReply ListenMode = "question_reply"
)

// StatusResponse represents the unified state of TTS and dc-transcription on Windows.
type StatusResponse struct {
	Status     string     `json:"status"`               // "idle" | "playing" | "paused"
	Queue      int        `json:"queue"`                // pending TTS items
	AutoRead   bool       `json:"autoRead"`             // auto-read agent replies
	Voice      string     `json:"voice"`                // active SAPI voice name
	Rate       float64    `json:"rate"`                 // 0.25 .. 2.0
	Volume     int        `json:"volume"`               // 0 .. 100
	ListenMode ListenMode `json:"listenMode,omitempty"` // active STT mode
	WakeWord   string     `json:"wakeWord,omitempty"`   // default "dc"
	Language   string     `json:"language,omitempty"`   // e.g. "es-MX"
	Error      string     `json:"error,omitempty"`
}

// VoiceInfo describes an installed TTS voice.
type VoiceInfo struct {
	Name    string `json:"name"`
	Culture string `json:"culture"`
	Gender  string `json:"gender"`
}

// VoicesResponse lists installed TTS voices.
type VoicesResponse struct {
	Voices []VoiceInfo `json:"voices"`
}

// TranscriptionCommand configures or triggers dc-transcription on the host.
type TranscriptionCommand struct {
	Action   string     `json:"action"`             // "start" | "stop" | "status" | "once"
	Mode     ListenMode `json:"mode,omitempty"`     // "toggle" | "push_to_talk" | "wake_word" | "question_reply"
	Language string     `json:"language,omitempty"` // default "es-MX"
	WakeWord string     `json:"wakeWord,omitempty"` // default "dc"
	Choices  []string   `json:"choices,omitempty"`  // optional candidate labels when answering a Pi question
	TimeoutS int        `json:"timeoutS,omitempty"` // max seconds to wait in "once" / "question_reply" mode
}

// TranscriptionEvent is emitted by dc-transcription when speech is detected or recognized.
type TranscriptionEvent struct {
	Event       string     `json:"event"`                 // "stt.listening" | "stt.partial" | "stt.recognized" | "stt.stopped" | "stt.error"
	Mode        ListenMode `json:"mode,omitempty"`        // mode that produced the event
	Text        string     `json:"text,omitempty"`        // raw recognized transcript
	Command     string     `json:"command,omitempty"`     // extracted command after wake word
	WakeMatched bool       `json:"wakeMatched,omitempty"` // true if wake word was matched
	ChoiceIndex int        `json:"choiceIndex"`           // >= 0 when matched against Choices, -1 otherwise
	Confidence  float64    `json:"confidence,omitempty"`  // 0.0 .. 1.0
	Language    string     `json:"language,omitempty"`    // e.g. "es-MX"
	Error       string     `json:"error,omitempty"`
}

// TtsEvent is emitted when TTS playback state or viseme changes.
type TtsEvent struct {
	Event  string `json:"event"`            // "tts.state" | "tts.viseme"
	Status string `json:"status,omitempty"` // "idle" | "playing" | "paused"
	Viseme int    `json:"viseme,omitempty"` // 0 .. 21 SAPI viseme id
	DurMs  int    `json:"durMs,omitempty"`
}
