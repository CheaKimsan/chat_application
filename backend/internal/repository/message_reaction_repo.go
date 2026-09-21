package repository

import (
	"context"
	"database/sql"
	"fmt"
	"golang-jwt-project/internal/models"
	"strings"
)

// --- Add to models package ---
//
// type Reaction struct {
//     Emoji string   `json:"emoji"`
//     Users []string `json:"users"` // user ids who reacted with this emoji
// }
//
// Add to MessageResponse:
//     Reactions []models.Reaction `json:"reactions,omitempty"`
//
// This file also needs "fmt" and "strings" imported alongside your
// existing repository package imports.

// AddReaction inserts a reaction, ignoring the call if this exact
// (message, user, emoji) combo already exists (ON CONFLICT DO NOTHING —
// toggling behavior, i.e. "already reacted", is handled client-side by
// calling RemoveReaction instead when the user clicks an emoji they've
// already picked). Returns the message's conversation_id / to_user so the
// caller can broadcast the update, same pattern as Delete/Update.
func (r *MessageRepository) AddReaction(ctx context.Context, messageID, userID, emoji string) (string, error) {
	var toUser sql.NullString
	var conversationID sql.NullString
	err := r.db.QueryRowContext(ctx,
		`SELECT to_user, conversation_id FROM messages WHERE id = $1 AND deleted_at IS NULL`,
		messageID,
	).Scan(&toUser, &conversationID)
	if err != nil {
		return "", err
	}

	if _, err := r.db.ExecContext(ctx,
		`INSERT INTO message_reactions (message_id, user_id, emoji)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
		messageID, userID, emoji,
	); err != nil {
		return "", err
	}

	target := conversationID.String
	if target == "" {
		target = toUser.String
	}
	return target, nil
}

func (r *MessageRepository) RemoveReaction(ctx context.Context, messageID, userID, emoji string) (string, error) {
	var toUser sql.NullString
	var conversationID sql.NullString
	err := r.db.QueryRowContext(ctx,
		`SELECT to_user, conversation_id FROM messages WHERE id = $1`,
		messageID,
	).Scan(&toUser, &conversationID)
	if err != nil {
		return "", err
	}

	if _, err := r.db.ExecContext(ctx,
		`DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
		messageID, userID, emoji,
	); err != nil {
		return "", err
	}

	target := conversationID.String
	if target == "" {
		target = toUser.String
	}
	return target, nil
}

// GetReactionsForMessages batches reaction lookup for a set of message ids
// (call once per page load, not per message) and groups rows into
// per-message, per-emoji lists of user ids — the shape the frontend wants
// to render badges like "👍 3". Builds a plain IN (...) clause rather than
// relying on a driver-specific array type (pq.Array/pgtype), so this works
// regardless of which Postgres driver you're on.
func (r *MessageRepository) GetReactionsForMessages(ctx context.Context, messageIDs []string) (map[string][]models.Reaction, error) {
	result := make(map[string][]models.Reaction)
	if len(messageIDs) == 0 {
		return result, nil
	}

	placeholders := make([]string, len(messageIDs))
	args := make([]interface{}, len(messageIDs))
	for i, id := range messageIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}

	query := fmt.Sprintf(
		`SELECT message_id, emoji, user_id
		 FROM message_reactions
		 WHERE message_id IN (%s)
		 ORDER BY created_at ASC`,
		strings.Join(placeholders, ", "),
	)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// messageID -> emoji -> []userID, preserving emoji insertion order.
	byMessage := make(map[string]map[string][]string)
	emojiOrder := make(map[string][]string)

	for rows.Next() {
		var messageID, emoji, userID string
		if err := rows.Scan(&messageID, &emoji, &userID); err != nil {
			return nil, err
		}
		if byMessage[messageID] == nil {
			byMessage[messageID] = make(map[string][]string)
		}
		if _, exists := byMessage[messageID][emoji]; !exists {
			emojiOrder[messageID] = append(emojiOrder[messageID], emoji)
		}
		byMessage[messageID][emoji] = append(byMessage[messageID][emoji], userID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for messageID, emojis := range emojiOrder {
		for _, emoji := range emojis {
			result[messageID] = append(result[messageID], models.Reaction{
				Emoji: emoji,
				Users: byMessage[messageID][emoji],
			})
		}
	}
	return result, nil
}
