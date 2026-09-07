package repository

import (
	"context"
	"database/sql"

	"golang-jwt-project/internal/models"
)

type CallHistoryRepository struct{ db *sql.DB }

func NewCallHistoryRepository(db *sql.DB) *CallHistoryRepository {
	return &CallHistoryRepository{db: db}
}

func (r *CallHistoryRepository) Create(ctx context.Context, fromUser string, req models.CreateCallHistoryRequest) (models.CallHistory, error) {
	var record models.CallHistory
	err := r.db.QueryRowContext(ctx, `INSERT INTO call_history
		(call_id, from_user, to_user, mode, status, duration_seconds)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, call_id, from_user, to_user, mode, status, duration_seconds, created_at`,
		req.CallID, fromUser, req.ToUser, req.Mode, req.Status, req.DurationSeconds,
	).Scan(&record.ID, &record.CallID, &record.FromUser, &record.ToUser, &record.Mode, &record.Status, &record.DurationSeconds, &record.CreatedAt)
	return record, err
}

func (r *CallHistoryRepository) List(ctx context.Context, callerID, otherID string) ([]models.CallHistory, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, call_id, from_user, to_user, mode, status, duration_seconds, created_at
		FROM call_history WHERE (from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1)
		ORDER BY created_at ASC`, callerID, otherID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []models.CallHistory
	for rows.Next() {
		var record models.CallHistory
		if err := rows.Scan(&record.ID, &record.CallID, &record.FromUser, &record.ToUser, &record.Mode, &record.Status, &record.DurationSeconds, &record.CreatedAt); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}
