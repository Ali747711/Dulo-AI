package main

// Shared test infrastructure for the smoke tests, which drive a real
// tea.Program against a fake harness in another goroutine.

import (
	"bytes"
	"strings"
	"sync"
	"testing"
	"time"
)

// syncBuffer is a bytes.Buffer safe for one writer (the tea.Program's
// renderer, in its own goroutine) and one reader (the test, polling via
// waitForSubstring) at once.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// waitForSubstring polls buf until it contains substr or timeout elapses.
// Preferred over a fixed time.Sleep: a sleep long enough to be reliable
// under load is also long enough to make every run of the suite slow, and
// one too short flakes under load instead.
func waitForSubstring(t *testing.T, buf *syncBuffer, substr string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if strings.Contains(buf.String(), substr) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out after %s waiting for %q in output:\n%s", timeout, substr, buf.String())
}
