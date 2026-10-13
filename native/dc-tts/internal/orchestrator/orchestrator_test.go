package orchestrator_test

import (
	"strings"
	"testing"

	"github.com/dc-studio/dc-tts/internal/orchestrator"
)

func TestStripMarkdown(t *testing.T) {
	input := "# Título Principal\n\nEste es un **texto en negrita** con `código inline` y un [enlace](https://dc.studio).\n\n```go\nfmt.Println(\"ignorar codigo\")\n```\n\n- Primer punto\n- Segundo punto"
	got := orchestrator.StripMarkdown(input)

	if strings.Contains(got, "fmt.Println") {
		t.Fatalf("expected fenced code block to be removed, got %q", got)
	}
	if strings.Contains(got, "**") || strings.Contains(got, "`") || strings.Contains(got, "https://") {
		t.Fatalf("expected markdown syntax removed, got %q", got)
	}
	if !strings.Contains(got, "Título Principal") || !strings.Contains(got, "texto en negrita") || !strings.Contains(got, "enlace") {
		t.Fatalf("expected spoken content preserved, got %q", got)
	}
}

func TestSplitByParagraphAndChunkText(t *testing.T) {
	p1 := "Primera oración corta. Segunda oración también breve."
	p2 := strings.Repeat("Esta es una oración bastante larga para probar el particionado automático por límite de caracteres. ", 3)
	raw := p1 + "\n\n" + p2

	paras := orchestrator.SplitByParagraph(raw)
	if len(paras) != 2 {
		t.Fatalf("expected 2 paragraphs, got %d", len(paras))
	}

	pieces := orchestrator.BuildParagraphPieces(raw, 180)
	if len(pieces) != 2 {
		t.Fatalf("expected 2 paragraph groups, got %d", len(pieces))
	}
	if len(pieces[0]) != 1 {
		t.Fatalf("expected paragraph 1 to fit in 1 chunk, got %d", len(pieces[0]))
	}
	if len(pieces[1]) < 2 {
		t.Fatalf("expected paragraph 2 to split into >= 2 chunks, got %d", len(pieces[1]))
	}
	for i, ch := range pieces[1] {
		if len(ch) > 180 {
			t.Errorf("chunk %d exceeds 180 chars (len=%d): %q", i, len(ch), ch)
		}
	}
}

func TestNavigate(t *testing.T) {
	if res := orchestrator.Navigate(0, 0, orchestrator.NavNext); res.Action != "noop" {
		t.Fatalf("expected noop on empty count, got %+v", res)
	}
	if res := orchestrator.Navigate(0, 3, orchestrator.NavPrev); res.Target != 0 || res.Action != "speak" {
		t.Fatalf("expected clamp to 0 on prev from 0, got %+v", res)
	}
	if res := orchestrator.Navigate(0, 3, orchestrator.NavNext); res.Target != 1 || res.Action != "speak" {
		t.Fatalf("expected target 1 on next from 0, got %+v", res)
	}
	if res := orchestrator.Navigate(2, 3, orchestrator.NavNext); res.Target != 2 || res.Action != "noop" {
		t.Fatalf("expected noop at end of paragraphs, got %+v", res)
	}
}

func TestFilterSubagentAndFinalResponse(t *testing.T) {
	subagentReport := "Subagent dc-sub-explore-123 finished.\n\n## Key Learnings\n" + strings.Repeat("Detalle técnico del subagente. ", 15)
	if orchestrator.IsFinalResponse(subagentReport, orchestrator.MessageMeta{}) {
		t.Fatal("expected subagent report by text to be filtered out")
	}

	if orchestrator.IsFinalResponse("Hola", orchestrator.MessageMeta{Agent: "dc-sub-worker-01"}) {
		t.Fatal("expected subagent message by agent name to be filtered out")
	}

	if orchestrator.IsFinalResponse("Pensando...", orchestrator.MessageMeta{IsThought: true}) {
		t.Fatal("expected thought message to be filtered out")
	}

	normalReply := "Listo, hemos configurado el túnel entre WSL y Windows correctamente."
	if !orchestrator.IsFinalResponse(normalReply, orchestrator.MessageMeta{Role: "assistant"}) {
		t.Fatal("expected normal assistant reply to be accepted")
	}
}
