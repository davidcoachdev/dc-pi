package protocol_test

import (
	"testing"

	"github.com/dc-studio/dc-tts/internal/protocol"
)

func TestExtractWakeCommand(t *testing.T) {
	cases := []struct {
		input   string
		wake    string
		matched bool
		command string
	}{
		{"dc corre los test del proyecto", "dc", true, "corre los test del proyecto"},
		{"DC, en qué nos quedamos", "dc", true, "en qué nos quedamos"},
		{"  dc: ejecuta el build  ", "dc", true, "ejecuta el build"},
		{"hola mundo sin frase de activación", "dc", false, ""},
		{"dcorrer todo pegado", "dc", false, ""},
		{"dc", "dc", true, ""},
	}

	for _, tc := range cases {
		matched, cmd := protocol.ExtractWakeCommand(tc.input, tc.wake)
		if matched != tc.matched || cmd != tc.command {
			t.Errorf("ExtractWakeCommand(%q, %q) = (%v, %q), want (%v, %q)",
				tc.input, tc.wake, matched, cmd, tc.matched, tc.command)
		}
	}
}

func TestMatchVoiceChoice(t *testing.T) {
	options := []string{
		"Ir con Go (Binario estático WSL + .exe Windows)",
		"Rust (requiere instalar toolchain Windows)",
	}

	cases := []struct {
		spoken  string
		wantIdx int
		wantOK  bool
	}{
		{"opción 1", 0, true},
		{"opcion uno", 0, true},
		{"la primera", 0, true},
		{"1", 0, true},
		{"opción 2", 1, true},
		{"opcion dos", 1, true},
		{"la segunda", 1, true},
		{"ir con go", 0, true},
		{"rust", 1, true},
		{"opción 9", -1, false},
	}

	for _, tc := range cases {
		idx, ok := protocol.MatchVoiceChoice(tc.spoken, options)
		if idx != tc.wantIdx || ok != tc.wantOK {
			t.Errorf("MatchVoiceChoice(%q) = (%d, %v), want (%d, %v)",
				tc.spoken, idx, ok, tc.wantIdx, tc.wantOK)
		}
	}
}
