package ws

import (
	"encoding/json"
	"fmt"
	"strings"
)

// HandleIncomingSocketMessage decodes a raw client frame into a Message,
// dispatching on its "kind" field. This is pure parsing/validation — no
// socket I/O — so it can be unit tested independently of an actual
// websocket connection.
func HandleIncomingSocketMessage(fromUserID string, raw []byte) (Message, error) {
	var envelope map[string]any
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return Message{}, err
	}

	kindValue, ok := envelope["kind"]
	if !ok {
		return Message{}, fmt.Errorf("missing kind")
	}
	kind := strings.TrimSpace(fmt.Sprint(kindValue))
	toUser, _ := envelope["to_user"].(string)

	switch kind {
	case "typing":
		isTyping, _ := envelope["is_typing"].(bool)
		return Message{
			Type:     "typing",
			FromUser: fromUserID,
			ToUser:   toUser,
			IsTyping: isTyping,
		}, nil

	case "chat_message":
		body, _ := envelope["body"].(string)
		return Message{
			Type:     "new_message",
			FromUser: fromUserID,
			ToUser:   toUser,
			Body:     body,
		}, nil

	case "mark_read":
		return Message{
			Type:     "message_read",
			FromUser: fromUserID,
			ToUser:   toUser,
		}, nil

	case "presence":
		status, _ := envelope["status"].(string)
		return Message{
			Type:     "presence",
			FromUser: fromUserID,
			ToUser:   toUser,
			Body:     status,
		}, nil

	case "key_exchange_request":
		if toUser == "" {
			return Message{}, fmt.Errorf("key_exchange_request requires to_user")
		}
		return Message{
			Type:     "key_exchange_request",
			FromUser: fromUserID,
			ToUser:   toUser,
		}, nil

	case "key_exchange_response":
		if toUser == "" {
			return Message{}, fmt.Errorf("key_exchange_response requires to_user")
		}
		publicKey, _ := envelope["public_key"].(string)
		if publicKey == "" {
			return Message{}, fmt.Errorf("key_exchange_response requires public_key")
		}
		return Message{
			Type:      "key_exchange_response",
			FromUser:  fromUserID,
			ToUser:    toUser,
			PublicKey: publicKey,
		}, nil

	default:
		return Message{}, fmt.Errorf("unsupported message kind: %s", kind)
	}
}
