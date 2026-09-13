package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"agent-tui/api"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

// renderTranscript re-derives the full scrollback from raw history at the
// given width. Called after every new event and after every resize, so a
// resize always re-wraps from the source events rather than re-wrapping
// already-wrapped text.
//
// Events renderEvent has nothing to say about (assistant.delta today, and any
// future event type the harness adds before this client knows it) contribute
// no separator and no blank line — otherwise every one of them, and there can
// be one per streamed token, shows up as an empty line in the scrollback.
func renderTranscript(history []api.RunEvent, width int) string {
	var b strings.Builder
	wroteAny := false
	for _, ev := range history {
		lines := renderEvent(ev, width)
		if len(lines) == 0 {
			continue
		}
		if wroteAny {
			b.WriteByte('\n')
		}
		b.WriteString(strings.Join(lines, "\n"))
		wroteAny = true
	}
	return b.String()
}

// renderEvent turns one api.RunEvent into zero or more already-styled
// transcript lines, pre-wrapped/truncated to width. Per the bubbletea skill's
// golden rules, nothing here is left for the terminal or a bordered style to
// auto-wrap — every line is sized before it reaches the viewport. Returning
// nil (any event this switch doesn't recognize) means "nothing to show" —
// renderTranscript above treats that as contributing no line, not a blank one.
func renderEvent(ev api.RunEvent, width int) []string {
	switch ev.Type {
	case "run.start":
		return []string{mutedStyle.Render(truncate(fmt.Sprintf("> %s", sanitize(ev.Query)), width))}

	case "step.start":
		return []string{stepStyle.Render(fmt.Sprintf("· step %d", ev.Step))}

	case "tool.call":
		line := fmt.Sprintf("  ⚙ %s(%s)", ev.Tool, formatArgs(ev.Args))
		return []string{toolStyle.Render(truncate(line, width))}

	case "tool.result":
		if ev.IsError {
			line := fmt.Sprintf("  ✗ %s failed: %s", ev.Tool, sanitize(ev.ToolError()))
			return []string{errStyle.Render(truncate(line, width))}
		}
		// Cut to width *before* sanitize/oneLine: a read_file/http_request
		// result can be hundreds of KB, but at most `width` runes of it will
		// ever be visible, so bound the string work to that instead of the
		// result's actual size. boundToWidth stops decoding as soon as it has
		// enough runes rather than converting the whole string first.
		result := oneLine(sanitize(boundToWidth(ev.Result, width)))
		line := fmt.Sprintf("  ✓ %s -> %s", ev.Tool, result)
		return []string{okStyle.Render(truncate(line, width))}

	case "assistant":
		return wrapLines(answerStyle, "◆ "+sanitize(ev.Text), width)

	case "run.end":
		return []string{mutedStyle.Render(truncate(renderRunEnd(ev), width))}

	case api.StreamErrorType:
		return []string{errStyle.Render(truncate("! connection error: "+sanitize(ev.RunEndError()), width))}

	default:
		return nil
	}
}

func renderRunEnd(ev api.RunEvent) string {
	usage := ""
	if ev.Usage != nil {
		usage = fmt.Sprintf(", %d tokens", ev.Usage.TotalTokens)
	}
	switch ev.Status {
	case "completed":
		if ev.Reason == "step-limit" {
			return fmt.Sprintf("— done (step limit, %d steps, %dms%s)", ev.Steps, ev.DurationMs, usage)
		}
		return fmt.Sprintf("— done (%d steps, %dms%s)", ev.Steps, ev.DurationMs, usage)
	case "cancelled":
		return fmt.Sprintf("— cancelled (%d steps, %dms%s)", ev.Steps, ev.DurationMs, usage)
	default: // "failed"
		return fmt.Sprintf("— failed: %s (%d steps, %dms%s)", sanitize(ev.RunEndError()), ev.Steps, ev.DurationMs, usage)
	}
}

// formatArgs renders tool-call arguments compactly for a single status line.
func formatArgs(args map[string]any) string {
	if len(args) == 0 {
		return ""
	}
	b, err := json.Marshal(args)
	if err != nil {
		return ""
	}
	return string(b)
}

// oneLine collapses a (possibly multi-line) tool result to one line for the
// compact status entry; the full result isn't shown in the transcript in v1.
func oneLine(s string) string {
	s = strings.ReplaceAll(s, "\n", " ⏎ ")
	return s
}

// sanitize strips ANSI/OSC escape sequences and other non-printable control
// bytes from text that ultimately came from outside this program (a tool
// result, the model's own text, a user-supplied query) before it reaches a
// lipgloss style. shell commonly returns colour codes (git, npm, ls
// --color); read_file/http_request/file_extract return arbitrary bytes.
// Left unstripped, a cursor-move, screen-clear, title-set or cursor-hide
// sequence would apply to this program's own terminal, and a bare \x1b left
// mid-string can desync the terminal for the rest of the session.
func sanitize(s string) string {
	s = ansi.Strip(s)
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r == '\n' || r == '\t':
			b.WriteRune(r)
		case r < 0x20 || r == 0x7f || (r >= 0x80 && r <= 0x9f):
			// C0/C1 control characters and DEL: dropped, not rendered.
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// boundToWidth returns at most the first n runes of s, stopping as soon as it
// has them rather than scanning to the end — so a 200KB string costs O(n),
// not O(len(s)), when only n runes will ever be displayed. A sequence
// straddling exactly the cut point is not specially handled: sanitize may
// leave a few raw bytes of an incomplete escape at the very end, which is far
// better than leaving whole uncut escape sequences in a 200KB result.
func boundToWidth(s string, n int) string {
	if n <= 0 {
		return ""
	}
	count := 0
	for i := range s {
		if count == n {
			return s[:i]
		}
		count++
	}
	return s
}

// truncate hard-cuts s to at most width runes, appending an ellipsis. Used
// for single-line status entries where wrapping would misalign the layout
// (Golden Rule 2 — never auto-wrap in a bordered panel).
func truncate(s string, width int) string {
	if width <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= width {
		return s
	}
	if width == 1 {
		return "…"
	}
	return string(r[:width-1]) + "…"
}

// wrapLines soft-wraps free-form text (the assistant's answer) to width,
// unlike truncate: readability of the full answer matters more than keeping
// it to one line. Wrapping happens here, once, before the lines are handed to
// the viewport — not left to an auto-wrapping bordered style at render time.
func wrapLines(style lipgloss.Style, text string, width int) []string {
	if width <= 0 {
		return nil
	}
	wrapped := lipgloss.NewStyle().Width(width).Render(text)
	lines := strings.Split(wrapped, "\n")
	out := make([]string, len(lines))
	for i, l := range lines {
		out[i] = style.Render(l)
	}
	return out
}
