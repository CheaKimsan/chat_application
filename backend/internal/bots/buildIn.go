package bots

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type Button struct {
	Label string `json:"label"`
	Data  string `json:"data"`
}

type Reply struct {
	Text    string     `json:"text"`
	Buttons [][]Button `json:"buttons,omitempty"`
}

type Message struct {
	UserID         string
	ConversationID string
	Text           string
}

type Handler func(ctx context.Context, m Message, args string) (Reply, error)

type command struct {
	description string
	handle      Handler
}

type Bot struct {
	ID       string
	Name     string
	commands map[string]command
	fallback Handler
}

type Registry struct {
	mu       sync.Mutex
	bots     map[string]*Bot
	limiters map[string]*rate.Limiter
}

func New(id, name string) *Bot {
	b := &Bot{ID: id, Name: name, commands: map[string]command{}}
	b.Command("help", "Show what this bot can do", b.help)
	return b
}

func (b *Bot) Command(name, description string, h Handler) {
	b.commands[strings.ToLower(strings.TrimPrefix(name, "/"))] = command{description, h}
}

func (b *Bot) Fallback(h Handler) { b.fallback = h }

func (b *Bot) help(context.Context, Message, string) (Reply, error) {
	names := make([]string, 0, len(b.commands))
	for n := range b.commands {
		names = append(names, n)
	}
	sort.Strings(names)

	var sb strings.Builder
	sb.WriteString("Commands:\n")
	for _, n := range names {
		sb.WriteString(fmt.Sprintf("/%s - %s\n", n, b.commands[n].description))
	}
	return Reply{Text: strings.TrimSpace(sb.String())}, nil
}

func (b *Bot) handle(ctx context.Context, m Message) (reply Reply) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	defer func() {
		if r := recover(); r != nil {
			reply = Reply{Text: "Sorry, that command failed."}
		}
	}()

	text := strings.TrimSpace(m.Text)
	h := b.fallback

	args := text
	if strings.HasPrefix(text, "/") {
		fields := strings.Fields(text)
		name := strings.ToLower(strings.TrimPrefix(fields[0], "/"))
		cmd, ok := b.commands[name]
		if !ok {
			return Reply{Text: "Unknown command. Try /help"}
		}
		h = cmd.handle
		args = strings.TrimSpace(strings.TrimPrefix(text, fields[0]))
	}

	if h == nil {
		return Reply{Text: "I only understand commands. Try /help"}
	}

	out, err := h(ctx, m, args)
	if err != nil {
		return Reply{Text: "Something went wrong. Please try again."} // details belong in your server log
	}
	return out
}



func NewRegistry() *Registry {
	return &Registry{bots: map[string]*Bot{}, limiters: map[string]*rate.Limiter{}}
}

func (r *Registry) Add(b *Bot) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.bots[b.ID] = b
}

// IsBot reports whether userID belongs to a registered bot.
func (r *Registry) IsBot(userID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.bots[userID]
	return ok
}

func (r *Registry) Dispatch(ctx context.Context, botUserID string, m Message) (reply Reply, ok bool) {
	r.mu.Lock()
	b, found := r.bots[botUserID]
	lim, hasLim := r.limiters[m.UserID]
	if !hasLim {
		lim = rate.NewLimiter(rate.Limit(1), 5)
		r.limiters[m.UserID] = lim
	}
	r.mu.Unlock()

	if !found {
		return Reply{}, false
	}
	if !lim.Allow() {
		return Reply{Text: "You're sending messages too fast. Please slow down."}, true
	}
	return b.handle(ctx, m), true
}
