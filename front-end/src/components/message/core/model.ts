interface AttachmentResponse {
    id: string;
    message_id: string;
    type: string;
    url: string;
    filename?: string;
    mime_type?: string;
    size_bytes?: number;
    created_at?: string;
}
interface MessageResponse {
    id: string;
    from_user: string;
    to_user: string;
    body: string;
    nonce: string,
    created_at: string;
    read_at: string | null;
    attachments?: AttachmentResponse[];
}

interface SendMessageRequest {
    to_user: string;
    body?: string;
    encrypted?: boolean;
}

export type {
    AttachmentResponse,
    SendMessageRequest,
    MessageResponse
}

