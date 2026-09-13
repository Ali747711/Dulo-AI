package main

import (
	"context"
	"time"

	"agent-tui/api"

	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
)

const healthPollInterval = 10 * time.Second

// model is the single root Bubbletea model. Phase 1 is one pane (transcript +
// input); Phase 2 splits this into a dual-pane layout per the bubbletea
// skill, at which point layout calculation grows into its own function here
// per the skill's convention.
type model struct {
	client *api.Client
	cfg    Config

	width, height int

	input    textinput.Model
	viewport viewport.Model
	// history is every event seen this session, kept raw (not pre-rendered)
	// so the transcript can be re-wrapped from scratch on a terminal resize.
	history []api.RunEvent

	state runState
	// runID is the current run's id (from its run.start event), needed to call
	// POST /api/run/:id/cancel — the only thing that actually stops a run;
	// see api.Client.Cancel and RunStream's doc comment.
	runID  string
	events <-chan api.RunEvent
	// releaseConn ends this client's own connection to the run stream. It
	// does NOT stop the run (see runID's comment) — it only lets quitting
	// release our side's goroutine/socket instead of orphaning them, since
	// nothing else in this process will ever do that for us (in production
	// the OS reclaims them on process exit either way, but a test running in
	// the same process — or any future embedding — would otherwise leak them
	// for as long as the harness keeps the connection open).
	releaseConn context.CancelFunc
	// pendingCancel is "cancel" or "quit" when Esc/Ctrl+C was pressed before
	// runID was known (stateStarting, or stateRunning with runID still "").
	// Acted on the moment run.start supplies the id; "" means nothing pending.
	pendingCancel string

	health    *api.Health
	healthErr error
}

func initialModel(cfg Config) model {
	ti := textinput.New()
	ti.Placeholder = "Ask Dulo something…"
	ti.Prompt = "> "
	ti.CharLimit = 4000
	ti.Focus()

	return model{
		client:   api.NewClient(cfg.HarnessURL),
		cfg:      cfg,
		input:    ti,
		viewport: viewport.New(0, 0),
		state:    stateIdle,
	}
}

func (m model) Init() tea.Cmd {
	return tea.Batch(checkHealthCmd(m.client), healthTickCmd(), textinput.Blink)
}
