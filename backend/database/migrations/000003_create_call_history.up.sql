CREATE TABLE IF NOT EXISTS call_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id VARCHAR(100) NOT NULL,
    from_user VARCHAR(50) NOT NULL,
    to_user VARCHAR(50) NOT NULL,
    mode VARCHAR(10) NOT NULL CHECK (mode IN ('audio', 'video')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('calling', 'incoming', 'connected', 'completed', 'missed', 'rejected', 'busy', 'failed')),
    duration_seconds INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_call_history_conversation
    ON call_history (from_user, to_user, created_at);
