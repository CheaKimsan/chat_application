package telegrambot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"time"
)

type CommandFunc func(ctx context.Context, args string) string

type Bot struct {
	token    string
	adminID  int64
	client   *http.Client
	commands map[string]CommandFunc
	order    []string // registration order, used to build the button grid
	started  time.Time
}

type tgUser struct {
	ID int64 `json:"id"`
}

type tgChat struct {
	ID int64 `json:"id"`
}

type tgMessage struct {
	MessageID int64  `json:"message_id"`
	Text      string `json:"text"`
	Chat      tgChat `json:"chat"`
	From      tgUser `json:"from"`
}

type tgCallbackQuery struct {
	ID      string     `json:"id"`
	Data    string     `json:"data"`
	From    tgUser     `json:"from"`
	Message *tgMessage `json:"message"`
}

type update struct {
	UpdateID      int64            `json:"update_id"`
	Message       *tgMessage       `json:"message"`
	CallbackQuery *tgCallbackQuery `json:"callback_query"`
}

type inlineButton struct {
	Text         string `json:"text"`
	CallbackData string `json:"callback_data,omitempty"`
}

type inlineKeyboard struct {
	InlineKeyboard [][]inlineButton `json:"inline_keyboard"`
}

func New(token string, adminID int64) *Bot {
	b := &Bot{
		token:    token,
		adminID:  adminID,
		client:   &http.Client{Timeout: 40 * time.Second},
		commands: map[string]CommandFunc{},
		started:  time.Now(),
	}
	b.Handle("ping", func(context.Context, string) string { return "pong" })
	b.Handle("status", b.status)
	return b
}

func (b *Bot) Handle(name string, fn CommandFunc) {
	name = strings.ToLower(name)
	if _, exists := b.commands[name]; !exists {
		b.order = append(b.order, name)
	}
	b.commands[name] = fn
}

// EnableLogin registers the "login" command (and its button).
//
// When you send /login, the bot creates a single-use token for userID and
// replies with <baseURL>/telegram-login?token=... The web app's
// /telegram-login page then exchanges that token for a normal session.
//
//	links   - the shared store; the same value must also be given to the
//	          auth handler so POST /telegram-login can consume the token
//	userID  - the web account the link logs into (fixed, never taken from
//	          message text)
//	baseURL - where the React app is served, e.g. http://localhost:3000
func (b *Bot) EnableLogin(links *LoginLinks, userID, baseURL string) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if links == nil || strings.TrimSpace(userID) == "" || baseURL == "" {
		log.Println("telegram bot: /login disabled (needs login links, TELEGRAM_LOGIN_USER_ID and APP_BASE_URL)")
		return
	}

	b.Handle("login", func(ctx context.Context, _ string) string {
		token, err := links.Create(userID)
		if err != nil {
			log.Printf("telegram bot: could not create login token: %v", err)
			return "Could not create a login link."
		}
		return fmt.Sprintf(
			"One-time login link (valid %s, works once):\n%s/telegram-login?token=%s",
			links.ttl.Round(time.Second), baseURL, token,
		)
	})
}

func (b *Bot) Run(ctx context.Context) {
	log.Println("telegram bot: listening for commands")
	var offset int64
	for ctx.Err() == nil {
		updates, err := b.getUpdates(ctx, offset)
		if err != nil {
			log.Printf("telegram bot: getUpdates failed: %v", err)
			select {
			case <-time.After(5 * time.Second):
			case <-ctx.Done():
				return
			}
			continue
		}
		for _, u := range updates {
			offset = u.UpdateID + 1
			b.handleUpdate(ctx, u)
		}
	}
}

func (b *Bot) menuKeyboard() inlineKeyboard {
	var rows [][]inlineButton
	var row []inlineButton
	for _, name := range b.order {
		row = append(row, inlineButton{Text: name, CallbackData: "cmd:" + name})
		if len(row) == 2 {
			rows = append(rows, row)
			row = nil
		}
	}
	if len(row) > 0 {
		rows = append(rows, row)
	}
	return inlineKeyboard{InlineKeyboard: rows}
}

func backKeyboard() inlineKeyboard {
	return inlineKeyboard{InlineKeyboard: [][]inlineButton{
		{{Text: "« Back to Commands", CallbackData: "menu"}},
	}}
}

func (b *Bot) handleUpdate(ctx context.Context, u update) {
	if u.CallbackQuery != nil {
		b.handleCallback(ctx, u.CallbackQuery)
		return
	}

	m := u.Message
	if m == nil || !strings.HasPrefix(m.Text, "/") {
		return
	}
	if m.Chat.ID != b.adminID || m.From.ID != b.adminID {
		log.Printf("telegram bot: ignored message from chat=%d user=%d", m.Chat.ID, m.From.ID)
		return
	}

	fields := strings.Fields(m.Text)
	name := strings.ToLower(strings.TrimPrefix(fields[0], "/"))
	if i := strings.Index(name, "@"); i >= 0 {
		name = name[:i] // "/ping@MyBot" -> "ping"
	}
	args := strings.TrimSpace(strings.TrimPrefix(m.Text, fields[0]))

	log.Printf("telegram bot: command /%s from %d", name, m.From.ID) // audit log

	switch name {
	case "start", "help", "menu":
		b.send(ctx, "Choose a command:", b.menuKeyboard())
		return
	}

	text, ok := b.run(ctx, name, args)
	if !ok {
		b.send(ctx, "Unknown command. Try /menu", nil)
		return
	}
	b.send(ctx, text, nil)
}

func (b *Bot) handleCallback(ctx context.Context, cq *tgCallbackQuery) {
	if cq.Message == nil || cq.From.ID != b.adminID || cq.Message.Chat.ID != b.adminID {
		log.Printf("telegram bot: ignored callback from user=%d", cq.From.ID)
		return
	}

	// Always answer, otherwise the button shows a loading spinner.
	_ = b.call(ctx, "answerCallbackQuery", map[string]any{"callback_query_id": cq.ID}, nil)

	text := "Choose a command:"
	keyboard := b.menuKeyboard()

	if strings.HasPrefix(cq.Data, "cmd:") {
		name := strings.TrimPrefix(cq.Data, "cmd:")
		log.Printf("telegram bot: button /%s from %d", name, cq.From.ID) // audit log

		result, ok := b.run(ctx, name, "")
		if !ok {
			result = "Unknown command."
		}
		text = "/" + name + "\n\n" + result
		keyboard = backKeyboard()
	}
	// any other data ("menu") just shows the grid again

	err := b.call(ctx, "editMessageText", map[string]any{
		"chat_id":      cq.Message.Chat.ID,
		"message_id":   cq.Message.MessageID,
		"text":         text,
		"reply_markup": keyboard,
	}, nil)
	if err != nil {
		log.Printf("telegram bot: edit message failed: %v", err)
	}
}

// run executes a registered command with a timeout and panic protection.
// The second return value is false when the command does not exist.
func (b *Bot) run(ctx context.Context, name, args string) (result string, ok bool) {
	fn, exists := b.commands[name]
	if !exists {
		return "", false
	}

	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	defer func() {
		if r := recover(); r != nil {
			log.Printf("telegram bot: command /%s panicked: %v", name, r)
			result, ok = "Command failed.", true
		}
	}()
	return fn(cctx, args), true
}

func (b *Bot) status(context.Context, string) string {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	return fmt.Sprintf("Uptime: %s\nGoroutines: %d\nMemory: %d MB",
		time.Since(b.started).Round(time.Second), runtime.NumGoroutine(), mem.Alloc/1024/1024)
}

func (b *Bot) send(ctx context.Context, text string, markup any) {
	payload := map[string]any{"chat_id": b.adminID, "text": text}
	if markup != nil {
		payload["reply_markup"] = markup
	}
	if err := b.call(ctx, "sendMessage", payload, nil); err != nil {
		log.Printf("telegram bot: send failed: %v", err)
	}
}

func (b *Bot) getUpdates(ctx context.Context, offset int64) ([]update, error) {
	var out struct {
		OK     bool     `json:"ok"`
		Result []update `json:"result"`
	}
	err := b.call(ctx, "getUpdates", map[string]any{
		"offset":          offset,
		"timeout":         30,
		"allowed_updates": []string{"message", "callback_query"},
	}, &out)
	return out.Result, err
}

func (b *Bot) call(ctx context.Context, method string, payload, out any) error {
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.telegram.org/bot"+b.token+"/"+method, bytes.NewReader(body))
	if err != nil {
		return errors.New("could not build request")
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.client.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			return fmt.Errorf("request failed: %w", ue.Err)
		}
		return errors.New("request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("status %d: %s", resp.StatusCode, msg)
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}
