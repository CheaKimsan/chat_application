package main

import (
	"log"

	"golang-jwt-project/database/config"
	"golang-jwt-project/database/store"
	"golang-jwt-project/internal/api"
	"golang-jwt-project/internal/ws"

	"github.com/joho/godotenv"
)

func main() {
	// Load .env into the process's environment variables (SMTP_FROM,
	// SMTP_APP_PASSWORD, SMTP_HOST, SMTP_PORT, etc). If no .env file is
	// found (e.g. in production where real env vars are set directly),
	// this just logs and continues rather than failing.
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

	router := api.NewRouter(db, pool, jwtSecret, refreshSecret)
	if err := router.Run(":8000"); err != nil {
		log.Fatalf("server failed: %v", err)
	}

}
