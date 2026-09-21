package handlers

import (
	"context"

	"golang-jwt-project/internal/models"
	"golang-jwt-project/internal/services"
)

// AuthServicer is the subset of *services.AuthService that AuthHandler
// depends on. Depending on this interface instead of the concrete
// *services.AuthService type is what makes AuthHandler unit-testable:
// production code passes the real *services.AuthService (it already
// satisfies this interface — no changes needed there), and tests pass
// a mock.
type AuthServicer interface {
	Login(ctx context.Context, username, password string) (models.UserResponse, services.TokenPair, error)
	Signup(ctx context.Context, username, email, password, publicKey string) (models.UserResponse, services.TokenPair, error)
	VerifyEmailOTP(email, otp string) error
	SendVerificationOTP(email string) error
	Refresh(ctx context.Context, rawRefreshToken string) (services.TokenPair, error)
	Logout(ctx context.Context, refreshToken string) error
	ForgotPassword(ctx context.Context, email string) error
	ResetPassword(ctx context.Context, rawToken, newPassword string) error
	CompleteLoginWithDeviceTracking(ctx context.Context, userID, refreshToken, userAgent, ipAddress, userEmail string)
}

// InviteServicer is the subset of *services.InviteService that AuthHandler
// depends on.
//
// ASSUMPTION: I don't have services/invite_service.go, so I'm inferring
// this signature from how the handler calls it:
//
//	h.inviteService.ConsumeInvite(c.Request.Context(), *req.InviteToken)
//
// If the real method has a different signature, update this interface
// to match — it must be identical to *services.InviteService's method
// for the concrete type to keep satisfying it.
type InviteServicer interface {
	ConsumeInvite(ctx context.Context, token string) error
}
