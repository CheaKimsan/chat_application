package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"golang.org/x/crypto/bcrypt"
)

type UserStore struct {
	db *sqlx.DB
}

func NewUserStore(db *sql.DB) *UserStore {
	return &UserStore{
		db: sqlx.NewDb(db, "postgres"),
	}
}

type User struct {
	Id                   uuid.UUID `db:"id"`
	Email                string    `db:"email"`
	HashedPasswordBase64 string    `db:"hashed_password"`
	CreatedAt            time.Time `db:"created_at"`
}

func (u *User) ComparePasswordd(password string) error {
	hashedPassword, err := base64.StdEncoding.DecodeString(u.HashedPasswordBase64)
	if err != nil {
		return err
	}
	err = bcrypt.CompareHashAndPassword(hashedPassword, []byte(password))
	if err != nil {
		return fmt.Errorf("invalid password")
	}
	return nil
}

func (s *UserStore) CreateUser(ctx context.Context, email string, password string) (*User, error) {
	const sql = `INSERT INTO users(email,hashed_password)VALUES($1,$2) RETURNING *;`
	var user User

	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	hashedPasswordBase64 := base64.StdEncoding.EncodeToString(bytes)
	if err := s.db.GetContext(ctx, &user, sql, email, hashedPasswordBase64); err != nil {
		return nil, fmt.Errorf("failed to insert user %w", err)
	}
	return &user, nil
}

func (s *UserStore) ByEmail(ctx context.Context, email string) (*User, error) {
	const query = `SELECT * FROM users WHERE email = $1;`

	var user User

	if err := s.db.GetContext(ctx, &user, query, email); err != nil {
		return nil, fmt.Errorf("failed to fetch user by id :  %w", err)
	}
	return &user, nil
}
