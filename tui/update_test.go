package main

import (
	"errors"
	"strings"
	"testing"

	"agent-tui/api"

	tea "github.com/charmbracelet/bubbletea"
)

func sized(cfg Config, w, h int) model {
	m := initialModel(cfg)
	next, _ := m.Update(tea.WindowSizeMsg{Width: w, Height: h})
	return next.(model)
}

// F2: a channel that closes without a run.end must not go quietly back to
// idle with no trace — that's indistinguishable from a run that produced
// nothing at all.
func TestUpdate_StreamClosesWithoutRunEnd_ShowsAnError(t *testing.T) {
	m := sized(Config{HarnessURL: "http://x", MaxSteps: 8, Temperature: 0.2}, 80, 24)
	m.state = stateRunning
	m.runID = "r1"

	next, _ := m.Update(runEventMsg{ok: false})
	m2 := next.(model)

	if m2.state != stateIdle {
		t.Errorf("state = %v, want stateIdle", m2.state)
	}
	if m2.runID != "" {
		t.Errorf("runID = %q, want cleared", m2.runID)
	}
	if !strings.Contains(m2.View(), "connection error") {
		t.Errorf("expected an error line in the view, got:\n%s", m2.View())
	}
}

// The normal case must NOT get a spurious error: run.end arriving, then the
// channel closing right after, is exactly what a successful run looks like.
func TestUpdate_StreamClosesAfterRunEnd_NoSpuriousError(t *testing.T) {
	m := sized(Config{HarnessURL: "http://x", MaxSteps: 8, Temperature: 0.2}, 80, 24)

	next, _ := m.Update(runEventMsg{ok: true, event: api.RunEvent{
		Type: "run.end", Status: "completed", Steps: 1, DurationMs: 5,
	}})
	m2 := next.(model)
	if m2.state != stateIdle {
		t.Fatalf("expected idle immediately after run.end, got %v", m2.state)
	}

	next2, _ := m2.Update(runEventMsg{ok: false})
	m3 := next2.(model)
	if strings.Contains(m3.View(), "connection error") {
		t.Errorf("run.end already arrived; the channel closing after should not add an error line:\n%s", m3.View())
	}
}

// F4: a new event must not yank a scrolled-up view back to the bottom.
func TestRefreshTranscript_PreservesScrollWhenNotAtBottom(t *testing.T) {
	m := sized(Config{HarnessURL: "http://x", MaxSteps: 8, Temperature: 0.2}, 80, 10)

	for i := 0; i < 30; i++ {
		m.history = append(m.history, api.RunEvent{Type: "step.start", Step: i})
	}
	m.refreshTranscript(true)
	m.viewport.GotoTop()
	yBefore := m.viewport.YOffset

	m.history = append(m.history, api.RunEvent{Type: "step.start", Step: 99})
	m.refreshTranscript(false)

	if m.viewport.YOffset != yBefore {
		t.Errorf("YOffset changed from %d to %d; a new event should not move a scrolled-up view", yBefore, m.viewport.YOffset)
	}
}

// ...but a view that WAS at the bottom should track new content, and
// run.start should always force it back down even if it wasn't.
func TestRefreshTranscript_TracksBottomAndRunStartForces(t *testing.T) {
	m := sized(Config{HarnessURL: "http://x", MaxSteps: 8, Temperature: 0.2}, 80, 10)
	for i := 0; i < 30; i++ {
		m.history = append(m.history, api.RunEvent{Type: "step.start", Step: i})
	}
	m.refreshTranscript(true)
	if !m.viewport.AtBottom() {
		t.Fatal("setup: expected to be at bottom")
	}

	m.history = append(m.history, api.RunEvent{Type: "step.start", Step: 99})
	m.refreshTranscript(false)
	if !m.viewport.AtBottom() {
		t.Errorf("expected to stay at bottom when it already was")
	}

	m.viewport.GotoTop()
	m.history = append(m.history, api.RunEvent{Type: "run.start", RunID: "r2", Query: "new run"})
	m.refreshTranscript(true)
	if !m.viewport.AtBottom() {
		t.Errorf("run.start should force the view back to bottom even when scrolled up")
	}
}

// F8: a second Enter while the first query's POST is still in flight (before
// runStartedMsg) must not start an overlapping run.
func TestSubmitQuery_RejectsSecondSubmitWhileStarting(t *testing.T) {
	m := sized(Config{HarnessURL: "http://x", MaxSteps: 8, Temperature: 0.2}, 80, 24)
	m.input.SetValue("first query")

	next1, cmd1 := m.submitQuery()
	m1 := next1.(model)
	if m1.state != stateStarting {
		t.Fatalf("state = %v, want stateStarting", m1.state)
	}
	if cmd1 == nil {
		t.Fatal("expected startRunCmd for the first submit")
	}

	m1.input.SetValue("second query")
	_, cmd2 := m1.submitQuery()
	if cmd2 != nil {
		t.Error("expected no command for a second submit while starting — it would start an overlapping run")
	}
}

// F8: Esc/Ctrl+C pressed before runID is known must not silently no-op —
// they should be remembered and acted on once run.start supplies the id.
func TestEsc_WhileStarting_IsRememberedNotDropped(t *testing.T) {
	m := sized(Config{HarnessURL: "http://x", MaxSteps: 8, Temperature: 0.2}, 80, 24)
	m.state = stateStarting

	next, cmd := m.handleKey(tea.KeyMsg{Type: tea.KeyEscape})
	m1 := next.(model)
	if cmd != nil {
		t.Error("no cancel is possible yet (no runID), so no command should fire immediately")
	}
	if m1.pendingCancel != "cancel" {
		t.Fatalf("pendingCancel = %q, want %q", m1.pendingCancel, "cancel")
	}
}

func TestEsc_WhileRunningWithoutRunIDYet_IsRememberedNotDropped(t *testing.T) {
	m := sized(Config{HarnessURL: "http://x", MaxSteps: 8, Temperature: 0.2}, 80, 24)
	m.state = stateRunning
	m.runID = "" // POST succeeded, but the run.start SSE event hasn't arrived

	next, cmd := m.handleKey(tea.KeyMsg{Type: tea.KeyEscape})
	m1 := next.(model)
	if cmd != nil {
		t.Error("no cancel is possible yet (no runID), so no command should fire immediately")
	}
	if m1.pendingCancel != "cancel" {
		t.Fatalf("pendingCancel = %q, want %q", m1.pendingCancel, "cancel")
	}
}

func TestCtrlC_WhileStarting_QueuesQuitInsteadOfQuittingImmediately(t *testing.T) {
	m := sized(Config{HarnessURL: "http://x", MaxSteps: 8, Temperature: 0.2}, 80, 24)
	m.state = stateStarting

	next, cmd := m.handleKey(tea.KeyMsg{Type: tea.KeyCtrlC})
	m1 := next.(model)
	if cmd != nil {
		t.Error("must not quit immediately — that would abandon the run with no way to cancel it")
	}
	if m1.pendingCancel != "quit" {
		t.Fatalf("pendingCancel = %q, want %q", m1.pendingCancel, "quit")
	}
}

// Once run.start supplies the id, a pending Esc fires the real cancel (and
// keeps listening); a pending Ctrl+C fires the cancel then quits.
func TestPendingCancel_ActedOnOnceRunStartArrives(t *testing.T) {
	m := sized(Config{HarnessURL: "http://x", MaxSteps: 8, Temperature: 0.2}, 80, 24)
	m.state = stateRunning
	m.events = make(chan api.RunEvent) // never sent to; only listenForEventCmd's shape matters
	m.pendingCancel = "cancel"

	next, cmd := m.Update(runEventMsg{ok: true, event: api.RunEvent{Type: "run.start", RunID: "r1", Query: "q"}})
	m2 := next.(model)

	if m2.pendingCancel != "" {
		t.Errorf("pendingCancel should be cleared once acted on, got %q", m2.pendingCancel)
	}
	if m2.runID != "r1" {
		t.Errorf("runID = %q, want r1", m2.runID)
	}
	if cmd == nil {
		t.Fatal("expected a command (cancel + keep listening)")
	}
}

func TestPendingQuit_ActedOnOnceRunStartArrives(t *testing.T) {
	m := sized(Config{HarnessURL: "http://x", MaxSteps: 8, Temperature: 0.2}, 80, 24)
	m.state = stateRunning
	m.events = make(chan api.RunEvent)
	m.pendingCancel = "quit"

	next, cmd := m.Update(runEventMsg{ok: true, event: api.RunEvent{Type: "run.start", RunID: "r1", Query: "q"}})
	m2 := next.(model)

	if m2.pendingCancel != "" {
		t.Errorf("pendingCancel should be cleared once acted on, got %q", m2.pendingCancel)
	}
	if cmd == nil {
		t.Fatal("expected a command (cancel then quit)")
	}
}

// If the run never even starts (RunStream itself failed) while a quit was
// pending, the quit intent must still be honored — there's nothing to cancel.
func TestPendingQuit_HonoredIfRunNeverStarts(t *testing.T) {
	m := sized(Config{HarnessURL: "http://x", MaxSteps: 8, Temperature: 0.2}, 80, 24)
	m.state = stateStarting
	m.pendingCancel = "quit"

	next, cmd := m.Update(runStartErrMsg{err: errors.New("connection refused")})
	m2 := next.(model)

	if m2.pendingCancel != "" {
		t.Errorf("pendingCancel should be cleared, got %q", m2.pendingCancel)
	}
	if cmd == nil {
		t.Fatal("expected a quit command")
	}
}
