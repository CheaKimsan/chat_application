package models

import "time"

type CallHistory struct {
	ID              string    `json:"id"`
	CallID          string    `json:"call_id"`
	FromUser        string    `json:"from_user"`
	ToUser          string    `json:"to_user"`
	Mode            string    `json:"mode"`
	Status          string    `json:"status"`
	DurationSeconds *int      `json:"duration_seconds,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type CreateCallHistoryRequest struct {
	CallID          string `json:"call_id" binding:"required"`
	ToUser          string `json:"to_user" binding:"required"`
	Mode            string `json:"mode" binding:"required"`
	Status          string `json:"status" binding:"required"`
	DurationSeconds *int   `json:"duration_seconds"`
}
