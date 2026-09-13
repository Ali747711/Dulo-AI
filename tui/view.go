package main

import (
	"fmt"

	"github.com/charmbracelet/lipgloss"
)

func (m model) View() string {
	if m.width == 0 {
		return "" // no WindowSizeMsg yet
	}

	innerWidth := m.width - boxBorders // matches applyLayout's box-border accounting

	// Below minFullLayoutHeight, the status bar and the transcript box get
	// dropped rather than clamped to a 1-row sliver that still doesn't add up
	// to m.height — the input box (where the user types) is what has to stay
	// visible. Below even its own 3 rows, drop its border too.
	if m.height > 0 && m.height < minFullLayoutHeight {
		if m.height >= inputBoxHeight {
			return inputBoxStyle.Width(innerWidth).Render(m.input.View())
		}
		return m.input.View()
	}

	// MaxWidth, not Width: Width pads-and-wraps to fit, which is exactly how a
	// narrow terminal turned this into two lines and silently broke the fixed
	// height budget applyLayout computed. MaxWidth hard-truncates to one line
	// (ANSI-aware, so the color codes in renderStatus's segments survive).
	status := statusBarStyle.MaxWidth(m.width).Render(m.renderStatus())
	transcript := transcriptBoxStyle.Width(innerWidth).Render(m.viewport.View())
	input := inputBoxStyle.Width(innerWidth).Render(m.input.View())

	return lipgloss.JoinVertical(lipgloss.Left, status, transcript, input)
}

func (m model) renderStatus() string {
	var conn string
	switch {
	case m.healthErr != nil:
		conn = statusErrStyle.Render("● disconnected")
	case m.health != nil:
		conn = statusOKStyle.Render("● connected")
	default:
		conn = mutedStyle.Render("● connecting…")
	}

	detail := mutedStyle.Render("  " + m.cfg.HarnessURL)
	if m.health != nil {
		detail = mutedStyle.Render(fmt.Sprintf("  model: %s  tools: %d", m.health.Model, m.health.ToolCount))
	}

	state := ""
	if m.state == stateRunning {
		state = mutedStyle.Render("  · running (esc to cancel)")
	}

	return conn + detail + state
}
