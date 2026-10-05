DATABASE_URL="postgresql://postgres:12345@localhost:5432/postgres?sslmode=disable"

db_login:
	psql $(DATABASE_URL)

db_create_migration:
	migrate create -ext sql -dir database/migrations -seq $(name)

db_migrate:
	migrate -database $(DATABASE_URL) -path database/migrations up