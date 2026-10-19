package monitor

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

// Config holds the sampling settings and your capacity limits.
// A limit of 0 means "unknown": that metric is shown but never alerts.
// Find real limits with a load test, then set them here.
type Config struct {
	Interval      time.Duration // how often to sample (default 10s)
	History       int           // samples kept in memory (default 360, one hour at 10s)
	WarnRatio     float64       // warn at this fraction of a limit (default 0.8)
	MaxOnline     int           // most users you can serve at once
	MaxInFlight   int           // most simultaneous HTTP requests
	MaxGoroutines int           // goroutine ceiling
}

func (c *Config) applyDefaults() {
	if c.Interval <= 0 {
		c.Interval = 10 * time.Second
	}
	if c.History <= 0 {
		c.History = 360
	}
	if c.WarnRatio <= 0 || c.WarnRatio >= 1 {
		c.WarnRatio = 0.8
	}
}

// Sample is one reading of the server's load.
type Sample struct {
	At         time.Time
	Online     int
	InFlight   int64
	DBInUse    int
	DBOpen     int
	DBMax      int
	Goroutines int
	MemMB      uint64
}

type limit struct {
	key   string
	name  string
	value int
	max   int
}

type Monitor struct {
	cfg     Config
	online  func() int
	dbStats func() sql.DBStats
	Alerter *Alerter
	started time.Time

	inflight     atomic.Int64
	peakInFlight atomic.Int64
	peakOnline   atomic.Int64

	mu      sync.RWMutex
	samples []Sample

	active map[string]bool // only touched by the Run goroutine
}

// New creates a Monitor.
//
//	online  - number of connected users (for example pool.Count). May be nil.
//	dbStats - database pool statistics (for example db.Stats). May be nil.
//	send    - where alerts go (for example telegram.SendAsync). May be nil.
func New(cfg Config, online func() int, dbStats func() sql.DBStats, send func(string)) *Monitor {
	cfg.applyDefaults()
	return &Monitor{
		cfg:     cfg,
		online:  online,
		dbStats: dbStats,
		Alerter: NewAlerter(send),
		started: time.Now(),
		active:  map[string]bool{},
	}
}

// Run samples the server until ctx is cancelled. Start it with `go mon.Run(ctx)`.
func (m *Monitor) Run(ctx context.Context) {
	ticker := time.NewTicker(m.cfg.Interval)
	defer ticker.Stop()
	for {
		m.tick()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (m *Monitor) tick() {
	s := m.sample()

	m.mu.Lock()
	m.samples = append(m.samples, s)
	if len(m.samples) > m.cfg.History {
		copy(m.samples, m.samples[1:])
		m.samples = m.samples[:len(m.samples)-1]
	}
	m.mu.Unlock()

	storeMax(&m.peakOnline, int64(s.Online))
	m.check(s)
}

func (m *Monitor) sample() Sample {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	s := Sample{
		At:         time.Now(),
		InFlight:   m.inflight.Load(),
		Goroutines: runtime.NumGoroutine(),
		MemMB:      mem.Alloc / 1024 / 1024,
	}
	if m.online != nil {
		s.Online = m.online()
	}
	if m.dbStats != nil {
		st := m.dbStats()
		s.DBInUse = st.InUse
		s.DBOpen = st.OpenConnections
		s.DBMax = st.MaxOpenConnections // 0 means unlimited
	}
	return s
}

func (m *Monitor) limits(s Sample) []limit {
	return []limit{
		{"online", "Users online", s.Online, m.cfg.MaxOnline},
		{"inflight", "Requests in flight", int(s.InFlight), m.cfg.MaxInFlight},
		{"goroutines", "Goroutines", s.Goroutines, m.cfg.MaxGoroutines},
		{"db", "DB connections in use", s.DBInUse, s.DBMax},
	}
}

// check raises capacity alerts and a recovery notice when load drops again.
func (m *Monitor) check(s Sample) {
	for _, l := range m.limits(s) {
		if l.max <= 0 {
			continue
		}
		ratio := float64(l.value) / float64(l.max)
		warnKey := "capacity:" + l.key + ":warn"
		critKey := "capacity:" + l.key + ":crit"
		detail := fmt.Sprintf("%d of %d (%.0f%%)", l.value, l.max, ratio*100)

		switch {
		case ratio >= 1:
			m.active[l.key] = true
			m.Alerter.Alert(Critical, critKey, l.name+" at its limit", detail)
		case ratio >= m.cfg.WarnRatio:
			m.active[l.key] = true
			m.Alerter.Alert(Warning, warnKey, l.name+" is high", detail)
		case m.active[l.key] && ratio < m.cfg.WarnRatio*0.9:
			m.active[l.key] = false
			m.Alerter.Recovered(l.name+" back to normal", detail, warnKey, critKey)
		}
	}
}

// Latest returns the most recent stored sample.
func (m *Monitor) Latest() (Sample, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.samples) == 0 {
		return Sample{}, false
	}
	return m.samples[len(m.samples)-1], true
}

// PeakIn returns the highest value of each metric over the last window, and
// how many samples that covers.
func (m *Monitor) PeakIn(window time.Duration) (Sample, int) {
	cutoff := time.Now().Add(-window)
	m.mu.RLock()
	defer m.mu.RUnlock()

	var p Sample
	n := 0
	for _, s := range m.samples {
		if s.At.Before(cutoff) {
			continue
		}
		n++
		if s.Online > p.Online {
			p.Online = s.Online
		}
		if s.InFlight > p.InFlight {
			p.InFlight = s.InFlight
		}
		if s.DBInUse > p.DBInUse {
			p.DBInUse = s.DBInUse
		}
		if s.Goroutines > p.Goroutines {
			p.Goroutines = s.Goroutines
		}
		if s.MemMB > p.MemMB {
			p.MemMB = s.MemMB
		}
	}
	return p, n
}

// Uptime reports how long the monitor (and so the server) has been running.
func (m *Monitor) Uptime() time.Duration { return time.Since(m.started) }

// Middleware counts requests in flight and alerts on 5xx responses.
// Register it once: router.Use(mon.Middleware()).
//
// WebSocket upgrades are not counted, because they stay "in flight" for as
// long as the connection lives, which would make the number meaningless.
func (m *Monitor) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.EqualFold(c.GetHeader("Upgrade"), "websocket") {
			c.Next()
			return
		}

		n := m.inflight.Add(1)
		storeMax(&m.peakInFlight, n)
		defer m.inflight.Add(-1)

		c.Next()

		if status := c.Writer.Status(); status >= 500 {
			// FullPath is the route pattern (/api/v1/users/:id). It never
			// contains query strings, so tokens in URLs cannot leak.
			route := c.Request.Method + " " + c.FullPath()
			m.Alerter.Alert(Warning, "http5xx:"+route, "Server error",
				fmt.Sprintf("%s returned %d", route, status))
		}
	}
}

// Recovery catches panics in handlers, alerts, and answers 500 so one bad
// request can't take the server down. Register it before other middleware:
// router.Use(mon.Recovery(), mon.Middleware()).
func (m *Monitor) Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				route := c.Request.Method + " " + c.FullPath()
				log.Printf("panic in %s: %v\n%s", route, r, debug.Stack())
				m.Alerter.Alert(Critical, "panic:"+route, "Panic in handler",
					fmt.Sprintf("%s\n%v", route, r))
				c.AbortWithStatus(http.StatusInternalServerError)
			}
		}()
		c.Next()
	}
}

func storeMax(v *atomic.Int64, n int64) {
	for {
		cur := v.Load()
		if n <= cur || v.CompareAndSwap(cur, n) {
			return
		}
	}
}