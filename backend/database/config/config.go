package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type ENV string

const (
	Env_Test ENV = "test"
	Env_Dev  ENV = "dev"
)

type Config struct {
	DatabaseName     string `env:"DB_NAME"`
	DatabaseHost     string `env:"DB_HOST"`
	DatabasePort     string `env:"DB_PORT"`
	DatabaseUser     string `env:"DB_USER"`
	DatabasePassword string `env:"DB_PASSWORD"`
	Env              ENV    `env:"ENV" envDefault:"dev"`
	ProjectRoot      string `env:"PROJECT_ROOT"`
	JWTSecret        string `env:"JWT_SECRET"`
	JWTRefreshSecret string `env:"JWT_REFRESH_SECRET"` // add this
}

func findEnvFile() string {
	dir, err := os.Getwd()
	if err != nil {
		return ".env"
	}

	for {
		candidate := filepath.Join(dir, ".env")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return ".env"
		}
		dir = parent
	}
}

func New() (*Config, error) {
	_ = godotenv.Load(findEnvFile())

	conf, err := env.ParseAs[Config]()
	if err != nil {
		return nil, fmt.Errorf("failed to load config : %w", err)
	}
	if conf.ProjectRoot == "" {
		conf.ProjectRoot = filepath.Dir(findEnvFile())
	}

	return &conf, nil
}

func (c *Config) DatabaseUrl() string {
	return fmt.Sprintf(
		"postgresql://%s:%s@%s:%s/%s?sslmode=disable",
		c.DatabaseUser,
		c.DatabasePassword,
		c.DatabaseHost,
		c.DatabasePort,
		c.DatabaseName,
	)
}
