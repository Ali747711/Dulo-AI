package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestClient_GetHealthAndGetTools(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/health":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"ok":true,"name":"dulo","model":"m","fallbackModels":["a","b"],"hasApiKey":true,"toolCount":2}`)
		case "/api/tools":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `[{"name":"get_uuid","description":"d","parameters":{"type":"object"}}]`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := NewClient(srv.URL)

	health, err := c.GetHealth(context.Background())
	if err != nil {
		t.Fatalf("GetHealth: %v", err)
	}
	if !health.Ok || health.ToolCount != 2 || health.Model != "m" {
		t.Errorf("GetHealth = %+v", health)
	}

	tools, err := c.GetTools(context.Background())
	if err != nil {
		t.Fatalf("GetTools: %v", err)
	}
	if len(tools) != 1 || tools[0].Name != "get_uuid" {
		t.Errorf("GetTools = %+v", tools)
	}
}

// flushWriter is the same pattern src/server.ts relies on: each write must
// reach the client immediately for a live SSE stream, not sit in a buffer.
type flushWriter struct {
	http.ResponseWriter
	flusher http.Flusher
}

func (f flushWriter) Write(p []byte) (int, error) {
	n, err := f.ResponseWriter.Write(p)
	f.flusher.Flush()
	return n, err
}

func TestClient_RunStream_ReceivesEventsInOrder(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fw := flushWriter{w, w.(http.Flusher)}
		fmt.Fprint(fw, `data: {"type":"run.start","runId":"r1","query":"hi"}`+"\n\n")
		fmt.Fprint(fw, `data: {"type":"assistant","step":1,"text":"hello"}`+"\n\n")
		fmt.Fprint(fw, `data: {"type":"run.end","status":"completed","steps":1,"durationMs":1}`+"\n\n")
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	stream, err := c.RunStream(context.Background(), RunRequest{Query: "hi"})
	if err != nil {
		t.Fatalf("RunStream: %v", err)
	}
	events := collect(t, stream)

	if len(events) != 3 {
		t.Fatalf("got %d events, want 3: %+v", len(events), events)
	}
	wantTypes := []string{"run.start", "assistant", "run.end"}
	for i, want := range wantTypes {
		if events[i].Type != want {
			t.Errorf("events[%d].Type = %q, want %q", i, events[i].Type, want)
		}
	}
}

func TestClient_RunStream_CancelClosesChannelPromptly(t *testing.T) {
	unblock := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fw := flushWriter{w, w.(http.Flusher)}
		fmt.Fprint(fw, `data: {"type":"run.start","runId":"r1","query":"hi"}`+"\n\n")
		// Hold the connection open — a real run can run for many seconds
		// between events. The client must be the one to end this early.
		<-r.Context().Done()
		close(unblock)
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	ctx, cancel := context.WithCancel(context.Background())
	events, err := c.RunStream(ctx, RunRequest{Query: "hi"})
	if err != nil {
		t.Fatalf("RunStream: %v", err)
	}

	// Read the one event the server sends before it blocks.
	select {
	case ev, ok := <-events:
		if !ok || ev.Type != "run.start" {
			t.Fatalf("first event = %+v, ok=%v", ev, ok)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for run.start")
	}

	cancel()

	select {
	case _, ok := <-events:
		if ok {
			t.Fatal("expected channel to close after cancel, got another event")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("channel did not close within 2s of cancelling ctx")
	}

	select {
	case <-unblock:
	case <-time.After(2 * time.Second):
		t.Fatal("server handler's request context was never cancelled — client left the connection open")
	}
}
