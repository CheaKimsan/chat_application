package ws

import (
	"fmt"
	"log"
	"strings"
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

func (c *Client) WriteJSON(payload any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.Conn.WriteJSON(payload)
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
			if msg.Type == "media_offer" {
				if err := c.Pool.MediaRelay.HandleOffer(msg); err != nil {
					c.Pool.SendToUser(c.ID, Message{Type: "media_failed", FromUser: "server", ToUser: c.ID, CallID: msg.CallID, Reason: err.Error()})
				}
				continue
			}
			if msg.Type == "media_answer" {
				if err := c.Pool.MediaRelay.HandleAnswer(msg); err != nil {
					log.Println("media answer error:", err)
					c.Pool.SendToUser(c.ID, Message{Type: "media_failed", FromUser: "server", ToUser: c.ID, CallID: msg.CallID, Reason: err.Error()})
				}
				continue
			}
			if msg.Type == "media_ice_candidate" {
				if err := c.Pool.MediaRelay.AddCandidate(msg); err != nil {
					log.Println("media ICE candidate error:", err)
					c.Pool.SendToUser(c.ID, Message{Type: "media_failed", FromUser: "server", ToUser: c.ID, CallID: msg.CallID, Reason: err.Error()})
				}
				continue
			}
			if msg.Type == "media_end" {
				c.Pool.MediaRelay.RemoveCall(msg.CallID)
				continue
			}
			delivered := c.Pool.SendToUser(msg.ToUser, msg)
			if strings.HasPrefix(msg.Type, "call_") || msg.Type == "ice_candidate" {
				log.Printf("call signal %s from %s to %s delivered=%t call_id=%s", msg.Type, msg.FromUser, msg.ToUser, delivered, msg.CallID)
			}

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
			if !delivered && strings.HasPrefix(msg.Type, "call_") {
				c.Pool.SendToUser(c.ID, Message{
					Type:     "call_failed",
					FromUser: msg.ToUser,
					ToUser:   c.ID,
					CallID:   msg.CallID,
					Reason:   "user is offline",
				})
			}
		} else {
			c.Pool.Broadcast <- msg
		}

		fmt.Printf("Message received: %+v\n", msg)
	}
}
