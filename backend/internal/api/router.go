package api

import (
	"database/sql"
	"encoding/base64"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang-jwt-project/internal/bots"
	"golang-jwt-project/internal/handlers"
	"golang-jwt-project/internal/middleware"
	"golang-jwt-project/internal/monitor"
	"golang-jwt-project/internal/notify"
	"golang-jwt-project/internal/repository"
	"golang-jwt-project/internal/services"
	"golang-jwt-project/internal/storage"
	"golang-jwt-project/internal/ws"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func handleImage() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		userID := ctx.Param("userId")
		messageID := ctx.Param("messageId")
		fileName := ctx.Param("file")

		if userID == "" || messageID == "" || fileName == "" {
			ctx.JSON(http.StatusBadRequest, gin.H{
				"error": "missing required path params: userId, messageId, file",
			})
			return
		}

		filePath := filepath.Join("uploads", "users", userID, "messages", messageID, fileName)
		if _, err := os.Stat(filePath); err != nil {
			ctx.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}

		ctx.File(filePath)
	}
}

func NewRouter(db *sql.DB, pool *ws.Pool, jwtSecret []byte, refreshSecret []byte, globalLimiter, authLimiter *middleware.RateLimiter, loginLinks handlers.LoginLinkConsumer) *gin.Engine {
	router := gin.Default()

	uploadsDir, err := filepath.Abs(filepath.Join("..", "..", "uploads"))
	if err == nil {
		router.Static("/uploads", uploadsDir)
	}

	corsConfig := cors.DefaultConfig()
	corsConfig.AllowOriginFunc = func(origin string) bool {
		return strings.HasPrefix(
			origin,
			"http://localhost:3000") ||
			strings.HasPrefix(origin, "http://127.0.0.1:3000") ||
			strings.HasPrefix(origin, "http://192.168.") ||
			strings.HasPrefix(origin, "http://10.") ||
			strings.HasPrefix(origin, "http://172.")
	}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization"}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	router.Use(cors.New(corsConfig))
	router.Use(Logger())
	router.Use(globalLimiter.Middleware())

	cryptoKey, err := base64.StdEncoding.DecodeString(os.Getenv("AES_KEY"))
	if err != nil || len(cryptoKey) != 32 {
		log.Fatal("invalid AES_KEY: must be base64-encoded 32 bytes (set it in .env)")
	}

	userRepo := repository.NewUserRepository(db)
	pool.SetBlockChecker(userRepo.IsBlockedBetween)
	refreshRepo := repository.NewRefreshTokenRepository(db)
	passwordResetRepo := repository.NewPasswordResetRepository(db)
	tokenService := services.NewTokenService(jwtSecret, refreshSecret)
	//email sent to invite user
	smtpFrom := os.Getenv("SMTP_FROM")
	smtpAppPassword := os.Getenv("SMTP_APP_PASSWORD")
	smtpHost := os.Getenv("SMTP_HOST")
	smtpPort := os.Getenv("SMTP_PORT")
	if smtpFrom == "" || smtpAppPassword == "" || smtpHost == "" || smtpPort == "" {
		log.Println("warning: SMTP env vars not fully set — password reset/invite emails will fail to send")
	}

	authService := services.NewAuthService(userRepo, refreshRepo, passwordResetRepo, tokenService, smtpFrom, smtpAppPassword, smtpHost, smtpPort)

	minioStore, err := storage.NewMinioStorage(
		os.Getenv("MINIO_ENDPOINT"),
		os.Getenv("MINIO_ACCESS_KEY"),
		os.Getenv("MINIO_SECRET_KEY"),
		os.Getenv("MINIO_BUCKET"),
		os.Getenv("MINIO_USE_SSL") == "true",
	)
	if err != nil {
		log.Fatalf("failed to connect to MinIO: %v", err)
	}

	// --- invite wiring: built before authHandler since Signup needs to
	inviteRepo := repository.NewInviteRepository(db)
	inviteService := services.NewInviteService(userRepo, inviteRepo, smtpFrom, smtpAppPassword, smtpHost, smtpPort)
	inviteHandler := handlers.NewInviteHandler(inviteService)

	// --- Telegram login-alert wiring ---
	telegramNotifier := notify.NewTelegram(os.Getenv("TELEGRAM_BOT_TOKEN"), os.Getenv("TELEGRAM_CHAT_ID"))
	if !telegramNotifier.Enabled() {
		log.Println("warning: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set — login alerts to Telegram are disabled")
	}

	monitorInstance := monitor.New(monitor.Config{
		Interval:      10 * time.Second,
		History:       360,
		WarnRatio:     0.8,
		MaxOnline:     500,
		MaxInFlight:   200,
		MaxGoroutines: 2000,
	}, func() int {
		return 0
	}, db.Stats, telegramNotifier.SendAsync)

	router.Use(monitorInstance.Recovery(), monitorInstance.Middleware())

	// --- in-app bot wiring ---
	botRegistry := bots.NewRegistry()
	shopRepo := repository.NewShopRepository(db)
	shopAI := bots.NewShop(shopRepo)
	shopAI.ConfigureAI(os.Getenv("GEMINI_API_KEY"), os.Getenv("GEMINI_MODEL"))
	helperBotID := os.Getenv("HELPER_BOT_USER_ID")
	log.Printf("bots: HELPER_BOT_USER_ID=%q", helperBotID)
	if helperBotID != "" {
		bot := bots.NewHelperBot(helperBotID, pool.Count)
		monitorInstance.RegisterCommands(bot, func(userID string) bool {
			return true
		})
		botRegistry.Add(bot)
	}
	shopBotID := os.Getenv("SHOP_BOT_USER_ID")
	if shopBotID != "" {
		shopBot := bots.New(shopBotID, "Shop AI")
		shopAI.Register(shopBot)
		botRegistry.Add(shopBot)
		log.Printf("bots: Shop AI registered for user %q", shopBotID)
	}

	authHandler := handlers.NewAuthHandler(authService, inviteService, telegramNotifier)

	userService := services.NewUserService(userRepo, minioStore)
	userHandler := handlers.NewUserHandler(userService, pool)

	messageRepo := repository.NewMessageRepository(db)
	attachmentRepo := repository.NewAttachmentRepository(db)
	callHistoryRepo := repository.NewCallHistoryRepository(db)
	callHistoryHandler := handlers.NewCallHistoryHandler(callHistoryRepo)
	messageService := services.NewMessageService(messageRepo, pool)
	messageService.SetBots(botRegistry)
	uploadService := services.NewUploadService(attachmentRepo, minioStore)
	messageHandler := handlers.NewMessageHandler(messageService, uploadService, pool)
	chatbotHandler := handlers.NewChatbotHandler(os.Getenv("GEMINI_API_KEY"), os.Getenv("GEMINI_MODEL"))
	shopHandler := handlers.NewShopHandler(shopRepo, shopAI)

	router.GET("/image/:userId/:messageId/:file", handleImage())

	api := router.Group("/api/v1")
	{
		authHandler.RegisterRoutes(api, authLimiter)
		authHandler.SetTelegramLoginLinks(loginLinks)

		users := api.Group("/users")
		users.Use(middleware.AuthMiddleware(jwtSecret))
		userHandler.RegisterRoutes(users)

		messages := api.Group("/messages")
		messages.Use(middleware.AuthMiddleware(jwtSecret))
		messageHandler.RegisterRoutes(messages)

		calls := api.Group("/calls")
		calls.Use(middleware.AuthMiddleware(jwtSecret))
		calls.GET("/:userId", callHistoryHandler.List)
		calls.POST("", callHistoryHandler.Create)

		groups := api.Group("/groups")
		groups.Use(middleware.AuthMiddleware(jwtSecret))
		groups.GET("/:groupId/call-history", callHistoryHandler.ListByGroup)

		chatbot := api.Group("/chatbot")
		chatbot.Use(middleware.AuthMiddleware(jwtSecret))
		chatbot.POST("", chatbotHandler.Generate)

		shop := api.Group("/shop")
		shop.Use(middleware.AuthMiddleware(jwtSecret))
		shopHandler.RegisterRoutes(shop)

		api.GET("/invites/validate", inviteHandler.ValidateInvite)
		invites := api.Group("/invites")
		invites.Use(middleware.AuthMiddleware(jwtSecret))
		invites.POST("", inviteHandler.SendInvite)
	}
	return router
}

func Logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		gin.DefaultWriter.Write([]byte("[gin] " + c.Request.Method + " " + c.Request.URL.Path + " took " + time.Since(start).String() + "\n"))
	}
}

func healthHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	}
}
