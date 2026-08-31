package utils

import "errors"

var (
	ErrInvalidCredentials    = errors.New("invalid credentials")
	ErrUsernameTaken         = errors.New("username already exists")
	ErrInvalidRefreshToken   = errors.New("invalid or expired refresh token")
	ErrMalformedRefreshToken = errors.New("malformed refresh token")
	ErrRefreshTokenRevoked   = errors.New("refresh token revoked or expired")
	ErrUserNotFound          = errors.New("user no longer exists")
	ErrForbidden             = errors.New("not authorized to perform this action")
)
