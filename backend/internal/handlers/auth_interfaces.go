package handlers

import (
	"context"

	"golang-jwt-project/internal/models"
	"golang-jwt-project/internal/services"
)

type AuthServicer interface {
	Login(ctx context.Context, username, password string) (models.UserResponse, services.TokenPair, error)
	LoginAsUser(ctx context.Context, userID string) (models.UserResponse, services.TokenPair, error)
	Signup(ctx context.Context, username, email, password, publicKey string) (models.UserResponse, services.TokenPair, error)
	VerifyEmailOTP(email, otp string) error
	SendVerificationOTP(email string) error
	Refresh(ctx context.Context, rawRefreshToken string) (services.TokenPair, error)
	Logout(ctx context.Context, refreshToken string) error
	ForgotPassword(ctx context.Context, email string) error
	ResetPassword(ctx context.Context, rawToken, newPassword string) error
	CompleteLoginWithDeviceTracking(ctx context.Context, userID, refreshToken, userAgent, ipAddress, userEmail string)
}

type InviteServicer interface {
	ConsumeInvite(ctx context.Context, token string) error
}
