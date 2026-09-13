package main

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// F7: below minFullLayoutHeight the view must not overflow the terminal, and
// the input box (where the user types) must stay visible.
func TestView_TinyTerminalDropsChromeInsteadOfOverflowing(t *testing.T) {
	m := initialModel(Config{HarnessURL: "http://example.invalid", MaxSteps: 8, Temperature: 0.2})
	next, _ := m.Update(tea.WindowSizeMsg{Width: 20, Height: 5})
	m2 := next.(model)

	view := m2.View()
	lines := strings.Split(view, "\n")

	if len(lines) > 5 {
		t.Errorf("view has %d lines for a 5-row terminal, want <= 5:\n%s", len(lines), view)
	}
	if !strings.Contains(view, "Ask Dulo") {
		t.Errorf("expected the input prompt/placeholder to remain visible, got:\n%s", view)
	}
}

func TestView_EvenTinierTerminalStillDoesNotOverflow(t *testing.T) {
	m := initialModel(Config{HarnessURL: "http://example.invalid", MaxSteps: 8, Temperature: 0.2})
	next, _ := m.Update(tea.WindowSizeMsg{Width: 20, Height: 2})
	m2 := next.(model)

	view := m2.View()
	lines := strings.Split(view, "\n")
	if len(lines) > 2 {
		t.Errorf("view has %d lines for a 2-row terminal, want <= 2:\n%s", len(lines), view)
	}
}

func TestView_FullHeightLayoutUnaffected(t *testing.T) {
	m := initialModel(Config{HarnessURL: "http://example.invalid", MaxSteps: 8, Temperature: 0.2})
	next, _ := m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	m2 := next.(model)

	view := m2.View()
	if !strings.Contains(view, "●") { // status bar's connection dot
		t.Errorf("expected the status bar at a normal terminal height, got:\n%s", view)
	}
}
