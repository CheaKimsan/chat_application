package handlers

import (
	"context"
	"errors"
	"golang-jwt-project/internal/utils"
	"log"
	"net/http"

	"golang-jwt-project/internal/models"
	"golang-jwt-project/internal/services"

	"github.com/gin-gonic/gin"
)

type AuthHandler struct {
	service       *services.AuthService
	inviteService *services.InviteService
}

func NewAuthHandler(service *services.AuthService, inviteService *services.InviteService) *AuthHandler {
	return &AuthHandler{service: service, inviteService: inviteService}
}

// RegisterRoutes wires up the auth routes
func (h *AuthHandler) RegisterRoutes(router *gin.RouterGroup) {
	router.POST("/login", h.Login)
	router.POST("/signup", h.Signup)
	router.POST("/refresh", h.Refresh)
	router.POST("/logout", h.Logout)
	router.POST("/forgot-password", h.ForgotPassword)
	router.POST("/reset-password", h.ResetPassword)
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, pair, err := h.service.Login(c.Request.Context(), req.Username, req.Password)
	if err != nil {
		if errors.Is(err, utils.ErrInvalidCredentials) {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "invalid credentials"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// ADDED — best-effort, never blocks the response even if it fails.
	go h.service.CompleteLoginWithDeviceTracking(
		context.Background(),
		// this keeps running after the response is already sent
		user.ID, pair.RefreshToken,
		c.Request.UserAgent(), c.ClientIP(), user.Email,
	)

	c.JSON(http.StatusOK, gin.H{
		"status":        "login success",
		"access_token":  pair.AccessToken,
		"refresh_token": pair.RefreshToken,
		"user":          gin.H{"id": user.ID, "username": user.Username, "email": user.Email, "role": user.Role},
	})
}

func (h *AuthHandler) Signup(c *gin.Context) {
	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "username, email, password and public_key are required", "error": err.Error()})
		return
	}

	user, pair, err := h.service.Signup(c.Request.Context(), req.Username, req.Email, req.Password, req.PublicKey)
	if err != nil {
		if errors.Is(err, utils.ErrUsernameTaken) {
			c.JSON(http.StatusConflict, gin.H{"message": "username already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to create user"})
		return
	}

	if req.InviteToken != nil && *req.InviteToken != "" && h.inviteService != nil {
		if err := h.inviteService.ConsumeInvite(c.Request.Context(), *req.InviteToken); err != nil {
			log.Printf("warning: failed to mark invite consumed for token %s: %v", *req.InviteToken, err)
		}
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":       "user registered successfully",
		"user":          gin.H{"id": user.ID, "username": user.Username, "role": user.Role},
		"access_token":  pair.AccessToken,
		"refresh_token": pair.RefreshToken,
	})
}

func (h *AuthHandler) Refresh(c *gin.Context) {
	var req models.RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pair, err := h.service.Refresh(c.Request.Context(), req.RefreshToken)
	if err != nil {
		switch {
		case errors.Is(err, utils.ErrMalformedRefreshToken):
			c.JSON(http.StatusUnauthorized, gin.H{"message": "malformed refresh token"})
		case errors.Is(err, utils.ErrInvalidRefreshToken):
			c.JSON(http.StatusUnauthorized, gin.H{"message": "invalid or expired refresh token"})
		case errors.Is(err, utils.ErrRefreshTokenRevoked):
			c.JSON(http.StatusUnauthorized, gin.H{"message": "refresh token revoked or expired"})
		case errors.Is(err, utils.ErrUserNotFound):
			c.JSON(http.StatusUnauthorized, gin.H{"message": "user no longer exists"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access_token":  pair.AccessToken,
		"refresh_token": pair.RefreshToken,
	})
}

func (h *AuthHandler) Logout(c *gin.Context) {
	var req models.RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.Logout(c.Request.Context(), req.RefreshToken); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "logged out"})
}

// --- restored: forgot/reset password

func (h *AuthHandler) ForgotPassword(c *gin.Context) {
	var req models.ForgotPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.ForgotPassword(c.Request.Context(), req.Email); err != nil {
		log.Printf("[DEBUG] ForgotPassword failed: %v", err) // TEMPORARY — remove once diagnosed
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "If that email is registered, a reset link has been sent.",
	})
}

func (h *AuthHandler) ResetPassword(c *gin.Context) {
	var req models.ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.ResetPassword(c.Request.Context(), req.Token, req.NewPassword); err != nil {
		if errors.Is(err, services.ErrInvalidResetToken) {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "invalid or expired reset token"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "password reset successfully"})
}
