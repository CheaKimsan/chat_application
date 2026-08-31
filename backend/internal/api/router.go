package api

import (
	"database/sql"
	"encoding/base64"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"golang-jwt-project/internal/handlers"
	"golang-jwt-project/internal/middleware"
	"golang-jwt-project/internal/repository"
	"golang-jwt-project/internal/services"
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

func NewRouter(db *sql.DB, pool *ws.Pool, jwtSecret []byte, refreshSecret []byte) *gin.Engine {
	router := gin.Default()

	uploadsDir, err := filepath.Abs(filepath.Join("..", "..", "uploads"))
	if err == nil {
		router.Static("/uploads", uploadsDir)
	}

	corsConfig := cors.DefaultConfig()
	corsConfig.AllowOrigins = []string{"http://localhost:3000"}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization"}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	router.Use(cors.New(corsConfig))
	router.Use(Logger())

	cryptoKey, err := base64.StdEncoding.DecodeString("wZ8KkUKjXlzw18cPeu7Tbj+4F8e8RmiSK8K5YihaxtA=")
	if err != nil || len(cryptoKey) != 32 {
		log.Fatal("invalid AES key: must be base64-encoded 32 bytes")
	}

	// --- auth wiring: repositories -> services -> handlers ---
	userRepo := repository.NewUserRepository(db)
	refreshRepo := repository.NewRefreshTokenRepository(db)
	passwordResetRepo := repository.NewPasswordResetRepository(db)
	tokenService := services.NewTokenService(jwtSecret, refreshSecret)

	// SMTP creds come from env vars — never hardcode these in source.
	// Set them in a .env file (gitignored) or your shell/deploy config:
	//   SMTP_FROM=youraddress@gmail.com
	//   SMTP_APP_PASSWORD=your-16-char-app-password   (Gmail App Password, NOT your login password)
	//   SMTP_HOST=smtp.gmail.com
	//   SMTP_PORT=587
	smtpFrom := os.Getenv("SMTP_FROM")
	smtpAppPassword := os.Getenv("SMTP_APP_PASSWORD")
	smtpHost := os.Getenv("SMTP_HOST")
	smtpPort := os.Getenv("SMTP_PORT")
	if smtpFrom == "" || smtpAppPassword == "" || smtpHost == "" || smtpPort == "" {
		log.Println("warning: SMTP env vars not fully set — password reset/invite emails will fail to send")
	}

	authService := services.NewAuthService(userRepo, refreshRepo, passwordResetRepo, tokenService, smtpFrom, smtpAppPassword, smtpHost, smtpPort)
	sessionHandler := handlers.NewSessionHandler(authService) // added — List/Revoke/LogoutAll live on authService

	// --- invite wiring: built before authHandler since Signup needs to
	// consume invites on success ---
	inviteRepo := repository.NewInviteRepository(db)
	inviteService := services.NewInviteService(userRepo, inviteRepo, smtpFrom, smtpAppPassword, smtpHost, smtpPort)
	inviteHandler := handlers.NewInviteHandler(inviteService)

	authHandler := handlers.NewAuthHandler(authService, inviteService)

	userService := services.NewUserService(userRepo)
	userHandler := handlers.NewUserHandler(userService)

	messageRepo := repository.NewMessageRepository(db)
	attachmentRepo := repository.NewAttachmentRepository(db)
	messageService := services.NewMessageService(messageRepo, pool)
	uploadService := services.NewUploadService(attachmentRepo)
	messageHandler := handlers.NewMessageHandler(messageService, uploadService, pool)

	router.GET("/mypwd", func(c *gin.Context) {
		cwd, err := os.Getwd()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"current_folder": cwd,
		})
	})

	router.GET("/image/:userId/:messageId/:file", handleImage())

	api := router.Group("/api/v1")
	{
		authHandler.RegisterRoutes(api)

		users := api.Group("/users")
		users.Use(middleware.AuthMiddleware(jwtSecret))
		userHandler.RegisterRoutes(users)

		messages := api.Group("/messages")
		messages.Use(middleware.AuthMiddleware(jwtSecret))
		messageHandler.RegisterRoutes(messages)

		// sessions: view/revoke your own logged-in devices, or log out
		// of all of them at once. All three routes require auth — you
		// can only ever see/manage your OWN sessions.
		sessions := api.Group("/sessions")
		sessions.Use(middleware.AuthMiddleware(jwtSecret))
		sessionHandler.RegisterRoutes(sessions)

		// GET /invites/validate is public — the invitee isn't logged in
		// yet when checking their invite link on the signup page.
		api.GET("/invites/validate", inviteHandler.ValidateInvite)

		// POST /invites requires auth — any logged-in user can send one.
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
