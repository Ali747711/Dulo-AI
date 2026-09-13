package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client talks to a running Dulo harness (src/server.ts).
type Client struct {
	BaseURL string
	http    *http.Client
}

// NewClient builds a Client for the harness at baseURL (e.g. "http://localhost:3001").
// A trailing slash is trimmed: BaseURL+path is a plain concatenation
// everywhere below, and "http://host/" + "/api/health" would otherwise send
// "//api/health" — the harness's `new URL(req.url, ...)` parses a leading
// "//" as a protocol-relative authority, so every route 404s. Trimming here,
// once, means every call site can stay a simple concatenation.
func NewClient(baseURL string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: 5 * time.Second},
	}
}

// GetHealth calls GET /api/health.
func (c *Client) GetHealth(ctx context.Context) (*Health, error) {
	var health Health
	if err := c.getJSON(ctx, "/api/health", &health); err != nil {
		return nil, err
	}
	return &health, nil
}

// GetTools calls GET /api/tools.
func (c *Client) GetTools(ctx context.Context) ([]Tool, error) {
	var tools []Tool
	if err := c.getJSON(ctx, "/api/tools", &tools); err != nil {
		return nil, err
	}
	return tools, nil
}

func (c *Client) getJSON(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%s: %s: %s", path, resp.Status, string(body))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// RunStream starts an agent run (POST /api/run) and streams its events back.
// The returned channel is closed when the run ends or this connection drops.
//
// Cancelling ctx only detaches this viewer — it does NOT stop the run. The
// harness (src/runs.ts) keeps a run going after its SSE connection closes, so
// a client can reconnect via GET /api/run/:id/stream?after=N; res.on("close")
// only removes this response from the run's subscriber set. Call Cancel to
// actually stop a run. There is deliberately no fixed timeout on this request;
// a run can legitimately take far longer than any reasonable deadline.
func (c *Client) RunStream(ctx context.Context, runReq RunRequest) (<-chan RunEvent, error) {
	body, err := json.Marshal(runReq)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/run", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("run request failed: %s: %s", resp.Status, string(errBody))
	}

	return parseSSE(ctx, resp.Body), nil
}

// Cancel calls POST /api/run/{runID}/cancel — the only thing that actually
// stops a run server-side (see RunStream's doc comment). Best-effort: the
// harness's own run.end (status "cancelled") arriving on the still-open
// RunStream is the authoritative signal the run actually stopped, not this
// call succeeding.
func (c *Client) Cancel(ctx context.Context, runID string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/run/"+runID+"/cancel", nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("cancel failed: %s: %s", resp.Status, string(body))
	}
	return nil
}
