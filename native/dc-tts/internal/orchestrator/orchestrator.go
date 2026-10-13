// Package orchestrator provides Markdown cleaning, paragraph splitting,
// sentence-aware chunking (<= 180 chars), paragraph navigation, and subagent
// filtering for agent responses.
package orchestrator

import (
	"regexp"
	"strings"
)

// NavDirection specifies paragraph navigation direction.
type NavDirection string

const (
	NavPrev NavDirection = "prev"
	NavNext NavDirection = "next"
)

// NavResult represents the resulting paragraph index and action.
type NavResult struct {
	Target int    `json:"target"`
	Action string `json:"action"` // "speak" | "noop"
}

// MessageMeta describes metadata about an agent session message.
type MessageMeta struct {
	Role      string
	Agent     string
	Kind      string
	IsThought bool
}

var (
	reFencedBacktick = regexp.MustCompile("(?s)```.*?```")
	reFencedTilde    = regexp.MustCompile("(?s)~~~.*?~~~")
	reInlineCode     = regexp.MustCompile("`([^`]+)`")
	reImage          = regexp.MustCompile(`!\[([^\]]*)\]\([^)]*\)`)
	reLink           = regexp.MustCompile(`\[([^\]]+)\]\([^)]*\)`)
	reBoldStar       = regexp.MustCompile(`\*\*([^*]+)\*\*`)
	reBoldUnder      = regexp.MustCompile(`__([^_]+)__`)
	reStrike         = regexp.MustCompile(`~~([^~]+)~~`)
	reItalicStar     = regexp.MustCompile(`(^|[^*])\*([^*]+)\*`)
	reItalicUnder    = regexp.MustCompile(`(^|[^_])_([^_]+)_`)
	reHeading        = regexp.MustCompile(`(?m)^\s{0,3}#{1,6}\s+`)
	reBlockquote     = regexp.MustCompile(`(?m)^\s{0,3}>\s?`)
	reHorizontalRule = regexp.MustCompile(`(?m)^\s{0,3}([-*_]\s*){3,}$`)
	reListItem       = regexp.MustCompile(`(?m)^\s{0,3}([-*+]|\d+[.)])\s+`)
	reHTMLTag        = regexp.MustCompile(`<\/?[^>]+>`)
	reEscaped        = regexp.MustCompile(`\\([*_` + "`" + `~])`)
	reMultiSpace     = regexp.MustCompile(`\s+`)

	reSubagentStatus  = regexp.MustCompile(`(?i)Status:\s*(running|pending)`)
	reSubagentHeading = regexp.MustCompile(`(?m)^##\s+(Key Learnings|Result|Summary)`)
	reSubagentPrefix  = regexp.MustCompile(`(?i)^Subagent\s+[a-z0-9_-]+\s+`)
)

// StripMarkdown removes code blocks, links, emphasis, headings, and HTML tags
// so the TTS synthesizer reads natural prose instead of punctuation symbols.
func StripMarkdown(text string) string {
	s := text
	s = reFencedBacktick.ReplaceAllString(s, " ")
	s = reFencedTilde.ReplaceAllString(s, " ")
	s = reInlineCode.ReplaceAllString(s, "$1")
	s = reImage.ReplaceAllString(s, "$1")
	s = reLink.ReplaceAllString(s, "$1")
	s = reBoldStar.ReplaceAllString(s, "$1")
	s = reBoldUnder.ReplaceAllString(s, "$1")
	s = reStrike.ReplaceAllString(s, "$1")
	s = reItalicStar.ReplaceAllString(s, "$1$2")
	s = reItalicUnder.ReplaceAllString(s, "$1$2")
	s = reHeading.ReplaceAllString(s, "")
	s = reBlockquote.ReplaceAllString(s, "")
	s = reHorizontalRule.ReplaceAllString(s, " ")
	s = reListItem.ReplaceAllString(s, "")
	s = reHTMLTag.ReplaceAllString(s, " ")
	s = reEscaped.ReplaceAllString(s, "$1")
	return s
}

// SplitByParagraph splits raw text by blank lines into non-empty paragraphs.
func SplitByParagraph(text string) []string {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	var paras []string
	var current []string

	flush := func() {
		if len(current) == 0 {
			return
		}
		joined := strings.TrimSpace(strings.Join(current, "\n"))
		if joined != "" {
			paras = append(paras, joined)
		}
		current = nil
	}

	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			flush()
		} else {
			current = append(current, line)
		}
	}
	flush()
	return paras
}

func splitSentences(s string) []string {
	var out []string
	var buf strings.Builder
	runes := []rune(s)

	for i := 0; i < len(runes); i++ {
		r := runes[i]
		buf.WriteRune(r)
		if (r == '.' || r == '!' || r == '?' || r == '…') && i+1 < len(runes) && runes[i+1] == ' ' {
			seg := strings.TrimSpace(buf.String())
			if seg != "" {
				out = append(out, seg)
			}
			buf.Reset()
			for i+1 < len(runes) && runes[i+1] == ' ' {
				i++
			}
		}
	}
	if tail := strings.TrimSpace(buf.String()); tail != "" {
		out = append(out, tail)
	}
	return out
}

// ChunkText strips Markdown, normalizes spaces, and splits text into chunks of at most maxLen bytes
// along sentence boundaries when possible.
func ChunkText(text string, maxLen int) []string {
	if maxLen <= 0 {
		maxLen = 180
	}
	cleaned := strings.TrimSpace(reMultiSpace.ReplaceAllString(StripMarkdown(text), " "))
	if cleaned == "" {
		return nil
	}
	if len(cleaned) <= maxLen {
		return []string{cleaned}
	}

	segments := splitSentences(cleaned)
	var chunks []string
	current := ""

	for _, seg := range segments {
		candidate := seg
		if current != "" {
			candidate = current + " " + seg
		}
		if len(candidate) > maxLen {
			if current != "" {
				chunks = append(chunks, strings.TrimSpace(current))
				current = ""
			}
			if len(seg) > maxLen {
				for len(seg) > maxLen {
					chunks = append(chunks, strings.TrimSpace(seg[:maxLen]))
					seg = strings.TrimSpace(seg[maxLen:])
				}
				current = seg
			} else {
				current = seg
			}
		} else {
			current = candidate
		}
	}

	if strings.TrimSpace(current) != "" {
		chunks = append(chunks, strings.TrimSpace(current))
	}
	return chunks
}

// BuildParagraphPieces splits text into paragraphs and chunks each paragraph to <= maxLen characters.
func BuildParagraphPieces(text string, maxLen int) [][]string {
	paras := SplitByParagraph(text)
	var out [][]string
	for _, p := range paras {
		if ch := ChunkText(p, maxLen); len(ch) > 0 {
			out = append(out, ch)
		}
	}
	return out
}

// Navigate computes the next or previous paragraph index given the current index and total paragraph count.
func Navigate(current, count int, dir NavDirection) NavResult {
	if count <= 0 {
		return NavResult{Target: current, Action: "noop"}
	}
	if dir == NavPrev {
		target := current - 1
		if target < 0 {
			target = 0
		}
		return NavResult{Target: target, Action: "speak"}
	}
	if count == 1 || current >= count-1 {
		return NavResult{Target: current, Action: "noop"}
	}
	return NavResult{Target: current + 1, Action: "speak"}
}

// IsSubagentMessage checks whether the message metadata belongs to a subagent.
func IsSubagentMessage(meta MessageMeta) bool {
	a := strings.ToLower(strings.TrimSpace(meta.Agent))
	if a == "" {
		return false
	}
	return strings.HasPrefix(a, "subagent") || strings.Contains(a, "subagent") || strings.HasPrefix(a, "dc-sub-")
}

// IsSubagentByText detects subagent reports and status dumps from text structure.
func IsSubagentByText(text string) bool {
	trimmed := strings.TrimSpace(text)
	if reSubagentPrefix.MatchString(trimmed) {
		return true
	}
	if len(trimmed) < 200 {
		return false
	}
	if reSubagentStatus.MatchString(trimmed) {
		return true
	}
	if reSubagentHeading.MatchString(trimmed) {
		return true
	}
	return false
}

// IsFinalResponse reports whether a message should be read aloud by TTS.
func IsFinalResponse(text string, meta MessageMeta) bool {
	if strings.TrimSpace(text) == "" {
		return false
	}
	if meta.IsThought || strings.EqualFold(meta.Kind, "thought") {
		return false
	}
	if IsSubagentMessage(meta) {
		return false
	}
	if IsSubagentByText(text) {
		return false
	}
	return true
}
