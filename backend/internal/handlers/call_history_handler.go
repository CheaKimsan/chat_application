package handlers

import (
	"net/http"

	"golang-jwt-project/internal/middleware"
	"golang-jwt-project/internal/models"
	"golang-jwt-project/internal/repository"

	"github.com/gin-gonic/gin"
)

type CallHistoryHandler struct {
	repo *repository.CallHistoryRepository
}

func NewCallHistoryHandler(repo *repository.CallHistoryRepository) *CallHistoryHandler {
	return &CallHistoryHandler{repo: repo}
}

func (h *CallHistoryHandler) List(c *gin.Context) {
	callerID, _ := middleware.CallerFromContext(c)
	records, err := h.repo.List(c.Request.Context(), callerID, c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load call history"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"calls": records})
}

func (h *CallHistoryHandler) Create(c *gin.Context) {
	callerID, _ := middleware.CallerFromContext(c)
	var req models.CreateCallHistoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	if req.Mode != "audio" && req.Mode != "video" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "mode must be audio or video"})
		return
	}
	record, err := h.repo.Create(c.Request.Context(), callerID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to save call history"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"call": record})
}
