package ws

import "time"

type Message struct {
	Type        string       `json:"type"`         // "new_message" | "typing" | "message_read" | "key_exchange_request" | "key_exchange_response" | "key_exchange_failed"
	ID          string       `json:"id,omitempty"` // DB id, once persisted
	FromUser    string       `json:"from_user"`
	ToUser      string       `json:"to_user,omitempty"`
	Body        string       `json:"body,omitempty"`
	Attachments []Attachment `json:"attachments,omitempty"`
	IsTyping    bool         `json:"is_typing,omitempty"`
	CreatedAt   *time.Time   `json:"created_at,omitempty"`
	PublicKey   string       `json:"public_key,omitempty"` // used by key_exchange_request/response
	Reason      string       `json:"reason,omitempty"`     // used by key_exchange_failed
}

type Attachment struct {
	ID         string    `json:"id"`
	MessageID  string    `json:"message_id"`
	Type       string    `json:"type"`
	URL        string    `json:"url"`
	Filename   string    `json:"filename,omitempty"`
	MimeType   string    `json:"mime_type,omitempty"`
	SizeBytes  int64     `json:"size_bytes,omitempty"`
	DurationMs *int      `json:"duration_ms,omitempty"`
	CreatedAt  time.Time `json:"created_at,omitempty"`
}
