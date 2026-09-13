package main

import (
	"agent-tui/api"
)

// runState is which mode the single input/transcript pane is in.
type runState int

const (
	stateIdle runState = iota
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
type runStartedMsg struct {
	events <-chan api.RunEvent
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
