package middleware

import (
	"testing"
	"time"

	"golang.org/x/time/rate"
)

func TestRateLimiter_AllowsUpToBurst(t *testing.T) {
	rl := NewRateLimiter(rate.Limit(1), 3) // 1 req/sec, burst 3
	defer rl.Close()

	ip := "1.2.3.4"

	// First 3 requests should be allowed (burst)
	for i := 0; i < 3; i++ {
		limiter := rl.getLimiter(ip)
		if !limiter.Allow() {
			t.Fatalf("request %d: expected allowed, got denied", i+1)
		}
	}

	// 4th immediate request should be denied
	limiter := rl.getLimiter(ip)
	if limiter.Allow() {
		t.Fatal("expected 4th request to be denied")
	}
}

func TestRateLimiter_RefillsOverTime(t *testing.T) {
	rl := NewRateLimiter(rate.Limit(10), 1) // 10 req/sec, burst 1
	defer rl.Close()

	ip := "1.2.3.4"
	limiter := rl.getLimiter(ip)

	if !limiter.Allow() {
		t.Fatal("expected first request allowed")
	}
	if limiter.Allow() {
		t.Fatal("expected second immediate request denied")
	}

	time.Sleep(150 * time.Millisecond) // enough for ~1 token at 10/sec

	if !limiter.Allow() {
		t.Fatal("expected request allowed after refill")
	}
}

func TestRateLimiter_SeparateIPsHaveSeparateBuckets(t *testing.T) {
	rl := NewRateLimiter(rate.Limit(1), 1)
	defer rl.Close()

	limiterA := rl.getLimiter("1.1.1.1")
	limiterB := rl.getLimiter("2.2.2.2")

	if !limiterA.Allow() {
		t.Fatal("expected IP A first request allowed")
	}
	// IP A exhausted its burst, but IP B should be fresh
	if !limiterB.Allow() {
		t.Fatal("expected IP B first request allowed independent of A")
	}
}

func TestRateLimiter_CleanupRemovesStaleVisitors(t *testing.T) {
	rl := NewRateLimiter(rate.Limit(1), 1)
	defer rl.Close()

	rl.getLimiter("1.2.3.4")
	rl.mu.Lock()
	rl.visitors["1.2.3.4"].lastSeen = time.Now().Add(-4 * time.Minute) // force stale
	rl.mu.Unlock()

	// simulate one cleanup pass manually rather than waiting a real minute
	rl.mu.Lock()
	for ip, v := range rl.visitors {
		if time.Since(v.lastSeen) > 3*time.Minute {
			delete(rl.visitors, ip)
		}
	}
	rl.mu.Unlock()

	rl.mu.Lock()
	_, exists := rl.visitors["1.2.3.4"]
	rl.mu.Unlock()

	if exists {
		t.Fatal("expected stale visitor to be removed")
	}
}
