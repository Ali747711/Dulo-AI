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
		// Quitting no longer stops an in-flight run by itself: the harness
		// keeps a run going after its viewer disconnects (reconnect support),
		// so make a best-effort real cancel call before exiting — otherwise
		// quitting the TUI would silently leave the agent running unattended.
		if m.state == stateRunning && m.runID != "" {
			return m, tea.Sequence(bestEffortCancelCmd(m.client, m.runID), tea.Quit)
		}
		return m, tea.Quit

	case "esc":
		// Ask the harness to actually stop the run (POST /api/run/:id/cancel).
		// The transcript reflects this once the harness's own run.end (status
		// "cancelled") arrives on the still-open stream — not immediately, and
		// not just by us closing our connection; see api.Client.Cancel's doc.
		if m.state == stateRunning && m.runID != "" {
			return m, cancelRunCmd(m.client, m.runID)
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

	req := api.RunRequest{
		Query:       query,
		Model:       m.cfg.Model,
		MaxSteps:    m.cfg.MaxSteps,
		Temperature: m.cfg.Temperature,
	}
	return m, startRunCmd(m.client, req)
}
