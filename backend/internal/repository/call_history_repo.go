package repository

import (
	"context"
	"database/sql"
	"github.com/lib/pq"
	"golang-jwt-project/internal/models"
)

type CallHistoryRepository struct{ db *sql.DB }

func pqStringArray(ss []string) interface{} {
	return pq.Array(ss)
}

func NewCallHistoryRepository(db *sql.DB) *CallHistoryRepository {
	return &CallHistoryRepository{db: db}
}

func (r *CallHistoryRepository) Create(ctx context.Context, fromUser string, req models.CreateCallHistoryRequest) (models.CallHistory, error) {
	var record models.CallHistory

	isGroup := req.GroupID != ""

	if !isGroup {
		// existing 1:1 path, unchanged
		err := r.db.QueryRowContext(ctx, `INSERT INTO call_history
			(call_id, from_user, to_user, mode, status, duration_seconds)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id, call_id, from_user, to_user, mode, status, duration_seconds, created_at`,
			req.CallID, fromUser, req.ToUser, req.Mode, req.Status, req.DurationSeconds,
		).Scan(&record.ID, &record.CallID, &record.FromUser, &record.ToUser, &record.Mode, &record.Status, &record.DurationSeconds, &record.CreatedAt)
		return record, err
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return record, err
	}
	defer tx.Rollback()

	err = tx.QueryRowContext(ctx, `INSERT INTO call_history
		(call_id, from_user, to_user, group_id, mode, status, duration_seconds)
		VALUES ($1, $2, '', $3, $4, $5, $6)
		RETURNING id, call_id, from_user, to_user, group_id, mode, status, duration_seconds, created_at`,
		req.CallID, fromUser, req.GroupID, req.Mode, req.Status, req.DurationSeconds,
	).Scan(&record.ID, &record.CallID, &record.FromUser, &record.ToUser, &record.GroupID, &record.Mode, &record.Status, &record.DurationSeconds, &record.CreatedAt)
	if err != nil {
		return record, err
	}

	participants := append(req.ParticipantIDs, fromUser)
	for _, uid := range participants {
		if _, err := tx.ExecContext(ctx, `INSERT INTO call_participants (call_history_id, user_id)
			VALUES ($1, $2) ON CONFLICT DO NOTHING`, record.ID, uid); err != nil {
			return record, err
		}
	}

	record.Participants = req.ParticipantIDs
	return record, tx.Commit()
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

func (r *CallHistoryRepository) ListByGroup(ctx context.Context, groupID string) ([]models.CallHistory, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, call_id, from_user, to_user, group_id, mode, status, duration_seconds, created_at
		FROM call_history WHERE group_id = $1
		ORDER BY created_at ASC`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []models.CallHistory
	var ids []string
	byID := make(map[string]*models.CallHistory)
	for rows.Next() {
		var record models.CallHistory
		if err := rows.Scan(&record.ID, &record.CallID, &record.FromUser, &record.ToUser, &record.GroupID, &record.Mode, &record.Status, &record.DurationSeconds, &record.CreatedAt); err != nil {
			return nil, err
		}
		records = append(records, record)
		ids = append(ids, record.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range records {
		byID[records[i].ID] = &records[i]
	}

	if len(ids) == 0 {
		return records, nil
	}

	prows, err := r.db.QueryContext(ctx, `SELECT call_history_id, user_id
		FROM call_participants WHERE call_history_id = ANY($1)`, pqStringArray(ids))
	if err != nil {
		return nil, err
	}
	defer prows.Close()
	for prows.Next() {
		var callHistoryID, userID string
		if err := prows.Scan(&callHistoryID, &userID); err != nil {
			return nil, err
		}
		if rec, ok := byID[callHistoryID]; ok {
			rec.Participants = append(rec.Participants, userID)
		}
	}
	return records, prows.Err()
}
