package handlers

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"

	"golang-jwt-project/internal/middleware"
	"golang-jwt-project/internal/models"
	"golang-jwt-project/internal/services"
	"golang-jwt-project/internal/ws"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type MessageHandler struct {
	messages *services.MessageService
	uploads  *services.UploadService
	pool     *ws.Pool
}

func NewMessageHandler(messages *services.MessageService, uploads *services.UploadService, pool *ws.Pool) *MessageHandler {
	return &MessageHandler{messages: messages, uploads: uploads, pool: pool}
}

// RegisterRoutes wires up the message routes, e.g. in router.go:
//
//	messages := api.Group("/messages")
//	messages.Use(middleware.AuthMiddleware(jwtSecret))
//	messageHandler.RegisterRoutes(messages)
func (h *MessageHandler) RegisterRoutes(router *gin.RouterGroup) {
	router.GET("", h.Websocket)
	router.GET("/:userId", h.GetConversation)
	router.POST("/send", h.Send)
	router.PATCH("/:id/read", h.MarkRead)
	router.POST("/:messageId/upload", h.Upload)
}

func (h *MessageHandler) Websocket(c *gin.Context) {
	callerID, _ := middleware.CallerFromContext(c)
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		fmt.Println("Upgrade error:", err)
		return
	}
	client := &ws.Client{Conn: conn, Pool: h.pool, ID: callerID}
	h.pool.Register <- client
	client.Read()
	defer func() {
		h.pool.Unregister <- client
		conn.Close()
	}()
}

func (h *MessageHandler) GetConversation(c *gin.Context) {
	callerID, _ := middleware.CallerFromContext(c)
	otherID := c.Param("userId")

	messages, err := h.messages.GetConversation(c.Request.Context(), callerID, otherID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to fetch messages"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"messages": messages})
}

func (h *MessageHandler) Send(c *gin.Context) {
	callerID, _ := middleware.CallerFromContext(c)

	var req models.SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	msg, err := h.messages.Send(c.Request.Context(), callerID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to send message", "error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": msg})
}

func (h *MessageHandler) MarkRead(c *gin.Context) {
	callerID, _ := middleware.CallerFromContext(c)
	msgID := c.Param("id")

	if err := h.messages.MarkRead(c.Request.Context(), callerID, msgID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"message": "message not found or already read"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to mark as read"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "marked as read"})
}

func (h *MessageHandler) Upload(c *gin.Context) {
	callerID, _ := middleware.CallerFromContext(c)
	if callerID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "user not authenticated"})
		return
	}

	messageID := c.Param("messageId")
	if messageID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "message ID is required"})
		return
	}

	owns, err := h.messages.VerifyOwnership(c.Request.Context(), messageID, callerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to verify message", "error": err.Error()})
		return
	}
	if !owns {
		c.JSON(http.StatusForbidden, gin.H{"message": "you cannot upload a file to this message"})
		return
	}

	// Parse form with enough headroom for multiple files.
	if err := c.Request.ParseMultipartForm(services.MaxUploadSize * int64(services.MaxFilesPerUpload)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "files too large or invalid form"})
		return
	}

	if c.Request.MultipartForm == nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "files are required"})
		return
	}

	headers := c.Request.MultipartForm.File["file"]
	if len(headers) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "at least one file is required"})
		return
	}
	if len(headers) > services.MaxFilesPerUpload {
		c.JSON(http.StatusBadRequest, gin.H{"message": fmt.Sprintf("too many files, max %d per upload", services.MaxFilesPerUpload)})
		return
	}

	saved, failed := h.uploads.SaveMany(c.Request.Context(), callerID, messageID, headers)

	// Notify the recipient once per successfully saved attachment.
	h.messages.NotifyAttachments(c.Request.Context(), messageID, saved)

	failedResp := make([]gin.H, 0, len(failed))
	for _, f := range failed {
		failedResp = append(failedResp, gin.H{"filename": f.Filename, "error": f.Err.Error()})
	}

	switch {
	case len(saved) == 0:
		// Every file failed.
		c.JSON(http.StatusBadRequest, gin.H{"message": "no files were uploaded", "errors": failedResp})
	case len(failed) == 0:
		// Every file succeeded.
		c.JSON(http.StatusCreated, gin.H{"message": "files uploaded successfully", "attachments": saved})
	default:
		// Partial success — 201 kept since some data was created; check "errors" for the rest.
		c.JSON(http.StatusCreated, gin.H{
			"message":     "some files uploaded successfully",
			"attachments": saved,
			"errors":      failedResp,
		})
	}
}
