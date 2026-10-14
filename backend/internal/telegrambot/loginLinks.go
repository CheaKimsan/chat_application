package telegrambot

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"sync"
	"time"
)

// LoginLinks issues one-time, short-lived tokens that can be exchanged for a
// so a memory dump or log never reveals a usable token.
type LoginLinks struct {
	mu     sync.Mutex
	ttl    time.Duration
	tokens map[[32]byte]loginEntry
}

type LoginLinkConsumer interface {
	Consume(token string) (userID string, ok bool)
}

type loginEntry struct {
	userID  string
	expires time.Time
}

func NewLoginLinks(ttl time.Duration) *LoginLinks {
	return &LoginLinks{ttl: ttl, tokens: map[[32]byte]loginEntry{}}
}

// Create returns a new random token bound to userID.
func (l *LoginLinks) Create(userID string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)

	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	for k, e := range l.tokens { // drop expired entries
		if now.After(e.expires) {
			delete(l.tokens, k)
		}
	}
	l.tokens[sha256.Sum256([]byte(token))] = loginEntry{userID: userID, expires: now.Add(l.ttl)}
	return token, nil
}

// Consume validates the token and deletes it, so it can be used only once.
// It returns the user the token was issued for.
func (l *LoginLinks) Consume(token string) (userID string, ok bool) {
	key := sha256.Sum256([]byte(token))

	l.mu.Lock()
	defer l.mu.Unlock()

	entry, found := l.tokens[key]
	if !found {
		return "", false
	}
	delete(l.tokens, key) // single use, even if it turns out to be expired
	if time.Now().After(entry.expires) {
		return "", false
	}
	return entry.userID, true
}
