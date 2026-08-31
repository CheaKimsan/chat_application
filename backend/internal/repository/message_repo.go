package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"golang-jwt-project/internal/models"
	"log"
)

type MessageRepository struct {
	db *sql.DB
}

func NewMessageRepository(db *sql.DB) *MessageRepository {
	return &MessageRepository{db: db}
}

func (r *MessageRepository) GetConversation(ctx context.Context, callerID, otherID string) ([]models.MessageResponse, error) {
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT
       m.id, m.from_user, m.to_user, m.body, m.nonce, m.created_at, m.read_at,
       COALESCE(
           json_agg(
               json_build_object(
                   'id', a.id,
                   'message_id', a.message_id::text,
                   'type', a.type,
                   'url', a.url,
                   'filename', a.filename,
                   'mime_type', a.mime_type,
                   'size_bytes', a.size_bytes,
                   'created_at', a.created_at
               ) ORDER BY a.created_at
           ) FILTER (WHERE a.id IS NOT NULL),
           '[]'
       ) AS attachments
   FROM messages m
   LEFT JOIN attachments a ON a.message_id = m.id
   WHERE (m.from_user = $1 AND m.to_user = $2)
      OR (m.from_user = $2 AND m.to_user = $1)
   GROUP BY m.id
   ORDER BY m.created_at ASC`,
		callerID,
		otherID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []models.MessageResponse
	for rows.Next() {
		var m models.MessageResponse
		var attachmentsRaw []byte

		if err := rows.Scan(
			&m.ID, &m.FromUser, &m.ToUser, &m.Body, &m.Nonce, &m.CreatedAt, &m.ReadAt,
			&attachmentsRaw,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(attachmentsRaw, &m.Attachments); err != nil {
			log.Println("unmarshal error:", err, "raw:", string(attachmentsRaw))
			return nil, err
		}
		messages = append(messages, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return messages, nil
}

func (r *MessageRepository) Create(ctx context.Context, fromUser, toUser string, ciphertext, nonce *string) (models.MessageResponse, error) {
	var msg models.MessageResponse
	err := r.db.QueryRowContext(ctx,
		`INSERT INTO messages (from_user, to_user, body, nonce)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, from_user, to_user, body, nonce, created_at, read_at`,
		fromUser, toUser, ciphertext, nonce,
	).Scan(&msg.ID, &msg.FromUser, &msg.ToUser, &msg.Body, &msg.Nonce, &msg.CreatedAt, &msg.ReadAt)
	if err != nil {
		return models.MessageResponse{}, err
	}
	return msg, nil
}

// MarkRead marks the message as read if it belongs to callerID and hasn't
// been read yet, returning the sender's id. Returns sql.ErrNoRows (unwrapped)
// if the message doesn't exist, isn't addressed to callerID, or is already read.
func (r *MessageRepository) MarkRead(ctx context.Context, msgID, callerID string) (string, error) {
	var fromUser string
	err := r.db.QueryRowContext(ctx,
		`UPDATE messages SET read_at = now()
		 WHERE id = $1 AND to_user = $2 AND read_at IS NULL
		 RETURNING from_user`,
		msgID, callerID,
	).Scan(&fromUser)
	if err != nil {
		return "", err
	}
	return fromUser, nil
}

func (r *MessageRepository) ExistsFromUser(ctx context.Context, messageID, callerID string) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx,
		`SELECT EXISTS (SELECT 1 FROM messages WHERE id = $1 AND from_user = $2)`,
		messageID, callerID,
	).Scan(&exists)
	return exists, err
}

func (r *MessageRepository) GetToUser(ctx context.Context, messageID string) (string, error) {
	var toUser string
	err := r.db.QueryRowContext(ctx, "SELECT to_user FROM messages WHERE id = $1", messageID).Scan(&toUser)
	return toUser, err
}
