package handlers

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestChatbotHandlerGenerate(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name       string
		body       string
		statusCode int
		response   string
	}{
		{name: "empty message", body: `{"message":"  "}`, statusCode: 400, response: "message must not be empty"},
		{name: "missing message", body: `{}`, statusCode: 400, response: "message is required"},
		{name: "not configured", body: `{"message":"hello"}`, statusCode: 503, response: "chatbot is not configured"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := gin.New()
			router.POST("/chatbot", NewChatbotHandler("", "").Generate)

			request := httptest.NewRequest("POST", "/chatbot", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)

			require.Equal(t, test.statusCode, recorder.Code)
			require.Contains(t, recorder.Body.String(), test.response)
		})
	}
}
