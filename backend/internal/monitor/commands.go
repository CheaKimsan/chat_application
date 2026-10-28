package monitor

import (
	"context"
	"fmt"
	"strings"
	"time"

	"golang-jwt-project/internal/bots"
)

// RegisterCommands adds /load, /peak, /capacity and /alerts to a bot.
// All four are admin-only, because they reveal how your server is doing.
// isAdmin reports whether a user id is allowed; nil refuses everyone.
func (m *Monitor) RegisterCommands(b *bots.Bot, isAdmin func(userID string) bool) {
	guard := func(h bots.Handler) bots.Handler {
		return func(ctx context.Context, msg bots.Message, args string) (bots.Reply, error) {
			if isAdmin == nil || !isAdmin(msg.UserID) {
				return bots.Reply{Text: "Sorry, only admins can use this command."}, nil
			}
			return h(ctx, msg, args)
		}
	}
	b.Command("load", "Current load numbers (admin)", guard(m.cmdLoad))
	b.Command("peak", "Peak load, last hour and since start (admin)", guard(m.cmdPeak))
	b.Command("capacity", "How close you are to your limits (admin)", guard(m.cmdCapacity))
	b.Command("alerts", "Alerts: /alerts on | off | recent (admin)", guard(m.cmdAlerts))
}

func (m *Monitor) cmdLoad(ctx context.Context, _ bots.Message, _ string) (bots.Reply, error) {
	s := m.sample() // a fresh reading, not the last stored one
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Users online: %d\n", s.Online))
	sb.WriteString(fmt.Sprintf("Requests in flight: %d\n", s.InFlight))
	if s.DBMax > 0 || s.DBOpen > 0 {
		max := "unlimited"
		if s.DBMax > 0 {
			max = fmt.Sprint(s.DBMax)
		}
		sb.WriteString(fmt.Sprintf("DB connections: %d in use, %d open (max %s)\n", s.DBInUse, s.DBOpen, max))
	}
	sb.WriteString(fmt.Sprintf("Goroutines: %d\n", s.Goroutines))
	sb.WriteString(fmt.Sprintf("Memory: %d MB\n", s.MemMB))
	sb.WriteString(fmt.Sprintf("Uptime: %s", m.Uptime().Round(time.Second)))
	return bots.Reply{Text: sb.String()}, nil
}

func (m *Monitor) cmdPeak(ctx context.Context, _ bots.Message, _ string) (bots.Reply, error) {
	p, n := m.PeakIn(time.Hour)
	var sb strings.Builder
	if n == 0 {
		sb.WriteString("No samples yet, try again in a few seconds.\n")
	} else {
		sb.WriteString(fmt.Sprintf("Last hour (%d samples):\n", n))
		sb.WriteString(fmt.Sprintf("  Users online: %d\n", p.Online))
		sb.WriteString(fmt.Sprintf("  Requests in flight: %d\n", p.InFlight))
		sb.WriteString(fmt.Sprintf("  DB connections in use: %d\n", p.DBInUse))
		sb.WriteString(fmt.Sprintf("  Goroutines: %d\n", p.Goroutines))
		sb.WriteString(fmt.Sprintf("  Memory: %d MB\n", p.MemMB))
	}
	sb.WriteString(fmt.Sprintf("\nSince server start (%s):\n", m.Uptime().Round(time.Second)))
	sb.WriteString(fmt.Sprintf("  Users online: %d\n", m.peakOnline.Load()))
	sb.WriteString(fmt.Sprintf("  Requests in flight: %d", m.peakInFlight.Load()))
	return bots.Reply{Text: sb.String()}, nil
}

func (m *Monitor) cmdCapacity(ctx context.Context, _ bots.Message, _ string) (bots.Reply, error) {
	s := m.sample()
	var sb strings.Builder
	configured := 0
	for _, l := range m.limits(s) {
		if l.max <= 0 {
			continue
		}
		configured++
		ratio := float64(l.value) / float64(l.max)
		sb.WriteString(fmt.Sprintf("%s\n%s %d / %d (%.0f%%)\n\n", l.name, bar(ratio), l.value, l.max, ratio*100))
	}
	if configured == 0 {
		return bots.Reply{Text: "No capacity limits are set yet.\n" +
			"Set MAX_ONLINE_USERS and MAX_INFLIGHT_REQUESTS after a load test shows what your server can really handle."}, nil
	}
	sb.WriteString(fmt.Sprintf("Warnings start at %.0f%% of a limit.", m.cfg.WarnRatio*100))
	return bots.Reply{Text: sb.String()}, nil
}

func (m *Monitor) cmdAlerts(ctx context.Context, _ bots.Message, args string) (bots.Reply, error) {
	switch strings.ToLower(strings.TrimSpace(args)) {
	case "on":
		m.Alerter.SetEnabled(true)
		return bots.Reply{Text: "Alerts are ON."}, nil
	case "off":
		m.Alerter.SetEnabled(false)
		return bots.Reply{Text: "Alerts are OFF. Events are still recorded, see /alerts recent."}, nil
	case "recent":
		events := m.Alerter.Recent(10)
		if len(events) == 0 {
			return bots.Reply{Text: "No alerts recorded yet."}, nil
		}
		var sb strings.Builder
		for _, e := range events {
			state := "sent"
			if !e.Sent {
				state = "held"
			}
			sb.WriteString(fmt.Sprintf("%s %s %s (%s)\n", e.At.Format("15:04:05"), e.Level.icon(), e.Title, state))
		}
		return bots.Reply{Text: strings.TrimSpace(sb.String())}, nil
	default:
		status := "ON"
		if !m.Alerter.Enabled() {
			status = "OFF"
		}
		return bots.Reply{Text: fmt.Sprintf("Alerts are %s.\nUse: /alerts on, /alerts off, /alerts recent", status)}, nil
	}
}

func bar(ratio float64) string {
	if ratio < 0 {
		ratio = 0
	}
	if ratio > 1 {
		ratio = 1
	}
	filled := int(ratio*10 + 0.5)
	return strings.Repeat("█", filled) + strings.Repeat("░", 10-filled)
}
