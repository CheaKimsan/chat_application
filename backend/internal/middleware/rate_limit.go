package middleware

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

type RateLimiter struct {
	redis         *redis.Client
	limit         int
	window        time.Duration
	KeyPrefix     string
	MaxViolations int
	BanDuration   time.Duration
}

func NewRateLimiter(
	rdb *redis.Client,
	limit int,
	window time.Duration,
) *RateLimiter {
	return &RateLimiter{
		redis:         rdb,
		limit:         limit,
		window:        window,
		MaxViolations: 10,
		KeyPrefix:     "rate_limit",
		BanDuration:   3 * time.Minute,
	}
}

// Each request is processed atomically by Redis.
var rateLimitScript = redis.NewScript(`
	local banKey = KEYS[1]
	local countKey = KEYS[2]
	local violationsKey = KEYS[3]

	local limit = tonumber(ARGV[1])
	local windowSeconds = tonumber(ARGV[2])
	local maxViolations = tonumber(ARGV[3])
	local banSeconds = tonumber(ARGV[4])

	-- Reject an IP that is already banned.
	local banTTL = redis.call("TTL", banKey)
	if banTTL > 0 or redis.call("EXISTS", banKey) == 1 then
		return {-1, math.max(banTTL, 1)}
	end

	-- Increment the request counter.
	local count = redis.call("INCR", countKey)

	if count == 1 then
		redis.call("EXPIRE", countKey, windowSeconds)
	end

	if count > limit then
		-- Every rejected request adds a violation.
		local violations = redis.call("INCR", violationsKey)

		if violations >= maxViolations then
			redis.call("SET", banKey, "1", "EX", banSeconds)
			redis.call("DEL", violationsKey)

			-- Preserve existing behavior: this request receives 429.
			return {0, 1}
		end

		return {0, 1}
	end

	-- Forgive one previous violation after an allowed request.
	local violations = tonumber(redis.call("GET", violationsKey) or "0")
	if violations > 0 then
		redis.call("DECR", violationsKey)
		if violations == 1 then
			redis.call("DEL", violationsKey)
		end
	end

	return {1, 0}
`)

// IsBanned reports whether an IP currently has an active Redis ban.
func (rl *RateLimiter) IsBanned(ip string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err := rl.redis.Exists(ctx, rl.banKey(ip)).Err()
	if err != nil {
		return false
	}

	return rl.redis.Exists(ctx, rl.banKey(ip)).Val() > 0
}

func (rl *RateLimiter) banKey(ip string) string {
	return rl.KeyPrefix + ":{" + ip + "}:ban"
}

func (rl *RateLimiter) countKey(ip string) string {
	return rl.KeyPrefix + ":{" + ip + "}:count"
}

func (rl *RateLimiter) violationsKey(ip string) string {
	return rl.KeyPrefix + ":{" + ip + "}:violations"
}

func (rl *RateLimiter) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if rl.limit <= 0 || rl.window < time.Second ||
			rl.MaxViolations <= 0 || rl.BanDuration < time.Second {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"error": "rate limiter is misconfigured",
			})
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()

		ip := c.ClientIP()
		windowSeconds := int(rl.window / time.Second)
		banSeconds := int(rl.BanDuration / time.Second)

		result, err := rateLimitScript.Run(
			ctx,
			rl.redis,
			[]string{
				rl.banKey(ip),
				rl.countKey(ip),
				rl.violationsKey(ip),
			},
			rl.limit,
			windowSeconds,
			rl.MaxViolations,
			banSeconds,
		).Int64Slice()

		if err != nil || len(result) != 2 {
			// Fail closed if Redis is unavailable.
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": "rate limiting service unavailable",
			})
			return
		}

		switch result[0] {
		case -1:
			c.Header("Retry-After", strconv.FormatInt(result[1], 10))
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "temporarily blocked due to repeated abuse",
			})
			return

		case 0:
			c.Header("Retry-After", "1")
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "too many requests, please try again later",
			})
			return

		default:
			c.Next()
		}
	}
}
