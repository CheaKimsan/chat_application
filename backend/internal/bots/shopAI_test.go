package bots

import (
	"context"
	"strings"
	"testing"

	"golang-jwt-project/internal/repository"
)

func TestShopAIPromptIncludesCatalogAndActionLimits(t *testing.T) {
	prompt := shopAIPrompt("What would you recommend?", []repository.ShopProduct{{
		ID:          12,
		Name:        "Travel mug",
		Description: "Insulated steel cup",
		PriceCents:  2499,
		Stock:       4,
	}})

	for _, expected := range []string{"Travel mug", "Insulated steel cup", `"price_cents":2499`, `"stock":4`, "cannot change carts or place orders", "What would you recommend?"} {
		if !strings.Contains(prompt, expected) {
			t.Errorf("shop AI prompt missing %q", expected)
		}
	}
}

func TestShopBotWithoutGeminiExplainsAIUnavailable(t *testing.T) {
	shop := NewShop(nil)
	bot := New("shop-id", "Shop AI")
	shop.Register(bot)

	reply := bot.handle(context.Background(), Message{Text: "What products do you have?"})
	if !strings.Contains(reply.Text, "Natural-language answers are currently unavailable") {
		t.Fatalf("unexpected fallback reply: %q", reply.Text)
	}
}
