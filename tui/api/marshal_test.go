package api

import (
	"encoding/json"
	"strings"
	"testing"
)

// The harness's zod schema is `model: z.string().min(1).max(200).optional()`
// — optional means the key may be absent, but present-and-empty still fails
// validation with a 400. Config.Model defaults to "" (meaning "let the
// harness pick"), so RunRequest.Model must omitempty or every run with no
// explicit model 400s. This is a real bug that shipped once already.
func TestRunRequest_EmptyModelIsOmittedNotSentAsEmptyString(t *testing.T) {
	body, err := json.Marshal(RunRequest{Query: "hi", MaxSteps: 8, Temperature: 0.2})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), `"model"`) {
		t.Errorf("expected no \"model\" key for an empty Model, got: %s", body)
	}
}

func TestRunRequest_NonEmptyModelIsSent(t *testing.T) {
	body, err := json.Marshal(RunRequest{Query: "hi", Model: "some/model:free", MaxSteps: 8, Temperature: 0.2})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `"model":"some/model:free"`) {
		t.Errorf("expected model to be sent, got: %s", body)
	}
}

// Temperature: 0 is a valid, meaningful value (deterministic sampling) and
// must still be sent — unlike Model, it has no omitempty. This guards against
// re-introducing that mistake.
func TestRunRequest_ZeroTemperatureIsSent(t *testing.T) {
	body, err := json.Marshal(RunRequest{Query: "hi", MaxSteps: 8, Temperature: 0})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `"temperature":0`) {
		t.Errorf("expected temperature:0 to be sent, got: %s", body)
	}
}

// The harness reports usage and a per-event seq on every run.end (StoredEvent
// in src/events.ts); both must decode, not be silently dropped by an
// api.RunEvent that has no field for them.
func TestRunEvent_DecodesUsageAndSeq(t *testing.T) {
	raw := `{"type":"run.end","status":"completed","steps":2,"durationMs":10,` +
		`"usage":{"promptTokens":100,"completionTokens":50,"totalTokens":150},"seq":42}`
	var ev RunEvent
	if err := json.Unmarshal([]byte(raw), &ev); err != nil {
		t.Fatal(err)
	}
	if ev.Usage == nil || ev.Usage.TotalTokens != 150 || ev.Usage.PromptTokens != 100 || ev.Usage.CompletionTokens != 50 {
		t.Errorf("Usage = %+v, want {100 50 150}", ev.Usage)
	}
	if ev.Seq != 42 {
		t.Errorf("Seq = %d, want 42", ev.Seq)
	}
}

func TestRunEvent_NoUsageDecodesAsNilNotZeroStruct(t *testing.T) {
	raw := `{"type":"run.end","status":"completed","steps":1,"durationMs":1}`
	var ev RunEvent
	if err := json.Unmarshal([]byte(raw), &ev); err != nil {
		t.Fatal(err)
	}
	if ev.Usage != nil {
		t.Errorf("Usage = %+v, want nil when the harness sends none", ev.Usage)
	}
}
