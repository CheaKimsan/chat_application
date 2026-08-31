package handlers

import (
	"net/http"
	"strconv"

	"golang-jwt-project/internal/middleware"
	"golang-jwt-project/internal/services"

	"github.com/gin-gonic/gin"
)

type SessionHandler struct {
	service *services.AuthService
}

func NewSessionHandler(service *services.AuthService) *SessionHandler {
	return &SessionHandler{service: service}
}

// RegisterRoutes wires up the session routes under an AUTHENTICATED
// group, e.g.:
//
//	sessions := api.Group("/sessions")
//	sessions.Use(middleware.AuthMiddleware(jwtSecret))
//	sessionHandler.RegisterRoutes(sessions)
func (h *SessionHandler) RegisterRoutes(router *gin.RouterGroup) {
	router.GET("", h.List)
	router.DELETE("/:id", h.Revoke)
	router.POST("/logout-all", h.LogoutAll)
}

func (h *SessionHandler) List(c *gin.Context) {
	userID, _ := middleware.CallerFromContext(c)

	sessions, err := h.service.List(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"sessions": sessions})
}

func (h *SessionHandler) Revoke(c *gin.Context) {
	userID, _ := middleware.CallerFromContext(c)

	sessionID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid session id"})
		return
	}

	ok, err := h.service.Revoke(c.Request.Context(), userID, sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"message": "session not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "session revoked"})
}

func (h *SessionHandler) LogoutAll(c *gin.Context) {
	userID, _ := middleware.CallerFromContext(c)

	if err := h.service.LogoutAll(c.Request.Context(), userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "logged out of all devices"})
}
