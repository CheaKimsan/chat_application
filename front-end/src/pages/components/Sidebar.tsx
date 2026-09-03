import { useEffect, useState } from "react";
import { useAuthStore } from "../../store/auth.store";
import { useQuery } from "@tanstack/react-query";
import { UserResponse } from "../../components/user/core/model";
import { reqGetUsers } from "../../components/user/core/request";
import { Contact2, Search } from "lucide-react";

const C = {
    bg: "#0F1113",
    subBg: "#131518",
    border: "#23262A",
    text: "#DCE1E6",
    muted: "#8B92A0",
    accent: "#4FA9A0",
    accentDim: "rgba(79, 169, 160, 0.12)",
};

type SidebarProps = {
    onSelectContact?: (user: UserResponse) => void;
};

type TypingPayload = {
    from_user: string;
    to_user: string;
    is_typing: boolean;
};

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
    const [selectedUserId, setSelectedUserId] = useState<string | number | null>(null);
    const [search, setSearch] = useState("");
    const onlineUsers = usePresenceUsers();

    const {
        data: users = [],
        isLoading,
        error,
    } = useQuery<UserResponse[]>({
        queryKey: ["users"],
        queryFn: reqGetUsers,
    });

    const typingUsers = useTypingUsers(user?.id);


    const contactRows = users
        .filter((u) => u.id !== user?.id)
        .filter((u) => `${u.username} ${u.email}`.toLowerCase().includes(search.toLowerCase()))
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

            <section
                style={{
                    width: 300,
                    minWidth: 240,
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
                <div style={{ padding: "18px 16px 14px", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                        <div style={{ fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, display: "flex", alignItems: "center", gap: 4 }}>
                            <Contact2 size={22} />
                            {title}
                        </div>
                        <span style={{ color: C.muted, fontSize: 11 }}>{rows.length}</span>
                    </div>
                    <label
                        style={{
                            height: 34,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "0 10px",
                            borderRadius: 8,
                            background: "#0F1113",
                            border: `1px solid ${C.border}`,
                            color: C.muted,
                        }}
                    >
                        <Search size={15} />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search contacts"
                            aria-label="Search contacts"
                            style={{
                                width: "100%",
                                border: "none",
                                outline: "none",
                                background: "transparent",
                                color: C.text,
                                fontSize: 12,
                            }}
                        />
                    </label>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
                    {isLoading ? (
                        <div style={{ padding: 12, fontSize: 13, color: C.muted }}>Loading contacts…</div>
                    ) : error ? (
                        <div style={{ padding: 12, fontSize: 13, color: "#E27D7D" }}>Failed to load contacts</div>
                    ) : rows.length === 0 ? (
                        <div style={{ padding: 12, fontSize: 13, color: C.muted }}>No contacts found</div>
                    ) : (
                        rows.map((row, i) => {
                            const isSelected = row.user?.id === selectedUserId;
                            const isTyping = row.user ? typingUsers.has(String(row.user.id)) : false;

                            return (
                                <button
                                    key={row.user?.id ?? i}
                                    onClick={() => {
                                        if (row.user) {
                                            handleSelectContact(row.user);
                                        }
                                    }}
                                    style={{
                                        width: "100%",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        padding: "9px 10px",
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
                                    <span
                                        style={{
                                            width: 38,
                                            height: 38,
                                            flexShrink: 0,
                                            borderRadius: 10,
                                            background: "#20242A",
                                            border: `1px solid ${C.border}`,
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            overflow: "hidden",
                                            color: C.muted,
                                            fontSize: 12,
                                            fontWeight: 700,
                                        }}
                                    >
                                        {row.user?.profile_photo ? (
                                            <img
                                                src={row.user.profile_photo}
                                                alt=""
                                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                            />
                                        ) : (
                                            row.primary
                                                .split(" ")
                                                .map((part) => part[0]?.toUpperCase())
                                                .join("")
                                                .slice(0, 2)
                                        )}
                                    </span>

                                    <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                                        <span style={{ fontSize: 13, fontWeight: 600 }}>{row.primary}</span>
                                        {isTyping ? (
                                            <span style={{ fontSize: 12, color: C.accent, fontStyle: "italic" }}>
                                                typing…
                                            </span>
                                        ) : (
                                            <>
                                                {row.secondary && (
                                                    <span style={{ fontSize: 12, color: C.muted }}>{row.secondary}</span>
                                                )}
                                                <span style={{ fontSize: 11, color: row.presence.color }}>
                                                    {row.presence.label}
                                                </span>
                                            </>
                                        )}
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>
            </section >
        </div >
    );
}