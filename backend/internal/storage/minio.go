package storage

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type MinioStorage struct {
	client     *minio.Client
	bucketName string
	publicBase string
}

func NewMinioStorage(endpoint, accessKey, secretKey, bucketName string, useSSL bool) (*MinioStorage, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, err
	}

	ctx := context.Background()
	exists, err := client.BucketExists(ctx, bucketName)
	if err != nil {
		return nil, err
	}
	if !exists {
		if err := client.MakeBucket(ctx, bucketName, minio.MakeBucketOptions{}); err != nil {
			return nil, err
		}
	}

	// Make the bucket publicly readable so avatar URLs work without expiry.
	// If you'd rather keep photos private, skip this and use GetPresignedURL
	// instead of PublicURL when returning user data.
	policy := fmt.Sprintf(`{
		"Version": "2012-10-17",
		"Statement": [{
			"Effect": "Allow",
			"Principal": {"AWS": ["*"]},
			"Action": ["s3:GetObject"],
			"Resource": ["arn:aws:s3:::%s/*"]
		}]
	}`, bucketName)
	if err := client.SetBucketPolicy(ctx, bucketName, policy); err != nil {
		return nil, err
	}

	scheme := "http"
	if useSSL {
		scheme = "https"
	}

	return &MinioStorage{
		client:     client,
		bucketName: bucketName,
		publicBase: fmt.Sprintf("%s://%s/%s", scheme, endpoint, bucketName),
	}, nil
}

func (s *MinioStorage) UploadStream(ctx context.Context, objectName string, reader io.Reader, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucketName, objectName, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	return err
}

// PublicURL returns a permanent, non-expiring URL for an object.
// Only works if the bucket policy allows public reads (see above).
func (s *MinioStorage) PublicURL(objectName string) string {
	return s.publicBase + "/" + objectName
}

func (s *MinioStorage) GetPresignedURL(ctx context.Context, objectName string, expiry time.Duration) (string, error) {
	url, err := s.client.PresignedGetObject(ctx, s.bucketName, objectName, expiry, nil)
	if err != nil {
		return "", err
	}
	return url.String(), nil
}

func (s *MinioStorage) Delete(ctx context.Context, objectName string) error {
	return s.client.RemoveObject(ctx, s.bucketName, objectName, minio.RemoveObjectOptions{})
}
