package bots

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"
)

// NewHelperBot builds a small example bot. id must be the user id of the bot's
// row in the users table.
func NewHelperBot(id string) *Bot {
	b := New(id, "Helper Bot")

	b.Command("start", "Show the main menu", func(context.Context, Message, string) (Reply, error) {
		return Reply{
			Text: "Hi! I'm Helper Bot. Pick something:",
			Buttons: [][]Button{
				{{Label: "Ping", Data: "/ping"}, {Label: "Time", Data: "/time"}},
				{{Label: "Roll a dice", Data: "/roll"}, {Label: "Help", Data: "/help"}},
			},
		}, nil
	})

	b.Command("ping", "Check that the bot is alive", func(context.Context, Message, string) (Reply, error) {
		return Reply{Text: "pong"}, nil
	})

	b.Command("time", "Current time, e.g. /time Asia/Phnom_Penh", timeCmd)
	b.Command("roll", "Roll a dice, e.g. /roll 20", rollCmd)

	b.Command("echo", "Repeat your text", func(_ context.Context, _ Message, args string) (Reply, error) {
		if args == "" {
			return Reply{Text: "Usage: /echo your text"}, nil
		}
		r := []rune(args)
		if len(r) > 500 {
			r = r[:500]
		}
		return Reply{Text: string(r)}, nil
	})

	b.Command("whoami", "Show your user id", func(_ context.Context, m Message, _ string) (Reply, error) {
		return Reply{Text: "Your user id: " + m.UserID}, nil
	})

	b.Fallback(func(context.Context, Message, string) (Reply, error) {
		return Reply{
			Text:    "I didn't understand that. Try one of these:",
			Buttons: [][]Button{{{Label: "Menu", Data: "/start"}, {Label: "Help", Data: "/help"}}},
		}, nil
	})

	return b
}

func timeCmd(_ context.Context, _ Message, args string) (Reply, error) {
	loc := time.UTC
	if args != "" {
		l, err := time.LoadLocation(args)
		if err != nil {
			return Reply{Text: "Unknown timezone. Example: /time Asia/Phnom_Penh"}, nil
		}
		loc = l
	}
	return Reply{Text: time.Now().In(loc).Format("Mon 02 Jan 2006, 15:04:05 MST")}, nil
}

func rollCmd(_ context.Context, _ Message, args string) (Reply, error) {
	sides := int64(6)
	if args != "" {
		n, err := strconv.ParseInt(strings.TrimSpace(args), 10, 64)
		if err != nil || n < 2 || n > 1000 {
			return Reply{Text: "Use a number from 2 to 1000, e.g. /roll 20"}, nil
		}
		sides = n
	}

	r, err := rand.Int(rand.Reader, big.NewInt(sides))
	if err != nil {
		return Reply{}, err
	}
	return Reply{
		Text: fmt.Sprintf("You rolled %d (1-%d)", r.Int64()+1, sides),
		Buttons: [][]Button{
			{{Label: "Roll again", Data: fmt.Sprintf("/roll %d", sides)}},
		},
	}, nil
}
