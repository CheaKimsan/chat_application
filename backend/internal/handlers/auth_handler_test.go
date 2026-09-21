package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"golang-jwt-project/internal/models"
	"golang-jwt-project/internal/services"
	"golang-jwt-project/internal/utils"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// newTestContext builds a gin.Context wired to an httptest recorder, with
// body marshaled to JSON (or raw bytes if body is a []byte / string).
func newTestContext(t *testing.T, method, path string, body any) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()

	var reader *bytes.Reader
	switch v := body.(type) {
	case nil:
		reader = bytes.NewReader(nil)
	case []byte:
		reader = bytes.NewReader(v)
	case string:
		reader = bytes.NewReader([]byte(v))
	default:
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatalf("failed to marshal request body: %v", err)
		}
		reader = bytes.NewReader(b)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, path, reader)
	c.Request.Header.Set("Content-Type", "application/json")
	return c, w
}

func decodeBody(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if w.Body.Len() == 0 {
		return out
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("failed to decode response body %q: %v", w.Body.String(), err)
	}
	return out
}

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------

func TestAuthHandler_Login(t *testing.T) {
	tests := []struct {
		name         string
		body         any
		loginFunc    func(ctx context.Context, username, password string) (models.UserResponse, services.TokenPair, error)
		wantStatus   int
		wantBodyKeys []string
	}{
		{
			name: "success",
			body: models.LoginRequest{Username: "alice", Password: "correct-password"},
			loginFunc: func(ctx context.Context, username, password string) (models.UserResponse, services.TokenPair, error) {
				return models.UserResponse{ID: "u1", Username: "alice", Email: "alice@example.com", Role: "user", ProfilePhoto: "avatar.png"},
					services.TokenPair{AccessToken: "access-tok", RefreshToken: "refresh-tok"}, nil
			},
			wantStatus:   http.StatusOK,
			wantBodyKeys: []string{"status", "access_token", "refresh_token", "user"},
		},
		{
			name: "invalid credentials",
			body: models.LoginRequest{Username: "alice", Password: "wrong-password"},
			loginFunc: func(ctx context.Context, username, password string) (models.UserResponse, services.TokenPair, error) {
				return models.UserResponse{}, services.TokenPair{}, utils.ErrInvalidCredentials
			},
			wantStatus:   http.StatusUnauthorized,
			wantBodyKeys: []string{"message"},
		},
		{
			name: "account locked",
			body: models.LoginRequest{Username: "alice", Password: "wrong-password"},
			loginFunc: func(ctx context.Context, username, password string) (models.UserResponse, services.TokenPair, error) {
				return models.UserResponse{}, services.TokenPair{}, utils.ErrAccountLocked
			},
			wantStatus:   http.StatusLocked,
			wantBodyKeys: []string{"message"},
		},
		{
			name: "unexpected service error",
			body: models.LoginRequest{Username: "alice", Password: "x"},
			loginFunc: func(ctx context.Context, username, password string) (models.UserResponse, services.TokenPair, error) {
				return models.UserResponse{}, services.TokenPair{}, context.DeadlineExceeded
			},
			wantStatus:   http.StatusInternalServerError,
			wantBodyKeys: []string{"error"},
		},
		{
			name:         "malformed JSON body",
			body:         "{not-json",
			loginFunc:    nil, // must not be called
			wantStatus:   http.StatusBadRequest,
			wantBodyKeys: []string{"error"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAuth := newMockAuthService()
			mockAuth.LoginFunc = tt.loginFunc
			// Login fires a background goroutine unconditionally on
			// success paths; give it a harmless no-op so it doesn't
			// panic on a nil func.
			mockAuth.CompleteLoginWithDeviceTrackingFunc = func(context.Context, string, string, string, string, string) {}

			h := NewAuthHandler(mockAuth, &mockInviteService{})
			c, w := newTestContext(t, http.MethodPost, "/login", tt.body)

			h.Login(c)

			if w.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body: %s)", w.Code, tt.wantStatus, w.Body.String())
			}
			got := decodeBody(t, w)
			for _, key := range tt.wantBodyKeys {
				if _, ok := got[key]; !ok {
					t.Errorf("response body missing key %q; got %v", key, got)
				}
			}

			if tt.wantStatus == http.StatusOK {
				// Confirm the device-tracking goroutine actually ran,
				// since the handler doesn't block on it.
				select {
				case <-mockAuth.deviceTrackingCalled:
				case <-time.After(time.Second):
					t.Error("CompleteLoginWithDeviceTracking was not called within 1s")
				}
			}
		})
	}
}

// ---------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------

func TestAuthHandler_Signup(t *testing.T) {
	t.Run("success without invite token", func(t *testing.T) {
		mockAuth := newMockAuthService()
		mockAuth.SignupFunc = func(ctx context.Context, username, email, password, publicKey string) (models.UserResponse, services.TokenPair, error) {
			return models.UserResponse{ID: "u1", Username: username, Email: email, Role: "user"}, services.TokenPair{}, nil
		}
		mockInvite := &mockInviteService{
			ConsumeInviteFunc: func(ctx context.Context, token string) error {
				t.Fatal("ConsumeInvite should not be called when no invite token is present")
				return nil
			},
		}

		h := NewAuthHandler(mockAuth, mockInvite)
		body := models.RegisterRequest{Username: "bob", Email: "bob@example.com", Password: "secret1", PublicKey: "pk"}
		c, w := newTestContext(t, http.MethodPost, "/signup", body)

		h.Signup(c)

		if w.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusCreated, w.Body.String())
		}
	})

	t.Run("success consumes invite token", func(t *testing.T) {
		mockAuth := newMockAuthService()
		mockAuth.SignupFunc = func(ctx context.Context, username, email, password, publicKey string) (models.UserResponse, services.TokenPair, error) {
			return models.UserResponse{ID: "u2", Username: username, Email: email, Role: "user"}, services.TokenPair{}, nil
		}
		consumed := false
		mockInvite := &mockInviteService{
			ConsumeInviteFunc: func(ctx context.Context, token string) error {
				consumed = true
				if token != "inv-123" {
					t.Errorf("ConsumeInvite token = %q, want %q", token, "inv-123")
				}
				return nil
			},
		}

		h := NewAuthHandler(mockAuth, mockInvite)
		invite := "inv-123"
		body := models.RegisterRequest{Username: "carol", Email: "carol@example.com", Password: "secret1", PublicKey: "pk", InviteToken: &invite}
		c, w := newTestContext(t, http.MethodPost, "/signup", body)

		h.Signup(c)

		if w.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusCreated, w.Body.String())
		}
		if !consumed {
			t.Error("expected ConsumeInvite to be called")
		}
	})

	t.Run("username taken", func(t *testing.T) {
		mockAuth := newMockAuthService()
		mockAuth.SignupFunc = func(ctx context.Context, username, email, password, publicKey string) (models.UserResponse, services.TokenPair, error) {
			return models.UserResponse{}, services.TokenPair{}, utils.ErrUsernameTaken
		}

		h := NewAuthHandler(mockAuth, &mockInviteService{})
		body := models.RegisterRequest{Username: "bob", Email: "bob@example.com", Password: "secret1", PublicKey: "pk"}
		c, w := newTestContext(t, http.MethodPost, "/signup", body)

		h.Signup(c)

		if w.Code != http.StatusConflict {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusConflict, w.Body.String())
		}
	})

	t.Run("malformed JSON body", func(t *testing.T) {
		h := NewAuthHandler(newMockAuthService(), &mockInviteService{})
		c, w := newTestContext(t, http.MethodPost, "/signup", "{not-json")

		h.Signup(c)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusBadRequest, w.Body.String())
		}
	})
}

// ---------------------------------------------------------------------
// VerifyEmail
// ---------------------------------------------------------------------

func TestAuthHandler_VerifyEmail(t *testing.T) {
	tests := []struct {
		name       string
		body       any
		verifyFunc func(email, otp string) error
		wantStatus int
	}{
		{
			name: "success",
			body: models.VerifyEmailRequest{Email: "a@example.com", OTP: "123456"},
			verifyFunc: func(email, otp string) error {
				return nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "invalid otp",
			body: models.VerifyEmailRequest{Email: "a@example.com", OTP: "000000"},
			verifyFunc: func(email, otp string) error {
				return services.ErrInvalidOTP
			},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "unexpected error",
			body: models.VerifyEmailRequest{Email: "a@example.com", OTP: "123456"},
			verifyFunc: func(email, otp string) error {
				return context.DeadlineExceeded
			},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name:       "malformed JSON body",
			body:       "{not-json",
			verifyFunc: nil,
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAuth := newMockAuthService()
			mockAuth.VerifyEmailOTPFunc = tt.verifyFunc

			h := NewAuthHandler(mockAuth, &mockInviteService{})
			c, w := newTestContext(t, http.MethodPost, "/verify-email", tt.body)

			h.VerifyEmail(c)

			if w.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body: %s)", w.Code, tt.wantStatus, w.Body.String())
			}
		})
	}
}

// ---------------------------------------------------------------------
// ResendVerification
// ---------------------------------------------------------------------

func TestAuthHandler_ResendVerification(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		mockAuth := newMockAuthService()
		mockAuth.SendVerificationOTPFunc = func(email string) error { return nil }

		h := NewAuthHandler(mockAuth, &mockInviteService{})
		c, w := newTestContext(t, http.MethodPost, "/resend-verification", models.ResendVerificationRequest{Email: "a@example.com"})

		h.ResendVerification(c)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusOK, w.Body.String())
		}
	})

	t.Run("service error", func(t *testing.T) {
		mockAuth := newMockAuthService()
		mockAuth.SendVerificationOTPFunc = func(email string) error { return context.DeadlineExceeded }

		h := NewAuthHandler(mockAuth, &mockInviteService{})
		c, w := newTestContext(t, http.MethodPost, "/resend-verification", models.ResendVerificationRequest{Email: "a@example.com"})

		h.ResendVerification(c)

		if w.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusInternalServerError, w.Body.String())
		}
	})
}

// ---------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------

func TestAuthHandler_Refresh(t *testing.T) {
	tests := []struct {
		name        string
		refreshFunc func(ctx context.Context, rawRefreshToken string) (services.TokenPair, error)
		wantStatus  int
	}{
		{
			name: "success",
			refreshFunc: func(ctx context.Context, rawRefreshToken string) (services.TokenPair, error) {
				return services.TokenPair{AccessToken: "a", RefreshToken: "r"}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "malformed refresh token",
			refreshFunc: func(ctx context.Context, rawRefreshToken string) (services.TokenPair, error) {
				return services.TokenPair{}, utils.ErrMalformedRefreshToken
			},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "invalid refresh token",
			refreshFunc: func(ctx context.Context, rawRefreshToken string) (services.TokenPair, error) {
				return services.TokenPair{}, utils.ErrInvalidRefreshToken
			},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "revoked refresh token",
			refreshFunc: func(ctx context.Context, rawRefreshToken string) (services.TokenPair, error) {
				return services.TokenPair{}, utils.ErrRefreshTokenRevoked
			},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "user no longer exists",
			refreshFunc: func(ctx context.Context, rawRefreshToken string) (services.TokenPair, error) {
				return services.TokenPair{}, utils.ErrUserNotFound
			},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "unexpected error",
			refreshFunc: func(ctx context.Context, rawRefreshToken string) (services.TokenPair, error) {
				return services.TokenPair{}, context.DeadlineExceeded
			},
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAuth := newMockAuthService()
			mockAuth.RefreshFunc = tt.refreshFunc

			h := NewAuthHandler(mockAuth, &mockInviteService{})
			c, w := newTestContext(t, http.MethodPost, "/refresh", models.RefreshRequest{RefreshToken: "some-token"})

			h.Refresh(c)

			if w.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body: %s)", w.Code, tt.wantStatus, w.Body.String())
			}
		})
	}

	t.Run("malformed JSON body", func(t *testing.T) {
		h := NewAuthHandler(newMockAuthService(), &mockInviteService{})
		c, w := newTestContext(t, http.MethodPost, "/refresh", "{not-json")

		h.Refresh(c)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusBadRequest, w.Body.String())
		}
	})
}

// ---------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------

func TestAuthHandler_Logout(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		mockAuth := newMockAuthService()
		mockAuth.LogoutFunc = func(ctx context.Context, refreshToken string) error { return nil }

		h := NewAuthHandler(mockAuth, &mockInviteService{})
		c, w := newTestContext(t, http.MethodPost, "/logout", models.RefreshRequest{RefreshToken: "tok"})

		h.Logout(c)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusOK, w.Body.String())
		}
	})

	t.Run("service error", func(t *testing.T) {
		mockAuth := newMockAuthService()
		mockAuth.LogoutFunc = func(ctx context.Context, refreshToken string) error { return context.DeadlineExceeded }

		h := NewAuthHandler(mockAuth, &mockInviteService{})
		c, w := newTestContext(t, http.MethodPost, "/logout", models.RefreshRequest{RefreshToken: "tok"})

		h.Logout(c)

		if w.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusInternalServerError, w.Body.String())
		}
	})

	t.Run("malformed JSON body", func(t *testing.T) {
		h := NewAuthHandler(newMockAuthService(), &mockInviteService{})
		c, w := newTestContext(t, http.MethodPost, "/logout", "{not-json")

		h.Logout(c)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusBadRequest, w.Body.String())
		}
	})
}

// ---------------------------------------------------------------------
// ForgotPassword / ResetPassword
//
// ASSUMPTION: models.ForgotPasswordRequest / models.ResetPasswordRequest
// were not in the files shared with me. I'm assuming:
//
//	type ForgotPasswordRequest struct { Email string `json:"email"` }
//	type ResetPasswordRequest struct {
//	    Token       string `json:"token"`
//	    NewPassword string `json:"new_password"`
//	}
//
// Update the field names below (and the JSON literals for the malformed
// tests, if needed) to match your actual struct definitions.
// ---------------------------------------------------------------------

func TestAuthHandler_ForgotPassword(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		mockAuth := newMockAuthService()
		mockAuth.ForgotPasswordFunc = func(ctx context.Context, email string) error { return nil }

		h := NewAuthHandler(mockAuth, &mockInviteService{})
		c, w := newTestContext(t, http.MethodPost, "/forgot-password", models.ForgotPasswordRequest{Email: "a@example.com"})

		h.ForgotPassword(c)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusOK, w.Body.String())
		}
	})

	t.Run("service error", func(t *testing.T) {
		mockAuth := newMockAuthService()
		mockAuth.ForgotPasswordFunc = func(ctx context.Context, email string) error { return context.DeadlineExceeded }

		h := NewAuthHandler(mockAuth, &mockInviteService{})
		c, w := newTestContext(t, http.MethodPost, "/forgot-password", models.ForgotPasswordRequest{Email: "a@example.com"})

		h.ForgotPassword(c)

		if w.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusInternalServerError, w.Body.String())
		}
	})
}

func TestAuthHandler_ResetPassword(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		mockAuth := newMockAuthService()
		mockAuth.ResetPasswordFunc = func(ctx context.Context, rawToken, newPassword string) error { return nil }

		h := NewAuthHandler(mockAuth, &mockInviteService{})
		c, w := newTestContext(t, http.MethodPost, "/reset-password", models.ResetPasswordRequest{Token: "tok", NewPassword: "newpass1"})

		h.ResetPassword(c)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusOK, w.Body.String())
		}
	})

	t.Run("invalid or expired token", func(t *testing.T) {
		mockAuth := newMockAuthService()
		mockAuth.ResetPasswordFunc = func(ctx context.Context, rawToken, newPassword string) error {
			return services.ErrInvalidResetToken
		}

		h := NewAuthHandler(mockAuth, &mockInviteService{})
		c, w := newTestContext(t, http.MethodPost, "/reset-password", models.ResetPasswordRequest{Token: "bad", NewPassword: "newpass1"})

		h.ResetPassword(c)

		if w.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusUnauthorized, w.Body.String())
		}
	})

	t.Run("unexpected error", func(t *testing.T) {
		mockAuth := newMockAuthService()
		mockAuth.ResetPasswordFunc = func(ctx context.Context, rawToken, newPassword string) error {
			return context.DeadlineExceeded
		}

		h := NewAuthHandler(mockAuth, &mockInviteService{})
		c, w := newTestContext(t, http.MethodPost, "/reset-password", models.ResetPasswordRequest{Token: "tok", NewPassword: "newpass1"})

		h.ResetPassword(c)

		if w.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusInternalServerError, w.Body.String())
		}
	})
}
