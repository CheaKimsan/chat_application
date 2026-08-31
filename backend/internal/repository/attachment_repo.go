package repository

import (
	"context"
	"database/sql"
	"golang-jwt-project/internal/ws"
)

type AttachmentRepository struct {
	db *sql.DB
}

func NewAttachmentRepository(db *sql.DB) *AttachmentRepository {
	return &AttachmentRepository{db: db}
}

func (r *AttachmentRepository) Create(ctx context.Context, messageID, attType, url, filename, mimeType string, sizeBytes int64) (ws.Attachment, error) {
	var att ws.Attachment
	err := r.db.QueryRowContext(
		ctx,
		`INSERT INTO attachments (message_id, type, url, filename, mime_type, size_bytes)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, message_id, type, url, filename, mime_type, size_bytes, created_at`,
		messageID, attType, url, filename, mimeType, sizeBytes,
	).Scan(&att.ID, &att.MessageID, &att.Type, &att.URL, &att.Filename, &att.MimeType, &att.SizeBytes, &att.CreatedAt)
	if err != nil {
		return ws.Attachment{}, err
	}
	return att, nil
}
