package repository

import (
	"context"
	"database/sql"
	"log"

	"golang-jwt-project/internal/models"
)

type UserRepository struct {
	db *sql.DB
}

func NewUserRepository(db *sql.DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) GetByUsername(ctx context.Context, username string) (*models.UserResponse, error) {
	var u models.UserResponse
	err := r.db.QueryRowContext(ctx,
		"SELECT id, username, email, password_hash, role, profile_photo FROM users WHERE username = $1", username,
	).Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.Role, &u.ProfilePhoto)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) GetByID(ctx context.Context, id string) (*models.UserResponse, error) {
	var u models.UserResponse
	err := r.db.QueryRowContext(ctx,
		"SELECT id, username, email, password_hash, role, profile_photo FROM users WHERE id = $1", id,
	).Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.Role, &u.ProfilePhoto)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) ExistsByUsername(ctx context.Context, username string) (bool, error) {
	var id string
	err := r.db.QueryRowContext(ctx, "SELECT id FROM users WHERE username = $1", username).Scan(&id)
	if err == nil {
		return true, nil
	}
	if err == sql.ErrNoRows {
		return false, nil
	}
	return false, err
}

func (r *UserRepository) GetAll(ctx context.Context) ([]models.UserResponse, error) {
	rows, err := r.db.QueryContext(ctx, "SELECT id, username, email, password_hash, role, profile_photo FROM users")
	if err != nil {
		log.Println("Error querying users:", err)
		return nil, err
	}
	defer rows.Close()

	var users []models.UserResponse
	for rows.Next() {
		var u models.UserResponse
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.Role, &u.ProfilePhoto); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return users, nil
}

func (r *UserRepository) Update(ctx context.Context, id string, username, email, passwordHash, role, profilePhoto *string) (*models.UserResponse, error) {
	var u models.UserResponse
	err := r.db.QueryRowContext(
		ctx,
		`UPDATE users
		 SET username = COALESCE($1, username),
		     email = COALESCE($2, email),
		     password_hash = COALESCE($3, password_hash),
		     role = COALESCE($4, role),
		     profile_photo = COALESCE($5, profile_photo)
		 WHERE id = $6
		 RETURNING id, username, email, role, password_hash, profile_photo`,
		username, email, passwordHash, role, profilePhoto, id,
	).Scan(&u.ID, &u.Username, &u.Email, &u.Role, &u.PasswordHash, &u.ProfilePhoto)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &u, nil
}

// Delete removes the user with the given id. The returned bool reports
// whether a row was actually deleted (false means no such user existed).
func (r *UserRepository) Delete(ctx context.Context, id string) (bool, error) {
	res, err := r.db.ExecContext(ctx, "DELETE FROM users WHERE id = $1", id)
	if err != nil {
		return false, err
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return rows > 0, nil
}

func (r *UserRepository) Create(ctx context.Context, username, email, role, passwordHash, publicKey string) (*models.UserResponse, error) {
	var u models.UserResponse
	err := r.db.QueryRowContext(ctx,
		`INSERT INTO users (username, email, role, password_hash, public_key, profile_photo)
			VALUES ($1, $2, $3, $4, $5, '')
			RETURNING id, username, email, role, profile_photo`,
		username, email, role, passwordHash, publicKey,
	).Scan(&u.ID, &u.Username, &u.Email, &u.Role, &u.ProfilePhoto)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetPublicKeyByID returns the stored public key for a user. It intentionally
// returns the raw sql.ErrNoRows on a missing user (rather than a
// services.ErrUserNotFound) — repository must not import services, since
// services already imports repository, and that combination is an import
// cycle Go's compiler rejects outright. The service layer is responsible for
// translating sql.ErrNoRows into ErrUserNotFound.
func (r *UserRepository) GetPublicKeyByID(ctx context.Context, id string) (string, error) {
	var pubKey sql.NullString
	err := r.db.QueryRowContext(ctx, `SELECT public_key FROM users WHERE id = $1`, id).Scan(&pubKey)
	if err != nil {
		return "", err
	}
	return pubKey.String, nil
}

func (r *UserRepository) UpdatePublicKey(ctx context.Context, id string, publicKey string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET public_key = $1 WHERE id = $2`, publicKey, id)
	return err
}

func (r *UserRepository) UpdatePasswordHash(ctx context.Context, userID, newPasswordHash string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET password_hash = $1 WHERE id = $2`,
		newPasswordHash, userID,
	)
	return err
}

func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*models.UserResponse, error) {
	var u models.UserResponse
	err := r.db.QueryRowContext(ctx,
		"SELECT id, username, email, password_hash, role, profile_photo FROM users WHERE email = $1", email,
	).Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.Role, &u.ProfilePhoto)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) UpdateProfilePhoto(ctx context.Context, id string, profilePhoto string) (*models.UserResponse, error) {
	var u models.UserResponse
	err := r.db.QueryRowContext(ctx,
		`UPDATE users SET profile_photo = $1 WHERE id = $2
		 RETURNING id, username, email, role, profile_photo`,
		profilePhoto, id,
	).Scan(&u.ID, &u.Username, &u.Email, &u.Role, &u.ProfilePhoto)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &u, nil
}
