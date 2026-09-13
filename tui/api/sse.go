package api

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"strings"
)

// maxSSELineBytes bounds a single SSE line. The harness's http_request tool
// already caps what it forwards, but a large local write_file/read_file
// result can still produce one long tool.result line — allow generous room.
const maxSSELineBytes = 4 << 20 // 4 MiB

// parseSSE reads the harness's Server-Sent Events stream from body and
// decodes each event onto the returned channel. It assumes every event is
// emitted as a single-line "data: {...}" frame followed by a blank line —
// true for this harness because it JSON.stringifies each event compactly
// (src/server.ts's `send`) — so a plain line scan is enough; a general SSE
// parser would need to also join multi-line "data:" fields.
//
// Blank lines and comment lines (the ": ping" heartbeat) are skipped. The
// channel is closed, and body is closed, when the stream ends normally, the
// underlying connection errors, or ctx is cancelled (which net/http surfaces
// as a Read error on body — see api.Client.RunStream). ctx is passed in only
// to tell those two cases apart: a cancelled ctx means the caller (a user
// pressing "stop") already knows the run ended, so it closes the channel
// quietly instead of also emitting a StreamErrorType for its own cancellation.
func parseSSE(ctx context.Context, body io.ReadCloser) <-chan RunEvent {
	out := make(chan RunEvent)
	go func() {
		defer close(out)
		defer body.Close()

		scanner := bufio.NewScanner(body)
		scanner.Buffer(make([]byte, 0, 64*1024), maxSSELineBytes)

		for scanner.Scan() {
			line := scanner.Text()
			if line == "" || strings.HasPrefix(line, ":") {
				continue
			}
			data, ok := strings.CutPrefix(line, "data: ")
			if !ok {
				continue
			}
			var event RunEvent
			if err := json.Unmarshal([]byte(data), &event); err != nil {
				out <- NewStreamErrorEvent("malformed event: " + err.Error())
				return
			}
			out <- event
		}
		if err := scanner.Err(); err != nil && ctx.Err() == nil {
			out <- NewStreamErrorEvent(err.Error())
		}
	}()
	return out
}
