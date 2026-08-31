package services

import (
	"context"
	"database/sql"
	"errors"
	"golang-jwt-project/internal/utils"

	"golang-jwt-project/internal/models"
	"golang-jwt-project/internal/repository"

	"golang.org/x/crypto/bcrypt"
)

var ErrPublicKeyNotSet = errors.New("public key not set for this user")

type UserService struct {
	users *repository.UserRepository
}

func NewUserService(users *repository.UserRepository) *UserService {
	return &UserService{users: users}
}

func (s *UserService) ListAll(ctx context.Context) ([]models.UserResponse, error) {
	return s.users.GetAll(ctx)
}

// canModify enforces that a caller can only touch their own user record
// unless they're an admin.
func canModify(callerID, callerRole, targetID string) bool {
	return callerID == targetID || callerRole == "admin"
}

func (s *UserService) Update(ctx context.Context, callerID, callerRole, targetID string, req models.UpdateUserRequest) (models.UserResponse, error) {
	if !canModify(callerID, callerRole, targetID) {
		return models.UserResponse{}, utils.ErrForbidden
	}

	var passwordHash *string
	if req.Password != nil {
		hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
		if err != nil {
			return models.UserResponse{}, err
		}
		s := string(hash)
		passwordHash = &s
	}

	user, err := s.users.Update(ctx, targetID, req.Username, req.Email, passwordHash, req.Role)
	if err != nil {
		return models.UserResponse{}, err
	}
	if user == nil {
		return models.UserResponse{}, utils.ErrUserNotFound
	}
	return *user, nil
}

func (s *UserService) Delete(ctx context.Context, callerID, callerRole, targetID string) error {
	if !canModify(callerID, callerRole, targetID) {
		return utils.ErrForbidden
	}

	deleted, err := s.users.Delete(ctx, targetID)
	if err != nil {
		return err
	}
	if !deleted {
		return utils.ErrUserNotFound
	}
	return nil
}

// GetPublicKey fetches a user's ECDH public key for the E2EE key directory.
// Translates the repository's raw sql.ErrNoRows into the service-level
// ErrUserNotFound, and distinguishes "user doesn't exist" from "user exists
// but never registered a public key" (ErrPublicKeyNotSet) — the latter can
// happen for accounts created before public_key was required, or if a NULL
// slipped in some other way.
func (s *UserService) GetPublicKey(ctx context.Context, userID string) (string, error) {
	pubKey, err := s.users.GetPublicKeyByID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", utils.ErrUserNotFound
		}
		return "", err
	}
	if pubKey == "" {
		return "", ErrPublicKeyNotSet
	}
	return pubKey, nil
}

// UpdatePublicKey (re)publishes the caller's own public key.
func (s *UserService) UpdatePublicKey(ctx context.Context, userID string, publicKey string) error {
	return s.users.UpdatePublicKey(ctx, userID, publicKey)
}
