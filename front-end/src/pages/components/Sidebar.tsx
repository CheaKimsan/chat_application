import { useEffect, useState } from "react";
import { useAuthStore } from "../../store/auth.store";
import { useQuery } from "@tanstack/react-query";
import { reqGetUsers } from "../../api/requestUser";
import { UserResponse } from "./core/model";

const C = {
    bg: "#0F1113",
    subBg: "#131518",
    border: "#23262A",
    text: "#DCE1E6",
    muted: "#8B92A0",
    accent: "#4FA9A0",
    accentDim: "rgba(79, 169, 160, 0.12)",
};

type ItemId = "contacts";

const items: { id: ItemId; label: string }[] = [
    { id: "contacts", label: "Contacts" },
];

type SidebarProps = {
    onSelectContact?: (user: UserResponse) => void;
};

type TypingPayload = {
    from_user: string;
    to_user: string;
    is_typing: boolean;
};

type PresenceState = "online" | "away" | "offline";

function getPresenceMeta(id?: string | number) {
    const seed = typeof id === "undefined" ? 0 : String(id)
        .split("")
        .reduce((sum, ch) => sum + ch.charCodeAt(0), 0);

    const state: PresenceState = seed % 5 === 0 ? "offline" : seed % 3 === 0 ? "away" : "online";

    const label =
        state === "online"
            ? "Online"
            : state === "away"
                ? `Last active ${((seed % 8) + 2).toString()}m ago`
                : `Offline since ${(seed % 12) + 2}h ago`;

    const color = state === "online" ? C.accent : state === "away" ? "#FBBF24" : "#8B92A0";

    return { state, label, color };
}

function useTypingUsers(currentUserId: string | number | undefined) {
    const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!currentUserId) return;

        const handler = (e: Event) => {
            const detail = (e as CustomEvent<TypingPayload>).detail;
            if (!detail) return;

            // Only care about typing events directed at me
            if (String(detail.to_user) !== String(currentUserId)) return;

            setTypingUsers((prev) => {
                const next = new Set(prev);
                if (detail.is_typing) {
                    next.add(String(detail.from_user));
                } else {
                    next.delete(String(detail.from_user));
                }
                return next;
            });
        };

        window.addEventListener("chat:typing", handler);
        return () => window.removeEventListener("chat:typing", handler);
    }, [currentUserId]);

    return typingUsers;
}

function usePresenceUsers() {
    const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

    useEffect(() => {
        const handlePresence = (e: Event) => {
            const detail = (e as CustomEvent<{ user_id?: string | number; status?: string }>).detail;
            if (!detail?.user_id) return;

            setOnlineUsers((prev) => {
                const next = new Set(prev);
                if (detail.status === "online") {
                    next.add(String(detail.user_id));
                } else {
                    next.delete(String(detail.user_id));
                }
                return next;
            });
        };

        const handleSnapshot = (e: Event) => {
            const detail = (e as CustomEvent<{ users?: Array<string | number> }>).detail;
            if (!detail?.users) return;

            setOnlineUsers(new Set(detail.users.map(String)));
        };

        window.addEventListener("chat:presence", handlePresence);
        window.addEventListener("chat:presence_snapshot", handleSnapshot);
        return () => {
            window.removeEventListener("chat:presence", handlePresence);
            window.removeEventListener("chat:presence_snapshot", handleSnapshot);
        };
    }, []);

    return onlineUsers;
}

export default function Sidebar({ onSelectContact }: SidebarProps) {
    const user = useAuthStore((s) => s.user);
    const [active, setActive] = useState<ItemId>("contacts");
    const [selectedUserId, setSelectedUserId] = useState<string | number | null>(null);
    const onlineUsers = usePresenceUsers();

    const {
        data: users = [],
        isLoading,
        error,
    } = useQuery<UserResponse[]>({
        queryKey: ["users"],
        queryFn: reqGetUsers,
    });

    // Live set of user IDs currently typing to me
    const typingUsers = useTypingUsers(user?.id);

    // Map fetched users into contact rows, excluding the logged-in user.
    const myPresence = {
        label: user ? (onlineUsers.has(String(user.id)) ? "Online" : "Offline") : "Not signed in",
        color: user ? (onlineUsers.has(String(user.id)) ? C.accent : C.muted) : C.muted,
    };

    const contactRows = users
        .filter((u) => u.id !== user?.id)
        .map((u) => ({
            primary: u.username,
            secondary: u.email,
            user: u,
            presence: onlineUsers.has(String(u.id))
                ? { label: "Online", color: C.accent }
                : { label: "Offline", color: C.muted },
        }));

    const handleSelectContact = (u: UserResponse) => {
        setSelectedUserId(u.id);
        onSelectContact?.(u);
    };

    const title = "Contacts";
    const rows = contactRows;

    return (
        <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
            <aside
                style={{
                    width: 260,
                    minWidth: 200,
                    background: C.bg,
                    borderRight: `1px solid ${C.border}`,
                    color: C.text,
                    display: "flex",
                    flexDirection: "column",
                    height: "100vh",
                    overflow: "hidden",
                    position: "sticky",
                    top: 0,
                    left: 0,
                }}
            >
                <div style={{ padding: "18px 16px", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 13, color: C.muted }}>Welcome</div>
                    <div style={{ marginTop: 8, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
                        {user?.username ?? "Guest"}
                    </div>
                </div>

                <nav style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                    {items.map((it) => {
                        const isActive = it.id === active;
                        return (
                            <button
                                key={it.id}
                                onClick={() => setActive(it.id)}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    padding: "10px 12px",
                                    borderRadius: 8,
                                    background: isActive ? C.accentDim : "transparent",
                                    color: isActive ? C.text : C.text,
                                    border: "none",
                                    textAlign: "left",
                                    cursor: "pointer",
                                }}
                                aria-label={it.label}
                                aria-current={isActive}
                            >
                                <span
                                    style={{
                                        width: 34,
                                        height: 34,
                                        borderRadius: 8,
                                        background: isActive ? C.accent : "#151718",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        color: isActive ? "#0F1113" : C.muted,
                                        fontSize: 12,
                                        fontWeight: 700,
                                        transition: "background 120ms ease, color 120ms ease",
                                    }}
                                >
                                    {it.label[0]}
                                </span>
                                <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 400 }}>{it.label}</span>
                            </button>
                        );
                    })}
                </nav>

                <div style={{ marginTop: "auto", padding: 12, borderTop: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 12, color: C.muted }}>Status</div>
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                            style={{
                                width: 10,
                                height: 10,
                                borderRadius: "50%",
                                background: user ? myPresence.color : C.muted,
                            }}
                        />
                        <div style={{ fontSize: 13 }}>{user ? myPresence.label : "Not signed in"}</div>
                    </div>
                </div>
            </aside>

            <section
                style={{
                    width: 280,
                    minWidth: 220,
                    background: C.subBg,
                    borderRight: `1px solid ${C.border}`,
                    color: C.text,
                    display: "flex",
                    flexDirection: "column",
                    height: "100vh",
                    overflow: "hidden",
                    position: "sticky",
                    top: 0,
                }}
            >
                <div style={{ padding: "18px 16px", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", fontSize: 15 }}>
                        {title}
                    </div>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
                    {active === "contacts" && isLoading ? (
                        <div style={{ padding: 12, fontSize: 13, color: C.muted }}>Loading contacts…</div>
                    ) : active === "contacts" && error ? (
                        <div style={{ padding: 12, fontSize: 13, color: "#E27D7D" }}>Failed to load contacts</div>
                    ) : rows.length === 0 && active === "contacts" ? (
                        <div style={{ padding: 12, fontSize: 13, color: C.muted }}>No contacts found</div>
                    ) : (
                        rows.map((row, i) => {
                            const isSelected =
                                active === "contacts" && row.user?.id === selectedUserId;
                            const isTyping = row.user ? typingUsers.has(String(row.user.id)) : false;

                            return (
                                <button
                                    key={row.user?.id ?? i}
                                    onClick={() => {
                                        if (active === "contacts" && row.user) {
                                            handleSelectContact(row.user);
                                        }
                                    }}
                                    style={{
                                        width: "100%",
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "flex-start",
                                        gap: 2,
                                        padding: "10px 12px",
                                        borderRadius: 8,
                                        background: isSelected ? C.accentDim : "transparent",
                                        border: "none",
                                        textAlign: "left",
                                        cursor: "pointer",
                                        color: C.text,
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isSelected) e.currentTarget.style.background = "#191c1f";
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isSelected) e.currentTarget.style.background = "transparent";
                                    }}
                                    aria-current={isSelected}
                                >
                                    <span style={{ fontSize: 13, fontWeight: 600 }}>{row.primary}</span>
                                    {isTyping ? (
                                        <span
                                            style={{
                                                fontSize: 12,
                                                color: C.accent,
                                                fontStyle: "italic",
                                            }}
                                        >
                                            typing…
                                        </span>
                                    ) : (
                                        <>
                                            {row.secondary && (
                                                <span style={{ fontSize: 12, color: C.muted }}>{row.secondary}</span>
                                            )}
                                            <span
                                                style={{
                                                    fontSize: 11,
                                                    color: row.presence.color,
                                                    marginTop: 2,
                                                }}
                                            >
                                                {row.presence.label}
                                            </span>
                                        </>
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>
            </section>
        </div>
    );
}