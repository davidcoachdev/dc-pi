// Command dc-tts is the WSL2 CLI for controlling TTS synthesis and dc-transcription
// over the binary envelope tunnel to Windows.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/dc-studio/dc-tts/internal/orchestrator"
	"github.com/dc-studio/dc-tts/internal/protocol"
	"github.com/dc-studio/dc-tts/internal/transport"
	"github.com/dc-studio/dc-tts/pkg/client"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	sub := os.Args[1]
	fs := flag.NewFlagSet(sub, flag.ExitOnError)
	host := fs.String("host", "", "Windows host IP override (default: auto-detect gateway)")
	port := fs.String("port", client.DefaultPort, "TCP port")
	timeout := fs.Duration("timeout", 10*time.Second, "Operation timeout")
	wakeWord := fs.String("wake", "dc", "Wake word for listen mode")
	choicesCSV := fs.String("choices", "", "Comma-separated option labels for question_reply mode")
	_ = fs.Parse(os.Args[2:])

	addr := transport.Addr(transport.ResolveHost(*host), *port)
	c := client.New(addr)

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	args := fs.Args()

	switch sub {
	case "ping", "status":
		st, err := c.Status(ctx)
		must(err)
		printJSON(st)

	case "speak":
		text := strings.Join(args, " ")
		if strings.TrimSpace(text) == "" {
			fmt.Fprintln(os.Stderr, "error: speak requires text")
			os.Exit(1)
		}
		st, err := c.Speak(ctx, text)
		must(err)
		printJSON(st)

	case "pause":
		st, err := c.Pause(ctx)
		must(err)
		printJSON(st)

	case "resume":
		st, err := c.Resume(ctx)
		must(err)
		printJSON(st)

	case "stop":
		st, err := c.Stop(ctx)
		must(err)
		printJSON(st)

	case "toggle":
		st, err := c.Toggle(ctx)
		must(err)
		printJSON(st)

	case "voices":
		v, err := c.Voices(ctx)
		must(err)
		printJSON(protocol.VoicesResponse{Voices: v})

	case "voice":
		st, err := c.SetVoice(ctx, strings.Join(args, " "))
		must(err)
		printJSON(st)

	case "rate":
		if len(args) < 1 {
			fmt.Fprintln(os.Stderr, "error: rate requires a numeric value (0.25..2.0)")
			os.Exit(1)
		}
		r, err := strconv.ParseFloat(args[0], 64)
		must(err)
		st, err := c.SetRate(ctx, r)
		must(err)
		printJSON(st)

	case "volume":
		if len(args) < 1 {
			fmt.Fprintln(os.Stderr, "error: volume requires an integer value (0..100)")
			os.Exit(1)
		}
		v, err := strconv.Atoi(args[0])
		must(err)
		st, err := c.SetVolume(ctx, v)
		must(err)
		printJSON(st)

	case "beep":
		kind := "info"
		if len(args) > 0 {
			kind = args[0]
		}
		st, err := c.Beep(ctx, kind)
		must(err)
		printJSON(st)

	case "read":
		text := strings.Join(args, " ")
		if strings.TrimSpace(text) == "" {
			fmt.Fprintln(os.Stderr, "error: read requires markdown/text")
			os.Exit(1)
		}
		if !orchestrator.IsFinalResponse(text, orchestrator.MessageMeta{Role: "assistant"}) {
			_, _ = c.Beep(ctx, "info")
			printJSON(map[string]any{"filtered": true, "reason": "subagent_or_thought"})
			return
		}
		paras := orchestrator.BuildParagraphPieces(text, 180)
		var lastSt protocol.StatusResponse
		var err error
		chunksSent := 0
		for _, p := range paras {
			for _, chunk := range p {
				lastSt, err = c.Speak(ctx, chunk)
				must(err)
				chunksSent++
			}
		}
		printJSON(map[string]any{
			"status":     lastSt.Status,
			"paragraphs": len(paras),
			"chunks":     chunksSent,
			"voice":      lastSt.Voice,
		})

	case "ask":
		question := strings.Join(args, " ")
		if strings.TrimSpace(question) == "" {
			fmt.Fprintln(os.Stderr, "error: ask requires a question string")
			os.Exit(1)
		}
		var choices []string
		if strings.TrimSpace(*choicesCSV) != "" {
			for _, item := range strings.Split(*choicesCSV, ",") {
				if trimmed := strings.TrimSpace(item); trimmed != "" {
					choices = append(choices, trimmed)
				}
			}
		}
		var promptBuilder strings.Builder
		promptBuilder.WriteString(orchestrator.StripMarkdown(question))
		for i, ch := range choices {
			promptBuilder.WriteString(fmt.Sprintf(". Opción %d: %s", i+1, orchestrator.StripMarkdown(ch)))
		}
		_, err := c.Speak(ctx, promptBuilder.String())
		must(err)

		ev, err := c.ListenQuestionReply(ctx, choices, int(timeout.Seconds()))
		must(err)
		printJSON(ev)

	case "listen":
		if strings.TrimSpace(*choicesCSV) != "" {
			var choices []string
			for _, item := range strings.Split(*choicesCSV, ",") {
				if trimmed := strings.TrimSpace(item); trimmed != "" {
					choices = append(choices, trimmed)
				}
			}
			ev, err := c.ListenQuestionReply(ctx, choices, int(timeout.Seconds()))
			must(err)
			printJSON(ev)
			return
		}
		ev, err := c.ListenWakeWordOnce(ctx, *wakeWord, int(timeout.Seconds()))
		must(err)
		printJSON(ev)

	default:
		printUsage()
		os.Exit(1)
	}
}

func must(err error) {
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func printJSON(v any) {
	b, _ := json.MarshalIndent(v, "", "  ")
	fmt.Println(string(b))
}

func printUsage() {
	fmt.Fprintln(os.Stderr, "Usage: dc-tts <ping|status|speak|read|ask|pause|resume|stop|toggle|voices|voice|rate|volume|beep|listen> [flags] [args]")
}
