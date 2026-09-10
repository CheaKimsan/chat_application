package services

import (
	"context"
	"errors"

	"golang-jwt-project/internal/models"
	"golang-jwt-project/internal/repository"
	"golang-jwt-project/internal/ws"
)

type MessageService struct {
	messages *repository.MessageRepository
	pool     *ws.Pool
}

var ErrNotConversationMember = errors.New("caller is not a member of this conversation")
var ErrMissingRecipient = errors.New("either conversation_id or to_user is required")

func NewMessageService(messages *repository.MessageRepository, pool *ws.Pool) *MessageService {
	return &MessageService{messages: messages, pool: pool}
}

// GetConversation is kept for backward compatibility with the existing
// GET /:userId route — resolves to the 1:1 conversation between callerID
// and otherID under the hood.
func (s *MessageService) GetConversation(ctx context.Context, callerID, otherID string) ([]models.MessageResponse, error) {
	return s.messages.GetConversation(ctx, callerID, otherID)
}

// GetConversationByID fetches messages for a conversation_id directly —
// used by both 1:1 (post-migration) and group chats. Caller must already
// be verified as a member via IsConversationMember before this is called.
func (s *MessageService) GetConversationByID(ctx context.Context, conversationID string) ([]models.MessageResponse, error) {
	return s.messages.GetByConversationID(ctx, conversationID)
}

// IsConversationMember reports whether userID belongs to conversationID —
// used both to gate GetConversationByID and to gate Send when a
// conversation_id is provided directly.
func (s *MessageService) IsConversationMember(ctx context.Context, conversationID, userID string) (bool, error) {
	return s.messages.IsConversationMember(ctx, conversationID, userID)
}

// CreateGroup creates a new group conversation with callerID plus every
// ID in memberIDs as members.
func (s *MessageService) CreateGroup(ctx context.Context, callerID, name string, memberIDs []string) (models.ConversationResponse, error) {
	allMembers := append([]string{callerID}, memberIDs...)
	return s.messages.CreateConversation(ctx, callerID, name, true, allMembers)
}

// Send accepts either a conversation_id (group chat, or the new 1:1 path)
// or a legacy to_user (old 1:1 path — automatically resolved to/created
// as a 2-person conversation). The message is broadcast to every other
// member of the resulting conversation.
func (s *MessageService) Send(ctx context.Context, fromUser string, req models.SendMessageRequest) (models.MessageResponse, error) {
	var conversationID string

	switch {
	case req.ConversationID != nil && *req.ConversationID != "":
		isMember, err := s.messages.IsConversationMember(ctx, *req.ConversationID, fromUser)
		if err != nil {
			return models.MessageResponse{}, err
		}
		if !isMember {
			return models.MessageResponse{}, ErrNotConversationMember
		}
		conversationID = *req.ConversationID

	case req.ToUser != "":
		id, err := s.messages.FindOrCreateDirectConversation(ctx, fromUser, req.ToUser)
		if err != nil {
			return models.MessageResponse{}, err
		}
		conversationID = id

	default:
		return models.MessageResponse{}, ErrMissingRecipient
	}

	msg, err := s.messages.CreateInConversation(ctx, fromUser, conversationID, req.Body, req.Ciphertext, req.Nonce)
	if err != nil {
		return models.MessageResponse{}, err
	}

	s.broadcastToConversation(ctx, conversationID, fromUser, map[string]interface{}{"type": "new_message", "message": msg})
	return msg, nil
}

func (s *MessageService) Update(ctx context.Context, fromUser, messageID string, req models.EditMessageRequest) (models.MessageResponse, error) {
	msg, conversationID, err := s.messages.Update(ctx, messageID, fromUser, req.Ciphertext, req.Nonce)
	if err != nil {
		return models.MessageResponse{}, err
	}
	s.broadcastToConversation(ctx, conversationID, fromUser, map[string]interface{}{"type": "message_updated", "message": msg})
	return msg, nil
}

func (s *MessageService) Delete(ctx context.Context, fromUser, messageID string) error {
	conversationID, err := s.messages.Delete(ctx, messageID, fromUser)
	if err != nil {
		return err
	}
	s.broadcastToConversation(ctx, conversationID, fromUser, map[string]interface{}{"type": "message_deleted", "message_id": messageID})
	return nil
}

// MarkRead marks the message read and notifies the sender over the socket.
// The returned error is sql.ErrNoRows (unwrapped) when the message doesn't
// exist, isn't addressed to callerID, or is already read — callers should
// check with errors.Is(err, sql.ErrNoRows).
func (s *MessageService) MarkRead(ctx context.Context, callerID, msgID string) error {
	fromUser, err := s.messages.MarkRead(ctx, msgID, callerID)
	if err != nil {
		return err
	}
	s.pool.SendToUser(fromUser, map[string]interface{}{"type": "message_read", "message_id": msgID, "read_by": callerID})
	return nil
}

// VerifyOwnership reports whether messageID exists and was sent by callerID
// — used to gate file uploads to a message.
func (s *MessageService) VerifyOwnership(ctx context.Context, messageID, callerID string) (bool, error) {
	return s.messages.ExistsFromUser(ctx, messageID, callerID)
}

// NotifyAttachments pushes a "new_attachment" event to every OTHER member
// of the message's conversation for each successfully saved attachment.
// Failures to look up the conversation/members are swallowed since this
// is a best-effort notification.
func (s *MessageService) NotifyAttachments(ctx context.Context, messageID string, attachments []ws.Attachment) {
	if len(attachments) == 0 {
		return
	}
	conversationID, senderID, err := s.messages.GetConversationAndSender(ctx, messageID)
	if err != nil || conversationID == "" {
		return
	}
	for _, att := range attachments {
		s.broadcastToConversation(ctx, conversationID, senderID, map[string]interface{}{"type": "new_attachment", "attachment": att})
	}
}

// broadcastToConversation looks up every member of conversationID and
// sends payload to each one except excludeUserID (typically the actor
// who triggered the event). Shared by Send, Update, Delete, and
// NotifyAttachments so the "who should hear about this" logic lives in
// exactly one place.
func (s *MessageService) broadcastToConversation(ctx context.Context, conversationID, excludeUserID string, payload map[string]interface{}) {
	members, err := s.messages.GetConversationMembers(ctx, conversationID)
	if err != nil {
		return
	}
	for _, memberID := range members {
		if memberID == excludeUserID {
			continue
		}
		s.pool.SendToUser(memberID, payload)
	}
}

func (s *MessageService) ListConversations(ctx context.Context, callerID string) ([]models.ConversationResponse, error) {
	return s.messages.ListConversationsForUser(ctx, callerID)
}
