package store

import (
	"context"
	"fmt"
	"golang-jwt-project/database/config"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/stretchr/testify/require"
)

func TestUserStore(t *testing.T) {
	os.Setenv("ENV", string(config.Env_Test))

	conf, err := config.New()
	require.NoError(t, err)

	fmt.Println("ProjectRoot:", conf.ProjectRoot)

	migrationDir := filepath.Join(conf.ProjectRoot, "migrations")

	fmt.Println("Migration Dir:", migrationDir)

	info, err := os.Stat(migrationDir)
	require.NoError(t, err)
	require.True(t, info.IsDir())

	migrationPath := (&url.URL{
		Scheme: "file",
		Path:   filepath.ToSlash(migrationDir),
	}).String()

	fmt.Println("Migration Path:", migrationPath)

	db, err := NewPostgresDb(conf)
	require.NoError(t, err)
	defer db.Close()

	m, err := migrate.New(
		migrationPath,
		conf.DatabaseUrl(),
	)
	require.NoError(t, err)

	defer func() {
		srcErr, dbErr := m.Close()
		require.NoError(t, srcErr)
		require.NoError(t, dbErr)
	}()

	for {
		err = m.Down()
		if err == nil {
			continue
		}
		if err == migrate.ErrNoChange {
			break
		}
		require.NoError(t, err)
	}

	err = m.Up()
	if err != nil && err != migrate.ErrNoChange {
		require.NoError(t, err)
	}

	userStore := NewUserStore(db)

	user, err := userStore.CreateUser(
		context.Background(),
		"test@gmail.com",
		"testing123",
	)
	require.NoError(t, err)

	require.Equal(t, "test@gmail.com", user.Email)
	require.NoError(t, user.ComparePasswordd("testing123"))
}
