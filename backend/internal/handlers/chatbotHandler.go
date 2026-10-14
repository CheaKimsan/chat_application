package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"google.golang.org/genai"
	gaInteractions "google.golang.org/genai/interactions/models/interactions"
	"google.golang.org/genai/interactions/models/operations"
)

const (
	chatbotMaxAttempts      = 2
	chatbotPerAttemptTimout = 45 * time.Second
	chatbotTotalTimeout     = 100 * time.Second
)

var errChatbotEmptyReply = errors.New("chatbot returned an empty response")

type ChatbotHandler struct {
	client *genai.Client
	model  string
}

type chatbotRequest struct {
	Message string `json:"message" binding:"required"`
}

// interactionView is the part of an Interaction response we care about.
// The reply text lives in steps[type="model_output"].content[type="text"].text.
// Steps of type "thought" hold the model's internal reasoning and are ignored.
type interactionView struct {
	Steps []struct {
		Type    string `json:"type"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"steps"`
}

func NewChatbotHandler(apiKey, model string) *ChatbotHandler {
	if model == "" {
		model = "gemini-3.8-flash"
	}

	handler := &ChatbotHandler{model: model}
	if apiKey == "" {
		log.Println("chatbot: GEMINI_API_KEY is empty, chatbot disabled")
		return handler
	}

	client, err := genai.NewClient(context.Background(), &genai.ClientConfig{APIKey: apiKey})
	if err != nil {
		log.Printf("chatbot: failed to create Gemini client: %v", err)
		return handler
	}
	handler.client = client
	return handler
}

func (h *ChatbotHandler) Generate(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)

	var request chatbotRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message is required and must be valid JSON"})
		return
	}
	request.Message = strings.TrimSpace(request.Message)
	if request.Message == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message must not be empty"})
		return
	}
	if h.client == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "chatbot is not configured"})
		return
	}

	start := time.Now()
	reply, err := h.generateWithRetry(c.Request.Context(), request.Message)
	if err != nil {
		log.Printf("chatbot failed for model %q after %s: %v", h.model, time.Since(start), err)
		if errors.Is(err, errChatbotEmptyReply) {
			c.JSON(http.StatusBadGateway, gin.H{"error": "chatbot returned an empty response"})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "chatbot request failed"})
		return
	}

	log.Printf("chatbot: replied in %s", time.Since(start))
	c.JSON(http.StatusOK, gin.H{"reply": reply})
}

// generateWithRetry calls Gemini up to chatbotMaxAttempts times, retrying only
func (h *ChatbotHandler) generateWithRetry(parent context.Context, message string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, chatbotTotalTimeout)
	defer cancel()

	var lastErr error
	for attempt := 1; attempt <= chatbotMaxAttempts; attempt++ {
		reply, err := h.generateOnce(ctx, message)
		if err == nil {
			return reply, nil
		}
		lastErr = err

		if !isTransientNetworkError(err) || ctx.Err() != nil || attempt == chatbotMaxAttempts {
			break
		}

		wait := time.Duration(attempt) * time.Second
		log.Printf("chatbot: attempt %d/%d failed (%v), retrying in %s", attempt, chatbotMaxAttempts, err, wait)
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return "", lastErr
		}
	}
	return "", lastErr
}

func (h *ChatbotHandler) generateOnce(parent context.Context, message string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, chatbotPerAttemptTimout)
	defer cancel()

	prompt := "You are a helpful assistant inside a chat app. Answer clearly and concisely " +
		"(under 200 words) unless the user asks for more detail.\n\nUser: " + message

	input := gaInteractions.NewInteractionsInput(prompt)
	body := operations.NewCreateInteractionRequestBody(gaInteractions.CreateModelInteraction{
		Model: gaInteractions.Model(h.model),
		Input: &input,
	})

	response, err := h.client.Interactions.Create(ctx, operations.CreateInteractionRequest{Body: body})
	if err != nil {
		return "", err
	}
	if response == nil || response.Interaction == nil {
		return "", errChatbotEmptyReply
	}

	reply := ""
	if response.Interaction.OutputText != nil {
		reply = strings.TrimSpace(*response.Interaction.OutputText)
	}
	if reply == "" {
		reply = extractModelText(response.Interaction)
	}
	if reply == "" {
		return "", errChatbotEmptyReply
	}
	return reply, nil
}

func isTransientNetworkError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}

	msg := strings.ToLower(err.Error())
	for _, needle := range []string{
		"eof",
		"connection reset",
		"connection refused",
		"timeout",
		"tls handshake",
		"temporarily unavailable",
	} {
		if strings.Contains(msg, needle) {
			return true
		}
	}
	return false
}

// extractModelText joins the text parts of every "model_output" step and
// skips "thought" steps. It returns "" when no reply text is present.
func extractModelText(interaction interface{}) string {
	raw, err := json.Marshal(interaction)
	if err != nil {
		log.Printf("chatbot: could not marshal interaction: %v", err)
		return ""
	}

	var view interactionView
	if err := json.Unmarshal(raw, &view); err != nil {
		log.Printf("chatbot: could not parse interaction: %v", err)
		return ""
	}

	var sb strings.Builder

	stepTypes := make([]string, 0, len(view.Steps))
	for _, step := range view.Steps {
		stepTypes = append(stepTypes, step.Type)
		if step.Type != "model_output" {
			continue
		}
		for _, part := range step.Content {
			if part.Type == "text" {
				sb.WriteString(part.Text)
			}
		}
	}

	text := strings.TrimSpace(sb.String())
	if text == "" {
		log.Printf("chatbot: no model_output text, step types seen: %v", stepTypes)
	}
	return text
}
