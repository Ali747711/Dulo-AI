package main

// Drives the real tea.Program end-to-end against a fake harness server, as a
// stand-in for a real-terminal check in an environment with no interactive
// TTY available. It exercises the full wiring main.go assembles — model,
// update, view, the api client, SSE parsing — not just each piece in
// isolation. This is not a substitute for actually eyeballing it in a real
// terminal before calling the feature done; see the Phase 1 write-up.

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func fakeHarness(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"ok":true,"name":"dulo","model":"stub-model","fallbackModels":[],"hasApiKey":true,"toolCount":3}`)
	})
	mux.HandleFunc("/api/run", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher := w.(http.Flusher)
		frames := []string{
			`{"type":"run.start","runId":"r1","query":"what time is it","model":"stub-model"}`,
			`{"type":"step.start","step":1}`,
			`{"type":"tool.call","step":1,"callId":"c1","tool":"get_current_time","args":{}}`,
			`{"type":"tool.result","step":1,"callId":"c1","tool":"get_current_time","result":"12:00","durationMs":1,"isError":false}`,
			`{"type":"assistant","step":2,"text":"It is 12:00."}`,
			`{"type":"run.end","status":"completed","finalAnswer":"It is 12:00.","reason":"answered","steps":2,"durationMs":5,"usage":{"promptTokens":10,"completionTokens":5,"totalTokens":15}}`,
		}
		for _, f := range frames {
			fmt.Fprint(w, "data: "+f+"\n\n")
			flusher.Flush()
		}
	})
	return httptest.NewServer(mux)
}

func TestSmoke_SubmitQueryAndRenderTranscript(t *testing.T) {
	srv := fakeHarness(t)
	defer srv.Close()

	cfg := Config{HarnessURL: srv.URL, MaxSteps: 8, Temperature: 0.2}
	var out syncBuffer
	p := tea.NewProgram(initialModel(cfg), tea.WithInput(strings.NewReader("")), tea.WithOutput(&out))

	done := make(chan error, 1)
	go func() { _, err := p.Run(); done <- err }()

	p.Send(tea.WindowSizeMsg{Width: 100, Height: 30})
	waitForSubstring(t, &out, "connected", 2*time.Second)

	for _, r := range "what time is it" {
		p.Send(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	p.Send(tea.KeyMsg{Type: tea.KeyEnter})
	waitForSubstring(t, &out, "done", 2*time.Second) // run.end rendered

	p.Send(tea.KeyMsg{Type: tea.KeyCtrlC})

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("p.Run() returned an error: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("program did not exit after ctrl+c")
	}

	rendered := out.String()
	for _, want := range []string{
		"connected",        // health check reached the fake harness
		"stub-model",       // status bar shows the harness's reported model
		"what time is it",  // the query line (rendered from the run.start event)
		"get_current_time", // tool.call line
		"12:00",            // tool.result line
		"It is 12:00.",     // assistant text
		"done",             // run.end summary
		"15 tokens",        // F9: usage surfaced on run.end
	} {
		if !strings.Contains(rendered, want) {
			t.Errorf("rendered output missing %q\n--- full output ---\n%s", want, rendered)
		}
	}
}
