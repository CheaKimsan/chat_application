package services

import (
	"context"
	"log"
	"time"

	"golang-jwt-project/internal/bots"
	"golang-jwt-project/internal/models"
)

// SetBots plugs the bot registry into the service. Called once from router.go,
// so NewMessageService keeps its original signature.
func (s *MessageService) SetBots(r *bots.Registry) {
	s.bots = r
	log.Printf("bot: SetBots called, registry is nil: %v", r == nil)
}

// botText returns the text the user typed, if the bot can read it.
// With the plaintext fallback, the frontend may put the text in "ciphertext"
// (with no nonce) instead of "body", so both are checked.
func botText(req models.SendMessageRequest) (string, bool) {
	if req.Body != nil && *req.Body != "" {
		return *req.Body, true
	}
	if req.Ciphertext != nil && *req.Ciphertext != "" && (req.Nonce == nil || *req.Nonce == "") {
		return *req.Ciphertext, true
	}
	log.Printf("bot: no readable text (body=%v ciphertext=%v nonce=%v)", req.Body != nil, req.Ciphertext != nil, req.Nonce != nil)
	return "", false
}

// maybeBotReply runs after a message is saved. If the conversation is a
// 1:1 chat between fromUser and a bot, it dispatches the text to the bot and
// sends the bot's answer back as a message from the bot.
// (Verbose debug logs included; remove them once it works.)
func (s *MessageService) maybeBotReply(conversationID, fromUser, text string) {
	log.Printf("bot: called conv=%s from=%s text=%q", conversationID, fromUser, text)

	// The request context is cancelled once the HTTP response is sent,
	// so the bot gets its own context.
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	if s.bots.IsBot(fromUser) {
		log.Printf("bot: skip, sender %s is a bot", fromUser)
		return // never let a bot answer another bot
	}

	members, err := s.messages.GetConversationMembers(ctx, conversationID)
	log.Printf("bot: members=%v err=%v", members, err)
	if err != nil || len(members) != 2 {
		log.Printf("bot: skip, not a 1:1 chat")
		return // only 1:1 chats, so a bot in a group doesn't answer everything
	}

	var botID string
	for _, id := range members {
		if id != fromUser && s.bots.IsBot(id) {
			botID = id
		}
	}
	if botID == "" {
		log.Printf("bot: skip, no registered bot among members %v", members)
		return
	}

	reply, ok := s.bots.Dispatch(ctx, botID, bots.Message{
		UserID:         fromUser,
		ConversationID: conversationID,
		Text:           text,
	})
	log.Printf("bot: dispatch ok=%v reply=%q", ok, reply.Text)
	if !ok {
		return
	}

	body := reply.Text
	msg, err := s.messages.CreateInConversation(ctx, botID, conversationID, &body, nil, nil)
	if err != nil {
		log.Printf("bot reply: save failed: %v", err)
		return
	}
	log.Printf("bot: reply saved id=%v", msg.ID)

	// Send to everyone in the chat except the bot itself, so the human
	// who asked receives the reply.
	s.broadcastToConversation(ctx, conversationID, botID, map[string]interface{}{
		"type":    "new_message",
		"message": msg,
		"buttons": reply.Buttons,
	})
}
