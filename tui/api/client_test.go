package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// F3: a trailing slash on the configured base URL used to double up with the
// leading slash on every path, which the harness's `new URL(req.url, ...)`
// parses as a protocol-relative authority — every route 404'd.
func TestNewClient_TrimsTrailingSlash(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"ok":true,"name":"dulo","model":"m","fallbackModels":[],"hasApiKey":true,"toolCount":0}`)
	}))
	defer srv.Close()

	for _, suffix := range []string{"", "/", "//"} {
		gotPath = ""
		c := NewClient(srv.URL + suffix)
		if _, err := c.GetHealth(context.Background()); err != nil {
			t.Fatalf("GetHealth with base %q: %v", srv.URL+suffix, err)
		}
		if gotPath != "/api/health" {
			t.Errorf("base %q: harness saw path %q, want \"/api/health\"", srv.URL+suffix, gotPath)
		}
	}
}

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

// F10: non-200 responses from RunStream and Cancel must produce an error
// that carries the status and body, not just "request failed" — this is the
// text a user actually sees on screen.
func TestClient_RunStream_NonOKResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"error":"invalid request","issues":[{"path":["model"]}]}`)
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	_, err := c.RunStream(context.Background(), RunRequest{Query: "hi"})
	if err == nil {
		t.Fatal("expected an error for a 400 response")
	}
	if !strings.Contains(err.Error(), "400") || !strings.Contains(err.Error(), "invalid request") {
		t.Errorf("error should carry status and body, got: %v", err)
	}
}

func TestClient_Cancel_NonOKResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no such run", http.StatusNotFound)
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	err := c.Cancel(context.Background(), "missing-run-id")
	if err == nil {
		t.Fatal("expected an error for a 404 response")
	}
	if !strings.Contains(err.Error(), "404") || !strings.Contains(err.Error(), "no such run") {
		t.Errorf("error should carry status and body, got: %v", err)
	}
}

func TestClient_Cancel_Success(t *testing.T) {
	var gotMethod, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		fmt.Fprint(w, `{}`)
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	if err := c.Cancel(context.Background(), "r1"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/api/run/r1/cancel" {
		t.Errorf("got %s %s, want POST /api/run/r1/cancel", gotMethod, gotPath)
	}
}
