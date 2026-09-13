package main

import (
	"strings"
	"testing"
	"time"

	"agent-tui/api"
)

// F1: an event renderEvent doesn't recognize (assistant.delta, permission.ask,
// etc.) must contribute nothing — not a blank line — to the transcript.
func TestRenderTranscript_UnhandledEventsProduceNoBlankLines(t *testing.T) {
	history := []api.RunEvent{
		{Type: "run.start", RunID: "r1", Query: "hi"},
		{Type: "assistant.delta", Step: 1, Text: "he"},
		{Type: "assistant.delta", Step: 1, Text: "llo"},
		{Type: "permission.ask", Step: 1},
		{Type: "context.condensed", Step: 1},
		{Type: "assistant", Step: 1, Text: "hello"},
		{Type: "run.end", Status: "completed", Steps: 1, DurationMs: 5},
	}

	out := renderTranscript(history, 80)
	lines := strings.Split(out, "\n")

	for _, l := range lines {
		if strings.TrimSpace(l) == "" {
			t.Fatalf("unexpected blank line in rendered transcript:\n%q", out)
		}
	}
	if len(lines) != 3 {
		t.Fatalf("got %d non-blank lines, want 3 (run.start, assistant, run.end): %q", len(lines), lines)
	}
}

// F5: ANSI/OSC escape sequences and other control bytes from tool output
// must never reach the rendered line.
func TestSanitize_StripsAnsiAndControlBytes(t *testing.T) {
	in := "\x1b[2Jhello\x1b]0;title\x07world\x7f\n\ttab"
	out := sanitize(in)

	if strings.ContainsAny(out, "\x1b\x07\x7f") {
		t.Fatalf("sanitize left control bytes behind: %q", out)
	}
	if !strings.Contains(out, "hello") || !strings.Contains(out, "world") {
		t.Fatalf("sanitize dropped real content: %q", out)
	}
	if !strings.Contains(out, "\n") || !strings.Contains(out, "\t") {
		t.Fatalf("sanitize should keep newline and tab: %q", out)
	}
}

func TestRenderEvent_ToolResultIsSanitized(t *testing.T) {
	ev := api.RunEvent{Type: "tool.result", Tool: "shell", Result: "\x1b[31mred\x1b[0m text"}
	joined := strings.Join(renderEvent(ev, 80), "\n")

	if strings.Contains(joined, "\x1b") {
		t.Fatalf("escape sequence leaked into rendered line: %q", joined)
	}
	if !strings.Contains(joined, "red") || !strings.Contains(joined, "text") {
		t.Fatalf("rendered line lost real content: %q", joined)
	}
}

func TestRenderEvent_AssistantTextIsSanitized(t *testing.T) {
	ev := api.RunEvent{Type: "assistant", Step: 1, Text: "before\x1b[2Jafter"}
	joined := strings.Join(renderEvent(ev, 80), "\n")
	if strings.Contains(joined, "\x1b") {
		t.Fatalf("escape sequence leaked into assistant text: %q", joined)
	}
}

// F6: boundToWidth must stop early rather than scan the whole string.
func TestBoundToWidth(t *testing.T) {
	cases := []struct {
		s, want string
		n       int
	}{
		{"hello", "hello", 10},
		{"hello", "hel", 3},
		{"hello", "", 0},
		{"héllo", "hé", 2}, // multi-byte rune still counts as one
	}
	for _, c := range cases {
		if got := boundToWidth(c.s, c.n); got != c.want {
			t.Errorf("boundToWidth(%q, %d) = %q, want %q", c.s, c.n, got, c.want)
		}
	}
}

func TestRenderEvent_ToolResultCostBoundedByWidthNotResultSize(t *testing.T) {
	big := strings.Repeat("x", 5<<20) // 5 MiB — far more than any terminal shows
	ev := api.RunEvent{Type: "tool.result", Tool: "read_file", Result: big}

	start := time.Now()
	lines := renderEvent(ev, 80)
	if elapsed := time.Since(start); elapsed > 200*time.Millisecond {
		t.Errorf("renderEvent on a 5MiB result took %v — looks like it processed the whole result instead of bounding to width", elapsed)
	}

	joined := strings.Join(lines, "\n")
	if len(joined) > 500 {
		t.Errorf("rendered line is %d bytes; expected it bounded by the 80-column width, not the 5MiB result", len(joined))
	}
}

// F9: token usage renders when the harness reports it, and is silently
// absent (not "0 tokens") when it doesn't.
func TestRenderRunEnd_ShowsTokenUsageWhenPresent(t *testing.T) {
	ev := api.RunEvent{Type: "run.end", Status: "completed", Steps: 2, DurationMs: 10, Usage: &api.RunUsage{TotalTokens: 1234}}
	if out := renderRunEnd(ev); !strings.Contains(out, "1234") {
		t.Errorf("renderRunEnd(%+v) = %q, want it to contain the token count", ev, out)
	}
}

func TestRenderRunEnd_OmitsTokenCountWhenAbsent(t *testing.T) {
	ev := api.RunEvent{Type: "run.end", Status: "completed", Steps: 2, DurationMs: 10}
	if out := renderRunEnd(ev); strings.Contains(out, "token") {
		t.Errorf("renderRunEnd(%+v) = %q, did not expect a token count with no Usage", ev, out)
	}
}
