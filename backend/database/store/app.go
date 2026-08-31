package store

import (
	"database/sql"
	"golang-jwt-project/database/config"
)

type app struct {
	config *config.Config
	db     *sql.DB
}
