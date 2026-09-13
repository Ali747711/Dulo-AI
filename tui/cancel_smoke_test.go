package main

// Regression test for the bug the owner hit live: closing/detaching a
// connection no longer stops a run server-side (the harness added run
// persistence + reconnect), so Esc must call POST /api/run/:id/cancel, not
// just stop reading. This proves that call actually happens and that the
// harness's resulting run.end (status "cancelled") renders.

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func TestSmoke_EscCallsRealCancelEndpoint(t *testing.T) {
	cancelPosted := make(chan string, 1)
	endStream := make(chan struct{})

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"ok":true,"name":"dulo","model":"stub-model","fallbackModels":[],"hasApiKey":true,"toolCount":1}`)
	})
	mux.HandleFunc("/api/run", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher := w.(http.Flusher)
		fmt.Fprint(w, "data: "+`{"type":"run.start","runId":"r1","query":"long task","model":"stub-model"}`+"\n\n")
		flusher.Flush()

		select {
		case <-endStream:
			fmt.Fprint(w, "data: "+`{"type":"run.end","status":"cancelled","steps":1,"durationMs":1}`+"\n\n")
			flusher.Flush()
		case <-time.After(5 * time.Second):
			t.Error("run was never told to end — cancel POST apparently never arrived")
		}
	})
	mux.HandleFunc("/api/run/r1/cancel", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "want POST", http.StatusMethodNotAllowed)
			return
		}
		select {
		case cancelPosted <- "r1":
		default:
		}
		close(endStream)
		fmt.Fprint(w, `{}`)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	cfg := Config{HarnessURL: srv.URL, MaxSteps: 8, Temperature: 0.2}
	var out bytes.Buffer
	p := tea.NewProgram(initialModel(cfg), tea.WithInput(strings.NewReader("")), tea.WithOutput(&out))

	done := make(chan error, 1)
	go func() { _, err := p.Run(); done <- err }()

	p.Send(tea.WindowSizeMsg{Width: 100, Height: 30})
	time.Sleep(150 * time.Millisecond)

	for _, r := range "long task" {
		p.Send(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	p.Send(tea.KeyMsg{Type: tea.KeyEnter})

	time.Sleep(150 * time.Millisecond) // let run.start land
	p.Send(tea.KeyMsg{Type: tea.KeyEsc})

	select {
	case id := <-cancelPosted:
		if id != "r1" {
			t.Fatalf("cancel POST hit for wrong run id: %q", id)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Esc did not result in a POST /api/run/r1/cancel")
	}

	time.Sleep(150 * time.Millisecond) // let the resulting run.end render
	p.Send(tea.KeyMsg{Type: tea.KeyCtrlC})

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("p.Run() returned an error: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("program did not exit after ctrl+c")
	}

	if !strings.Contains(out.String(), "cancelled") {
		t.Errorf("rendered transcript does not show the run as cancelled:\n%s", out.String())
	}
}
