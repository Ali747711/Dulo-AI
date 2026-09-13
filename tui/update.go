package main

import (
	"context"
	"time"

	"agent-tui/api"

	tea "github.com/charmbracelet/bubbletea"
)

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.applyLayout()
		return m, nil

	case tea.KeyMsg:
		return m.handleKey(msg)

	case healthMsg:
		m.health = msg.health
		m.healthErr = msg.err
		return m, nil

	case healthTickMsg:
		return m, tea.Batch(checkHealthCmd(m.client), healthTickCmd())

	case runStartedMsg:
		m.state = stateRunning
		m.events = msg.events
		return m, listenForEventCmd(m.events)

	case runStartErrMsg:
		m.state = stateIdle
		m.history = append(m.history, api.NewStreamErrorEvent(msg.err.Error()))
		m.refreshTranscript()
		return m, nil

	case runEventMsg:
		if !msg.ok {
			// Channel closed: the run is over (run.end already arrived, or the
			// stream broke and parseSSE appended its own StreamErrorType event).
			m.state = stateIdle
			m.runID = ""
			m.events = nil
			return m, nil
		}
		if msg.event.Type == "run.start" {
			m.runID = msg.event.RunID
		}
		m.history = append(m.history, msg.event)
		if msg.event.Type == "run.end" {
			m.state = stateIdle
		}
		m.refreshTranscript()
		// Keep reading until the channel closes — that's the only real
		// end-of-run signal; run.end doesn't necessarily mean no more events.
		return m, listenForEventCmd(m.events)

	case cancelResultMsg:
		if msg.err != nil {
			m.history = append(m.history, api.NewStreamErrorEvent("cancel request failed: "+msg.err.Error()))
			m.refreshTranscript()
		}
		// On success there's nothing to show yet — the harness's own run.end
		// (status "cancelled") is what actually confirms the run stopped, and
		// it arrives through the ordinary runEventMsg path.
		return m, nil
	}

	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	return m, cmd
}

// applyLayout recomputes the input/viewport sizes from m.width/m.height.
// Golden Rule 1: account for every border and chrome line before sizing
// content, rather than setting an explicit Height() on a bordered style.
func (m *model) applyLayout() {
	const statusBarHeight = 1
	const inputBoxHeight = 3 // 1 content line + top/bottom border
	const boxBorders = 2     // a rounded border costs 1 column/row per side

	innerWidth := m.width - boxBorders
	if innerWidth < 1 {
		innerWidth = 1
	}
	transcriptHeight := m.height - statusBarHeight - inputBoxHeight - boxBorders
	if transcriptHeight < 1 {
		transcriptHeight = 1
	}

	m.viewport.Width = innerWidth
	m.viewport.Height = transcriptHeight
	// input.Width excludes the prompt string ("> "), which View() renders
	// separately — so this plus len(Prompt) is what fills innerWidth exactly,
	// keeping the input box's border aligned with the transcript box's.
	m.input.Width = innerWidth - len(m.input.Prompt)

	m.refreshTranscript()
}

// refreshTranscript re-wraps history at the current viewport width — always
// from the raw events, never by re-wrapping already-wrapped text — and pins
// the view to the bottom, like a live log tail.
func (m *model) refreshTranscript() {
	m.viewport.SetContent(renderTranscript(m.history, m.viewport.Width))
	m.viewport.GotoBottom()
}

func checkHealthCmd(client *api.Client) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		health, err := client.GetHealth(ctx)
		return healthMsg{health: health, err: err}
	}
}

func healthTickCmd() tea.Cmd {
	return tea.Tick(healthPollInterval, func(time.Time) tea.Msg { return healthTickMsg{} })
}

// startRunCmd has no cancel of its own tied to the request context: closing
// this connection no longer stops the run server-side (see RunStream's doc
// comment), so there is nothing useful left to cancel it *for*. A context
// still has to be passed to RunStream, and Background is the honest one —
// no fixed deadline applies to watching a run.
func startRunCmd(client *api.Client, req api.RunRequest) tea.Cmd {
	return func() tea.Msg {
		events, err := client.RunStream(context.Background(), req)
		if err != nil {
			return runStartErrMsg{err: err}
		}
		return runStartedMsg{events: events}
	}
}

func listenForEventCmd(events <-chan api.RunEvent) tea.Cmd {
	return func() tea.Msg {
		ev, ok := <-events
		return runEventMsg{event: ev, ok: ok}
	}
}

// cancelRunCmd posts the real cancellation the harness honors (Esc).
func cancelRunCmd(client *api.Client, runID string) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return cancelResultMsg{err: client.Cancel(ctx, runID)}
	}
}

// bestEffortCancelCmd is cancelRunCmd's quitting-anyway variant (Ctrl+C):
// the program is about to exit regardless, so there is no cancelResultMsg
// for anyone to receive — just try, within a short bound, before Quit runs.
func bestEffortCancelCmd(client *api.Client, runID string) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = client.Cancel(ctx, runID)
		return nil
	}
}
