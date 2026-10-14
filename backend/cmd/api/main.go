package main

import (
	"context"
	"golang-jwt-project/internal/middleware"
	"log"
	"os"
	"strconv"
	"time"

	"golang.org/x/time/rate"

	"golang-jwt-project/database/config"
	"golang-jwt-project/database/store"
	"golang-jwt-project/internal/api"
	"golang-jwt-project/internal/telegrambot"
	"golang-jwt-project/internal/ws"

	"github.com/joho/godotenv"
)

func main() {
	if err := loadProjectEnv(); err != nil {
		log.Println("no .env file found, relying on system environment variables")
	}

	conf, err := config.New()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	db, err := store.NewPostgresDb(conf)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	jwtSecret := []byte(conf.JWTSecret)
	refreshSecret := []byte(conf.JWTRefreshSecret)

	pool := ws.NewPool()
	go pool.Start()

	links := telegrambot.NewLoginLinks(2 * time.Minute) // NEW

	botCtx, stopBot := context.WithCancel(context.Background())
	defer stopBot()
	startTelegramBot(botCtx, links)

	globalLimiter := middleware.NewRateLimiter(rate.Limit(20), 40)
	authLimiter := middleware.NewRateLimiter(rate.Limit(0.5), 3)
	defer globalLimiter.Close()
	defer authLimiter.Close()

	router := api.NewRouter(db, pool, jwtSecret, refreshSecret, globalLimiter, authLimiter, links) // CHANGED

	if err := router.Run(":8000"); err != nil {
		log.Fatalf("server failed: %v", err)
	}

}

func loadProjectEnv() error {
	candidates := []string{
		".env",
		"../../.env",
		"../../../.env",
	}

	for _, candidate := range candidates {
		if err := godotenv.Load(candidate); err == nil {
			return nil
		}
	}

	return godotenv.Load()
}

func startTelegramBot(ctx context.Context, links *telegrambot.LoginLinks) {
	token := os.Getenv("TELEGRAM_BOT_TOKEN")
	if token == "" {
		log.Println("telegram bot disabled: TELEGRAM_BOT_TOKEN is not set")
		return
	}

	adminID, err := strconv.ParseInt(os.Getenv("TELEGRAM_CHAT_ID"), 10, 64)
	if err != nil {
		log.Printf("telegram bot disabled: TELEGRAM_CHAT_ID is missing or not a number: %v", err)
		return
	}

	bot := telegrambot.New(token, adminID)
	bot.EnableLogin(links, os.Getenv("TELEGRAM_LOGIN_USER_ID"), os.Getenv("APP_BASE_URL")) // NEW
	go bot.Run(ctx)
}
