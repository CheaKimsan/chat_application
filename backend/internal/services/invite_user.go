package services

import (
	"context"
	"errors"
	"fmt"
	"net/smtp"
	"time"

	"golang-jwt-project/internal/repository"
)

const inviteTokenTTL = 7 * 24 * time.Hour // invites last longer than password resets

var (
	ErrInviteEmailAlreadyRegistered = errors.New("that email is already registered")
	ErrInvalidInviteToken           = errors.New("invalid or expired invite")
)

type InviteService struct {
	users         *repository.UserRepository
	invites       *repository.InviteRepository
	emailFrom     string
	emailPassword string
	smtpHost      string
	smtpPort      string
}

func NewInviteService(
	users *repository.UserRepository,
	invites *repository.InviteRepository,
	emailFrom, emailPassword, smtpHost, smtpPort string,
) *InviteService {
	return &InviteService{
		users:         users,
		invites:       invites,
		emailFrom:     emailFrom,
		emailPassword: emailPassword,
		smtpHost:      smtpHost,
		smtpPort:      smtpPort,
	}
}

func (s *InviteService) SendInvite(ctx context.Context, inviterID, email string) error {
	existing, err := s.users.GetByEmail(ctx, email)
	if err != nil {
		return err
	}
	if existing != nil {
		return ErrInviteEmailAlreadyRegistered
	}

	rawToken, err := repository.GenerateRawToken()
	if err != nil {
		return err
	}

	if err := s.invites.Create(ctx, inviterID, email, rawToken, time.Now().Add(inviteTokenTTL)); err != nil {
		return err
	}

	return s.sendInviteEmail(email, rawToken)
}

// ValidateInvite is used by the signup page to check a token before
// showing the form (and to prefill/lock the email field). It does NOT
// mark the token used — that happens once signup actually completes.
func (s *InviteService) ValidateInvite(ctx context.Context, rawToken string) (email string, err error) {
	email, ok, err := s.invites.Validate(ctx, rawToken)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", ErrInvalidInviteToken
	}
	return email, nil
}

// ConsumeInvite marks the invite used. Call this after Signup succeeds
// for an invited email, so the same invite link can't be reused.
func (s *InviteService) ConsumeInvite(ctx context.Context, rawToken string) error {
	return s.invites.MarkUsed(ctx, rawToken)
}

func (s *InviteService) sendInviteEmail(email, rawToken string) error {
	signupLink := fmt.Sprintf("http://localhost:3000/register?invite=%s", rawToken)
	subject := "Subject: You've been invited\n"
	body := fmt.Sprintf("You've been invited to join. Click the link to create your account: %s\nThis invite expires in 7 days.", signupLink)
	msg := []byte(subject + "\n" + body)

	auth := smtp.PlainAuth("", s.emailFrom, s.emailPassword, s.smtpHost)
	return smtp.SendMail(s.smtpHost+":"+s.smtpPort, auth, s.emailFrom, []string{email}, msg)
}
