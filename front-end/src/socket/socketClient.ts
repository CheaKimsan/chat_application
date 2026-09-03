import { decryptMessage, encryptMessage } from "./crypto";
import { buildKeyExchangeResponse, clearAllSharedKeys, completeKeyExchange, failKeyExchange, initE2EE, waitForSharedKey } from "./keyExchange";
import { getAccessToken, refreshAccessToken } from "../api/apiClient";

let socket: WebSocket | null = null;
let manualDisconnect = false;

const emitChatEvent = (type: string, payload: unknown) => {
    window.dispatchEvent(new CustomEvent(type, { detail: payload }));
};

// Decodes the JWT payload without verifying the signature (verification
// is the server's job) just to read `exp` and decide whether it's worth
// connecting with this token or refreshing first.
function isTokenExpiringSoon(token: string, bufferSeconds = 30): boolean {
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        const expMs = payload.exp * 1000;
        return Date.now() > expMs - bufferSeconds * 1000;
    } catch {
        return true; // unparsable — treat as unusable, force a refresh
    }
}

// Guarantees the token handed to the WebSocket handshake is actually
// still valid. This is the fix for the exact failure we just saw: a
// stale access token (already past its exp) being passed straight into
// `new WebSocket(...)`, which the server's AuthMiddleware rejects at
// the upgrade — a failure the browser only reports as a generic
// "connection failed", not a 401.
async function ensureValidAccessToken(candidate?: string): Promise<string> {
    const token = candidate ?? getAccessToken();
    if (!token || isTokenExpiringSoon(token)) {
        return refreshAccessToken();
    }
    return token;
}

export const connectSocket = async (token?: string) => {

    manualDisconnect = false;

    if (socket) {
        // We're intentionally replacing this socket — strip its
        // onclose handler first so it doesn't also try to reconnect
        // and race with the new connection we're about to open.
        socket.onclose = null;
        socket.close();
    }

    await initE2EE();

    const freshToken = await ensureValidAccessToken(token);

    socket = new WebSocket(`ws://localhost:8000/api/v1/messages?token=${freshToken}`);

    socket.onopen = () => console.log("socket connected");

    socket.onmessage = async (event) => {
        const payload = JSON.parse(event.data);

        if (payload.type === "key_exchange_request") {
            const myPublicKeyB64 = await buildKeyExchangeResponse();
            send({
                kind: "key_exchange_response",
                to_user: payload.from_user,
                public_key: myPublicKeyB64,
            });
            return;
        }

        if (payload.type === "key_exchange_response") {
            await completeKeyExchange(payload.from_user, payload.public_key);
            return;
        }

        if (payload.type === "key_exchange_failed") {
            failKeyExchange(payload.from_user, payload.reason || "key exchange failed");
            return;
        }

        if (payload.type === "new_message") {
            const msg = payload.message;

            // Plain messages have no nonce; attachment-only messages have no body.
            if (!msg.body || !msg.nonce) {
                emitChatEvent("chat:new_message", { ...msg, plaintext: msg.body || "" });
                return;
            }

            try {
                const sharedKey = await waitForSharedKey(msg.from_user, () =>
                    send({ kind: "key_exchange_request", to_user: msg.from_user })
                );
                const plaintext = await decryptMessage(sharedKey, msg.body, msg.nonce);
                emitChatEvent("chat:new_message", { ...msg, plaintext });
            } catch (err) {
                console.error("failed to decrypt incoming message:", err);
                emitChatEvent("chat:new_message", { ...msg, plaintext: null, decryptError: (err as Error).message });
            }
        }
        if (payload.type === "new_attachment") {
            emitChatEvent("chat:new_attachment", payload.attachment);
        }
        if (payload.type === "message_read") {
            emitChatEvent("chat:message_read", payload);
        }
        if (payload.type === "typing") {
            emitChatEvent("chat:typing", {
                from_user: payload.from_user,
                to_user: payload.to_user,
                is_typing: payload.is_typing,
            });
        }
        if (payload.type === "presence") {
            emitChatEvent("chat:presence", {
                user_id: payload.user_id,
                status: payload.status,
            });
        }
        if (payload.type === "presence_snapshot") {
            emitChatEvent("chat:presence_snapshot", {
                users: payload.users || [],
            });
        }
    };

    socket.onclose = async () => {
        console.log("socket disconnected");
        clearAllSharedKeys();

        // Only auto-reconnect if this was an unexpected drop (expired
        // token, network blip, server restart) — not a deliberate
        // disconnectSocket() call from e.g. logout.
        if (manualDisconnect) return;

        try {
            const newToken = await ensureValidAccessToken();
            await connectSocket(newToken);
        } catch (err) {
            // Refresh token is also dead — nothing left to retry with.
            // The apiClient interceptor will already be sending the user
            // to /login on their next HTTP call for the same reason.
            console.error("socket reconnect failed, refresh token likely expired:", err);
        }
    };
};

export const disconnectSocket = () => {
    manualDisconnect = true;
    socket?.close();
    socket = null;
};

export const getSocket = () => socket;

function send(payload: unknown) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.warn("socket not connected, dropping payload:", payload);
        return;
    }
    socket.send(JSON.stringify(payload));
}

export const sendChatMessage = async (toUser: string, body: string) => {
    try {
        const sharedKey = await waitForSharedKey(toUser, () =>
            send({ kind: "key_exchange_request", to_user: toUser })
        );
        const { ciphertext, nonce } = await encryptMessage(sharedKey, body);
        return { ciphertext, nonce };
    } catch (err) {
        console.error("failed to send encrypted message:", err);
        throw err;
    }
};

export const sendTyping = (toUser: string, isTyping: boolean) => {
    send({ kind: "typing", to_user: toUser, is_typing: isTyping });
};

export const sendKeyExchangeRequest = (toUser: string) => {
    send({ kind: "key_exchange_request", to_user: toUser });
};

export const sendMarkRead = (fromUserOfMessages: string) => {
    send({ kind: "mark_read", to_user: fromUserOfMessages });
};