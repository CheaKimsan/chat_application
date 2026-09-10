package models

import (
	"golang-jwt-project/internal/ws"
	"time"
)

type SendMessageRequest struct {
	ToUser         string  `json:"to_user"`         // now optional — legacy 1:1 path
	ConversationID *string `json:"conversation_id"` // NEW — group + preferred 1:1 path
	Ciphertext     *string `json:"ciphertext"`
	Body           *string `json:"body"` // NEW — plaintext body for unencrypted group messages
	Nonce          *string `json:"nonce"`
}

type EditMessageRequest struct {
	Ciphertext *string `json:"ciphertext"`
	Nonce      *string `json:"nonce"`
}

type MessageResponse struct {
	ID             string          `json:"id"`
	FromUser       string          `json:"from_user"`
	ToUser         string          `json:"to_user,omitempty"`
	ConversationID string          `json:"conversation_id,omitempty"` // NEW
	Body           *string         `json:"body,omitempty"`
	Nonce          *string         `json:"nonce,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
	Attachments    []ws.Attachment `json:"attachments,omitempty"`
	ReadAt         *time.Time      `json:"read_at"`
}

type ConversationResponse struct {
	ID        string    `json:"id"`
	IsGroup   bool      `json:"is_group"`
	Name      *string   `json:"name,omitempty"`
	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
	MemberIDs []string  `json:"member_ids"`
}
