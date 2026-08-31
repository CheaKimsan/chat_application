package ws

import (
	"fmt"
	"sync"
)

type Pool struct {
	Register   chan *Client
	Unregister chan *Client
	Clients    map[string]*Client
	Broadcast  chan Message
	mu         sync.RWMutex
}

func NewPool() *Pool {
	return &Pool{
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Clients:    make(map[string]*Client),
		Broadcast:  make(chan Message),
	}
}

func (pool *Pool) Start() {
	for {
		select {
		case client := <-pool.Register:
			pool.mu.Lock()
			pool.Clients[client.ID] = client
			pool.mu.Unlock()
			fmt.Println("size of connection pool: ", len(pool.Clients))

			pool.mu.RLock()
			onlineUsers := make([]string, 0, len(pool.Clients))
			for userID := range pool.Clients {
				onlineUsers = append(onlineUsers, userID)
			}
			pool.mu.RUnlock()

			snapshotPayload := map[string]any{"type": "presence_snapshot", "users": onlineUsers}
			if err := client.Conn.WriteJSON(snapshotPayload); err != nil {
				fmt.Println("presence snapshot error for", client.ID, ":", err)
			}

			presencePayload := map[string]any{"type": "presence", "user_id": client.ID, "status": "online"}
			pool.mu.RLock()
			for _, c := range pool.Clients {
				if c.ID == client.ID {
					continue
				}
				if err := c.Conn.WriteJSON(presencePayload); err != nil {
					fmt.Println("presence broadcast error for", c.ID, ":", err)
				}
			}
			pool.mu.RUnlock()

		case client := <-pool.Unregister:
			pool.mu.Lock()
			delete(pool.Clients, client.ID)
			pool.mu.Unlock()
			fmt.Println("size of connection pool:", len(pool.Clients))

			presencePayload := map[string]any{"type": "presence", "user_id": client.ID, "status": "offline"}
			pool.mu.RLock()
			for _, c := range pool.Clients {
				if err := c.Conn.WriteJSON(presencePayload); err != nil {
					fmt.Println("presence offline broadcast error for", c.ID, ":", err)
				}
			}
			pool.mu.RUnlock()

		case message := <-pool.Broadcast:
			pool.mu.RLock()
			for _, client := range pool.Clients {
				if err := client.Conn.WriteJSON(message); err != nil {
					fmt.Println("broadcast error for", client.ID, ":", err)
				}
			}
			pool.mu.RUnlock()
		}
	}
}

func (pool *Pool) SendToUser(userID string, payload any) bool {
	pool.mu.RLock()
	client, ok := pool.Clients[userID]
	pool.mu.RUnlock()
	if !ok {
		return false
	}
	if err := client.Conn.WriteJSON(payload); err != nil {
		fmt.Println("send error for", userID, ":", err)
		return false
	}
	return true
}
