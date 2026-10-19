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

// Reply is what a bot sends back.
type Reply struct {
	Text    string     `json:"text"`
	Buttons [][]Button `json:"buttons,omitempty"` // rows of buttons
}

// Message is what a bot receives.
type Message struct {
	UserID         string // who sent it
	ConversationID string
	Text           string
}

// Handler runs one command. args is everything after the command name.
type Handler func(ctx context.Context, m Message, args string) (Reply, error)

type command struct {
	description string
	handle      Handler
}

// Bot is a set of commands plus an optional fallback for plain text.
type Bot struct {
	ID       string // the bot's user id in the users table
	Name     string
	commands map[string]command
	fallback Handler
}

func New(id, name string) *Bot {
	b := &Bot{ID: id, Name: name, commands: map[string]command{}}
	b.Command("help", "Show what this bot can do", b.help)
	return b
}

// Command registers /name. Only registered commands can ever run.
func (b *Bot) Command(name, description string, h Handler) {
	b.commands[strings.ToLower(strings.TrimPrefix(name, "/"))] = command{description, h}
}

// Fallback handles any message that is not a command (for example an AI reply).
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

// handle parses "/name args" and runs the matching handler. It never panics
// and never runs longer than the timeout.
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

// Registry finds the bot for a user id and rate-limits each human user.
type Registry struct {
	mu       sync.Mutex
	bots     map[string]*Bot
	limiters map[string]*rate.Limiter
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

// Dispatch sends m to the bot with id botUserID. ok is false when that id is
// not a bot. A user who sends too fast gets a polite "slow down" reply instead
// of running the command.
func (r *Registry) Dispatch(ctx context.Context, botUserID string, m Message) (reply Reply, ok bool) {
	r.mu.Lock()
	b, found := r.bots[botUserID]
	lim, hasLim := r.limiters[m.UserID]
	if !hasLim {
		lim = rate.NewLimiter(rate.Limit(1), 5) // 1 message/second, bursts of 5
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
