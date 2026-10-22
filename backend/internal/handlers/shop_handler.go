package handlers

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"golang-jwt-project/internal/bots"
	"golang-jwt-project/internal/middleware"
	"golang-jwt-project/internal/repository"

	"github.com/gin-gonic/gin"
)

type ShopHandler struct {
	repo      *repository.ShopRepository
	assistant *bots.Shop
}

func NewShopHandler(repo *repository.ShopRepository, assistant *bots.Shop) *ShopHandler {
	return &ShopHandler{repo: repo, assistant: assistant}
}

func (h *ShopHandler) RegisterRoutes(router *gin.RouterGroup) {
	router.GET("/products", h.ListProducts)
	router.GET("/orders", h.ListOrders)
	router.POST("/orders", h.PlaceOrder)
	router.POST("/assistant", h.AskAssistant)
}

func (h *ShopHandler) AskAssistant(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	var request struct {
		Message string `json:"message" binding:"required"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message is required and must be valid JSON"})
		return
	}
	request.Message = strings.TrimSpace(request.Message)
	if request.Message == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message must not be empty"})
		return
	}
	if len(request.Message) > 4000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message must be 4,000 characters or fewer"})
		return
	}
	reply, err := h.assistant.Ask(c.Request.Context(), request.Message)
	if err != nil {
		log.Printf("shop assistant failed: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "shop assistant request failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reply": reply})
}

func (h *ShopHandler) ListProducts(c *gin.Context) {
	maxCents, err := parseNonNegativeQuery(c, "max_cents", 0)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "max_cents must be a non-negative integer"})
		return
	}
	limit, err := parseNonNegativeQuery(c, "limit", 50)
	if err != nil || limit < 1 || limit > 50 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be between 1 and 50"})
		return
	}

	products, err := h.repo.SearchProducts(c.Request.Context(), c.Query("q"), maxCents, int(limit))
	if err != nil {
		log.Printf("list shop products failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load products"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"products": products})
}

func (h *ShopHandler) ListOrders(c *gin.Context) {
	limit, err := parseNonNegativeQuery(c, "limit", 5)
	if err != nil || limit < 1 || limit > 20 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be between 1 and 20"})
		return
	}
	userID, _ := middleware.CallerFromContext(c)
	orders, err := h.repo.ListOrders(c.Request.Context(), userID, int(limit))
	if err != nil {
		log.Printf("list shop orders failed for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load orders"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"orders": orders})
}

func (h *ShopHandler) PlaceOrder(c *gin.Context) {
	var req struct {
		Cart map[int]int `json:"cart" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cart must map product IDs to quantities"})
		return
	}
	if len(req.Cart) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": repository.ErrEmptyCart.Error()})
		return
	}
	for id, quantity := range req.Cart {
		if id < 1 || quantity < 1 || quantity > 20 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "product IDs must be positive and quantities must be between 1 and 20"})
			return
		}
	}

	userID, _ := middleware.CallerFromContext(c)
	order, err := h.repo.PlaceOrder(c.Request.Context(), userID, req.Cart)
	if err != nil {
		var stockErr *repository.StockError
		switch {
		case errors.As(err, &stockErr):
			c.JSON(http.StatusConflict, gin.H{"error": stockErr.Error(), "available": stockErr.Available})
		case errors.Is(err, repository.ErrProductNotFound):
			c.JSON(http.StatusConflict, gin.H{"error": "a product in the cart is no longer available"})
		default:
			log.Printf("place shop order failed for user %s: %v", userID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to place order"})
		}
		return
	}
	c.JSON(http.StatusCreated, gin.H{"order": order})
}

func parseNonNegativeQuery(c *gin.Context, key string, fallback int64) (int64, error) {
	value := c.Query(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed < 0 {
		return 0, errors.New("invalid value")
	}
	return parsed, nil
}
