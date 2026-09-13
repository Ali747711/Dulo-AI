package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"agent-tui/api"

	"github.com/charmbracelet/lipgloss"
)

// renderTranscript re-derives the full scrollback from raw history at the
// given width. Called after every new event and after every resize, so a
// resize always re-wraps from the source events rather than re-wrapping
// already-wrapped text.
func renderTranscript(history []api.RunEvent, width int) string {
	var b strings.Builder
	for i, ev := range history {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(strings.Join(renderEvent(ev, width), "\n"))
	}
	return b.String()
}

// renderEvent turns one api.RunEvent into zero or more already-styled
// transcript lines, pre-wrapped/truncated to width. Per the bubbletea skill's
// golden rules, nothing here is left for the terminal or a bordered style to
// auto-wrap — every line is sized before it reaches the viewport.
func renderEvent(ev api.RunEvent, width int) []string {
	switch ev.Type {
	case "run.start":
		return []string{mutedStyle.Render(truncate(fmt.Sprintf("> %s", ev.Query), width))}

	case "step.start":
		return []string{stepStyle.Render(fmt.Sprintf("· step %d", ev.Step))}

	case "tool.call":
		line := fmt.Sprintf("  ⚙ %s(%s)", ev.Tool, formatArgs(ev.Args))
		return []string{toolStyle.Render(truncate(line, width))}

	case "tool.result":
		if ev.IsError {
			line := fmt.Sprintf("  ✗ %s failed: %s", ev.Tool, ev.ToolError())
			return []string{errStyle.Render(truncate(line, width))}
		}
		line := fmt.Sprintf("  ✓ %s -> %s", ev.Tool, oneLine(ev.Result))
		return []string{okStyle.Render(truncate(line, width))}

	case "assistant":
		return wrapLines(answerStyle, "◆ "+ev.Text, width)

	case "run.end":
		return []string{mutedStyle.Render(truncate(renderRunEnd(ev), width))}

	case api.StreamErrorType:
		return []string{errStyle.Render(truncate("! connection error: "+ev.RunEndError(), width))}

	default:
		return nil
	}
}

func renderRunEnd(ev api.RunEvent) string {
	switch ev.Status {
	case "completed":
		if ev.Reason == "step-limit" {
			return fmt.Sprintf("— done (step limit, %d steps, %dms)", ev.Steps, ev.DurationMs)
		}
		return fmt.Sprintf("— done (%d steps, %dms)", ev.Steps, ev.DurationMs)
	case "cancelled":
		return fmt.Sprintf("— cancelled (%d steps, %dms)", ev.Steps, ev.DurationMs)
	default: // "failed"
		return fmt.Sprintf("— failed: %s (%d steps, %dms)", ev.RunEndError(), ev.Steps, ev.DurationMs)
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
