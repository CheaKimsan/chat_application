package ws

import (
	"context"
	"fmt"
	"log"
	"sync"
)

type Pool struct {
	Register   chan *Client
	Unregister chan *Client
	Clients    map[string]*Client
	Broadcast  chan Message
	mu         sync.RWMutex
	MediaRelay *MediaRelay
	blockCheck func(context.Context, string, string) (bool, error)
}

func NewPool() *Pool {
	pool := &Pool{
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Clients:    make(map[string]*Client),
		Broadcast:  make(chan Message),
	}
	pool.MediaRelay = NewMediaRelay(pool.SendToUser)
	return pool
}

func (pool *Pool) SetBlockChecker(check func(context.Context, string, string) (bool, error)) {
	pool.blockCheck = check
}

func (pool *Pool) isBlocked(userA, userB string) bool {
	blocked, err := pool.blockCheckStatus(userA, userB)
	if err != nil {
		log.Printf("failed to check block status for presence %s/%s: %v", userA, userB, err)
		return true
	}
	return blocked
}

func (pool *Pool) blockCheckStatus(userA, userB string) (bool, error) {
	if pool.blockCheck == nil {
		return false, nil
	}
	return pool.blockCheck(context.Background(), userA, userB)
}

func (pool *Pool) RefreshPresence(userID string) {
	pool.mu.RLock()
	client, ok := pool.Clients[userID]
	onlineUsers := make([]string, 0, len(pool.Clients))
	for connectedID := range pool.Clients {
		onlineUsers = append(onlineUsers, connectedID)
	}
	pool.mu.RUnlock()
	if !ok {
		return
	}

	visibleUsers := make([]string, 0, len(onlineUsers))
	for _, connectedID := range onlineUsers {
		if connectedID == userID || !pool.isBlocked(userID, connectedID) {
			visibleUsers = append(visibleUsers, connectedID)
		}
	}
	if err := client.WriteJSON(map[string]any{"type": "presence_snapshot", "users": visibleUsers}); err != nil {
		log.Printf("presence snapshot error for %s: %v", userID, err)
	}
}

func (pool *Pool) broadcastPresence(userID, status string) {
	pool.mu.RLock()
	clients := make([]*Client, 0, len(pool.Clients))
	for _, client := range pool.Clients {
		clients = append(clients, client)
	}
	pool.mu.RUnlock()

	payload := map[string]any{"type": "presence", "user_id": userID, "status": status}
	for _, client := range clients {
		if client.ID != userID && pool.isBlocked(client.ID, userID) {
			continue
		}
		if err := client.WriteJSON(payload); err != nil {
			log.Printf("presence %s error for %s: %v", status, client.ID, err)
		}
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

			visibleUsers := make([]string, 0, len(onlineUsers))
			for _, userID := range onlineUsers {
				if userID == client.ID || !pool.isBlocked(client.ID, userID) {
					visibleUsers = append(visibleUsers, userID)
				}
			}
			if err := client.WriteJSON(map[string]any{"type": "presence_snapshot", "users": visibleUsers}); err != nil {
				fmt.Println("presence snapshot error for", client.ID, ":", err)
			}
			pool.broadcastPresence(client.ID, "online")

		case client := <-pool.Unregister:
			pool.mu.Lock()
			delete(pool.Clients, client.ID)
			pool.mu.Unlock()
			fmt.Println("size of connection pool:", len(pool.Clients))
			pool.broadcastPresence(client.ID, "offline")

		case message := <-pool.Broadcast:
			pool.mu.RLock()
			for _, client := range pool.Clients {
				if err := client.WriteJSON(message); err != nil {
					fmt.Println("broadcast error for", client.ID, ":", err)
				}
			}
			pool.mu.RUnlock()
		}
	}
}

func (pool *Pool) Count() int {
	pool.mu.RLock()
	defer pool.mu.RUnlock()
	return len(pool.Clients)
}

func (pool *Pool) SendToUser(userID string, payload any) bool {
	pool.mu.RLock()
	client, ok := pool.Clients[userID]
	pool.mu.RUnlock()
	if !ok {
		return false
	}
	if err := client.WriteJSON(payload); err != nil {
		fmt.Println("send error for", userID, ":", err)
		return false
	}
	return true
}
