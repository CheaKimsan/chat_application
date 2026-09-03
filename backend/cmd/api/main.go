package main

import (
	"golang-jwt-project/internal/middleware"
	"golang.org/x/time/rate"
	"log"

	"golang-jwt-project/database/config"
	"golang-jwt-project/database/store"
	"golang-jwt-project/internal/api"
	"golang-jwt-project/internal/ws"

	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil {
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

	globalLimiter := middleware.NewRateLimiter(rate.Limit(20), 40)
	authLimiter := middleware.NewRateLimiter(rate.Limit(0.5), 3)
	defer globalLimiter.Close()
	defer authLimiter.Close()

	router := api.NewRouter(db, pool, jwtSecret, refreshSecret, globalLimiter, authLimiter)
	if err := router.Run(":8000"); err != nil {
		log.Fatalf("server failed: %v", err)
	}

}
