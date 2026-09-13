package main

// Closes two proof gaps the review found in the existing smoke tests:
//
//   - AC-3's Ctrl+C-mid-run path was never actually exercised — the existing
//     test sent Ctrl+C only after run.end had already landed, so state was
//     already idle and the plain tea.Quit branch ran, not
//     tea.Sequence(bestEffortCancelCmd, tea.Quit).
//   - AC-4 ("harness down at startup does not crash") had no automated test
//     at all.

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func TestSmoke_CtrlCWhileGenuinelyRunning_CancelsBeforeExit(t *testing.T) {
	cancelPosted := make(chan struct{})

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
		// Hold the connection open past when Ctrl+C is sent below, so state
		// is still genuinely "running" (not idle-after-run.end) at that point.
		<-r.Context().Done()
	})
	mux.HandleFunc("/api/run/r1/cancel", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "want POST", http.StatusMethodNotAllowed)
			return
		}
		close(cancelPosted)
		fmt.Fprint(w, `{}`)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	cfg := Config{HarnessURL: srv.URL, MaxSteps: 8, Temperature: 0.2}
	var out syncBuffer
	p := tea.NewProgram(initialModel(cfg), tea.WithInput(strings.NewReader("")), tea.WithOutput(&out))

	done := make(chan error, 1)
	go func() { _, err := p.Run(); done <- err }()

	p.Send(tea.WindowSizeMsg{Width: 100, Height: 30})
	waitForSubstring(t, &out, "connected", 2*time.Second)

	for _, r := range "long task" {
		p.Send(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	p.Send(tea.KeyMsg{Type: tea.KeyEnter})
	waitForSubstring(t, &out, "long task", 2*time.Second) // run.start rendered: genuinely running, runID known

	p.Send(tea.KeyMsg{Type: tea.KeyCtrlC})

	// The cancel POST must arrive before the program exits, not after — that
	// ordering is the entire point of tea.Sequence over tea.Batch here.
	select {
	case <-cancelPosted:
	case <-time.After(2 * time.Second):
		t.Fatal("Ctrl+C mid-run did not result in a cancel POST before exit")
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("p.Run() returned an error: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("program did not exit after ctrl+c")
	}
}

func TestSmoke_HarnessDownAtStartup_DoesNotCrash(t *testing.T) {
	// Bind then immediately release a port: guaranteed nobody is listening
	// there, unlike a fixed port number that might collide with something else.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close()

	cfg := Config{HarnessURL: "http://" + addr, MaxSteps: 8, Temperature: 0.2}
	var out syncBuffer
	p := tea.NewProgram(initialModel(cfg), tea.WithInput(strings.NewReader("")), tea.WithOutput(&out))

	done := make(chan error, 1)
	go func() { _, err := p.Run(); done <- err }()

	p.Send(tea.WindowSizeMsg{Width: 80, Height: 24})
	waitForSubstring(t, &out, "disconnected", 3*time.Second)

	for _, r := range "hi" {
		p.Send(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	p.Send(tea.KeyMsg{Type: tea.KeyEnter})
	waitForSubstring(t, &out, "connection error", 3*time.Second)

	p.Send(tea.KeyMsg{Type: tea.KeyCtrlC})
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("p.Run() returned an error: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("program did not exit cleanly")
	}
}
