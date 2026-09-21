// --- Add to MessageService (message_service.go) ---
package services

import "context"

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

// Note: excludeUserID is passed as "" here (unlike Delete/Update, which
// exclude the actor) because reactions should notify EVERYONE including
// the person who reacted — their own other tabs/devices need the update
// too, and the frontend's optimistic UI update already handles the local
// echo cheaply, so a duplicate is harmless.

// --- Add to your message handler (message_handler.go) ---
//
// func (h *MessageHandler) AddReaction(c *gin.Context) {
//     callerID, _ := middleware.CallerFromContext(c)
//     var req struct {
//         Emoji string `json:"emoji" binding:"required"`
//     }
//     if err := c.ShouldBindJSON(&req); err != nil {
//         c.JSON(http.StatusBadRequest, gin.H{"message": "emoji is required"})
//         return
//     }
//     if err := h.messages.AddReaction(c.Request.Context(), callerID, c.Param("id"), req.Emoji); err != nil {
//         log.Printf("add reaction failed: %v", err)
//         c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to add reaction"})
//         return
//     }
//     c.JSON(http.StatusOK, gin.H{"message": "reaction added"})
// }
//
// func (h *MessageHandler) RemoveReaction(c *gin.Context) {
//     callerID, _ := middleware.CallerFromContext(c)
//     emoji := c.Query("emoji")
//     if emoji == "" {
//         c.JSON(http.StatusBadRequest, gin.H{"message": "emoji is required"})
//         return
//     }
//     if err := h.messages.RemoveReaction(c.Request.Context(), callerID, c.Param("id"), emoji); err != nil {
//         log.Printf("remove reaction failed: %v", err)
//         c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to remove reaction"})
//         return
//     }
//     c.JSON(http.StatusOK, gin.H{"message": "reaction removed"})
// }
//
// Routes (wherever your other /messages/:id routes are registered):
//   router.POST("/messages/:id/reactions", handler.AddReaction)
//   router.DELETE("/messages/:id/reactions", handler.RemoveReaction)
