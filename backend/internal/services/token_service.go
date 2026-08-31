package services

import (
	"fmt"
	"golang-jwt-project/internal/utils"
	"time"

	"golang-jwt-project/internal/models"

	"github.com/golang-jwt/jwt/v5"
)

const RefreshTokenTTL = 7 * 24 * time.Hour

type TokenService struct {
	jwtSecret     []byte
	refreshSecret []byte
}

func NewTokenService(jwtSecret, refreshSecret []byte) *TokenService {
	return &TokenService{jwtSecret: jwtSecret, refreshSecret: refreshSecret}
}

func (t *TokenService) GenerateAccessToken(u models.UserResponse) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"id":       u.ID,
		"username": u.Username,
		"role":     u.Role,
		//set expire access token 1d
		"exp": time.Now().Add(24 * time.Hour).Unix(),
	})
	return token.SignedString(t.jwtSecret)
}

func (t *TokenService) GenerateRefreshToken(u models.UserResponse) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"id":  u.ID,
		"exp": time.Now().Add(RefreshTokenTTL).Unix(),
	})
	return token.SignedString(t.refreshSecret)
}

// ParseRefreshToken validates the signature/expiry of a refresh token
func (t *TokenService) ParseRefreshToken(tokenString string) (jwt.MapClaims, error) {
	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(tk *jwt.Token) (interface{}, error) {
		if _, ok := tk.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", tk.Header["alg"])
		}
		return t.refreshSecret, nil
	})
	if err != nil || !token.Valid {
		return nil, utils.ErrInvalidRefreshToken
	}
	return claims, nil
}
