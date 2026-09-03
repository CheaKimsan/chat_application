package services

import (
	"context"
	"errors"
	"fmt"
	"golang-jwt-project/internal/utils"
	"net/smtp"
	"time"

	"golang-jwt-project/internal/models"
	"golang-jwt-project/internal/repository"

	"golang.org/x/crypto/bcrypt"
)

type TokenPair struct {
	AccessToken  string
	RefreshToken string
}

var ErrInvalidResetToken = errors.New("invalid or expired reset token")

type AuthService struct {
	users          *repository.UserRepository
	refreshTokens  *repository.RefreshTokenRepository
	passwordResets *repository.PasswordResetRepository
	tokens         *TokenService
	emailFrom      string
	emailPassword  string
	smtpHost       string
	smtpPort       string
}

func NewAuthService(
	users *repository.UserRepository,
	refreshTokens *repository.RefreshTokenRepository,
	passwordResets *repository.PasswordResetRepository,
	tokens *TokenService,
	emailFrom, emailPassword, smtpHost, smtpPort string,
) *AuthService {
	return &AuthService{
		users:          users,
		refreshTokens:  refreshTokens,
		passwordResets: passwordResets,
		tokens:         tokens,
		emailFrom:      emailFrom,
		emailPassword:  emailPassword,
		smtpHost:       smtpHost,
		smtpPort:       smtpPort,
	}
}

const (
	maxFailedAttempts = 5
	lockDuration      = 15 * time.Minute
)

func (s *AuthService) issueTokenPair(ctx context.Context, u models.UserResponse) (TokenPair, error) {
	access, err := s.tokens.GenerateAccessToken(u)
	if err != nil {
		return TokenPair{}, err
	}
	refresh, err := s.tokens.GenerateRefreshToken(u)
	if err != nil {
		return TokenPair{}, err
	}
	if err := s.refreshTokens.Store(ctx, u.ID, refresh, time.Now().Add(RefreshTokenTTL)); err != nil {
		return TokenPair{}, err
	}
	return TokenPair{AccessToken: access, RefreshToken: refresh}, nil
}

func (s *AuthService) Login(ctx context.Context, username, password string) (models.UserResponse, TokenPair, error) {
	u, err := s.users.GetByUsername(ctx, username)
	if err != nil {
		return models.UserResponse{}, TokenPair{}, err
	}
	if u == nil {
		return models.UserResponse{}, TokenPair{}, utils.ErrInvalidCredentials
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		return models.UserResponse{}, TokenPair{}, utils.ErrInvalidCredentials
	}

	pair, err := s.issueTokenPair(ctx, *u)
	if err != nil {
		return models.UserResponse{}, TokenPair{}, err
	}
	return *u, pair, nil
}

func (s *AuthService) Signup(ctx context.Context, username, email, password, publicKey string) (models.UserResponse, TokenPair, error) {
	exists, err := s.users.ExistsByUsername(ctx, username)
	if err != nil {
		return models.UserResponse{}, TokenPair{}, err
	}
	if exists {
		return models.UserResponse{}, TokenPair{}, utils.ErrUsernameTaken
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return models.UserResponse{}, TokenPair{}, err
	}

	//default role user when register
	const defaultRole = "user"

	user, err := s.users.Create(ctx, username, email, defaultRole, string(passwordHash), publicKey)
	if err != nil {
		return models.UserResponse{}, TokenPair{}, err
	}

	pair, err := s.issueTokenPair(ctx, *user)
	if err != nil {
		return models.UserResponse{}, TokenPair{}, err
	}
	return *user, pair, nil
}

// Refresh redeems a valid, unrevoked refresh token for a brand new
// access/refresh pair, then revokes the old refresh token (rotation) so
// it can never be redeemed a second time.
func (s *AuthService) Refresh(ctx context.Context, rawRefreshToken string) (TokenPair, error) {
	claims, err := s.tokens.ParseRefreshToken(rawRefreshToken)
	if err != nil {
		return TokenPair{}, err
	}

	userID, ok := claims["id"].(string)
	if !ok || userID == "" {
		return TokenPair{}, utils.ErrMalformedRefreshToken
	}

	active, err := s.refreshTokens.IsActive(ctx, rawRefreshToken)
	if err != nil {
		return TokenPair{}, err
	}
	if !active {
		// Expired, already used, or explicitly revoked (e.g. logout).
		// Reuse of an already-rotated token is a strong theft signal —
		// worth logging/alerting on in production.
		return TokenPair{}, utils.ErrRefreshTokenRevoked
	}

	// Rotate: this token is spent regardless of what happens next.
	if err := s.refreshTokens.Revoke(ctx, rawRefreshToken); err != nil {
		return TokenPair{}, err
	}

	// Re-fetch so the new access token reflects current role/etc, rather
	// than trusting whatever was baked into the refresh token.
	u, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return TokenPair{}, err
	}
	if u == nil {
		return TokenPair{}, utils.ErrUserNotFound
	}

	return s.issueTokenPair(ctx, *u)
}

func (s *AuthService) Logout(ctx context.Context, refreshToken string) error {
	// Deliberately idempotent: whether the token was valid, already
	// expired, or already revoked, the response is identical — logout
	// should never leak information about a token's state to the caller.
	return s.refreshTokens.Revoke(ctx, refreshToken)
}

// --- restored: forgot/reset password ---
const passwordResetTokenTTL = 3 * time.Minute

func (s *AuthService) ForgotPassword(ctx context.Context, email string) error {
	u, err := s.users.GetByEmail(ctx, email)
	if err != nil {
		return err
	}
	if u == nil {
		return nil // same generic behavior either way
	}

	rawToken, err := repository.GenerateRawToken()

	if err != nil {
		return err
	}

	if err := s.passwordResets.Store(ctx, u.ID, rawToken, time.Now().Add(passwordResetTokenTTL)); err != nil {
		return err
	}

	return s.sendPasswordResetEmail(u.Email, rawToken)
}

// ResetPassword redeems a valid, unused reset token for a new password,
// then revokes every active session for the user.
func (s *AuthService) ResetPassword(ctx context.Context, rawToken, newPassword string) error {
	userID, ok, err := s.passwordResets.Validate(ctx, rawToken)
	if err != nil {
		return err
	}
	if !ok {
		return ErrInvalidResetToken
	}

	// Rotate: this token is spent regardless of what happens next.
	if err := s.passwordResets.MarkUsed(ctx, rawToken); err != nil {
		return err
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	if err := s.users.UpdatePasswordHash(ctx, userID, string(passwordHash)); err != nil {
		return err
	}

	return s.refreshTokens.RevokeAllForUser(ctx, userID)
}

// sendPasswordResetEmail uses credentials loaded from config
func (s *AuthService) sendPasswordResetEmail(email, rawToken string) error {
	resetLink := fmt.Sprintf("http://localhost:3000/reset-password?token=%s", rawToken)
	subject := "Subject: Reset your password\n"
	body := fmt.Sprintf("Click the link to reset your password: %s\nThis link expires in 3 minutes.", resetLink)
	msg := []byte(subject + "\n" + body)

	auth := smtp.PlainAuth("", s.emailFrom, s.emailPassword, s.smtpHost)
	return smtp.SendMail(s.smtpHost+":"+s.smtpPort, auth, s.emailFrom, []string{email}, msg)
}

// CompleteLoginWithDeviceTracking attaches the requesting device's
// user-agent/IP to the just-issued refresh token, and — if this device
// doesn't match any of the user's OTHER currently active sessions —
// sends a "new device" email alert. Call this from the Login handler
// right after a successful s.Login(...) call, passing the refresh token
// from the returned TokenPair.
func (s *AuthService) CompleteLoginWithDeviceTracking(ctx context.Context, userID, refreshToken, userAgent, ipAddress, userEmail string) {
	// Check existing sessions BEFORE this one is attached, so this new
	// login doesn't count as "already existing" evidence against itself.
	existing, err := s.refreshTokens.ListActiveForUser(ctx, userID)
	if err == nil {
		isNewDevice := true
		for _, sess := range existing {
			if sess.UserAgent.String == userAgent {
				isNewDevice = false
				break
			}
		}
		if isNewDevice && len(existing) > 0 {
			// Best-effort — a failed alert email should never block login.
			_ = s.sendNewDeviceAlert(userEmail, userAgent, ipAddress)
		}
	}

	// Best-effort — device metadata is informational, never worth
	// failing the login over if this write has an issue.
	_ = s.refreshTokens.AttachDeviceInfo(ctx, refreshToken, userAgent, ipAddress)
}

func (s *AuthService) sendNewDeviceAlert(email, userAgent, ipAddress string) error {
	return s.sendPlainEmail(email, "New login to your account",
		fmt.Sprintf(
			"We noticed a login to your account from a new device.\n\nDevice: %s\nIP: %s\n\nIf this was you, no action is needed. If this wasn't you, reset your password immediately.",
			userAgent, ipAddress,
		),
	)
}

// sendPlainEmail mirrors the same SMTP pattern sendPasswordResetEmail
// already uses — kept as its own method so it's easy to swap for a real
// provider later without touching call sites.
func (s *AuthService) sendPlainEmail(to, subject, body string) error {
	msg := []byte("Subject: " + subject + "\n\n" + body)
	auth := smtp.PlainAuth("", s.emailFrom, s.emailPassword, s.smtpHost)
	return smtp.SendMail(s.smtpHost+":"+s.smtpPort, auth, s.emailFrom, []string{to}, msg)
}

// --- added: session management (used by SessionHandler) ---

func (s *AuthService) List(ctx context.Context, userID string) ([]models.SessionResponse, error) {
	rows, err := s.refreshTokens.ListActiveForUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	sessions := make([]models.SessionResponse, 0, len(rows))
	for _, r := range rows {
		sessions = append(sessions, models.SessionResponse{
			ID:        r.ID,
			UserAgent: r.UserAgent.String,
			IPAddress: r.IPAddress.String,
			CreatedAt: r.CreatedAt,
			ExpiresAt: r.ExpiresAt,
		})
	}
	return sessions, nil
}

func (s *AuthService) Revoke(ctx context.Context, userID string, sessionID int) (bool, error) {
	return s.refreshTokens.RevokeByIDForUser(ctx, sessionID, userID)
}

// LogoutAll ends every session for the user — the "log out everywhere"
// panic button. Reuses the same RevokeAllForUser that ChangePassword and
// ResetPassword already depend on.
func (s *AuthService) LogoutAll(ctx context.Context, userID string) error {
	return s.refreshTokens.RevokeAllForUser(ctx, userID)
}
