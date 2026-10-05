package services

import (
	"context"
	"golang-jwt-project/internal/models"
	"log"
)

func (s *MessageService) AddReaction(ctx context.Context, userID, messageID, emoji string) error {
	target, err := s.messages.AddReaction(ctx, messageID, userID, emoji)
	if err != nil {
		return err
	}
	s.broadcastToConversation(ctx, target, "", map[string]interface{}{
		"type": "reaction_added", "message_id": messageID, "user_id": userID, "emoji": emoji,
	})
	return nil
}

func (s *MessageService) RemoveReaction(ctx context.Context, userID, messageID, emoji string) error {
	target, err := s.messages.RemoveReaction(ctx, messageID, userID, emoji)
	if err != nil {
		return err
	}
	s.broadcastToConversation(ctx, target, "", map[string]interface{}{
		"type": "reaction_removed", "message_id": messageID, "user_id": userID, "emoji": emoji,
	})
	return nil
}

func (s *MessageService) AttachReactions(ctx context.Context, msgs []models.MessageResponse) error {
	if len(msgs) == 0 {
		return nil
	}
	ids := make([]string, len(msgs))
	for i, m := range msgs {
		ids[i] = m.ID
	}

	reactions, err := s.messages.GetReactionsForMessages(ctx, ids)

	if err != nil {
		log.Printf("AttachReactions error: %v", err)
		return err
	}
	log.Printf("AttachReactions: %d msgs, %d with reactions", len(msgs), len(reactions))

	for i := range msgs {
		msgs[i].Reactions = reactions[msgs[i].ID]
	}
	return nil
}
