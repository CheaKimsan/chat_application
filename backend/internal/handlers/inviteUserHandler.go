package handlers

import (
	"errors"
	"net/http"

	"golang-jwt-project/internal/middleware"
	"golang-jwt-project/internal/services"

	"github.com/gin-gonic/gin"
)

type InviteHandler struct {
	service *services.InviteService
}

func NewInviteHandler(service *services.InviteService) *InviteHandler {
	return &InviteHandler{service: service}
}

// RegisterRoutes wires up invite routes under a group that already has
// AuthMiddleware applied (see router.go) — sending an invite requires
// being logged in.
func (h *InviteHandler) RegisterRoutes(router *gin.RouterGroup) {
	router.POST("", h.SendInvite)
	router.GET("/validate", h.ValidateInvite)
}

type sendInviteRequest struct {
	Email string `json:"email" binding:"required,email"`
}

func (h *InviteHandler) SendInvite(c *gin.Context) {
	var req sendInviteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// CallerFromContext returns (id, role) — both plain strings, no ok
	// flag. It calls c.MustGet internally, which panics if "claims" isn't
	// set, so by the time we get here (behind AuthMiddleware) id is
	// always populated. Still guard against an empty id defensively.
	inviterID, _ := middleware.CallerFromContext(c)
	if inviterID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "unauthorized"})
		return
	}

	err := h.service.SendInvite(c.Request.Context(), inviterID, req.Email)
	if err != nil {
		if errors.Is(err, services.ErrInviteEmailAlreadyRegistered) {
			c.JSON(http.StatusConflict, gin.H{"message": "that email is already registered"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "invite sent"})
}

// ValidateInvite lets the signup page check a ?invite=... token before
// rendering the form (e.g. to prefill and lock the email field). Public
// — no auth required, since the invitee isn't logged in yet.
func (h *InviteHandler) ValidateInvite(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "missing token"})
		return
	}

	email, err := h.service.ValidateInvite(c.Request.Context(), token)
	if err != nil {
		if errors.Is(err, services.ErrInvalidInviteToken) {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "invalid or expired invite"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"email": email})
}
