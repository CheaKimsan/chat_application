package storage

import (
	"context"
	"io"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type MinioStorage struct {
	client     *minio.Client
	bucketName string
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

	return &MinioStorage{client: client, bucketName: bucketName}, nil
}

func (s *MinioStorage) UploadStream(ctx context.Context, objectName string, reader io.Reader, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucketName, objectName, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	return err
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
