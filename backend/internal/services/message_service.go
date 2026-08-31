package services

import (
	"context"

	"golang-jwt-project/internal/models"
	"golang-jwt-project/internal/repository"
	"golang-jwt-project/internal/ws"
)

type MessageService struct {
	messages *repository.MessageRepository
	pool     *ws.Pool
}

func NewMessageService(messages *repository.MessageRepository, pool *ws.Pool) *MessageService {
	return &MessageService{messages: messages, pool: pool}
}

func (s *MessageService) GetConversation(ctx context.Context, callerID, otherID string) ([]models.MessageResponse, error) {
	return s.messages.GetConversation(ctx, callerID, otherID)
}

func (s *MessageService) Send(ctx context.Context, fromUser string, req models.SendMessageRequest) (models.MessageResponse, error) {
	msg, err := s.messages.Create(ctx, fromUser, req.ToUser, req.Ciphertext, req.Nonce)
	if err != nil {
		return models.MessageResponse{}, err
	}
	s.pool.SendToUser(req.ToUser, map[string]interface{}{"type": "new_message", "message": msg})
	return msg, nil
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

// NotifyAttachments pushes a "new_attachment" event to the message's
// recipient for each successfully saved attachment. Failures to look up
// the recipient are swallowed since this is a best-effort notification.
func (s *MessageService) NotifyAttachments(ctx context.Context, messageID string, attachments []ws.Attachment) {
	if len(attachments) == 0 {
		return
	}
	toUser, err := s.messages.GetToUser(ctx, messageID)
	if err != nil || toUser == "" {
		return
	}
	for _, att := range attachments {
		s.pool.SendToUser(toUser, map[string]interface{}{"type": "new_attachment", "attachment": att})
	}
}
