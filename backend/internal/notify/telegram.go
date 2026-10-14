package notify

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
	"time"
)

type Telegram struct {
	token  string
	chatID string
	client *http.Client
}

func NewTelegram(token, chatID string) *Telegram {
	return &Telegram{
		token:  token,
		chatID: chatID,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (t *Telegram) Enabled() bool {
	return t != nil && t.token != "" && t.chatID != ""
}

func (t *Telegram) Send(ctx context.Context, text string) error {
	payload, _ := json.Marshal(map[string]any{
		"chat_id":                  t.chatID,
		"text":                     text, // plain text: no parse_mode, so usernames can't inject formatting
		"disable_web_page_preview": true,
	})

	endpoint := "https://api.telegram.org/bot" + t.token + "/sendMessage"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return errors.New("telegram: could not build request")
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.client.Do(req)
	if err != nil {
		// url.Error contains the full URL, which includes the bot token. Never log it.
		var ue *url.Error
		if errors.As(err, &ue) {
			return fmt.Errorf("telegram: request failed: %w", ue.Err)
		}
		return errors.New("telegram: request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("telegram: status %d: %s", resp.StatusCode, body)
	}
	return nil
}

// SendAsync never blocks the caller, and uses its own context because the
// HTTP request context is cancelled as soon as the response is written.
func (t *Telegram) SendAsync(text string) {
	if !t.Enabled() {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := t.Send(ctx, text); err != nil {
			log.Printf("telegram notify failed: %v", err)
		}
	}()
}
