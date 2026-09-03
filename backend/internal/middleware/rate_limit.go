package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

type visitor struct {
	limiter     *rate.Limiter
	lastSeen    time.Time
	violations  int
	bannedUntil time.Time
}

type RateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	r        rate.Limit
	burst    int
	stop     chan struct{}

	// MaxViolations is how many rate-limit hits (429s) an IP can rack up
	// before it gets temporarily banned outright.
	MaxViolations int
	// BanDuration is how long an IP stays banned after crossing MaxViolations.
	BanDuration time.Duration
}

func NewRateLimiter(r rate.Limit, burst int) *RateLimiter {
	rl := &RateLimiter{
		visitors:      make(map[string]*visitor),
		r:             r,
		burst:         burst,
		stop:          make(chan struct{}),
		MaxViolations: 10,              // sensible default, override if needed
		BanDuration:   3 * time.Minute, // sensible default, override if needed
	}
	go rl.cleanupLoop()
	return rl
}

// Close stops the background cleanup goroutine. Call this on shutdown
// (or in tests) to avoid leaking the goroutine.
func (rl *RateLimiter) Close() {
	close(rl.stop)
}

func (rl *RateLimiter) getVisitor(ip string) *visitor {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	v, exists := rl.visitors[ip]
	if !exists {
		v = &visitor{
			limiter:  rate.NewLimiter(rl.r, rl.burst),
			lastSeen: time.Now(),
		}
		rl.visitors[ip] = v
		return v
	}
	v.lastSeen = time.Now()
	return v
}

func (rl *RateLimiter) cleanupLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			rl.mu.Lock()
			now := time.Now()
			for ip, v := range rl.visitors {
				// Remove entries that are both stale (no traffic in 3 min)
				// AND not currently banned — a banned IP must stay tracked
				// until its ban actually expires, otherwise it would reset
				// on the next cleanup pass and lose its ban.
				stale := now.Sub(v.lastSeen) > 3*time.Minute
				stillBanned := now.Before(v.bannedUntil)
				if stale && !stillBanned {
					delete(rl.visitors, ip)
				}
			}
			rl.mu.Unlock()
		case <-rl.stop:
			return
		}
	}
}

// IsBanned reports whether an IP is currently under an active ban.
// Exposed mainly for tests/inspection.
func (rl *RateLimiter) IsBanned(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	v, exists := rl.visitors[ip]
	if !exists {
		return false
	}
	return time.Now().Before(v.bannedUntil)
}

func (rl *RateLimiter) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		v := rl.getVisitor(ip)

		rl.mu.Lock()

		// Already banned — reject immediately, don't even touch the limiter.
		if time.Now().Before(v.bannedUntil) {
			retryAfter := int(time.Until(v.bannedUntil).Seconds())
			rl.mu.Unlock()
			c.Header("Retry-After", strconv.Itoa(retryAfter))
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "temporarily blocked due to repeated abuse",
			})
			return
		}

		allowed := v.limiter.Allow()
		if !allowed {
			v.violations++
			if v.violations >= rl.MaxViolations {
				v.bannedUntil = time.Now().Add(rl.BanDuration)
				v.violations = 0 // reset strikes once a ban is issued
			}
		} else {
			// Optional: let good behavior slowly forgive past violations
			// instead of leaving them at a permanently elevated count.
			if v.violations > 0 {
				v.violations--
			}
		}

		rl.mu.Unlock()

		if !allowed {
			c.Header("Retry-After", "1")
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "too many requests, please try again later",
			})
			return
		}

		c.Next()
	}
}

func (rl *RateLimiter) getLimiter(ip string) *rate.Limiter {
	return rl.getVisitor(ip).limiter
}
