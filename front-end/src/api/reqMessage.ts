import { apiClient } from "./apiClient";
import { MessageResponse, SendMessageRequest } from "../components/auth/core/model";
import { getSharedKey, hasSharedKey, waitForSharedKey } from "../socket/keyExchange";
import { sendKeyExchangeRequest } from "../socket/socketClient";
import { decryptMessage, encryptMessage } from "../socket/crypto";

interface GetMessagesResponse {
    messages: MessageResponse[];
}

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

    const decrypted = await Promise.all(
        rawMessages.map(async (m) => {
            if (!m.body || !m.nonce) {
                return { ...m, body: "" };
            }

            if (!sharedKey) {
                return { ...m, body: "[pending — waiting for secure connection]" };
            }

            try {
                const plaintext = await decryptMessage(sharedKey, m.body, m.nonce);
                return { ...m, body: plaintext };
            } catch (err) {
                return { ...m, body: "[unable to decrypt]" };
            }
        })
    );

    return decrypted;
};

export const reqSendMessage = async (
    data: SendMessageRequest
): Promise<MessageResponse> => {
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