package repository

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"time"
)

type RefreshTokenRepository struct {
	db *sql.DB
}

func NewRefreshTokenRepository(db *sql.DB) *RefreshTokenRepository {
	return &RefreshTokenRepository{db: db}
}

// hashToken produces the lookup key stored in refresh_tokens.token_hash.
// SHA-256 (not bcrypt) is correct here: the token is already long and
// random like a session token, not a low-entropy human password, so
// there's no brute-force risk to slow down against — we just don't want
// the raw token sitting in the DB in plaintext.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (r *RefreshTokenRepository) Store(ctx context.Context, userID, rawToken string, expiresAt time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked)
			VALUES ($1, $2, $3, false)`,
		userID, hashToken(rawToken), expiresAt,
	)
	return err
}

func (r *RefreshTokenRepository) IsActive(ctx context.Context, rawToken string) (bool, error) {
	var revoked bool
	var expiresAt time.Time
	err := r.db.QueryRowContext(ctx,
		`SELECT revoked, expires_at FROM refresh_tokens WHERE token_hash = $1`,
		hashToken(rawToken),
	).Scan(&revoked, &expiresAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return !revoked && time.Now().Before(expiresAt), nil
}

func (r *RefreshTokenRepository) Revoke(ctx context.Context, rawToken string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1`,
		hashToken(rawToken),
	)
	return err
}

func (r *RefreshTokenRepository) RevokeAllForUser(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND revoked = false`,
		userID,
	)
	return err
}

// --- added: session management ---

type SessionRow struct {
	ID        int
	UserAgent sql.NullString
	IPAddress sql.NullString
	CreatedAt time.Time
	ExpiresAt time.Time
}

// AttachDeviceInfo records the device/IP for an already-stored refresh
// token, right after issuance. Kept as a separate call (rather than
// adding params to Store) so every existing call site — Signup, Refresh,
// ChangePassword, ResetPassword — is completely unaffected.
func (r *RefreshTokenRepository) AttachDeviceInfo(ctx context.Context, rawToken, userAgent, ipAddress string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE refresh_tokens SET user_agent = $1, ip_address = $2 WHERE token_hash = $3`,
		userAgent, ipAddress, hashToken(rawToken),
	)
	return err
}

// ListActiveForUser returns every active (non-revoked, unexpired) session
// row for a user — this is what powers "your logged-in devices".
func (r *RefreshTokenRepository) ListActiveForUser(ctx context.Context, userID string) ([]SessionRow, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, user_agent, ip_address, created_at, expires_at
		 FROM refresh_tokens
		 WHERE user_id = $1 AND revoked = false AND expires_at > now()
		 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []SessionRow
	for rows.Next() {
		var s SessionRow
		if err := rows.Scan(&s.ID, &s.UserAgent, &s.IPAddress, &s.CreatedAt, &s.ExpiresAt); err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}

// RevokeByIDForUser revokes one session by its row id, scoped to the
// owning user — critical check, otherwise any user could revoke anyone
// else's session just by guessing an id.
func (r *RefreshTokenRepository) RevokeByIDForUser(ctx context.Context, id int, userID string) (bool, error) {
	res, err := r.db.ExecContext(ctx,
		`UPDATE refresh_tokens SET revoked = true WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
