package models

import "time"

type RegisterRequest struct {
	Username  string `json:"username" binding:"required"`
	Password  string `json:"password" binding:"required,min=6"`
	Email     string `json:"email" binding:"required,email"`
	PublicKey string `json:"public_key" binding:"required"`
	// Role is intentionally NOT bound from the request — the server always
	// assigns a default role on signup (see services.AuthService.Signup).
	InviteToken *string `json:"invite_token"` // optional — set when signing up via an invite link
}

type LoginRequest struct {
	Username string  `json:"username"`
	Password string  `json:"password"`
	Email    *string `json:"email"`
	Role     *string `json:"role"`
}

type UpdateUserRequest struct {
	Username     *string `json:"username"`
	Email        *string `json:"email"`
	Role         *string `json:"role" binding:"omitempty,oneof=admin user"`
	Password     *string `json:"password" binding:"omitempty,min=6"`
	ProfilePhoto *string `json:"profile_photo"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

type VerifyEmailRequest struct {
	Email string `json:"email" binding:"required,email"`
	OTP   string `json:"otp" binding:"required,len=6"`
}

type ResendVerificationRequest struct {
	Email string `json:"email" binding:"required,email"`
}

type SessionResponse struct {
	ID        int       `json:"id"`
	UserAgent string    `json:"user_agent"`
	IPAddress string    `json:"ip_address"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}
