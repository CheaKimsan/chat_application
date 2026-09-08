import { MessageResponse, SendMessageRequest } from "./model";
import { apiClient } from "../../../api/apiClient";
import { getSharedKey, hasSharedKey, waitForSharedKey } from "../../../socket/keyExchange";
import { sendKeyExchangeRequest } from "../../../socket/socketClient";
import { decryptMessage, encryptMessage } from "../../../socket/crypto";

interface GetMessagesResponse {
    messages: MessageResponse[];
}

export interface CallHistoryResponse {
    id: string;
    call_id: string;
    from_user: string;
    to_user: string;
    mode: "audio" | "video";
    status: string;
    duration_seconds?: number;
    created_at: string;
}

export const reqGetCallHistory = async (contactId: string | number): Promise<CallHistoryResponse[]> => {
    const response = await apiClient.get<{ calls: CallHistoryResponse[] }>(`/calls/${contactId}`);
    return response.data.calls ?? [];
};

export const reqCreateCallHistory = async (data: {
    call_id: string;
    to_user: string;
    mode: "audio" | "video";
    status: string;
    duration_seconds?: number;
}) => {
    await apiClient.post("/calls", data);
};

export const reqGetMessages = async (contactId: string | number): Promise<MessageResponse[]> => {

    const response = await apiClient.get<GetMessagesResponse>(`/messages/${contactId}`);

    const rawMessages = response.data?.messages ?? [];

    let sharedKey: CryptoKey | undefined;
    try {
        sharedKey = hasSharedKey(String(contactId))
            ? getSharedKey(String(contactId))
            : await waitForSharedKey(String(contactId), () =>
                sendKeyExchangeRequest(String(contactId))
            );
    } catch (err) {
        sharedKey = undefined;
    }

    const sortedMessages = [...rawMessages].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    const decrypted = await Promise.all(
        sortedMessages.map(async (m) => {
            if (!m.body) {
                return { ...m, body: "" };
            }

            if (!m.nonce) {
                return m;
            }

            if (!sharedKey) {
                return { ...m, body: "[pending — waiting for secure connection]" };
            }

            try {
                const plaintext = await decryptMessage(sharedKey, m.body, m.nonce);
                return { ...m, body: plaintext };
            } catch (err) {
                return { ...m, body: "[message end to end encrypted]" };
            }
        })
    );

    return decrypted;
};

export const reqSendMessage = async (
    data: SendMessageRequest
): Promise<MessageResponse> => {
    if (data.encrypted === false) {
        const response = await apiClient.post<{ message?: MessageResponse; data?: MessageResponse }>(
            "/messages/send",
            { to_user: data.to_user, ciphertext: data.body ?? "", nonce: null }
        );

        const msg = response.data.message ?? response.data.data ?? (response.data as unknown as MessageResponse);
        return { ...msg, body: data.body ?? "" };
    }

    const sharedKey = await waitForSharedKey(data.to_user, () =>
        sendKeyExchangeRequest(data.to_user)
    );
    const { ciphertext, nonce } = await encryptMessage(sharedKey, data.body ?? "");

    const response = await apiClient.post<{ message?: MessageResponse; data?: MessageResponse }>(
        "/messages/send",
        { to_user: data.to_user, ciphertext, nonce }
    );

    const msg = response.data.message ?? response.data.data ?? (response.data as unknown as MessageResponse);

    return { ...msg, body: data.body ?? "" };
};

export const reqUploadFile = async (
    messageId: string | number,
    files: File[],
    onProgress?: (progress: number, loaded?: number, total?: number) => void
): Promise<{ message: string; attachments?: unknown[] }> => {
    const formData = new FormData();
    files.forEach((file) => formData.append("file", file));
    const response = await apiClient.post(
        `/messages/${messageId}/upload`,
        formData,
        {
            onUploadProgress: (progressEvent) => {
                if (progressEvent.total) {
                    const percentCompleted = Math.round(
                        (progressEvent.loaded * 100) / progressEvent.total
                    );
                    onProgress?.(percentCompleted, progressEvent.loaded, progressEvent.total);
                }
            },
        }
    );

    return response.data;
};

export const reqEditMessage = async (data: { messageId: string; body: string; contactId: string }) => {
    const sharedKey = await waitForSharedKey(data.contactId, () => sendKeyExchangeRequest(data.contactId));
    const { ciphertext, nonce } = await encryptMessage(sharedKey, data.body);
    const response = await apiClient.patch<{ message: MessageResponse }>(
        `/messages/${data.messageId}/edit`,
        { ciphertext, nonce }
    );
    return { ...response.data.message, body: data.body };
};

export const reqDeleteMessage = async (messageId: string) => {
    await apiClient.delete(`/messages/${messageId}`);
};