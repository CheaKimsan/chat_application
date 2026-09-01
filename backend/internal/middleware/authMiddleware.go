package middleware

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"net/http"
	"strings"
)

func AuthMiddleware(jwtSecret []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		var tokenString string

		if header := c.GetHeader("Authorization"); header != "" {
			parts := strings.SplitN(header, " ", 2)
			if len(parts) != 2 || parts[0] != "Bearer" {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "invalid authorization header format"})
				return
			}
			tokenString = parts[1]
		} else if q := c.Query("token"); q != "" {
			tokenString = q
		} else {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "authorization required"})
			return
		}

		claims := jwt.MapClaims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return jwtSecret, nil
		})
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "invalid or expired token"})
			return
		}

		c.Set("claims", claims)
		c.Next()
	}
}

// CallerFromContext pulls the id/role of the authenticated caller out of
func CallerFromContext(c *gin.Context) (id string, role string) {
	claims := c.MustGet("claims").(jwt.MapClaims)
	id, _ = claims["id"].(string)
	role, _ = claims["role"].(string)
	return id, role
}

//func rateLimit(next http.Handler, rps, burst int) http.Handler {
//	clients := make(map[string]*rate.Limiter)
//	var mu sync.Mutex
//
//	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
//		ip := realip.FromRequest(r)
//
//		mu.Lock()
//		limiter, ok := clients[ip]
//		if !ok {
//			limiter = rate.NewLimiter(rate.Limit(rps), burst)
//			clients[ip] = limiter
//		}
//		mu.Unlock()
//
//		if !limiter.Allow() {
//			http.Error(w, "too many requests", http.StatusTooManyRequests)
//			return
//		}
//
//		next.ServeHTTP(w, r)
//	})
//}
