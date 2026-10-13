package protocol

import (
	"strconv"
	"strings"
	"unicode"
)

// stripAccents removes diacritics and lowercases text for resilient Spanish/English voice matching.
func normalizeSpoken(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	var b strings.Builder
	for _, r := range s {
		switch r {
		case 'á', 'à', 'ä', 'â':
			b.WriteRune('a')
		case 'é', 'è', 'ë', 'ê':
			b.WriteRune('e')
		case 'í', 'ì', 'ï', 'î':
			b.WriteRune('i')
		case 'ó', 'ò', 'ö', 'ô':
			b.WriteRune('o')
		case 'ú', 'ù', 'ü', 'û':
			b.WriteRune('u')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// ExtractWakeCommand checks whether spoken starts with the wake word (e.g. "dc")
// followed by a word boundary (space, comma, colon, or end of string), and returns
// the remainder command trimmed of leading punctuation.
func ExtractWakeCommand(spoken, wakeWord string) (bool, string) {
	raw := strings.TrimSpace(spoken)
	wake := strings.TrimSpace(wakeWord)
	if wake == "" {
		wake = "dc"
	}
	if len(raw) < len(wake) {
		return false, ""
	}

	prefix := raw[:len(wake)]
	if !strings.EqualFold(prefix, wake) {
		return false, ""
	}

	rest := raw[len(wake):]
	if rest == "" {
		return true, ""
	}

	firstRune := []rune(rest)[0]
	if unicode.IsLetter(firstRune) || unicode.IsDigit(firstRune) {
		// e.g. "dcorrer" must not trigger wake word "dc"
		return false, ""
	}

	cleaned := strings.TrimLeftFunc(rest, func(r rune) bool {
		return unicode.IsSpace(r) || r == ',' || r == ':' || r == '.' || r == '-' || r == ';'
	})
	return true, strings.TrimSpace(cleaned)
}

var spanishOrdinals = map[string]int{
	"1":          0,
	"uno":        0,
	"una":        0,
	"primero":    0,
	"primera":    0,
	"opcion 1":   0,
	"opcion uno": 0,
	"la primera": 0,
	"el primero": 0,
	"2":          1,
	"dos":        1,
	"segundo":    1,
	"segunda":    1,
	"opcion 2":   1,
	"opcion dos": 1,
	"la segunda": 1,
	"el segundo": 1,
	"3":          2,
	"tres":       2,
	"tercero":    2,
	"tercera":    2,
	"opcion 3":   2,
	"opcion tres": 2,
	"la tercera": 2,
	"el tercero": 2,
	"4":            3,
	"cuatro":       3,
	"cuarto":       3,
	"cuarta":       3,
	"opcion 4":     3,
	"opcion cuatro": 3,
	"la cuarta":    3,
	"el cuarto":    3,
}

// MatchVoiceChoice matches a user's spoken phrase against an ordered slice of option labels.
// It supports direct ordinal phrases ("opción 1", "la segunda", "uno", "2") as well as
// substring matching against normalized option labels.
func MatchVoiceChoice(spoken string, options []string) (int, bool) {
	norm := normalizeSpoken(spoken)
	norm = strings.Trim(norm, ".,;:!?¡¿\"'")
	if norm == "" || len(options) == 0 {
		return -1, false
	}

	if idx, ok := spanishOrdinals[norm]; ok {
		if idx >= 0 && idx < len(options) {
			return idx, true
		}
		return -1, false
	}

	// Check "opcion <N>" for numeric N
	if strings.HasPrefix(norm, "opcion ") {
		numStr := strings.TrimSpace(strings.TrimPrefix(norm, "opcion "))
		if n, err := strconv.Atoi(numStr); err == nil {
			if n >= 1 && n <= len(options) {
				return n - 1, true
			}
			return -1, false
		}
	}

	// Match by normalized label substring
	for i, opt := range options {
		normOpt := normalizeSpoken(opt)
		if normOpt != "" && (strings.Contains(normOpt, norm) || strings.Contains(norm, normOpt)) {
			return i, true
		}
	}

	return -1, false
}
