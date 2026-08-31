CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_user VARCHAR(50) NOT NULL,
    to_user VARCHAR(50) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages (from_user, to_user, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_to_user
    ON messages (to_user, read_at);
