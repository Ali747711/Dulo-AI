package main

import (
	"context"

	"agent-tui/api"
)

// runState is which mode the single input/transcript pane is in. stateStarting
// covers the gap between submitting a query and the harness's run.start event
// actually arriving: the POST to /api/run is in flight (stateStarting), then
// once it succeeds the SSE stream is open but the harness hasn't published
// run.start yet, so runID is still "" (stateRunning with runID == ""). Both
// halves of that gap need to reject a second submit and remember an Esc/Ctrl+C
// pressed too early instead of silently doing nothing — see model.pendingCancel.
type runState int

const (
	stateIdle runState = iota
	stateStarting
	stateRunning
)

// Messages produced by our own tea.Cmds (as opposed to bubbletea/bubbles'
// built-in ones like tea.KeyMsg or tea.WindowSizeMsg).

// healthMsg carries the result of a GET /api/health check.
type healthMsg struct {
	health *api.Health
	err    error
}

// healthTickMsg fires every healthPollInterval to re-check /api/health.
type healthTickMsg struct{}

// runStartedMsg means RunStream succeeded and a run is now streaming.
// releaseConn ends this client's own connection — used only to release our
// side's resources on quit; it does not stop the run server-side (that's
// api.Client.Cancel, over POST /api/run/:id/cancel).
type runStartedMsg struct {
	events      <-chan api.RunEvent
	releaseConn context.CancelFunc
}

// runStartErrMsg means RunStream failed before any event arrived (e.g. the
// harness is unreachable).
type runStartErrMsg struct {
	err error
}

// runEventMsg carries one event read off an in-progress run's channel. ok is
// false when the channel has been closed (the run is over).
type runEventMsg struct {
	event api.RunEvent
	ok    bool
}

// cancelResultMsg carries the outcome of an Esc-triggered POST
// /api/run/:id/cancel. It does not by itself mean the run stopped — the
// harness's own run.end (status "cancelled"), arriving on the still-open
// stream, is what actually confirms that.
type cancelResultMsg struct {
	err error
}
