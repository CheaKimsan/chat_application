# Chat Application

A full-stack chat application with a Go API, a React web client, PostgreSQL, and MinIO object storage. The app includes account authentication, real-time messaging, file uploads, a chatbot, and a shop with an AI assistant.

## Technology

- **Backend:** Go, Gin, PostgreSQL, JWT, WebSockets
- **Frontend:** React, TypeScript, React Router
- **Storage:** MinIO
- **Optional integrations:** Gemini AI, SMTP email, and Telegram

## Requirements

- Go version specified in [`backend/go.mod`](./backend/go.mod)
- Node.js and npm
- Docker Desktop with Docker Compose
- The `golang-migrate` CLI to apply database migrations

## Local setup

### 1. Configure the backend

Create `backend/.env` and set the following values:

```env
DB_NAME=chat_application
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=replace-with-a-local-password

JWT_SECRET=replace-with-a-long-random-secret
JWT_REFRESH_SECRET=replace-with-another-long-random-secret
AES_KEY=replace-with-base64-encoded-32-random-bytes

MINIO_ENDPOINT=localhost:9010
MINIO_ACCESS_KEY=replace-with-a-local-access-key
MINIO_SECRET_KEY=replace-with-a-local-secret-key
MINIO_BUCKET=chat-uploads
MINIO_USE_SSL=false

# Optional: configure these to enable the related integrations.
GEMINI_API_KEY=
GEMINI_MODEL=
SMTP_FROM=
SMTP_APP_PASSWORD=
SMTP_HOST=
SMTP_PORT=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_LOGIN_USER_ID=
APP_BASE_URL=http://localhost:3000
HELPER_BOT_USER_ID=
SHOP_BOT_USER_ID=
TURN_URL=
TURN_USERNAME=
TURN_PASSWORD=
```

Use unique, strong secrets for `JWT_SECRET` and `JWT_REFRESH_SECRET`. `AES_KEY` must be a base64-encoded key containing exactly 32 random bytes; the API will not start if it is missing or invalid. Do not commit `.env` files or real credentials.

### 2. Start PostgreSQL and MinIO

From the `backend` directory, start the services:

```powershell
cd backend
docker compose up -d db minio
```

The Compose configuration reads database and MinIO credentials from `backend/.env`. MinIO's API is available on port `9010`, and its console is available at `http://localhost:9001`.

### 3. Apply database migrations

From the `backend` directory, run the migrations using the `golang-migrate` CLI:

```powershell
migrate -database "postgres://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:<DB_PORT>/<DB_NAME>?sslmode=disable" -path database/migrations up
```

Replace the placeholders in the connection URL with the values from your `.env`. URL-encode special characters in the password if needed.

### 4. Run the backend

In a terminal, from the `backend` directory:

```powershell
go run ./cmd/api
```

The API listens on `http://localhost:8000`.

### 5. Run the frontend

In another terminal, from the repository root:

```powershell
cd front-end
Copy-Item .env.example .env.local
npm install
npm start
```

The frontend runs at `http://localhost:3000`. Its local environment file points to the API at `http://localhost:8000/api/v1`.

## Tests and build

Run backend tests from `backend`:

```powershell
go test ./...
```

Run frontend tests or create a production build from `front-end`:

```powershell
npm test -- --watchAll=false
npm run build
```

## Project layout

```text
backend/
  cmd/api/                 API entry point
  database/migrations/     PostgreSQL schema migrations
  internal/                API, handlers, services, storage, WebSockets, and bots
front-end/
  src/                     React application
```
