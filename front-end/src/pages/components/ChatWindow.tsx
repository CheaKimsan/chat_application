import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { useAuthStore } from "../../store/auth.store";
import { sendMarkRead } from "../../socket/socketClient";
import { UserResponse } from "../../components/user/core/model";
import { LoadingSpinner } from "../../shared/LoadingSpinner";
import { MessageResponse } from "../../components/message/core/model";
import { reqGetMessages } from "../../components/message/core/request";

export default function ChatWindow() {
    const { selectedContact, isUploading, uploadProgress, uploadedBytes, uploadTotalBytes } = useOutletContext<{
        selectedContact?: UserResponse;
        isUploading?: boolean;
        uploadProgress?: number;
        uploadedBytes?: number;
        uploadTotalBytes?: number;
    }>();
    const queryClient = useQueryClient();
    const user = useAuthStore((state) => state.user);
    const [isContactTyping, setIsContactTyping] = useState(false);


    const {
        data: messages = [],
        isLoading,
        error,
    } = useQuery<MessageResponse[]>({
        queryKey: ["messages", selectedContact?.id],
        queryFn: async () => {
            const result = await reqGetMessages(selectedContact!.id);
            return Array.isArray(result) ? result : (result as any)?.messages ?? [];
        },
        enabled: !!selectedContact?.id,
    });

    useEffect(() => {
        if (!selectedContact?.id) return;

        const handleKeyReady = (event: Event) => {
            const { userId } = (event as CustomEvent<{ userId: string }>).detail;
            if (String(userId) !== String(selectedContact.id)) return;

            queryClient.invalidateQueries({ queryKey: ["messages", selectedContact.id] });
        };

        window.addEventListener("chat:key_ready", handleKeyReady);
        return () => window.removeEventListener("chat:key_ready", handleKeyReady);
    }, [queryClient, selectedContact?.id]);

    useEffect(() => {
        if (!selectedContact?.id) return;

        const handleIncomingMessage = (event: Event) => {
            const incoming = (event as CustomEvent<MessageResponse & { plaintext?: string | null; decryptError?: string }>).detail;
            if (!incoming) return;

            const isRelevant =
                String(incoming.from_user) === String(selectedContact.id) ||
                String(incoming.to_user) === String(selectedContact.id);

            if (!isRelevant) return;

            const normalized: MessageResponse = {
                ...incoming,
                body: incoming.plaintext ?? (incoming.decryptError ? "[unable to decrypt]" : incoming.body ?? ""),
            };

            queryClient.setQueryData<MessageResponse[]>(["messages", selectedContact.id], (prev = []) => {
                if (prev.some((m) => m.id === normalized.id)) return prev;

                return [...prev, normalized].sort(
                    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                );
            });
        };

        window.addEventListener("chat:new_message", handleIncomingMessage);
        return () => window.removeEventListener("chat:new_message", handleIncomingMessage);
    }, [queryClient, selectedContact?.id]);

    useEffect(() => {
        if (!selectedContact?.id) return;

        const handleIncomingAttachment = (event: Event) => {
            const attachment = (event as CustomEvent<any>).detail;
            if (!attachment?.message_id) return;

            queryClient.setQueryData<MessageResponse[]>(["messages", selectedContact.id], (prev = []) =>
                prev.map((m) =>
                    String(m.id) === String(attachment.message_id)
                        ? { ...m, attachments: [...(m.attachments ?? []), attachment] }
                        : m
                )
            );
        };

        window.addEventListener("chat:new_attachment", handleIncomingAttachment);
        return () => window.removeEventListener("chat:new_attachment", handleIncomingAttachment);
    }, [queryClient, selectedContact?.id]);

    useEffect(() => {
        if (!selectedContact?.id) return;

        const handleTyping = (event: Event) => {
            const { from_user, is_typing } = (event as CustomEvent<{ from_user: string; is_typing: boolean }>).detail;
            if (String(from_user) !== String(selectedContact.id)) return;
            setIsContactTyping(is_typing);
        };

        window.addEventListener("chat:typing", handleTyping);
        return () => window.removeEventListener("chat:typing", handleTyping);
    }, [selectedContact?.id]);

    useEffect(() => {
        setIsContactTyping(false);
    }, [selectedContact?.id]);

    useEffect(() => {
        if (!selectedContact?.id || messages.length === 0) return;

        const hasUnreadFromContact = messages.some(
            (m) => String(m.from_user) === String(selectedContact.id) && !m.read_at
        );
        if (hasUnreadFromContact) {
            sendMarkRead(selectedContact.id);
        }
    }, [selectedContact?.id, messages]);

    useEffect(() => {
        if (!selectedContact?.id) return;

        const handleMessageRead = (event: Event) => {
            const { from_user, read_at } = (event as CustomEvent<{ from_user: string; read_at: string }>).detail;
            if (String(from_user) !== String(selectedContact.id)) return;

            queryClient.setQueryData<MessageResponse[]>(["messages", selectedContact.id], (prev = []) =>
                prev.map((m) =>
                    String(m.to_user) === String(from_user) && !m.read_at ? { ...m, read_at } : m
                )
            );
        };

        window.addEventListener("chat:message_read", handleMessageRead);
        return () => window.removeEventListener("chat:message_read", handleMessageRead);
    }, [queryClient, selectedContact?.id]);

    if (isLoading) return <div>Loading messages…</div>;
    if (error) return <div>Failed to load messages</div>;

    // index of the last message I sent — only that one gets a "Delivered/Read" label
    const lastSelfIndex = [...messages].reverse().findIndex((m) => String(m.from_user) === String(user?.id));
    const lastSelfMessageId =
        lastSelfIndex === -1 ? null : messages[messages.length - 1 - lastSelfIndex].id;

    return (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <style>{`
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `}</style>
            {messages.map((m) => {
                const isSelf = String(m.from_user) === String(user?.id);
                const showReceipt = isSelf && m.id === lastSelfMessageId;
                const attachments = m.attachments ?? [];

                return (
                    <div
                        key={m.id}
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: isSelf ? "flex-end" : "flex-start",
                            gap: 8,
                        }}
                    >
                        {attachments.length > 0 && (
                            <div
                                style={{
                                    maxWidth: "70%",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8,
                                }}
                            >
                                {attachments.map((attachment) => {
                                    const isImage = attachment.type === "image" || attachment.mime_type?.startsWith("image/");
                                    const isVideo = attachment.type === "video" || attachment.mime_type?.startsWith("video/");

                                    return isImage ? (
                                        <img
                                            key={attachment.id}
                                            src={attachment.url}
                                            alt="uploaded image"
                                            style={{
                                                maxWidth: 260,
                                                maxHeight: 260,
                                                borderRadius: 12,
                                                border: "1px solid rgba(255,255,255,0.1)",
                                                objectFit: "cover",
                                            }}
                                        />
                                    ) : isVideo ? (
                                        <video
                                            key={attachment.id}
                                            controls
                                            style={{
                                                maxWidth: 320,
                                                maxHeight: 320,
                                                borderRadius: 12,
                                                border: "1px solid rgba(255,255,255,0.1)",
                                                objectFit: "cover",
                                            }}
                                        >
                                            <source src={attachment.url} type={attachment.mime_type} />
                                            Your browser does not support the video tag.
                                        </video>
                                    ) : null;
                                })}
                            </div>
                        )}

                        {m.body && (
                            m.body === "[pending — waiting for secure connection]" ? (
                                <div
                                    style={{
                                        maxWidth: "70%",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        padding: "8px 12px",
                                        borderRadius: 12,
                                        backgroundColor: isSelf ? "#2563eb" : "#3f3f46",
                                        opacity: 0.6,
                                    }}
                                >
                                    <div style={{
                                        width: 12,
                                        height: 12,
                                        border: "2px solid rgba(255,255,255,0.3)",
                                        borderTop: "2px solid #fff",
                                        borderRadius: "50%",
                                        animation: "spin 0.8s linear infinite",
                                        flexShrink: 0,
                                    }} />
                                    <span className="text-white" style={{ fontSize: 13, fontStyle: "italic" }}>
                                        Waiting to decrypt…
                                    </span>
                                </div>
                            ) : (
                                <div
                                    className="text-white"
                                    style={{
                                        maxWidth: "70%",
                                        padding: "8px 12px",
                                        borderRadius: 12,
                                        backgroundColor: isSelf ? "#2563eb" : "#3f3f46",
                                    }}
                                >
                                    {m.body}
                                </div>
                            )
                        )}

                        {showReceipt && (
                            <span style={{ fontSize: 11, color: "#8B92A0", marginTop: 2 }}>
                                {m.read_at ? "Read" : "Delivered"}
                            </span>
                        )}
                    </div>
                );
            })}

            {isUploading && <LoadingSpinner progress={uploadProgress} loaded={uploadedBytes} total={uploadTotalBytes} />}
        </div>
    );
}