package main

import "github.com/charmbracelet/lipgloss"

var (
	colorMuted    = lipgloss.Color("240")
	colorAccent   = lipgloss.Color("39")  // step markers
	colorTool     = lipgloss.Color("214") // tool calls
	colorOK       = lipgloss.Color("42")  // tool success / connected
	colorErr      = lipgloss.Color("203") // errors / disconnected
	colorAnswer   = lipgloss.Color("183") // assistant text
	colorBorder   = lipgloss.Color("240")
	colorBorderOn = lipgloss.Color("62") // focused/active border

	statusBarStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("250")).
			Padding(0, 1)

	statusOKStyle  = lipgloss.NewStyle().Foreground(colorOK).Bold(true)
	statusErrStyle = lipgloss.NewStyle().Foreground(colorErr).Bold(true)

	transcriptBoxStyle = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(colorBorder)

	inputBoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(colorBorderOn)

	mutedStyle  = lipgloss.NewStyle().Foreground(colorMuted)
	stepStyle   = lipgloss.NewStyle().Foreground(colorAccent)
	toolStyle   = lipgloss.NewStyle().Foreground(colorTool)
	okStyle     = lipgloss.NewStyle().Foreground(colorOK)
	errStyle    = lipgloss.NewStyle().Foreground(colorErr)
	answerStyle = lipgloss.NewStyle().Foreground(colorAnswer)
)
