package main

import "testing"

func TestValidateHarnessURL(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		wantErr bool
	}{
		{"valid http", "http://localhost:3001", false},
		{"valid https", "https://example.com", false},
		{"trailing slash accepted here — NewClient trims it", "http://localhost:3001/", false},
		{"missing scheme", "localhost:3001", true},
		{"empty", "", true},
		{"unsupported scheme", "ftp://x", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validateHarnessURL(c.in)
			if (err != nil) != c.wantErr {
				t.Errorf("validateHarnessURL(%q) error = %v, wantErr %v", c.in, err, c.wantErr)
			}
		})
	}
}

func TestLoadConfig_DefaultsWhenEnvUnset(t *testing.T) {
	t.Setenv("DULO_TUI_HARNESS_URL", "")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig() error = %v", err)
	}
	if cfg.HarnessURL != "http://localhost:3001" {
		t.Errorf("HarnessURL = %q, want the default", cfg.HarnessURL)
	}
}

func TestLoadConfig_RejectsSchemeLessEnvValue(t *testing.T) {
	// The exact value someone would type by habit — "host:port", no scheme.
	t.Setenv("DULO_TUI_HARNESS_URL", "localhost:3001")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected an error for a scheme-less DULO_TUI_HARNESS_URL")
	}
}
