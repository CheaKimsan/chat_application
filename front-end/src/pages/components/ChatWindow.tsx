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

// Local view-model extension. `deleted`/`edited` aren't (yet) part of the
// shared MessageResponse type — add them there once the backend starts
// persisting deleted_at / edited_at, and this alias can be dropped.
type ChatMessage = MessageResponse & { deleted?: boolean; edited?: boolean };

type CallRecord = {
    id: string;
    mode: "audio" | "video";
    status: string;
    createdAt: string;
    durationSeconds?: number;
    direction?: "incoming" | "outgoing";
};

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
        <div className="sender-avatar" title={sender.username}>
            {sender.profile_photo ? (
                <img src={sender.profile_photo} alt="" />
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

    const conversationId = selectedConversation?.id;
    const contactId = selectedContact?.id;
    const activeId = conversationId ?? (contactId !== undefined ? String(contactId) : undefined);
    const isGroup = !!conversationId;

    const getSenderInfo = (fromUserId: string): SenderInfo => {
        if (isGroup) {
            const member = selectedConversation!.members.find((m) => String(m.id) === String(fromUserId));
            return { username: member?.username || "Unknown", profile_photo: member?.profile_photo };
        }
        return { username: selectedContact?.username ?? "Unknown", profile_photo: selectedContact?.profile_photo };
    };

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
    } = useQuery<ChatMessage[]>({
        queryKey: messagesQueryKey,
        queryFn: async () => {
            let list: any[];
            if (conversationId) {
                list = await reqGetConversationMessages(conversationId);
            } else {
                const result = await reqGetMessages(contactId!);
                list = Array.isArray(result) ? result : (result as any)?.messages ?? [];
            }
            // Server marks soft-deleted / edited rows with is_deleted /
            // is_edited; map those onto the `deleted` / `edited` flags the
            // renderer checks, same as the live socket paths do — so
            // refreshing the page still shows the tombstone and the
            // "Edited" label instead of losing that state.
            return list.map((m) => ({
                ...m,
                ...(m.is_deleted ? { deleted: true, body: "", attachments: [] } : {}),
                ...(m.is_edited ? { edited: true } : {}),
            }));
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
            const updated = (event as CustomEvent<ChatMessage & { plaintext?: string | null; decryptError?: string }>).detail;
            queryClient.setQueryData<ChatMessage[]>(messagesQueryKey, (prev = []) =>
                prev.map((message) => String(message.id) === String(updated.id)
                    ? {
                        ...message,
                        ...updated,
                        body: updated.plaintext ?? (updated.decryptError ? "[unable to decrypt]" : updated.body ?? ""),
                        edited: true,
                    }
                    : message)
            );
        };
        const handleDeleted = (event: Event) => {
            const { message_id } = (event as CustomEvent<{ message_id: string }>).detail;
            queryClient.setQueryData<ChatMessage[]>(messagesQueryKey, (prev = []) =>
                prev.map((message) =>
                    String(message.id) === String(message_id)
                        ? { ...message, body: "", attachments: [], deleted: true }
                        : message
                )
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
            const incoming = (event as CustomEvent<ChatMessage & { plaintext?: string | null; decryptError?: string }>).detail;
            if (!incoming) return;

            const isRelevant = conversationId
                ? String(incoming.conversation_id) === String(conversationId)
                : String(incoming.from_user) === String(contactId) || String(incoming.to_user) === String(contactId);

            if (!isRelevant) return;

            const normalized: ChatMessage = {
                ...incoming,
                body: incoming.plaintext ?? (incoming.decryptError ? "[unable to decrypt]" : incoming.body ?? ""),
            };

            queryClient.setQueryData<ChatMessage[]>(messagesQueryKey, (prev = []) => {
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

            queryClient.setQueryData<ChatMessage[]>(messagesQueryKey, (prev = []) => {
                const matched = prev.some((m) => String(m.id) === String(attachment.message_id));
                if (!matched) {
                    // message not in cache yet (id race, or message not loaded) — refetch instead of dropping it
                    queryClient.invalidateQueries({ queryKey: messagesQueryKey });
                    return prev;
                }
                return prev.map((m) =>
                    String(m.id) === String(attachment.message_id)
                        ? { ...m, attachments: [...(m.attachments ?? []), attachment] }
                        : m
                );
            });
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

            queryClient.setQueryData<ChatMessage[]>(["messages", contactId], (prev = []) =>
                prev.map((m) =>
                    String(m.to_user) === String(from_user) && !m.read_at ? { ...m, read_at } : m
                )
            );
        };

        window.addEventListener("chat:message_read", handleMessageRead);
        return () => window.removeEventListener("chat:message_read", handleMessageRead);
    }, [queryClient, contactId]);

    if (isLoading) {
        return (
            <div className="chat-window chat-window--loading">
                <div className="skeleton-thread">
                    {/* Received message */}
                    <div className="skeleton-msg skeleton-msg--left">
                        <div className="skeleton-avatar" />
                        <div className="skeleton-bubble" style={{ width: "42%" }} />
                    </div>

                    {/* Sent message */}
                    <div className="skeleton-msg skeleton-msg--right">
                        <div className="skeleton-bubble" style={{ width: "28%" }} />
                    </div>

                    {/* Received (2 lines) */}
                    <div className="skeleton-msg skeleton-msg--left">
                        <div className="skeleton-avatar" />
                        <div className="skeleton-bubble skeleton-bubble--tall" style={{ width: "58%" }} />
                    </div>

                    {/* Sent */}
                    <div className="skeleton-msg skeleton-msg--right">
                        <div className="skeleton-bubble" style={{ width: "36%" }} />
                    </div>

                    {/* Received */}
                    <div className="skeleton-msg skeleton-msg--left">
                        <div className="skeleton-avatar" />
                        <div className="skeleton-bubble" style={{ width: "48%" }} />
                    </div>

                    {/* Sent (short) */}
                    <div className="skeleton-msg skeleton-msg--right">
                        <div className="skeleton-bubble" style={{ width: "22%" }} />
                    </div>
                </div>

                {/* Loading indicator at bottom */}
                <div className="chat-window__loader">
                    <span className="chat-window__loader-dot" />
                    <span className="chat-window__loader-dot" />
                    <span className="chat-window__loader-dot" />
                    <span className="chat-window__loader-text">Loading messages…</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="chat-window chat-window--error">
                <div className="chat-window__error-card">
                    <div className="chat-window__error-icon">⚠</div>
                    <h3 className="chat-window__error-title">Couldn't load messages</h3>
                    <p className="chat-window__error-text">
                        Something went wrong. Please check your connection and try again.
                    </p>
                </div>
            </div>
        );
    }

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

    const lastSelfIndex = [...orderedMessages].reverse().findIndex((m) => String(m.from_user) === String(user?.id));
    const lastSelfMessageId =
        lastSelfIndex === -1 ? null : orderedMessages[orderedMessages.length - 1 - lastSelfIndex].id;

    return (
        <div className="chat-window">
            {timeline.map((item, index) => {
                const currentDate = new Date(item.timestamp).toDateString();
                const previousDate = index > 0 ? new Date(timeline[index - 1].timestamp).toDateString() : null;
                const showDateDivider = currentDate !== previousDate;

                if (item.kind === "call") {
                    const record = item.record;
                    const isIncoming = record.direction === "incoming";
                    const title =
                        record.status === "missed" || (record.status === "failed" && isIncoming)
                            ? "Missed call"
                            : record.status === "incoming"
                                ? "Incoming call"
                                : record.status === "rejected"
                                    ? "Rejected call"
                                    : record.status === "busy"
                                        ? "Busy call"
                                        : record.status === "failed"
                                            ? "Failed call"
                                            : isIncoming
                                                ? "Incoming call"
                                                : "Outgoing call";
                    const CallIcon = record.mode === "video" ? Video : Phone;

                    return (
                        <Fragment key={`call-${record.id}`}>
                            {showDateDivider && (
                                <div className="chat-date-divider">
                                    <span>{formatDateLabel(item.timestamp)}</span>
                                </div>
                            )}
                            <div
                                className={`call-history-card call-history-card--${record.status} call-history-card--${isIncoming ? "incoming" : "outgoing"}`}
                            >
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

                const m = item.message as ChatMessage;
                const isSelf = String(m.from_user) === String(user?.id);
                const showReceipt = isSelf && m.id === lastSelfMessageId;
                const attachments = m.attachments ?? [];
                const isEditing = editingMessageId === m.id;
                const canEdit = isSelf && !conversationId && !m.deleted;

                const previousItem = index > 0 ? timeline[index - 1] : null;
                const previousFromSameSender =
                    previousItem?.kind === "message" &&
                    String(previousItem.message.from_user) === String(m.from_user);
                const showSenderHeader = !isSelf && !showDateDivider && !previousFromSameSender;
                const showAvatarSlot = !isSelf;
                const sender = !isSelf ? getSenderInfo(m.from_user) : null;
                const isPending = m.body === "[pending — waiting for secure connection]";

                return (
                    <Fragment key={m.id}>
                        {showDateDivider && (
                            <div className="chat-date-divider">
                                <span>{formatDateLabel(item.timestamp)}</span>
                            </div>
                        )}
                        <div
                            className={`message-entry${isSelf ? " message-entry--self" : ""}`}
                            onClick={(event) => {
                                if (!isSelf || isEditing || m.deleted) return;
                                const target = event.target as HTMLElement;
                                if (target.closest("button, input, form, audio, video, img")) return;
                                setOpenMessageMenuId(openMessageMenuId === m.id ? null : m.id);
                            }}
                        >
                            {showAvatarSlot && (
                                <div className="message-entry__avatar-slot">
                                    {showSenderHeader && sender && <SenderAvatar sender={sender} />}
                                </div>
                            )}

                            <div className="message-entry__body">
                                {showSenderHeader && isGroup && sender && (
                                    <span className="message-entry__sender-name">{sender.username}</span>
                                )}

                                {attachments.length > 0 && !m.deleted && (
                                    <div className="message-attachments">
                                        {attachments.map((attachment) => {
                                            const url = attachment.url || "";
                                            const mime = attachment.mime_type || "";
                                            const type = attachment.type || "";

                                            // Detect by MIME, then by type, then by file extension.
                                            // .webm is ambiguous — treat it as AUDIO when the backend
                                            // labeled it audio/voice, otherwise use MIME prefix.
                                            const hasWebmExt = /\.webm(\?|$)/i.test(url);

                                            const isImage =
                                                type === "image" ||
                                                mime.startsWith("image/") ||
                                                /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(url);

                                            const isAudio =
                                                type === "audio" ||
                                                type === "voice" ||
                                                mime.startsWith("audio/") ||
                                                /\.(mp3|wav|ogg|m4a|aac|opus)(\?|$)/i.test(url) ||
                                                (hasWebmExt && (type === "audio" || type === "voice" || mime === "audio/webm"));

                                            const isVideo =
                                                !isAudio && (
                                                    type === "video" ||
                                                    mime.startsWith("video/") ||
                                                    /\.(mp4|mov|avi|mkv|m4v)(\?|$)/i.test(url) ||
                                                    hasWebmExt
                                                );

                                            return isImage ? (
                                                <img
                                                    key={attachment.id}
                                                    src={attachment.url}
                                                    alt="uploaded image"
                                                    className="message-attachment message-attachment--image"
                                                />
                                            ) : isAudio ? (
                                                <audio
                                                    key={attachment.id}
                                                    controls
                                                    preload="metadata"
                                                    className="message-attachment message-attachment--audio"
                                                >
                                                    <source src={attachment.url} type={attachment.mime_type || "audio/webm"} />
                                                    Your browser does not support the audio tag.
                                                </audio>
                                            ) : isVideo ? (
                                                <video
                                                    key={attachment.id}
                                                    controls
                                                    preload="metadata"
                                                    className="message-attachment message-attachment--video"
                                                >
                                                    <source src={attachment.url} type={attachment.mime_type || "video/webm"} />
                                                    Your browser does not support the video tag.
                                                </video>
                                            ) : (
                                                <a
                                                    key={attachment.id}
                                                    href={attachment.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="message-attachment message-attachment--file"
                                                >
                                                    📎 {attachment.filename || "Download file"}
                                                </a>
                                            );
                                        })}
                                    </div>
                                )}

                                {isEditing ? (
                                    <form
                                        onSubmit={async (event) => {
                                            event.preventDefault();
                                            const text = editingText.trim();
                                            if (!text || !contactId) return;
                                            const updated = await reqEditMessage({
                                                messageId: m.id,
                                                body: text,
                                                contactId: String(contactId),
                                            });
                                            queryClient.setQueryData<ChatMessage[]>(
                                                messagesQueryKey,
                                                (prev = []) =>
                                                    prev.map((message) =>
                                                        message.id === m.id
                                                            ? { ...message, ...updated, edited: true }
                                                            : message
                                                    )
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
                                        <button className="message-edit-save" type="submit" disabled={!editingText.trim()}>
                                            Save
                                        </button>
                                        <button
                                            className="message-edit-cancel"
                                            type="button"
                                            onClick={() => setEditingMessageId(null)}
                                        >
                                            Cancel
                                        </button>
                                    </form>
                                ) : m.deleted ? (
                                    <div className="message-bubble message-bubble--deleted">
                                        <em>This message was deleted</em>
                                    </div>
                                ) : (
                                    m.body && (
                                        isPending ? (
                                            <div className="message-bubble message-bubble--self message-bubble--pending">
                                                <div className="message-bubble__spinner" />
                                                <span>Waiting to decrypt…</span>
                                            </div>
                                        ) : (
                                            <div
                                                className={`message-bubble ${isSelf
                                                    ? "message-bubble--self"
                                                    : "message-bubble--other"
                                                    }`}
                                            >
                                                {m.body}
                                            </div>
                                        )
                                    )
                                )}

                                <span className="message-time">
                                    {extractTimeOnly(m.created_at)}
                                    {m.edited && !m.deleted ? " · Edited" : ""}
                                    {showReceipt ? ` · ${m.read_at ? "Read" : "Delivered"}` : ""}
                                </span>

                                {isSelf && !isEditing && !m.deleted && openMessageMenuId === m.id && (
                                    <div className="message-actions">
                                        <div className="message-actions-menu">
                                            {canEdit && m.body && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setEditingMessageId(m.id);
                                                        setEditingText(m.body);
                                                        setOpenMessageMenuId(null);
                                                    }}
                                                >
                                                    <Pencil size={14} />
                                                    Edit
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                className="message-actions-menu__delete"
                                                onClick={async () => {
                                                    setOpenMessageMenuId(null);
                                                    if (!window.confirm("Delete this message?")) return;
                                                    await reqDeleteMessage(m.id);
                                                    queryClient.setQueryData<ChatMessage[]>(
                                                        messagesQueryKey,
                                                        (prev = []) =>
                                                            prev.map((message) =>
                                                                message.id === m.id
                                                                    ? { ...message, body: "", attachments: [], deleted: true }
                                                                    : message
                                                            )
                                                    );
                                                }}
                                            >
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

            {isUploading && (
                <LoadingSpinner
                    progress={uploadProgress}
                    loaded={uploadedBytes}
                    total={uploadTotalBytes}
                />
            )}
            <div ref={bottomRef} />
        </div>
    );
}