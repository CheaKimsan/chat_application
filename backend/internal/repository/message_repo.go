package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"golang-jwt-project/internal/models"
	"golang-jwt-project/internal/ws"
	"log"

	"github.com/lib/pq"
)

type MessageRepository struct {
	db *sql.DB
}

func NewMessageRepository(db *sql.DB) *MessageRepository {
	return &MessageRepository{db: db}
}

// GetConversation now includes soft-deleted rows (tombstones) instead of
// silently dropping them, so a deleted message keeps its place in the
// timeline across reloads. Attachments are hidden for deleted messages
// since the message content itself is gone.
func (r *MessageRepository) GetConversation(ctx context.Context, callerID, otherID string) ([]models.MessageResponse, error) {
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT
			m.id, m.from_user, m.to_user, m.conversation_id, m.body, m.nonce, m.created_at, m.read_at,
			(m.deleted_at IS NOT NULL) AS is_deleted,
			(m.edited_at IS NOT NULL) AS is_edited,
			CASE WHEN m.deleted_at IS NOT NULL THEN '[]'::json ELSE
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
				)
			END AS attachments
		FROM messages m
		LEFT JOIN attachments a ON a.message_id = m.id AND m.deleted_at IS NULL
		WHERE m.conversation_id IN (
			SELECT cm1.conversation_id
			FROM conversation_members cm1
			JOIN conversation_members cm2 ON cm2.conversation_id = cm1.conversation_id
			JOIN conversations c ON c.id = cm1.conversation_id
			WHERE cm1.user_id = $1 AND cm2.user_id = $2 AND c.is_group = false
		)
		OR (m.from_user = $1 AND m.to_user = $2)
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
		var conversationID sql.NullString
		var toUser sql.NullString
		var attachmentsRaw []byte

		if err := rows.Scan(
			&m.ID, &m.FromUser, &toUser, &conversationID, &m.Body, &m.Nonce, &m.CreatedAt, &m.ReadAt,
			&m.IsDeleted, &m.IsEdited, &attachmentsRaw,
		); err != nil {
			return nil, err
		}
		if toUser.Valid {
			m.ToUser = toUser.String
		}
		if conversationID.Valid {
			m.ConversationID = conversationID.String
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

func (r *MessageRepository) Update(ctx context.Context, messageID, fromUser string, ciphertext, nonce *string) (models.MessageResponse, string, error) {
	var msg models.MessageResponse
	var toUser sql.NullString
	var conversationID sql.NullString

	err := r.db.QueryRowContext(ctx,
		`UPDATE messages
			SET body = $1, nonce = $2, edited_at = now()
			WHERE id = $3 AND from_user = $4 AND deleted_at IS NULL
			RETURNING id, from_user, to_user, conversation_id, body, nonce, created_at, read_at,
			          (edited_at IS NOT NULL) AS is_edited`,
		ciphertext, nonce, messageID, fromUser,
	).Scan(&msg.ID, &msg.FromUser, &toUser, &conversationID, &msg.Body, &msg.Nonce, &msg.CreatedAt, &msg.ReadAt, &msg.IsEdited)
	if err != nil {
		return models.MessageResponse{}, "", err
	}

	if toUser.Valid {
		msg.ToUser = toUser.String
	}
	if conversationID.Valid {
		msg.ConversationID = conversationID.String
	}

	// Broadcast target: conversation_id for the new path, to_user for legacy.
	broadcastTarget := msg.ConversationID
	if broadcastTarget == "" {
		broadcastTarget = msg.ToUser
	}

	return msg, broadcastTarget, nil
}

// Delete soft-deletes the message: the row stays, body/nonce are cleared
// server-side so no ciphertext lingers in storage, and deleted_at is set.
// The WHERE clause also guards against double-deleting an already
// tombstoned row. Returns the conversation to broadcast the tombstone to
// (falls back to legacy to_user for pre-migration rows with no
// conversation_id).
func (r *MessageRepository) Delete(ctx context.Context, messageID, fromUser string) (string, error) {
	var toUser sql.NullString
	var conversationID sql.NullString

	err := r.db.QueryRowContext(ctx,
		`UPDATE messages
		 SET deleted_at = now(), body = NULL, nonce = NULL
		 WHERE id = $1 AND from_user = $2 AND deleted_at IS NULL
		 RETURNING to_user, conversation_id`,
		messageID, fromUser,
	).Scan(&toUser, &conversationID)
	if err != nil {
		return "", err
	}

	broadcastTarget := conversationID.String
	if broadcastTarget == "" {
		broadcastTarget = toUser.String
	}
	return broadcastTarget, nil
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
		`SELECT EXISTS (SELECT 1 FROM messages WHERE id = $1 AND from_user = $2 AND deleted_at IS NULL)`,
		messageID, callerID,
	).Scan(&exists)
	return exists, err
}

func (r *MessageRepository) GetToUser(ctx context.Context, messageID string) (string, error) {
	var toUser string
	err := r.db.QueryRowContext(ctx, "SELECT to_user FROM messages WHERE id = $1", messageID).Scan(&toUser)
	return toUser, err
}

// FindOrCreateDirectConversation returns the conversation_id for the 1:1
// chat between userA and userB, creating it if it doesn't exist yet.
func (r *MessageRepository) FindOrCreateDirectConversation(ctx context.Context, userA, userB string) (string, error) {
	var conversationID string
	err := r.db.QueryRowContext(ctx, `
			SELECT c.id FROM conversations c
			JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = $1
			JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = $2
			WHERE c.is_group = false
			LIMIT 1
		`, userA, userB).Scan(&conversationID)
	if err == nil {
		return conversationID, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	if err := tx.QueryRowContext(ctx,
		`INSERT INTO conversations (is_group, created_by) VALUES (false, $1) RETURNING id`,
		userA,
	).Scan(&conversationID); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
		conversationID, userA, userB,
	); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return conversationID, nil
}

func (r *MessageRepository) CreateConversation(ctx context.Context, createdBy, name string, isGroup bool, memberIDs []string) (models.ConversationResponse, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return models.ConversationResponse{}, err
	}
	defer tx.Rollback()

	var conv models.ConversationResponse
	if err := tx.QueryRowContext(ctx,
		`INSERT INTO conversations (is_group, name, created_by) VALUES ($1, $2, $3) RETURNING id, is_group, name, created_by, created_at`,
		isGroup, name, createdBy,
	).Scan(&conv.ID, &conv.IsGroup, &conv.Name, &conv.CreatedBy, &conv.CreatedAt); err != nil {
		return models.ConversationResponse{}, err
	}

	for _, memberID := range memberIDs {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			conv.ID, memberID,
		); err != nil {
			return models.ConversationResponse{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return models.ConversationResponse{}, err
	}
	conv.MemberIDs = memberIDs
	return conv, nil
}

func (r *MessageRepository) IsConversationMember(ctx context.Context, conversationID, userID string) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2)`,
		conversationID, userID,
	).Scan(&exists)
	return exists, err
}

func (r *MessageRepository) GetConversationMembers(ctx context.Context, conversationID string) ([]string, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT user_id FROM conversation_members WHERE conversation_id = $1`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var members []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		members = append(members, id)
	}
	return members, rows.Err()
}

// CreateInConversation replaces Create — inserts a message against a
// conversation_id instead of a single to_user.
func (r *MessageRepository) CreateInConversation(ctx context.Context, fromUser, conversationID string, body, ciphertext, nonce *string) (models.MessageResponse, error) {
	var msg models.MessageResponse
	err := r.db.QueryRowContext(ctx, `
			INSERT INTO messages (from_user, conversation_id, body, nonce, created_at)
			VALUES ($1, $2, COALESCE($3, $4), $5, now())
			RETURNING id, from_user, conversation_id, body, nonce, created_at
		`, fromUser, conversationID, body, ciphertext, nonce).Scan(
		&msg.ID, &msg.FromUser, &msg.ConversationID, &msg.Body, &msg.Nonce, &msg.CreatedAt,
	)
	return msg, err
}

// GetByConversationID — same tombstone-inclusive treatment as
// GetConversation: soft-deleted rows are returned with is_deleted=true
// instead of being filtered out, so a delete survives a page reload.
func (r *MessageRepository) GetByConversationID(ctx context.Context, conversationID string) ([]models.MessageResponse, error) {
	rows, err := r.db.QueryContext(ctx, `
			SELECT id, from_user, conversation_id, body, nonce, created_at, read_at,
			       (deleted_at IS NOT NULL) AS is_deleted,
			       (edited_at IS NOT NULL) AS is_edited
			FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC
		`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.MessageResponse
	var ids []string
	for rows.Next() {
		var m models.MessageResponse
		if err := rows.Scan(&m.ID, &m.FromUser, &m.ConversationID, &m.Body, &m.Nonce, &m.CreatedAt, &m.ReadAt, &m.IsDeleted, &m.IsEdited); err != nil {
			return nil, err
		}
		out = append(out, m)
		ids = append(ids, m.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}

	attRows, err := r.db.QueryContext(ctx, `
			SELECT id, message_id, type, url, filename, mime_type, size_bytes, created_at
			FROM attachments WHERE message_id = ANY($1)
		`, pq.Array(ids))
	if err != nil {
		return nil, err
	}
	defer attRows.Close()

	byMessage := make(map[string][]ws.Attachment)
	for attRows.Next() {
		var a ws.Attachment
		if err := attRows.Scan(&a.ID, &a.MessageID, &a.Type, &a.URL, &a.Filename, &a.MimeType, &a.SizeBytes, &a.CreatedAt); err != nil {
			return nil, err
		}
		byMessage[a.MessageID] = append(byMessage[a.MessageID], a)
	}
	if err := attRows.Err(); err != nil {
		return nil, err
	}

	for i := range out {
		out[i].Attachments = byMessage[out[i].ID]
	}

	return out, nil
}

// GetConversationAndSender is used by NotifyAttachments to look up a
// message's conversation_id + original sender, replacing GetToUser.
func (r *MessageRepository) GetConversationAndSender(ctx context.Context, messageID string) (conversationID, fromUser string, err error) {
	err = r.db.QueryRowContext(ctx,
		`SELECT conversation_id, from_user FROM messages WHERE id = $1`, messageID,
	).Scan(&conversationID, &fromUser)
	return
}

func (r *MessageRepository) ListConversationsForUser(ctx context.Context, userID string) ([]models.ConversationResponse, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT c.id, c.is_group, c.name, c.created_by, c.created_at
		FROM conversations c
		JOIN conversation_members cm ON cm.conversation_id = c.id
		WHERE cm.user_id = $1
		ORDER BY c.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.ConversationResponse
	for rows.Next() {
		var conv models.ConversationResponse
		if err := rows.Scan(&conv.ID, &conv.IsGroup, &conv.Name, &conv.CreatedBy, &conv.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, conv)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// N+1, but conversation lists are small and this reuses the existing method.
	for i := range out {
		memberIDs, err := r.GetConversationMembers(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].MemberIDs = memberIDs
	}

	return out, nil
}
