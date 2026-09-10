import { Fragment, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { useAuthStore } from "../../store/auth.store";
import { sendMarkRead } from "../../socket/socketClient";
import { UserResponse } from "../../components/user/core/model";
import { LoadingSpinner } from "../../shared/LoadingSpinner";
import { MessageResponse } from "../../components/message/core/model";
import {
    reqDeleteMessage,
    reqEditMessage,
    reqGetCallHistory,
    reqGetConversationMessages,
    reqGetMessages,
} from "../../components/message/core/request";
import { ArrowDownLeft, ArrowUpRight, Pencil, Phone, Trash2, Video } from "lucide-react";

type CallRecord = {
    id: string;
    mode: "audio" | "video";
    status: string;
    createdAt: string;
    durationSeconds?: number;
    direction?: "incoming" | "outgoing";
};

// Minimal shape of what Layout.tsx passes down as `selectedConversation`
// (its full `Conversation` type) — members are needed here to resolve
// each message's sender to an avatar/name in group chats.
type SelectedConversation = {
    id: string;
    isGroup: boolean;
    name?: string;
    members: { id: string; username: string; profile_photo?: string }[];
};

const parseTimestamp = (value: string | number | Date) => {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;

    const timestamp = value.trim();
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp);
    const isoTimestamp = timestamp.includes("T") ? timestamp : timestamp.replace(" ", "T");
    const parsed = hasTimezone
        ? Date.parse(isoTimestamp)
        : Date.parse(`${isoTimestamp}+07:00`);
    return parsed;
};

// Pulls HH:MM straight out of an ISO timestamp string, with no timezone
// conversion at all — e.g. "2026-09-09T11:27:15.411083Z" -> "11:27".
const extractTimeOnly = (value: string) => {
    const match = value.match(/T(\d{2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : "";
};

const initialsOf = (name: string) =>
    name
        .split(" ")
        .map((part) => part[0]?.toUpperCase())
        .join("")
        .slice(0, 2) || "?";

type SenderInfo = { username: string; profile_photo?: string };

function SenderAvatar({ sender }: { sender: SenderInfo }) {
    return (
        <div
            title={sender.username}
            style={{
                width: 28,
                height: 28,
                flexShrink: 0,
                borderRadius: "50%",
                background: "#20242A",
                border: "1px solid #23262A",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                color: "#8B92A0",
                fontSize: 11,
                fontWeight: 700,
            }}
        >
            {sender.profile_photo ? (
                <img
                    src={sender.profile_photo}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
            ) : (
                initialsOf(sender.username)
            )}
        </div>
    );
}

export default function ChatWindow() {
    const { selectedContact, selectedConversation, isUploading, uploadProgress, uploadedBytes, uploadTotalBytes } = useOutletContext<{
        selectedContact?: UserResponse;
        selectedConversation?: SelectedConversation;
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
    const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);

    // Groups are addressed by conversation_id; 1:1 chats are addressed by
    // the other user's id. Exactly one of these is set at a time (Layout
    // clears selectedContact when a group is selected, and vice versa).
    const conversationId = selectedConversation?.id;
    const contactId = selectedContact?.id;
    const activeId = conversationId ?? (contactId !== undefined ? String(contactId) : undefined);
    const isGroup = !!conversationId;

    // Resolve a from_user id to {username, profile_photo} so each message
    // bubble can show who actually sent it — needed for group chats where
    // "not self" could be any of several members.
    const getSenderInfo = (fromUserId: string): SenderInfo => {
        if (isGroup) {
            const member = selectedConversation!.members.find((m) => String(m.id) === String(fromUserId));
            return { username: member?.username || "Unknown", profile_photo: member?.profile_photo };
        }
        return { username: selectedContact?.username ?? "Unknown", profile_photo: selectedContact?.profile_photo };
    };

    // Matches the keys Layout.tsx's sendMutation.onSuccess already invalidates.
    const messagesQueryKey = conversationId
        ? ["messages", "conv", conversationId]
        : ["messages", contactId];

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
        queryKey: messagesQueryKey,
        queryFn: async () => {
            if (conversationId) {
                return await reqGetConversationMessages(conversationId);
            }
            const result = await reqGetMessages(contactId!);
            return Array.isArray(result) ? result : (result as any)?.messages ?? [];
        },
        enabled: !!conversationId || !!contactId,
    });

    useEffect(() => {
        if (!contactId) return;

        const handleKeyReady = (event: Event) => {
            const { userId } = (event as CustomEvent<{ userId: string }>).detail;
            if (String(userId) !== String(contactId)) return;

            queryClient.invalidateQueries({ queryKey: ["messages", contactId] });
        };

        window.addEventListener("chat:key_ready", handleKeyReady);
        return () => window.removeEventListener("chat:key_ready", handleKeyReady);
    }, [queryClient, contactId]);

    useEffect(() => {
        if (!activeId) return;

        const handleUpdated = (event: Event) => {
            const updated = (event as CustomEvent<MessageResponse & { plaintext?: string | null; decryptError?: string }>).detail;
            queryClient.setQueryData<MessageResponse[]>(messagesQueryKey, (prev = []) =>
                prev.map((message) => String(message.id) === String(updated.id)
                    ? { ...message, ...updated, body: updated.plaintext ?? (updated.decryptError ? "[unable to decrypt]" : updated.body ?? "") }
                    : message)
            );
        };
        const handleDeleted = (event: Event) => {
            const { message_id } = (event as CustomEvent<{ message_id: string }>).detail;
            queryClient.setQueryData<MessageResponse[]>(messagesQueryKey, (prev = []) =>
                prev.filter((message) => String(message.id) !== String(message_id))
            );
        };
        window.addEventListener("chat:message_updated", handleUpdated);
        window.addEventListener("chat:message_deleted", handleDeleted);
        return () => {
            window.removeEventListener("chat:message_updated", handleUpdated);
            window.removeEventListener("chat:message_deleted", handleDeleted);
        };
    }, [queryClient, activeId, conversationId, contactId]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [messages, callHistory, activeId]);

    useEffect(() => {
        if (!activeId) return;

        const handleIncomingMessage = (event: Event) => {
            const incoming = (event as CustomEvent<MessageResponse & { plaintext?: string | null; decryptError?: string }>).detail;
            if (!incoming) return;

            const isRelevant = conversationId
                ? String(incoming.conversation_id) === String(conversationId)
                : String(incoming.from_user) === String(contactId) || String(incoming.to_user) === String(contactId);

            if (!isRelevant) return;

            const normalized: MessageResponse = {
                ...incoming,
                body: incoming.plaintext ?? (incoming.decryptError ? "[unable to decrypt]" : incoming.body ?? ""),
            };

            queryClient.setQueryData<MessageResponse[]>(messagesQueryKey, (prev = []) => {
                if (prev.some((m) => m.id === normalized.id)) return prev;

                return [...prev, normalized].sort(
                    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                );
            });
        };

        window.addEventListener("chat:new_message", handleIncomingMessage);
        return () => window.removeEventListener("chat:new_message", handleIncomingMessage);
    }, [queryClient, activeId, conversationId, contactId]);

    useEffect(() => {
        if (!activeId) return;

        const handleIncomingAttachment = (event: Event) => {
            const attachment = (event as CustomEvent<any>).detail;
            if (!attachment?.message_id) return;

            queryClient.setQueryData<MessageResponse[]>(messagesQueryKey, (prev = []) =>
                prev.map((m) =>
                    String(m.id) === String(attachment.message_id)
                        ? { ...m, attachments: [...(m.attachments ?? []), attachment] }
                        : m
                )
            );
        };

        window.addEventListener("chat:new_attachment", handleIncomingAttachment);
        return () => window.removeEventListener("chat:new_attachment", handleIncomingAttachment);
    }, [queryClient, activeId, conversationId, contactId]);

    useEffect(() => {
        if (!contactId) return;

        const handleTyping = (event: Event) => {
            const { from_user, is_typing } = (event as CustomEvent<{ from_user: string; is_typing: boolean }>).detail;
            if (String(from_user) !== String(contactId)) return;
            setIsContactTyping(is_typing);
        };

        window.addEventListener("chat:typing", handleTyping);
        return () => window.removeEventListener("chat:typing", handleTyping);
    }, [contactId]);

    useEffect(() => {
        setIsContactTyping(false);
    }, [activeId]);

    useEffect(() => {
        if (!contactId || messages.length === 0) return;

        const hasUnreadFromContact = messages.some(
            (m) => String(m.from_user) === String(contactId) && !m.read_at
        );
        if (hasUnreadFromContact) {
            sendMarkRead(contactId);
        }
    }, [contactId, messages]);

    useEffect(() => {
        if (!contactId) return;

        const handleMessageRead = (event: Event) => {
            const { from_user, read_at } = (event as CustomEvent<{ from_user: string; read_at: string }>).detail;
            if (String(from_user) !== String(contactId)) return;

            queryClient.setQueryData<MessageResponse[]>(["messages", contactId], (prev = []) =>
                prev.map((m) =>
                    String(m.to_user) === String(from_user) && !m.read_at ? { ...m, read_at } : m
                )
            );
        };

        window.addEventListener("chat:message_read", handleMessageRead);
        return () => window.removeEventListener("chat:message_read", handleMessageRead);
    }, [queryClient, contactId]);

    if (isLoading) return <div>Loading messages…</div>;
    if (error) return <div>Failed to load messages</div>;

    const orderedMessages = [...messages].sort(
        (a, b) => parseTimestamp(a.created_at) - parseTimestamp(b.created_at)
    );
    const timeline = [
        ...orderedMessages.map((message) => ({
            kind: "message" as const,
            timestamp: parseTimestamp(message.created_at),
            message,
        })),
        ...callHistory.map((record) => ({
            kind: "call" as const,
            timestamp: parseTimestamp(record.createdAt),
            record,
        })),
    ].sort((a, b) => a.timestamp - b.timestamp);
    const today = new Date();
    const todayKey = today.toDateString();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toDateString();
    const formatDateLabel = (timestamp: number) => {
        const date = new Date(timestamp);
        const dateKey = date.toDateString();
        const isToday = dateKey === todayKey;
        const isYesterday = dateKey === yesterdayKey;

        if (isToday) return "Today";
        if (isYesterday) return "Yesterday";
        return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    };

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
                const currentDate = new Date(item.timestamp).toDateString();
                const previousDate = index > 0 ? new Date(timeline[index - 1].timestamp).toDateString() : null;
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
                                        {record.durationSeconds !== undefined && `${record.durationSeconds} seconds`}
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
                // Editing goes through the encrypted 1:1 edit flow (reqEditMessage
                // needs a contactId to resolve the shared key), so it's only
                // offered for 1:1 messages — group messages are plaintext and
                // don't have a matching group-edit endpoint yet.
                const canEdit = isSelf && !conversationId;

                // Whether consecutive messages come from the same sender —
                // groups the avatar/name once per run instead of every bubble.
                const previousItem = index > 0 ? timeline[index - 1] : null;
                const previousFromSameSender =
                    previousItem?.kind === "message" && String(previousItem.message.from_user) === String(m.from_user);
                const showSenderHeader = !isSelf && !showDateDivider && !previousFromSameSender;
                const showAvatarSlot = !isSelf;
                const sender = !isSelf ? getSenderInfo(m.from_user) : null;

                return (
                    <Fragment key={m.id}>
                        {showDateDivider && <div className="chat-date-divider"><span>{formatDateLabel(item.timestamp)}</span></div>}
                        <div
                            className={`message-entry ${isSelf ? "message-entry--self" : ""}`}
                            onClick={(event) => {
                                if (!isSelf || isEditing) return;
                                const target = event.target as HTMLElement;
                                if (target.closest("button, input, form, audio, video, img")) return;
                                setOpenMessageMenuId(openMessageMenuId === m.id ? null : m.id);
                            }}
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                justifyContent: isSelf ? "flex-end" : "flex-start",
                                alignItems: "flex-end",
                                gap: 8,
                            }}
                        >
                            {showAvatarSlot && (
                                <div style={{ width: 28, flexShrink: 0 }}>
                                    {showSenderHeader && sender && <SenderAvatar sender={sender} />}
                                </div>
                            )}

                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: isSelf ? "flex-end" : "flex-start",
                                    gap: 4,
                                    maxWidth: "70%",
                                }}
                            >
                                {/* Sender name — only shown in group chats, only on the first bubble of a run. */}
                                {showSenderHeader && isGroup && sender && (
                                    <span style={{ fontSize: 11, fontWeight: 600, color: "#8B92A0", marginLeft: 2 }}>
                                        {sender.username}
                                    </span>
                                )}

                                {attachments.length > 0 && (
                                    <div
                                        style={{
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
                                            if (!text || !contactId) return;
                                            const updated = await reqEditMessage({ messageId: m.id, body: text, contactId: String(contactId) });
                                            queryClient.setQueryData<MessageResponse[]>(messagesQueryKey, (prev = []) =>
                                                prev.map((message) => message.id === m.id ? { ...message, ...updated } : message)
                                            );
                                            setEditingMessageId(null);
                                        }}
                                        className="message-edit-form"
                                    >
                                        <input
                                            className="message-edit-input"
                                            value={editingText}
                                            onChange={(event) => setEditingText(event.target.value)}
                                            autoFocus
                                            aria-label="Edit message"
                                        />
                                        <button className="message-edit-save" type="submit" disabled={!editingText.trim()}>Save</button>
                                        <button className="message-edit-cancel" type="button" onClick={() => setEditingMessageId(null)}>Cancel</button>
                                    </form>
                                ) : m.body && (
                                    m.body === "[pending — waiting for secure connection]" ? (
                                        <div
                                            style={{
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
                                    {extractTimeOnly(m.created_at)}{showReceipt ? ` · ${m.read_at ? "Read" : "Delivered"}` : ""}
                                </span>
                                {isSelf && !isEditing && openMessageMenuId === m.id && (
                                    <div className="message-actions">
                                        <div className="message-actions-menu">
                                            {canEdit && m.body && (
                                                <button type="button" onClick={() => { setEditingMessageId(m.id); setEditingText(m.body); setOpenMessageMenuId(null); }}>
                                                    <Pencil size={14} />
                                                    Edit
                                                </button>
                                            )}
                                            <button type="button" className="message-actions-menu__delete" onClick={async () => {
                                                setOpenMessageMenuId(null);
                                                if (!window.confirm("Delete this message?")) return;
                                                await reqDeleteMessage(m.id);
                                                queryClient.setQueryData<MessageResponse[]>(messagesQueryKey, (prev = []) => prev.filter((message) => message.id !== m.id));
                                            }}>
                                                <Trash2 size={14} />
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </Fragment>
                );
            })}

            {isUploading && <LoadingSpinner progress={uploadProgress} loaded={uploadedBytes} total={uploadTotalBytes} />}
            <div ref={bottomRef} />
        </div>
    );
}