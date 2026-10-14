package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// LoginLinkConsumer is satisfied by *telegrambot.LoginLinks. Declared here as
// an interface so the handlers package does not import the bot package.
type LoginLinkConsumer interface {
	Consume(token string) (userID string, ok bool)
}

type telegramLoginRequest struct {
	Token string `json:"token" binding:"required"`
}

// SetTelegramLoginLinks enables POST /telegram-login. Without it the endpoint
// answers 404, so the feature stays off unless it is wired in on purpose.
func (h *AuthHandler) SetTelegramLoginLinks(links LoginLinkConsumer) {
	h.telegramLinks = links
}

// TelegramLogin exchanges a one-time token (created by the bot's /login
// command) for the same session a password login returns.
//
// It must be a POST: Telegram and browsers may prefetch links, and a GET that
// consumed the token would be burned before the user ever opened it.
func (h *AuthHandler) TelegramLogin(c *gin.Context) {
	if h.telegramLinks == nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "not found"})
		return
	}

	var req telegramLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "token is required"})
		return
	}

	userID, ok := h.telegramLinks.Consume(req.Token) // single use, deleted here
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "invalid or expired login link"})
		return
	}

	// LoginAsUser must be added to AuthService and to the AuthServicer
	// interface: same as Login, but it skips the password check and returns
	// (user, tokenPair, error).
	user, pair, err := h.service.LoginAsUser(c.Request.Context(), userID)
	if err != nil {
		log.Printf("telegram login: LoginAsUser failed for user %s: %v", userID, err)
		c.JSON(http.StatusUnauthorized, gin.H{"message": "login failed"})
		return
	}

	go h.service.CompleteLoginWithDeviceTracking(
		context.Background(),
		user.ID, pair.RefreshToken,
		c.Request.UserAgent(), c.ClientIP(), user.Email,
	)

	h.telegram.SendAsync(fmt.Sprintf(
		"🔑 Login via Telegram link\nUser: %s (%s)\nIP: %s\nUser-Agent: %s\nTime: %s",
		user.Username, user.Email, c.ClientIP(), c.Request.UserAgent(), time.Now().Format(time.RFC3339),
	))

	c.JSON(http.StatusOK, gin.H{
		"status":        "login success",
		"access_token":  pair.AccessToken,
		"refresh_token": pair.RefreshToken,
		"user":          gin.H{"id": user.ID, "username": user.Username, "email": user.Email, "role": user.Role, "profile_photo": user.ProfilePhoto},
	})
}
