package repository

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"time"
)

type PasswordResetRepository struct {
	db *sql.DB
}

func NewPasswordResetRepository(db *sql.DB) *PasswordResetRepository {
	return &PasswordResetRepository{db: db}
}

func GenerateRawToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func hashResetToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (r *PasswordResetRepository) Store(ctx context.Context, userID string, rawToken string, expiresAt time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used)
		 VALUES ($1, $2, $3, false)`,
		userID, hashResetToken(rawToken), expiresAt,
	)
	return err
}

func (r *PasswordResetRepository) Validate(ctx context.Context, rawToken string) (userID string, ok bool, err error) {
	err = r.db.QueryRowContext(ctx,
		`SELECT user_id FROM password_reset_tokens
		 WHERE token_hash = $1 AND used = false AND expires_at > now()`,
		hashResetToken(rawToken),
	).Scan(&userID)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", false, nil
		}
		return "", false, err
	}
	return userID, true, nil
}
func (r *PasswordResetRepository) MarkUsed(ctx context.Context, rawToken string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE password_reset_tokens SET used = true WHERE token_hash = $1`,
		hashResetToken(rawToken),
	)
	return err
}
