package winhost_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dc-studio/dc-tts/internal/protocol"
	"github.com/dc-studio/dc-tts/internal/winhost"
)

func TestHTTPBridgeEndpointsForDcFaceAndAssistant(t *testing.T) {
	eng := newStubEngine()
	handler := winhost.NewHTTPHandler(eng)
	ts := httptest.NewServer(handler)
	defer ts.Close()

	// 1. GET /status (used by dc-face TtsBridgeClient)
	resp, err := http.Get(ts.URL + "/status")
	if err != nil {
		t.Fatalf("GET /status error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /status code = %d, want 200", resp.StatusCode)
	}
	var st protocol.StatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		t.Fatalf("decode /status error: %v", err)
	}
	if st.Status != "idle" || st.Voice != "Microsoft Sabina Desktop" {
		t.Fatalf("unexpected /status: %+v", st)
	}

	// 2. POST /read (Markdown cleaning + full multi-paragraph sequential playback)
	readBody, _ := json.Marshal(map[string]any{
		"text": "# Hola\n\nPrimer párrafo con **negrita**.\n\n```ts\nconst x = 1;\n```\n\nSegundo párrafo de prueba.",
	})
	resp2, err := http.Post(ts.URL+"/read", "application/json", bytes.NewReader(readBody))
	if err != nil {
		t.Fatalf("POST /read error: %v", err)
	}
	defer resp2.Body.Close()
	var readRes map[string]any
	_ = json.NewDecoder(resp2.Body).Decode(&readRes)
	if readRes["status"] != "playing" {
		t.Fatalf("expected status playing after POST /read, got %+v", readRes)
	}
	if len(eng.spoken) != 3 {
		t.Fatalf("expected all 3 paragraphs queued on POST /read, got %d (%v)", len(eng.spoken), eng.spoken)
	}

	// 3. POST /nav (next paragraph)
	navBody, _ := json.Marshal(map[string]string{"direction": "next"})
	resp3, err := http.Post(ts.URL+"/nav", "application/json", bytes.NewReader(navBody))
	if err != nil {
		t.Fatalf("POST /nav error: %v", err)
	}
	defer resp3.Body.Close()
	var navRes map[string]any
	_ = json.NewDecoder(resp3.Body).Decode(&navRes)
	if navRes["action"] != "speak" {
		t.Fatalf("expected action speak on POST /nav next, got %+v", navRes)
	}

	// 4. POST /ask (Assistant reads question & options, then listens for spoken choice)
	eng.phrase = "opción 1"
	askBody, _ := json.Marshal(map[string]any{
		"question": "¿Con qué lenguaje construimos el Core?",
		"choices":  []string{"Go estático", "Rust"},
		"timeoutS": 5,
	})
	resp4, err := http.Post(ts.URL+"/ask", "application/json", bytes.NewReader(askBody))
	if err != nil {
		t.Fatalf("POST /ask error: %v", err)
	}
	defer resp4.Body.Close()
	var askEv protocol.TranscriptionEvent
	if err := json.NewDecoder(resp4.Body).Decode(&askEv); err != nil {
		t.Fatalf("decode /ask error: %v", err)
	}
	// 5. POST /autoread (toggle autoRead ON/OFF)
	resp5, err := http.Post(ts.URL+"/autoread", "application/json", bytes.NewReader([]byte(`{}`)))
	if err != nil {
		t.Fatalf("POST /autoread error: %v", err)
	}
	defer resp5.Body.Close()
	if resp5.StatusCode != http.StatusOK {
		t.Fatalf("POST /autoread code = %d, want 200", resp5.StatusCode)
	}
	var arSt protocol.StatusResponse
	if err := json.NewDecoder(resp5.Body).Decode(&arSt); err != nil {
		t.Fatalf("decode /autoread error: %v", err)
	}
	if arSt.AutoRead != false {
		t.Fatalf("expected autoRead=false after toggle, got %+v", arSt)
	}
}
