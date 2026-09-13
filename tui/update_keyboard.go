package main

import (
	"strings"

	"agent-tui/api"

	tea "github.com/charmbracelet/bubbletea"
)

// handleKey processes a keypress. Global bindings are handled here first;
// anything else falls through to the (always-focused) text input, so typing
// just works without a separate "focus mode".
func (m model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "ctrl+c":
		if m.state == stateRunning && m.runID != "" {
			// Release our own connection now — the goroutine reading it would
			// otherwise sit blocked for as long as the harness keeps the
			// stream open, which in this process only ends when it does.
			// Quitting no longer stops the run itself: the harness keeps a
			// run going after its viewer disconnects (reconnect support), so
			// also make a best-effort real cancel call before exiting.
			if m.releaseConn != nil {
				m.releaseConn()
				m.releaseConn = nil
			}
			return m, tea.Sequence(bestEffortCancelCmd(m.client, m.runID), tea.Quit)
		}
		if m.state != stateIdle {
			// A run is starting but its id isn't known yet (POST still in
			// flight, or the SSE stream is open but run.start hasn't arrived).
			// Remember to cancel-then-quit once it is, instead of quitting now
			// and leaving that run going unattended with no id to stop it by.
			m.pendingCancel = "quit"
			return m, nil
		}
		return m, tea.Quit

	case "esc":
		if m.state == stateRunning && m.runID != "" {
			// Ask the harness to actually stop the run. The transcript
			// reflects this once the harness's own run.end (status
			// "cancelled") arrives on the still-open stream — not
			// immediately, and not just by us closing our connection; see
			// api.Client.Cancel's doc.
			return m, cancelRunCmd(m.client, m.runID)
		}
		if m.state != stateIdle {
			m.pendingCancel = "cancel"
		}
		return m, nil

	case "enter":
		return m.submitQuery()

	case "pgup":
		m.viewport.ViewUp()
		return m, nil

	case "pgdown":
		m.viewport.ViewDown()
		return m, nil
	}

	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	return m, cmd
}

func (m model) submitQuery() (tea.Model, tea.Cmd) {
	if m.state != stateIdle {
		return m, nil
	}
	query := strings.TrimSpace(m.input.Value())
	if query == "" {
		return m, nil
	}
	m.input.SetValue("")
	// Set synchronously, not on the eventual runStartedMsg: otherwise a
	// second Enter pressed while the POST to /api/run is still in flight
	// reads m.state as idle and fires a second, overlapping run.
	m.state = stateStarting

	req := api.RunRequest{
		Query:       query,
		Model:       m.cfg.Model,
		MaxSteps:    m.cfg.MaxSteps,
		Temperature: m.cfg.Temperature,
	}
	return m, startRunCmd(m.client, req)
}
