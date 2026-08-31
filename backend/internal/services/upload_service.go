package services

import (
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"golang-jwt-project/internal/repository"
	"golang-jwt-project/internal/ws"

	"github.com/google/uuid"
)

const (
	MaxUploadSize     = 10 << 50 // per-file limit
	MaxFilesPerUpload = 10       // safety cap on how many files one request can carry
	uploadWorkers     = 4        // how many files are saved concurrently per request
	uploadDir         = "../../uploads"
	copyBufferSize    = 128 * 1024 // 256KB chunks — tune based on typical file size / memory budget
)

var allowedExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true,
	".pdf": true, ".txt": true, ".zip": false, ".mp4": true,
}

func attachmentTypeFromExt(ext string) string {
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif":
		return "image"
	case ".pdf", ".txt":
		return "file"
	case ".mp4":
		return "video"
	default:
		return "file"
	}
}

type UploadFailure struct {
	Filename string
	Err      error
}

type UploadService struct {
	attachments *repository.AttachmentRepository
}

func NewUploadService(attachments *repository.AttachmentRepository) *UploadService {
	return &UploadService{attachments: attachments}
}

func (s *UploadService) saveOne(ctx context.Context, callerID, messageID string, header *multipart.FileHeader) (ws.Attachment, error) {
	var att ws.Attachment

	if header.Size > MaxUploadSize {
		return att, fmt.Errorf("%s exceeds max size of 10MB", header.Filename)
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !allowedExts[ext] {
		return att, fmt.Errorf("%s has an unsupported file type", header.Filename)
	}

	src, err := header.Open()
	if err != nil {
		return att, fmt.Errorf("failed to open %s: %w", header.Filename, err)
	}
	defer src.Close()

	messageUploadDir := filepath.Join(uploadDir, "users", callerID, "messages", messageID)
	if err := os.MkdirAll(messageUploadDir, 0o755); err != nil {
		return att, fmt.Errorf("failed to prepare upload directory: %w", err)
	}

	filename := uuid.NewString() + ext
	destPath := filepath.Join(messageUploadDir, filename)

	dst, err := os.Create(destPath)
	if err != nil {
		return att, fmt.Errorf("failed to create destination file for %s: %w", header.Filename, err)
	}
	defer dst.Close()

	// Stream file to disk in custom-sized chunks — no manual loop needed,
	// io.CopyBuffer already does this internally, without per-chunk overhead.
	buf := make([]byte, copyBufferSize)
	written, err := io.CopyBuffer(dst, src, buf)
	if err != nil {
		_ = os.Remove(destPath)
		return att, fmt.Errorf("failed to save %s: %w", header.Filename, err)
	}

	fileURL := "http://localhost:8000/uploads/users/" + callerID + "/messages/" + messageID + "/" + filename
	attType := attachmentTypeFromExt(ext)
	mimeType := header.Header.Get("Content-Type")

	att, err = s.attachments.Create(ctx, messageID, attType, fileURL, header.Filename, mimeType, written)
	if err != nil {
		_ = os.Remove(destPath)
		return att, fmt.Errorf("failed to save attachment record for %s: %w", header.Filename, err)
	}

	return att, nil
}

type uploadJob struct {
	index  int
	header *multipart.FileHeader
}

type uploadResult struct {
	index int
	att   ws.Attachment
	err   error
	name  string
}

// SaveMany saves headers concurrently via a small worker pool and returns
// successfully saved attachments plus per-file failures, preserving the
// original file order in both slices.
func (s *UploadService) SaveMany(ctx context.Context, callerID, messageID string, headers []*multipart.FileHeader) ([]ws.Attachment, []UploadFailure) {
	jobs := make(chan uploadJob, len(headers))
	results := make(chan uploadResult, len(headers))

	var wg sync.WaitGroup

	workerCount := uploadWorkers
	if workerCount > len(headers) {
		workerCount = len(headers)
	}

	for w := 0; w < workerCount; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				att, err := s.saveOne(ctx, callerID, messageID, job.header)
				results <- uploadResult{
					index: job.index,
					att:   att,
					err:   err,
					name:  job.header.Filename,
				}
			}
		}()
	}

	for i, header := range headers {
		jobs <- uploadJob{index: i, header: header}
	}
	close(jobs)

	// Close results once all workers finish so the range below terminates.
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results indexed by original position so output order matches
	// the order files were sent, regardless of which worker finished first.
	collected := make([]*uploadResult, len(headers))
	for res := range results {
		r := res
		collected[r.index] = &r
	}

	var saved []ws.Attachment
	var failed []UploadFailure

	for _, r := range collected {
		if r == nil {
			continue
		}
		if r.err != nil {
			failed = append(failed, UploadFailure{Filename: r.name, Err: r.err})
			continue
		}
		saved = append(saved, r.att)
	}

	return saved, failed
}
