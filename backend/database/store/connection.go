package store

import (
	"database/sql"
	"fmt"
	"golang-jwt-project/database/config"

	_ "github.com/lib/pq"
)

func NewPostgresDb(conf *config.Config) (*sql.DB, error) {
	dsn := conf.DatabaseUrl()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database connection: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return db, nil
}
