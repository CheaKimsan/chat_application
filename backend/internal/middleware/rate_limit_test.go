package middleware

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// --- helpers ---------------------------------------------------------------

func newTestLimiter(t *testing.T, limit int, window time.Duration) (*RateLimiter, *miniredis.Miniredis) {
	t.Helper()

	mr := miniredis.RunT(t) // in-memory Redis, closed automatically
	rdb := redis.NewClient(&redis.Options{
		Addr:       mr.Addr(),
		MaxRetries: -1, // fail fast in the "redis down" test
	})
	t.Cleanup(func() { _ = rdb.Close() })

	return NewRateLimiter(rdb, limit, window), mr
}

func newRouter(rl *RateLimiter) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(rl.Middleware())
	r.GET("/", func(c *gin.Context) { c.Status(http.StatusOK) })
	return r
}

// doRequest sends one request that appears to come from ip.
func doRequest(r http.Handler, ip string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = ip + ":12345"
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func expectStatus(t *testing.T, w *httptest.ResponseRecorder, want int, msg string) {
	t.Helper()
	if w.Code != want {
		t.Fatalf("%s: expected status %d, got %d", msg, want, w.Code)
	}
}

// --- tests -----------------------------------------------------------------

func TestRateLimiter_AllowsUpToLimit(t *testing.T) {
	rl, _ := newTestLimiter(t, 3, time.Minute)
	r := newRouter(rl)
	ip := "1.2.3.4"

	for i := 1; i <= 3; i++ {
		expectStatus(t, doRequest(r, ip), http.StatusOK, "request "+strconv.Itoa(i))
	}

	w := doRequest(r, ip)
	expectStatus(t, w, http.StatusTooManyRequests, "4th request")
	if w.Header().Get("Retry-After") == "" {
		t.Fatal("expected Retry-After header on 429")
	}
}

func TestRateLimiter_WindowResets(t *testing.T) {
	rl, mr := newTestLimiter(t, 1, 10*time.Second)
	r := newRouter(rl)
	ip := "1.2.3.4"

	expectStatus(t, doRequest(r, ip), http.StatusOK, "first request")
	expectStatus(t, doRequest(r, ip), http.StatusTooManyRequests, "second request")

	// miniredis does not use real time: advance its clock instead of sleeping.
	mr.FastForward(11 * time.Second)

	expectStatus(t, doRequest(r, ip), http.StatusOK, "request after window reset")
}

func TestRateLimiter_SeparateIPsHaveSeparateCounters(t *testing.T) {
	rl, _ := newTestLimiter(t, 1, time.Minute)
	r := newRouter(rl)

	expectStatus(t, doRequest(r, "1.1.1.1"), http.StatusOK, "IP A first request")
	expectStatus(t, doRequest(r, "1.1.1.1"), http.StatusTooManyRequests, "IP A second request")
	expectStatus(t, doRequest(r, "2.2.2.2"), http.StatusOK, "IP B should be unaffected by A")
}

func TestRateLimiter_BansAfterMaxViolations(t *testing.T) {
	rl, _ := newTestLimiter(t, 1, time.Minute)
	rl.MaxViolations = 3
	r := newRouter(rl)
	ip := "1.2.3.4"

	expectStatus(t, doRequest(r, ip), http.StatusOK, "first request")

	// Three rejected requests = three violations. The third triggers the ban
	// but still returns 429 itself.
	for i := 1; i <= 3; i++ {
		expectStatus(t, doRequest(r, ip), http.StatusTooManyRequests, "violation "+strconv.Itoa(i))
	}

	if !rl.IsBanned(ip) {
		t.Fatal("expected IP to be banned after MaxViolations")
	}

	w := doRequest(r, ip)
	expectStatus(t, w, http.StatusForbidden, "request while banned")
	retry, err := strconv.Atoi(w.Header().Get("Retry-After"))
	if err != nil || retry <= 0 {
		t.Fatalf("expected positive Retry-After on 403, got %q", w.Header().Get("Retry-After"))
	}

	// Other IPs are not affected.
	expectStatus(t, doRequest(r, "9.9.9.9"), http.StatusOK, "other IP during ban")
}

func TestRateLimiter_BanExpires(t *testing.T) {
	rl, mr := newTestLimiter(t, 1, time.Minute)
	rl.MaxViolations = 2
	r := newRouter(rl)
	ip := "1.2.3.4"

	doRequest(r, ip) // allowed
	doRequest(r, ip) // violation 1
	doRequest(r, ip) // violation 2 -> ban
	expectStatus(t, doRequest(r, ip), http.StatusForbidden, "request while banned")

	// Past both the ban and the rate-limit window.
	mr.FastForward(rl.BanDuration + time.Second)

	if rl.IsBanned(ip) {
		t.Fatal("expected ban to have expired")
	}
	expectStatus(t, doRequest(r, ip), http.StatusOK, "request after ban expiry")
}

func TestRateLimiter_GoodBehaviorForgivesViolations(t *testing.T) {
	rl, mr := newTestLimiter(t, 1, 10*time.Second)
	r := newRouter(rl)
	ip := "1.2.3.4"

	doRequest(r, ip)                                                           // allowed
	expectStatus(t, doRequest(r, ip), http.StatusTooManyRequests, "violation") // violations = 1

	if !mr.Exists(rl.violationsKey(ip)) {
		t.Fatal("expected a violation to be recorded")
	}

	mr.FastForward(11 * time.Second) // new window
	expectStatus(t, doRequest(r, ip), http.StatusOK, "allowed request after window")

	if mr.Exists(rl.violationsKey(ip)) {
		t.Fatal("expected the violation to be forgiven after an allowed request")
	}
}

func TestRateLimiter_FailsClosedWhenRedisDown(t *testing.T) {
	rl, mr := newTestLimiter(t, 5, time.Minute)
	r := newRouter(rl)

	mr.Close()

	expectStatus(t, doRequest(r, "1.2.3.4"), http.StatusServiceUnavailable, "request with Redis down")
}

func TestRateLimiter_MisconfiguredReturns500(t *testing.T) {
	cases := map[string]func(rl *RateLimiter){
		"zero limit":        func(rl *RateLimiter) { rl.limit = 0 },
		"sub-second window": func(rl *RateLimiter) { rl.window = 500 * time.Millisecond },
		"zero violations":   func(rl *RateLimiter) { rl.MaxViolations = 0 },
		"sub-second ban":    func(rl *RateLimiter) { rl.BanDuration = 500 * time.Millisecond },
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			rl, _ := newTestLimiter(t, 5, time.Minute)
			mutate(rl)
			expectStatus(t, doRequest(newRouter(rl), "1.2.3.4"), http.StatusInternalServerError, name)
		})
	}
}
