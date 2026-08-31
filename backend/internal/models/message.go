package models

import (
	"golang-jwt-project/internal/ws"
	"time"
)

type SendMessageRequest struct {
	ToUser     string  `json:"to_user" binding:"required"`
	Ciphertext *string `json:"ciphertext"`
	Nonce      *string `json:"nonce"`
}

type MessageResponse struct {
	ID          string          `json:"id"`
	FromUser    string          `json:"from_user"`
	ToUser      string          `json:"to_user"`
	Body        *string         `json:"body,omitempty"`
	Nonce       *string         `json:"nonce,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
	Attachments []ws.Attachment `json:"attachments,omitempty"`
	ReadAt      *time.Time      `json:"read_at"`
}
