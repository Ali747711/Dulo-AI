package main

import (
	"fmt"
	"net/url"
	"os"
)

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

// loadConfig resolves Config from the environment and validates it once at
// startup, rather than letting a bad value surface later as an opaque
// connection error from deep inside api.Client (e.g. Go's own
// "unsupported protocol scheme" for a URL with no scheme at all).
func loadConfig() (Config, error) {
	harnessURL := os.Getenv("DULO_TUI_HARNESS_URL")
	if harnessURL == "" {
		harnessURL = "http://localhost:3001"
	}
	if err := validateHarnessURL(harnessURL); err != nil {
		return Config{}, err
	}
	return Config{
		HarnessURL: harnessURL,
		// Matches client/src/lib/defaults.ts's DEFAULT_SETTINGS so the TUI and
		// web client behave the same way out of the box.
		MaxSteps:    8,
		Temperature: 0.2,
	}, nil
}

func validateHarnessURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("DULO_TUI_HARNESS_URL %q is not a valid URL: %w", raw, err)
	}
	// A scheme-less value like "localhost:3001" parses "successfully" with
	// Scheme == "localhost" and the port as opaque data — url.Parse has no
	// error for this, so it must be checked explicitly.
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf(
			"DULO_TUI_HARNESS_URL %q must start with http:// or https:// (got scheme %q) — did you mean \"http://%s\"?",
			raw, u.Scheme, raw,
		)
	}
	if u.Host == "" {
		return fmt.Errorf("DULO_TUI_HARNESS_URL %q is missing a host", raw)
	}
	return nil
}
