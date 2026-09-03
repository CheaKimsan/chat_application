package handlers

import (
	"errors"
	"golang-jwt-project/internal/utils"
	"net/http"
	"path/filepath"

	"golang-jwt-project/internal/middleware"
	"golang-jwt-project/internal/models"
	"golang-jwt-project/internal/services"

	"github.com/gin-gonic/gin"
)

type UserHandler struct {
	service *services.UserService
}

func NewUserHandler(service *services.UserService) *UserHandler {
	return &UserHandler{service: service}
}

// RegisterRoutes wires up the user management routes, e.g. in router.go:
//
//	users := api.Group("/users")
//	users.Use(middleware.AuthMiddleware(jwtSecret))
//	userHandler.RegisterRoutes(users)
func (h *UserHandler) RegisterRoutes(router *gin.RouterGroup) {
	router.GET("", h.List)
	router.PUT("/:id", h.Update)
	router.DELETE("/:id", h.Delete)

	// E2EE public key directory — lets a client fetch any user's public key
	// on demand (e.g. deriving a shared secret with someone who's offline
	// and has never completed a live socket handshake before).
	router.GET("/:id/public-key", h.GetPublicKey)
	router.PUT("/me/public-key", h.UpdateMyPublicKey)
	router.POST("/:id/photo", h.UploadProfilePhoto) // <-- add this
}

func (h *UserHandler) List(c *gin.Context) {
	users, err := h.service.ListAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to query users"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": users})
}

func (h *UserHandler) Update(c *gin.Context) {
	targetID := c.Param("id")
	if targetID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "user id is required"})
		return
	}

	var req models.UpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	callerID, callerRole := middleware.CallerFromContext(c)

	user, err := h.service.Update(c.Request.Context(), callerID, callerRole, targetID, req)
	if err != nil {
		switch {
		case errors.Is(err, utils.ErrForbidden):
			c.JSON(http.StatusForbidden, gin.H{"message": "not authorized to update this user"})
		case errors.Is(err, utils.ErrUserNotFound):
			c.JSON(http.StatusNotFound, gin.H{"message": "user not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to update user", "error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "user updated successfully", "user": gin.H{"id": user.ID, "username": user.Username}})
}

func (h *UserHandler) Delete(c *gin.Context) {
	targetID := c.Param("id")
	if targetID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "user id is required"})
		return
	}

	callerID, callerRole := middleware.CallerFromContext(c)

	err := h.service.Delete(c.Request.Context(), callerID, callerRole, targetID)
	if err != nil {
		switch {
		case errors.Is(err, utils.ErrForbidden):
			c.JSON(http.StatusForbidden, gin.H{"message": "not authorized to delete this user"})
		case errors.Is(err, utils.ErrUserNotFound):
			c.JSON(http.StatusNotFound, gin.H{"message": "user not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to delete user", "error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "user deleted successfully"})
}

// GetPublicKey returns another user's ECDH public key so the client can
// derive a shared AES key locally — works even if that user is offline and
// has never completed a live socket key exchange with the caller before.
//
//	GET /api/v1/users/:id/public-key
//	200 { "user_id": "11", "public_key": "<base64 raw P-256 public key>" }
func (h *UserHandler) GetPublicKey(c *gin.Context) {
	targetID := c.Param("id")
	if targetID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "user id is required"})
		return
	}

	pubKey, err := h.service.GetPublicKey(c.Request.Context(), targetID)
	if err != nil {
		switch {
		case errors.Is(err, utils.ErrUserNotFound):
			c.JSON(http.StatusNotFound, gin.H{"message": "user not found"})
		case errors.Is(err, services.ErrPublicKeyNotSet):
			c.JSON(http.StatusNotFound, gin.H{"message": "user has no public key registered"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to fetch public key"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"user_id": targetID, "public_key": pubKey})
}

// UpdateMyPublicKey lets the authenticated caller (re)publish their own
// public key — used when a client generates a fresh keypair (new device,
// cleared storage, key rotation).
//
//	PUT /api/v1/users/me/public-key
//	Body: { "public_key": "<base64 raw P-256 public key>" }
func (h *UserHandler) UpdateMyPublicKey(c *gin.Context) {
	var req models.UpdatePublicKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "public_key is required", "error": err.Error()})
		return
	}

	callerID, _ := middleware.CallerFromContext(c)

	if err := h.service.UpdatePublicKey(c.Request.Context(), callerID, req.PublicKey); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to update public key"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "public key updated"})
}

func (h *UserHandler) UploadProfilePhoto(c *gin.Context) {
	targetID := c.Param("id")

	targetUsername := c.Query("username") // Get the username from the query parameter

	if targetID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "user id is required"})
		return
	}

	callerID, callerRole := middleware.CallerFromContext(c)

	fileHeader, err := c.FormFile("photo")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing photo file"})
		return
	}
	if fileHeader.Size > 5<<20 { // 5MB limit
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read file"})
		return
	}
	defer file.Close()

	ext := filepath.Ext(fileHeader.Filename)
	contentType := fileHeader.Header.Get("Content-Type")

	user, err := h.service.UpdateProfilePhoto(
		c.Request.Context(), callerID, callerRole, targetUsername, targetID,
		file, fileHeader.Size, contentType, ext,
	)
	if err != nil {
		switch {
		case errors.Is(err, utils.ErrForbidden):
			c.JSON(http.StatusForbidden, gin.H{"error": "not allowed"})
		case errors.Is(err, utils.ErrUserNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "upload failed"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "profile photo updated", "user": user})
}
