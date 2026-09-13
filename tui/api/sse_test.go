package api

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"
)

func TestParseSSE_DecodesEventsAndSkipsHeartbeats(t *testing.T) {
	// Exactly what src/server.ts's `send`/heartbeat write: one JSON object per
	// "data:" line, blank-line separated, plus a ": ping" comment.
	body := `data: {"type":"run.start","runId":"r1","query":"hi","model":"m","startedAt":"t"}

: ping

data: {"type":"step.start","step":1}

data: {"type":"run.end","status":"completed","steps":1,"durationMs":5}

`
	events := collect(t, parseSSE(context.Background(), io.NopCloser(strings.NewReader(body))))

	if len(events) != 3 {
		t.Fatalf("got %d events, want 3: %+v", len(events), events)
	}
	if events[0].Type != "run.start" || events[0].Query != "hi" {
		t.Errorf("event[0] = %+v", events[0])
	}
	if events[1].Type != "step.start" || events[1].Step != 1 {
		t.Errorf("event[1] = %+v", events[1])
	}
	if events[2].Type != "run.end" || events[2].Status != "completed" {
		t.Errorf("event[2] = %+v", events[2])
	}
}

func TestParseSSE_ToolResultErrorShape(t *testing.T) {
	body := `data: {"type":"tool.result","step":1,"callId":"c1","tool":"shell","isError":true,"error":{"message":"boom"}}

`
	events := collect(t, parseSSE(context.Background(), io.NopCloser(strings.NewReader(body))))
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if got := events[0].ToolError(); got != "boom" {
		t.Errorf("ToolError() = %q, want %q", got, "boom")
	}
}

func TestParseSSE_RunEndErrorIsAPlainString(t *testing.T) {
	// run.end's "error" is a bare string, not {message}. This is the exact
	// shape mismatch RawError/RunEndError exist to handle — see types.go.
	body := `data: {"type":"run.end","status":"failed","error":"OpenRouter free-tier limit reached","steps":2,"durationMs":10}

`
	events := collect(t, parseSSE(context.Background(), io.NopCloser(strings.NewReader(body))))
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if got := events[0].RunEndError(); got != "OpenRouter free-tier limit reached" {
		t.Errorf("RunEndError() = %q", got)
	}
}

func TestParseSSE_LineLongerThanDefaultScannerBuffer(t *testing.T) {
	// bufio.Scanner's default buffer is 64KB; a large write_file/read_file
	// tool.result can exceed that in a single line. Confirms the explicit
	// scanner.Buffer(...) sizing in parseSSE actually prevents bufio.ErrTooLong.
	big := strings.Repeat("x", 200*1024)
	body := `data: {"type":"tool.result","step":1,"callId":"c1","tool":"read_file","result":"` + big + `"}

`
	events := collect(t, parseSSE(context.Background(), io.NopCloser(strings.NewReader(body))))
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1 (large line should not be dropped)", len(events))
	}
	if len(events[0].Result) != len(big) {
		t.Errorf("result truncated: got %d chars, want %d", len(events[0].Result), len(big))
	}
}

func TestParseSSE_MalformedEventEmitsStreamError(t *testing.T) {
	body := "data: {not json}\n\n"
	events := collect(t, parseSSE(context.Background(), io.NopCloser(strings.NewReader(body))))
	if len(events) != 1 || events[0].Type != StreamErrorType {
		t.Fatalf("got %+v, want one StreamErrorType event", events)
	}
}

func collect(t *testing.T, ch <-chan RunEvent) []RunEvent {
	t.Helper()
	var events []RunEvent
	timeout := time.After(2 * time.Second)
	for {
		select {
		case ev, ok := <-ch:
			if !ok {
				return events
			}
			events = append(events, ev)
		case <-timeout:
			t.Fatal("parseSSE did not close its channel in time")
		}
	}
}
