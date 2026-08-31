package ws

import (
	"fmt"
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

// Client represents a single connected websocket peer.
type Client struct {
	ID   string
	Conn *websocket.Conn
	Pool *Pool
	mu   sync.Mutex
}

// Read pumps incoming frames off the socket, decodes them, and routes
// them either to a specific recipient or broadcasts them to the pool.
// It runs until the connection errors or closes, then unregisters the
// client from the pool.
func (c *Client) Read() {
	defer func() {
		c.Pool.Unregister <- c
		c.Conn.Close()
	}()

	for {
		_, p, err := c.Conn.ReadMessage()
		if err != nil {
			log.Println(err)
			return
		}

		msg, err := HandleIncomingSocketMessage(c.ID, p)
		if err != nil {
			log.Println("invalid message:", err)
			continue
		}

		if msg.ToUser != "" {
			delivered := c.Pool.SendToUser(msg.ToUser, msg)

			// Let the sender know their key exchange couldn't reach an offline peer,
			// so the UI can show something useful instead of silently hanging.
			if !delivered && (msg.Type == "key_exchange_request" || msg.Type == "key_exchange_response") {
				c.Pool.SendToUser(c.ID, Message{
					Type:     "key_exchange_failed",
					FromUser: msg.ToUser,
					ToUser:   c.ID,
					Reason:   "user is offline",
				})
			}
		} else {
			c.Pool.Broadcast <- msg
		}

		fmt.Printf("Message received: %+v\n", msg)
	}
}
