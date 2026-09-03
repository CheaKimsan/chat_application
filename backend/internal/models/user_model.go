package models

type UserResponse struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	Email        string `json:"email"`
	PasswordHash string `json:"-"`
	Role         string `json:"role"`
	ProfilePhoto string `json:"profile_photo"`
}

type UpdatePublicKeyRequest struct {
	PublicKey string `json:"public_key" binding:"required"`
}
