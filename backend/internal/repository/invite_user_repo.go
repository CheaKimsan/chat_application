package repository

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"time"
)

type InviteRepository struct {
	db *sql.DB
}

func NewInviteRepository(db *sql.DB) *InviteRepository {
	return &InviteRepository{db: db}
}

func hashInviteToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Create stores a new invite. rawToken is hashed before storage — same
// principle as password reset tokens, so a DB leak alone can't be used
// to redeem invites. used_at is left NULL (defaulted by the column) to
// mark it as not-yet-used.
func (r *InviteRepository) Create(ctx context.Context, inviterID, email, rawToken string, expiresAt time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO invites (inviter_id, email, token_hash, expires_at)
		 VALUES ($1, $2, $3, $4)`,
		inviterID, email, hashInviteToken(rawToken), expiresAt,
	)
	return err
}

// Validate returns the invited email for an active (unused, unexpired)
// invite token, or "", false if the token doesn't match any active row.
// "Unused" is now used_at IS NULL, replacing the old used boolean.
func (r *InviteRepository) Validate(ctx context.Context, rawToken string) (email string, ok bool, err error) {
	err = r.db.QueryRowContext(ctx,
		`SELECT email FROM invites
		 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
		hashInviteToken(rawToken),
	).Scan(&email)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", false, nil
		}
		return "", false, err
	}
	return email, true, nil
}

// MarkUsed makes the invite single-use, consumed once the invitee
// completes signup with it. Sets used_at to now() instead of flipping a
// boolean, so you also get a record of when it was redeemed.
func (r *InviteRepository) MarkUsed(ctx context.Context, rawToken string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE invites SET used_at = now() WHERE token_hash = $1`,
		hashInviteToken(rawToken),
	)
	return err
}
