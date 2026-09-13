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
		m.releaseConn = msg.releaseConn
		return m, listenForEventCmd(m.events)

	case runStartErrMsg:
		m.state = stateIdle
		m.history = append(m.history, api.NewStreamErrorEvent(msg.err.Error()))
		m.refreshTranscript(true)
		pending := m.pendingCancel
		m.pendingCancel = ""
		if pending == "quit" {
			// Nothing ever started, so there's nothing to cancel — just honor
			// the quit that was requested while we were still waiting.
			return m, tea.Quit
		}
		return m, nil

	case runEventMsg:
		if !msg.ok {
			// Channel closed: normally because run.end already arrived. If it
			// didn't (harness process died or tsx watch restarted mid-run —
			// see context.md's "Honest limit" gotcha), the state would
			// otherwise just quietly go back to idle with no indication
			// anything went wrong, indistinguishable from a run that produced
			// no output at all.
			if m.state == stateRunning {
				m.history = append(m.history, api.NewStreamErrorEvent(
					"stream ended before run.end — harness stopped or restarted?"))
				m.refreshTranscript(true)
			}
			m.state = stateIdle
			m.runID = ""
			m.events = nil
			if m.releaseConn != nil {
				m.releaseConn() // no-op if the connection is already what closed it
				m.releaseConn = nil
			}
			pending := m.pendingCancel
			m.pendingCancel = ""
			if pending == "quit" {
				// The stream broke before run.start ever arrived, so there was
				// never a runID to cancel by — quitting is all that's left.
				return m, tea.Quit
			}
			return m, nil
		}

		if msg.event.Type == "run.start" {
			m.runID = msg.event.RunID
		}

		lines := renderEvent(msg.event, m.viewport.Width)
		m.history = append(m.history, msg.event)
		if len(lines) > 0 {
			m.refreshTranscript(msg.event.Type == "run.start")
		}
		if msg.event.Type == "run.end" {
			m.state = stateIdle
		}

		if msg.event.Type == "run.start" && m.pendingCancel != "" {
			pending := m.pendingCancel
			m.pendingCancel = ""
			if pending == "quit" {
				if m.releaseConn != nil {
					m.releaseConn()
					m.releaseConn = nil
				}
				return m, tea.Sequence(bestEffortCancelCmd(m.client, m.runID), tea.Quit)
			}
			return m, tea.Batch(cancelRunCmd(m.client, m.runID), listenForEventCmd(m.events))
		}

		// Keep reading until the channel closes — that's the only real
		// end-of-run signal; run.end doesn't necessarily mean no more events.
		return m, listenForEventCmd(m.events)

	case cancelResultMsg:
		if msg.err != nil {
			m.history = append(m.history, api.NewStreamErrorEvent("cancel request failed: "+msg.err.Error()))
			m.refreshTranscript(true)
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

// Layout budget, shared with view.go so both agree on the same numbers.
const (
	statusBarHeight = 1
	inputBoxHeight  = 3 // 1 content line + top/bottom border
	boxBorders      = 2 // a rounded border costs 1 column/row per side

	// minFullLayoutHeight is the shortest terminal that fits status bar +
	// bordered transcript (>=1 content row) + bordered input. Below it,
	// View() drops to a smaller layout instead of overflowing — see F7.
	minFullLayoutHeight = statusBarHeight + inputBoxHeight + boxBorders + 1
)

// applyLayout recomputes the input/viewport sizes from m.width/m.height.
// Golden Rule 1: account for every border and chrome line before sizing
// content, rather than setting an explicit Height() on a bordered style.
func (m *model) applyLayout() {
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

	// A resize reflows existing content; it should not also yank a
	// scrolled-up view back to the bottom (see refreshTranscript's forceBottom).
	m.refreshTranscript(false)
}

// refreshTranscript re-wraps history at the current viewport width — always
// from the raw events, never by re-wrapping already-wrapped text. It only
// jumps to the bottom when the view was already there, or forceBottom asks
// for it regardless (used for run.start: a fresh run's output should be
// visible even if the previous run's transcript was scrolled up when it was
// submitted). Otherwise a scrolled-up read gets yanked back down by the very
// next streamed event.
func (m *model) refreshTranscript(forceBottom bool) {
	wasAtBottom := forceBottom || m.viewport.AtBottom()
	m.viewport.SetContent(renderTranscript(m.history, m.viewport.Width))
	if wasAtBottom {
		m.viewport.GotoBottom()
	}
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

// startRunCmd's context is not for stopping the run — closing this
// connection no longer does that server-side (see RunStream's doc comment) —
// it is only so quitting can release *our* goroutine and socket rather than
// leaving them for the process to take down. No fixed deadline: a run can
// legitimately outlive any reasonable timeout.
func startRunCmd(client *api.Client, req api.RunRequest) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithCancel(context.Background())
		events, err := client.RunStream(ctx, req)
		if err != nil {
			cancel()
			return runStartErrMsg{err: err}
		}
		return runStartedMsg{events: events, releaseConn: cancel}
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
