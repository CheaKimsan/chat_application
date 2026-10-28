package redis

import (
	"context"
	"os"

	"github.com/redis/go-redis/v9"
)

var Client *redis.Client

func Init() {
	Client = redis.NewClient(&redis.Options{
		Addr:     os.Getenv("REDIS_ADDR"),
		Password: os.Getenv("REDIS_PASSWORD"),
		DB:       0,
	})
}

func Close() error {
	return Client.Close()
}

func Ping(ctx context.Context) error {
	return Client.Ping(ctx).Err()
}
