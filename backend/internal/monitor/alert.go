// Package monitor tracks how loaded your server is, raises alerts when
// something goes wrong, and gives the admin bot commands to inspect both.
package monitor

import (
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Level int

const (
	Info Level = iota
	Warning
	Critical
)

func (l Level) String() string {
	switch l {
	case Critical:
		return "CRITICAL"
	case Warning:
		return "WARNING"
	default:
		return "INFO"
	}
}

func (l Level) icon() string {
	switch l {
	case Critical:
		return "🚨"
	case Warning:
		return "⚠️"
	default:
		return "ℹ️"
	}
}

// Event is one alert, kept for the /alerts recent command.
type Event struct {
	At      time.Time
	Level   Level
	Key     string
	Title   string
	Details string
	Sent    bool // false when it was held back (cooldown, rate cap, or alerts off)
}

type keyState struct {
	lastSent   time.Time
	suppressed int
}

// Alerter decides whether an alert is worth sending. Everything that wants to
// raise an alert calls Alert, and Alerter handles the rest:
//
//   - the same key is sent at most once per cooldown (default 10 minutes), and
//     the number of held-back repeats is reported with the next one
//   - at most maxPerMinute alerts leave the server per minute overall, so a
//     failure loop can never flood your phone
//   - only Warning and Critical are sent; Info is only recorded
//   - secrets (tokens, passwords, JWTs) are scrubbed before anything is sent
type Alerter struct {
	send         func(string)
	cooldown     time.Duration
	maxPerMinute int

	mu      sync.Mutex
	enabled bool
	keys    map[string]*keyState
	sentAt  []time.Time
	recent  []Event
}

// NewAlerter creates an Alerter. send is called with the final message text,
// for example (*notify.Telegram).SendAsync. A nil send keeps alerts local.
func NewAlerter(send func(string)) *Alerter {
	return &Alerter{
		send:         send,
		cooldown:     10 * time.Minute,
		maxPerMinute: 6,
		enabled:      true,
		keys:         map[string]*keyState{},
	}
}

func (a *Alerter) SetEnabled(on bool) {
	a.mu.Lock()
	a.enabled = on
	a.mu.Unlock()
}

func (a *Alerter) Enabled() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.enabled
}

// Recent returns up to n of the latest events, newest first.
func (a *Alerter) Recent(n int) []Event {
	a.mu.Lock()
	defer a.mu.Unlock()
	if n > len(a.recent) {
		n = len(a.recent)
	}
	out := make([]Event, 0, n)
	for i := len(a.recent) - 1; i >= 0 && len(out) < n; i-- {
		out = append(out, a.recent[i])
	}
	return out
}

// Alert records an event and sends it if it passes the filters. key identifies
// "the same problem" for deduplication, for example "http5xx:POST /chatbot".
// It never blocks on the network for longer than send itself takes, and the
// send happens outside the internal lock.
func (a *Alerter) Alert(level Level, key, title, details string) {
	if a == nil {
		return
	}
	title = scrub(title)
	details = scrub(details)
	now := time.Now()

	a.mu.Lock()
	if len(a.keys) > 500 { // bound memory if keys are ever generated per-request
		a.keys = map[string]*keyState{}
	}
	st := a.keys[key]
	if st == nil {
		st = &keyState{}
		a.keys[key] = st
	}

	shouldSend := a.enabled && a.send != nil && level >= Warning

	if shouldSend && !st.lastSent.IsZero() && now.Sub(st.lastSent) < a.cooldown {
		st.suppressed++
		shouldSend = false
	}
	if shouldSend {
		cutoff := now.Add(-time.Minute)
		kept := a.sentAt[:0]
		for _, t := range a.sentAt {
			if t.After(cutoff) {
				kept = append(kept, t)
			}
		}
		a.sentAt = kept
		if len(a.sentAt) >= a.maxPerMinute {
			st.suppressed++
			shouldSend = false
		}
	}

	var text string
	if shouldSend {
		text = formatAlert(level, title, details, st.suppressed, now)
		st.suppressed = 0
		st.lastSent = now
		a.sentAt = append(a.sentAt, now)
	}

	a.recent = append(a.recent, Event{At: now, Level: level, Key: key, Title: title, Details: details, Sent: shouldSend})
	if len(a.recent) > 50 {
		a.recent = a.recent[len(a.recent)-50:]
	}
	send := a.send
	a.mu.Unlock()

	if shouldSend {
		send(text)
	}
}

// Recovered sends a single "problem is over" message, but only when at least
// one of the given keys had actually been sent as an alert before.
func (a *Alerter) Recovered(title, details string, keys ...string) {
	if a == nil {
		return
	}
	a.mu.Lock()
	wasAlerting := false
	for _, k := range keys {
		if st, ok := a.keys[k]; ok && !st.lastSent.IsZero() {
			wasAlerting = true
		}
		delete(a.keys, k)
	}
	canSend := a.enabled && a.send != nil
	send := a.send
	a.mu.Unlock()

	if wasAlerting && canSend {
		send(fmt.Sprintf("✅ RECOVERED: %s\n%s\n%s", scrub(title), scrub(details), time.Now().Format("15:04:05")))
	}
}

func formatAlert(level Level, title, details string, suppressed int, at time.Time) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("%s %s: %s", level.icon(), level.String(), title))
	if details != "" {
		sb.WriteString("\n" + details)
	}
	if suppressed > 0 {
		sb.WriteString(fmt.Sprintf("\n(+%d similar alerts held back)", suppressed))
	}
	sb.WriteString("\n" + at.Format("15:04:05"))
	return sb.String()
}

var scrubbers = []struct {
	re   *regexp.Regexp
	with string
}{
	{regexp.MustCompile(`eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}`), `[jwt redacted]`},
	{regexp.MustCompile(`(?i)bearer\s+[A-Za-z0-9\-._~+/]+=*`), `Bearer [redacted]`},
	{regexp.MustCompile(`(?i)\b(token|access_token|refresh_token|password|secret|otp|api[_-]?key)(["']?\s*[:=]\s*["']?)[^\s&"',]+`), `${1}${2}[redacted]`},
}

// scrub removes secrets and shortens long text. Telegram messages are not
// end-to-end encrypted, so nothing sensitive should ever be sent to it.
func scrub(s string) string {
	for _, r := range scrubbers {
		s = r.re.ReplaceAllString(s, r.with)
	}
	runes := []rune(s)
	if len(runes) > 600 {
		s = string(runes[:600]) + "…"
	}
	return s
}