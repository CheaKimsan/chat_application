package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"golang-jwt-project/database/config"
	"golang-jwt-project/database/store"
	"golang-jwt-project/internal/api"
	"golang-jwt-project/internal/middleware"
	appredis "golang-jwt-project/internal/redis"
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

	// Redis must be initialised after loadProjectEnv(), because Init()
	// reads REDIS_ADDR / REDIS_PASSWORD from the environment.
	appredis.Init()
	defer appredis.Close()

	pingCtx, cancelPing := context.WithTimeout(context.Background(), 3*time.Second)
	if err := appredis.Ping(pingCtx); err != nil {
		cancelPing()
		log.Fatalf("failed to connect to redis: %v", err)
	}
	cancelPing()

	jwtSecret := []byte(conf.JWTSecret)
	refreshSecret := []byte(conf.JWTRefreshSecret)

	pool := ws.NewPool()
	go pool.Start()

	links := telegrambot.NewLoginLinks(2 * time.Minute)

	botCtx, stopBot := context.WithCancel(context.Background())
	defer stopBot()
	startTelegramBot(botCtx, links, pool.Count)

	// Each limiter needs its own KeyPrefix so they don't share
	// counters, violations, or bans in Redis.
	//
	// Old: rate.Limit(20), burst 40  ->  40 requests per 2 seconds
	globalLimiter := middleware.NewRateLimiter(appredis.Client, 40, 2*time.Second)
	globalLimiter.KeyPrefix = "global"

	// Old: rate.Limit(0.5), burst 3  ->  3 requests per 6 seconds
	authLimiter := middleware.NewRateLimiter(appredis.Client, 3, 6*time.Second)
	authLimiter.KeyPrefix = "auth"

	router := api.NewRouter(db, pool, jwtSecret, refreshSecret, globalLimiter, authLimiter, links)

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

func startTelegramBot(ctx context.Context, links *telegrambot.LoginLinks, online func() int) {
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
	bot.Handle("online", func(context.Context, string) string {
		if online == nil {
			return "Users online: 0"
		}
		return fmt.Sprintf("Users online: %d", online())
	})
	bot.EnableLogin(links, os.Getenv("TELEGRAM_LOGIN_USER_ID"), os.Getenv("APP_BASE_URL"))
	go bot.Run(ctx)
}
