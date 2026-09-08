import { Fragment, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { useAuthStore } from "../../store/auth.store";
import { sendMarkRead } from "../../socket/socketClient";
import { UserResponse } from "../../components/user/core/model";
import { LoadingSpinner } from "../../shared/LoadingSpinner";
import { MessageResponse } from "../../components/message/core/model";
import { reqDeleteMessage, reqEditMessage, reqGetCallHistory, reqGetMessages } from "../../components/message/core/request";
import { ArrowDownLeft, ArrowUpRight, Pencil, Phone, Trash2, Video } from "lucide-react";

type CallRecord = {
    id: string;
    mode: "audio" | "video";
    status: string;
    createdAt: string;
    durationSeconds?: number;
    direction?: "incoming" | "outgoing";
};

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
    const [callHistory, setCallHistory] = useState<CallRecord[]>([]);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState("");
    const bottomRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!selectedContact?.id) {
            setCallHistory([]);
            return;
        }
        const key = `call-history-${selectedContact.id}`;
        const loadHistory = async () => {
            try {
                const remoteRecords = await reqGetCallHistory(selectedContact.id);
                const records = remoteRecords.map((record) => ({
                    id: record.id,
                    call_id: record.call_id,
                    mode: record.mode,
                    status: record.status,
                    createdAt: record.created_at,
                    durationSeconds: record.duration_seconds,
                    direction: String(record.from_user) === String(user?.id) ? "outgoing" : "incoming",
                } as CallRecord));
                setCallHistory(records);
            } catch {
                try { setCallHistory(JSON.parse(localStorage.getItem(key) || "[]")); } catch { setCallHistory([]); }
            }
        };
        const handleHistory = (event: Event) => {
            const detail = (event as CustomEvent<{ contactId: string | number; records: CallRecord[] }>).detail;
            if (String(detail.contactId) === String(selectedContact.id)) setCallHistory(detail.records);
        };
        void loadHistory();
        window.addEventListener("chat:call_history", handleHistory);
        return () => window.removeEventListener("chat:call_history", handleHistory);
    }, [selectedContact?.id]);


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

        const handleUpdated = (event: Event) => {
            const updated = (event as CustomEvent<MessageResponse & { plaintext?: string | null; decryptError?: string }>).detail;
            queryClient.setQueryData<MessageResponse[]>(["messages", selectedContact.id], (prev = []) =>
                prev.map((message) => String(message.id) === String(updated.id)
                    ? { ...message, ...updated, body: updated.plaintext ?? (updated.decryptError ? "[unable to decrypt]" : updated.body ?? "") }
                    : message)
            );
        };
        const handleDeleted = (event: Event) => {
            const { message_id } = (event as CustomEvent<{ message_id: string }>).detail;
            queryClient.setQueryData<MessageResponse[]>(["messages", selectedContact.id], (prev = []) =>
                prev.filter((message) => String(message.id) !== String(message_id))
            );
        };
        window.addEventListener("chat:message_updated", handleUpdated);
        window.addEventListener("chat:message_deleted", handleDeleted);
        return () => {
            window.removeEventListener("chat:message_updated", handleUpdated);
            window.removeEventListener("chat:message_deleted", handleDeleted);
        };
    }, [queryClient, selectedContact?.id]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [messages, callHistory, selectedContact?.id]);

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

    const orderedMessages = [...messages].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const timeline = [
        ...orderedMessages.map((message) => ({
            kind: "message" as const,
            timestamp: new Date(message.created_at).getTime(),
            message,
        })),
        ...callHistory.map((record) => ({
            kind: "call" as const,
            timestamp: new Date(record.createdAt).getTime(),
            record,
        })),
    ].sort((a, b) => a.timestamp - b.timestamp);
    const displayTimeZone = "UTC";
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);
    const formatDateLabel = (timestamp: number) => {
        const date = new Date(timestamp);
        const dateKey = date.toISOString().slice(0, 10);
        const isToday = dateKey === todayKey;
        const isYesterday = dateKey === yesterdayKey;

        if (isToday) return "Today";
        if (isYesterday) return "Yesterday";
        return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", timeZone: displayTimeZone });
    };
    const formatTime = (timestamp: number) =>
        new Date(timestamp).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            timeZone: displayTimeZone,
        });

    // index of the last message I sent — only that one gets a "Delivered/Read" label
    const lastSelfIndex = [...orderedMessages].reverse().findIndex((m) => String(m.from_user) === String(user?.id));
    const lastSelfMessageId =
        lastSelfIndex === -1 ? null : orderedMessages[orderedMessages.length - 1 - lastSelfIndex].id;

    return (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <style>{`
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `}</style>
            {timeline.map((item, index) => {
                const currentDate = new Date(item.timestamp).toISOString().slice(0, 10);
                const previousDate = index > 0 ? new Date(timeline[index - 1].timestamp).toISOString().slice(0, 10) : null;
                const showDateDivider = currentDate !== previousDate;

                if (item.kind === "call") {
                    const record = item.record;
                    const isIncoming = record.direction === "incoming";
                    const title = record.status === "missed" || (record.status === "failed" && isIncoming) ? "Missed call" : record.status === "incoming" ? "Incoming call" : record.status === "rejected" ? "Rejected call" : record.status === "busy" ? "Busy call" : record.status === "failed" ? "Failed call" : isIncoming ? "Incoming call" : "Outgoing call";
                    const CallIcon = record.mode === "video" ? Video : Phone;
                    return (
                        <Fragment key={`call-${record.id}`}>
                            {showDateDivider && <div className="chat-date-divider"><span>{formatDateLabel(item.timestamp)}</span></div>}
                            <div className={`call-history-card call-history-card--${record.status} call-history-card--${isIncoming ? "incoming" : "outgoing"}`}>
                                <div className="call-history-card__copy">
                                    <strong>{title}</strong>
                                    <span>
                                        {isIncoming ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                                        {formatTime(item.timestamp)}
                                        {record.durationSeconds !== undefined && `, ${record.durationSeconds} seconds`}
                                    </span>
                                </div>
                                <CallIcon className="call-history-card__icon" size={25} />
                            </div>
                        </Fragment>
                    );
                }

                const m = item.message;
                const isSelf = String(m.from_user) === String(user?.id);
                const showReceipt = isSelf && m.id === lastSelfMessageId;
                const attachments = m.attachments ?? [];
                const isEditing = editingMessageId === m.id;

                return (
                    <Fragment key={m.id}>
                        {showDateDivider && <div className="chat-date-divider"><span>{formatDateLabel(item.timestamp)}</span></div>}
                        <div
                            className={`message-entry ${isSelf ? "message-entry--self" : ""}`}
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
                                        const isAudio = attachment.type === "audio" || attachment.mime_type?.startsWith("audio/");

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
                                        ) : isAudio ? (
                                            <audio
                                                key={attachment.id}
                                                controls
                                                style={{ maxWidth: 320 }}
                                            >
                                                <source src={attachment.url} type={attachment.mime_type} />
                                                Your browser does not support the audio tag.
                                            </audio>
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

                            {isEditing ? (
                                <form
                                    onSubmit={async (event) => {
                                        event.preventDefault();
                                        const text = editingText.trim();
                                        if (!text || !selectedContact) return;
                                        const updated = await reqEditMessage({ messageId: m.id, body: text, contactId: String(selectedContact.id) });
                                        queryClient.setQueryData<MessageResponse[]>(["messages", selectedContact.id], (prev = []) =>
                                            prev.map((message) => message.id === m.id ? { ...message, ...updated } : message)
                                        );
                                        setEditingMessageId(null);
                                    }}
                                    style={{ display: "flex", gap: 6, maxWidth: "70%" }}
                                >
                                    <input value={editingText} onChange={(event) => setEditingText(event.target.value)} autoFocus />
                                    <button type="submit">Save</button>
                                    <button type="button" onClick={() => setEditingMessageId(null)}>Cancel</button>
                                </form>
                            ) : m.body && (
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
                                        className="text-white message-bubble"
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

                            <span style={{ fontSize: 11, color: "#8B92A0", marginTop: 2 }}>
                                {formatTime(item.timestamp)}{showReceipt ? ` · ${m.read_at ? "Read" : "Delivered"}` : ""}
                            </span>
                            {isSelf && !isEditing && (
                                <span className="message-actions">
                                    {m.body && <button className="message-action-button" type="button" onClick={() => { setEditingMessageId(m.id); setEditingText(m.body); }} title="Edit message">
                                        <Pencil size={14} />
                                    </button>}
                                    <button className="message-action-button message-action-button--delete" type="button" onClick={async () => {
                                        if (!window.confirm("Delete this message?")) return;
                                        await reqDeleteMessage(m.id);
                                        queryClient.setQueryData<MessageResponse[]>(["messages", selectedContact!.id], (prev = []) => prev.filter((message) => message.id !== m.id));
                                    }} title="Delete message">
                                        <Trash2 size={14} />
                                    </button>
                                </span>
                            )}
                        </div>
                    </Fragment>
                );
            })}

            {isUploading && <LoadingSpinner progress={uploadProgress} loaded={uploadedBytes} total={uploadTotalBytes} />}
            <div ref={bottomRef} />
        </div>
    );
}