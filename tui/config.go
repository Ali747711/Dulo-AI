package main

import "os"

// Config holds the settings a run is built from. Phase 1 keeps this to
// environment-variable overrides with hardcoded defaults; a YAML file with
// hot-reload (per the bubbletea skill's config system) is Phase 3 work, once
// there's a Settings view to edit these in-session.
type Config struct {
	// HarnessURL is the Dulo harness base URL, e.g. "http://localhost:3001".
	HarnessURL string
	// Model is sent as RunRequest.Model. Empty defers to the harness's own
	// default model (src/llm.ts's MODEL).
	Model string
	// MaxSteps is sent as RunRequest.MaxSteps.
	MaxSteps int
	// Temperature is sent as RunRequest.Temperature.
	Temperature float64
}

func defaultConfig() Config {
	harnessURL := os.Getenv("DULO_TUI_HARNESS_URL")
	if harnessURL == "" {
		harnessURL = "http://localhost:3001"
	}
	return Config{
		HarnessURL: harnessURL,
		// Matches client/src/lib/defaults.ts's DEFAULT_SETTINGS so the TUI and
		// web client behave the same way out of the box.
		MaxSteps:    8,
		Temperature: 0.2,
	}
}
