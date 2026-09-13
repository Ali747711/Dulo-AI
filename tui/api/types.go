// Package api is a thin client for the Dulo harness HTTP API (src/server.ts).
// Types here mirror src/events.ts and src/server.ts's RunRequest schema exactly;
// keep the two in sync the same way the harness keeps src/events.ts and
// client/src/lib/types.ts in sync.
package api

import "encoding/json"

// StreamErrorType marks a synthetic RunEvent built locally when the SSE
// connection breaks (network error, cancellation) before a run.end arrived.
// The harness never sends this type; callers can treat it like any other event.
const StreamErrorType = "stream.error"

// RunUsage mirrors src/events.ts's RunUsage — token counts summed across
// every model call in a run. Present on run.end when the harness has it.
type RunUsage struct {
	PromptTokens     int `json:"promptTokens"`
	CompletionTokens int `json:"completionTokens"`
	TotalTokens      int `json:"totalTokens"`
}

// RunEvent is the Go mirror of the RunEvent union in src/events.ts. Go has no
// tagged unions, so every variant's fields live on one struct with omitempty;
// Type is the discriminant to switch on. Not yet mirrored here at all:
// permission.ask, permission.resolved, context.condensed, assistant.delta —
// unrecognized Type values decode fine (fields just stay zero) but render.go
// treats them as "nothing to show" rather than rendering them.
//
// "error" is the one field that cannot be a single typed field: on tool.result
// it is a {message: string} object, but on run.end it is a plain string — two
// different JSON shapes under the same key. RawError defers decoding until
// ToolError/RunEndError knows, from Type, which shape to expect.
type RunEvent struct {
	Type string `json:"type"`

	// run.start
	RunID     string `json:"runId,omitempty"`
	Query     string `json:"query,omitempty"`
	Model     string `json:"model,omitempty"`
	StartedAt string `json:"startedAt,omitempty"`

	// step.start, tool.call, tool.result, assistant
	Step int `json:"step,omitempty"`

	// tool.call, tool.result
	CallID string         `json:"callId,omitempty"`
	Tool   string         `json:"tool,omitempty"`
	Args   map[string]any `json:"args,omitempty"`

	// tool.result
	Result     string `json:"result,omitempty"`
	DurationMs int    `json:"durationMs,omitempty"`
	IsError    bool   `json:"isError,omitempty"`

	// tool.result ({message}) or run.end (plain string) — see ToolError/RunEndError.
	RawError json.RawMessage `json:"error,omitempty"`

	// assistant
	Text string `json:"text,omitempty"`

	// run.end
	Status      string    `json:"status,omitempty"`
	FinalAnswer string    `json:"finalAnswer,omitempty"`
	Reason      string    `json:"reason,omitempty"`
	Usage       *RunUsage `json:"usage,omitempty"`
	Steps       int       `json:"steps,omitempty"`

	// Every event carries this once stored/streamed by the harness
	// (StoredEvent in src/events.ts). Not used for rendering today, but
	// reconnect (GET /api/run/:id/stream?after=N) will need it — decoded now
	// rather than silently dropped.
	Seq int `json:"seq,omitempty"`
}

// ToolError returns a tool.result event's error message, or "" if absent.
func (e RunEvent) ToolError() string {
	if len(e.RawError) == 0 {
		return ""
	}
	var obj struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(e.RawError, &obj); err != nil {
		return ""
	}
	return obj.Message
}

// RunEndError returns a run.end event's error string, or "" if absent.
func (e RunEvent) RunEndError() string {
	if len(e.RawError) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(e.RawError, &s); err != nil {
		return ""
	}
	return s
}

// NewStreamErrorEvent builds a synthetic StreamErrorType event carrying msg.
// The harness never sends this type; it's how the TUI reports a transport
// failure (connection refused, dropped mid-stream) through the same
// RunEvent/RunEndError path as a server-reported failure.
func NewStreamErrorEvent(msg string) RunEvent {
	raw, _ := json.Marshal(msg) // a string always marshals; error is never non-nil
	return RunEvent{Type: StreamErrorType, RawError: raw}
}

// Tool is one entry from GET /api/tools.
type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

// Health is the body of GET /api/health.
type Health struct {
	Ok             bool     `json:"ok"`
	Name           string   `json:"name"`
	Model          string   `json:"model"`
	FallbackModels []string `json:"fallbackModels"`
	HasAPIKey      bool     `json:"hasApiKey"`
	ToolCount      int      `json:"toolCount"`
}

// RunRequest is the POST /api/run body (mirrors the zod RunRequest schema in
// src/server.ts, which — critically — validates "model" with z.string().min(1)
// only when the field is *present*: omitted is fine, "" is a 400). MaxSteps
// and Temperature have no omitempty because the TUI always resolves them to
// a concrete, valid value (never a zero the harness would reject) — a
// deliberate Temperature of 0 must still reach the harness, not be dropped as
// a JSON zero value. Model is the one field genuinely left "unset" (empty
// string means "let the harness use its own default"), so it keeps
// omitempty; sending "" here previously caused a 400 on every run. EnabledTools
// is omitted (nil) to mean "every tool", exactly as the harness's own comment
// on the field says.
type RunRequest struct {
	Query        string   `json:"query"`
	Model        string   `json:"model,omitempty"`
	MaxSteps     int      `json:"maxSteps"`
	Temperature  float64  `json:"temperature"`
	EnabledTools []string `json:"enabledTools,omitempty"`
}
