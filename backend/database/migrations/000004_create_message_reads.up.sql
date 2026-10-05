CREATE TABLE IF NOT EXISTS message_reads (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reads_user
    ON message_reads (user_id, read_at);