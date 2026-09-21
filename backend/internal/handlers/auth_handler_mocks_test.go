package handlers

import (
	"context"

	"golang-jwt-project/internal/models"
	"golang-jwt-project/internal/services"
)

// mockAuthService is a configurable fake satisfying AuthServicer.
// Set only the *Func fields a given test actually needs; calling a
// method whose Func is nil will panic — treat that panic as "this test
// called something it didn't expect to."
type mockAuthService struct {
	LoginFunc                           func(ctx context.Context, username, password string) (models.UserResponse, services.TokenPair, error)
	SignupFunc                          func(ctx context.Context, username, email, password, publicKey string) (models.UserResponse, services.TokenPair, error)
	VerifyEmailOTPFunc                  func(email, otp string) error
	SendVerificationOTPFunc             func(email string) error
	RefreshFunc                         func(ctx context.Context, rawRefreshToken string) (services.TokenPair, error)
	LogoutFunc                          func(ctx context.Context, refreshToken string) error
	ForgotPasswordFunc                  func(ctx context.Context, email string) error
	ResetPasswordFunc                   func(ctx context.Context, rawToken, newPassword string) error
	CompleteLoginWithDeviceTrackingFunc func(ctx context.Context, userID, refreshToken, userAgent, ipAddress, userEmail string)

	// deviceTrackingCalled is closed the first time
	// CompleteLoginWithDeviceTracking runs, so tests can synchronize with
	// the goroutine the handler launches it in (see the Login handler's
	// `go h.service.CompleteLoginWithDeviceTracking(...)`).
	deviceTrackingCalled chan struct{}
}

func newMockAuthService() *mockAuthService {
	return &mockAuthService{deviceTrackingCalled: make(chan struct{})}
}

func (m *mockAuthService) Login(ctx context.Context, username, password string) (models.UserResponse, services.TokenPair, error) {
	return m.LoginFunc(ctx, username, password)
}

func (m *mockAuthService) Signup(ctx context.Context, username, email, password, publicKey string) (models.UserResponse, services.TokenPair, error) {
	return m.SignupFunc(ctx, username, email, password, publicKey)
}

func (m *mockAuthService) VerifyEmailOTP(email, otp string) error {
	return m.VerifyEmailOTPFunc(email, otp)
}

func (m *mockAuthService) SendVerificationOTP(email string) error {
	return m.SendVerificationOTPFunc(email)
}

func (m *mockAuthService) Refresh(ctx context.Context, rawRefreshToken string) (services.TokenPair, error) {
	return m.RefreshFunc(ctx, rawRefreshToken)
}

func (m *mockAuthService) Logout(ctx context.Context, refreshToken string) error {
	return m.LogoutFunc(ctx, refreshToken)
}

func (m *mockAuthService) ForgotPassword(ctx context.Context, email string) error {
	return m.ForgotPasswordFunc(ctx, email)
}

func (m *mockAuthService) ResetPassword(ctx context.Context, rawToken, newPassword string) error {
	return m.ResetPasswordFunc(ctx, rawToken, newPassword)
}

func (m *mockAuthService) CompleteLoginWithDeviceTracking(ctx context.Context, userID, refreshToken, userAgent, ipAddress, userEmail string) {
	defer close(m.deviceTrackingCalled)
	if m.CompleteLoginWithDeviceTrackingFunc != nil {
		m.CompleteLoginWithDeviceTrackingFunc(ctx, userID, refreshToken, userAgent, ipAddress, userEmail)
	}
}

// mockInviteService is a configurable fake satisfying InviteServicer.
type mockInviteService struct {
	ConsumeInviteFunc func(ctx context.Context, token string) error
}

func (m *mockInviteService) ConsumeInvite(ctx context.Context, token string) error {
	return m.ConsumeInviteFunc(ctx, token)
}
