-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(320) NOT NULL UNIQUE,
    hashed_password VARCHAR(96) NOT NULL, -- bcrypt password base64 encoded
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    hashed_token VARCHAR(500) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '1 day',
    PRIMARY KEY (user_id, hashed_token)
);

CREATE TABLE IF NOT EXISTS reports (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    report_type VARCHAR NOT NULL,
    output_file_path VARCHAR,
    download_url VARCHAR,
    download_url_expires_at TIMESTAMPTZ,
    error_message VARCHAR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, id)
);