// src/components/layout/Sidebar.tsx
import { useEffect, useState } from "react";
import { useAuthStore } from "../../store/auth.store";
import { useQuery } from "@tanstack/react-query";
import { UserResponse } from "../../components/user/core/model";
import { reqGetUsers } from "../../components/user/core/request";
import { Contact2, Plus, Search, Users } from "lucide-react";
import { Conversation } from "./Layout";

interface SidebarProps {
    onSelectContact: (u: UserResponse) => void;
    onSelectGroup?: (group: Conversation) => void;
    onCreateGroupClick?: () => void;
    conversations?: Conversation[];
    activeContactId?: string;
    activeGroupId?: string;
}

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
            if (String(detail.to_user) !== String(currentUserId)) return;

            setTypingUsers((prev) => {
                const next = new Set(prev);
                if (detail.is_typing) next.add(String(detail.from_user));
                else next.delete(String(detail.from_user));
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
                if (detail.status === "online") next.add(String(detail.user_id));
                else next.delete(String(detail.user_id));
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

function initialsOf(name: string) {
    return (
        name
            .split(" ")
            .map((part) => part[0]?.toUpperCase())
            .join("")
            .slice(0, 2) || "?"
    );
}

export default function Sidebar({
    onSelectContact,
    onSelectGroup,
    onCreateGroupClick,
    conversations = [],
    activeContactId,
    activeGroupId,
}: SidebarProps) {
    const user = useAuthStore((s) => s.user);
    const [search, setSearch] = useState("");
    const onlineUsers = usePresenceUsers();

    const { data: users = [], isLoading, error } = useQuery<UserResponse[]>({
        queryKey: ["users"],
        queryFn: reqGetUsers,
    });

    const typingUsers = useTypingUsers(user?.id);

    const groups = conversations.filter((c) => c.isGroup);

    const contactRows = users
        .filter((u) => u.id !== user?.id)
        .filter((u) =>
            `${u.username} ${u.email}`.toLowerCase().includes(search.toLowerCase())
        )
        .map((u) => ({
            primary: u.username,
            secondary: u.email,
            user: u,
            online: onlineUsers.has(String(u.id)),
        }));

    const groupRows = groups.filter((g) =>
        (g.name ?? "Group").toLowerCase().includes(search.toLowerCase())
    );

    return (
        <aside className="sidebar">
            {/* Header */}
            <div className="sidebar__header">
                <div className="sidebar__title">
                    <Contact2 size={20} />
                    <span>Messages</span>
                </div>

                <label className="sidebar__search">
                    <Search size={15} />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search"
                        aria-label="Search"
                    />
                </label>
            </div>

            {/* Scroll body */}
            <div className="sidebar__body">
                {/* Groups */}
                <div className="sidebar__section">
                    <div className="sidebar__section-head">
                        <span className="sidebar__section-label">
                            Groups {groupRows.length > 0 && <em>· {groupRows.length}</em>}
                        </span>
                        <button
                            type="button"
                            className="sidebar__new-btn"
                            onClick={onCreateGroupClick}
                        >
                            <Plus size={12} />
                            New
                        </button>
                    </div>

                    {groupRows.length === 0 ? (
                        <div className="sidebar__empty">No groups yet — start one above.</div>
                    ) : (
                        groupRows.map((g) => {
                            const isSelected = g.id === activeGroupId;
                            const name = g.name ?? "Group";
                            const count = g.members?.length ?? 0;

                            return (
                                <button
                                    key={g.id}
                                    type="button"
                                    className={`sidebar-row${isSelected ? " sidebar-row--active" : ""}`}
                                    onClick={() => onSelectGroup?.(g)}
                                    aria-current={isSelected}
                                >
                                    <span className="sidebar-row__avatar sidebar-row__avatar--group">
                                        {g.profile_photo ? (
                                            <img src={g.profile_photo} alt="" />
                                        ) : (
                                            <Users size={16} />
                                        )}
                                    </span>
                                    <span className="sidebar-row__body">
                                        <span className="sidebar-row__name">{name}</span>
                                        <span className="sidebar-row__meta">
                                            {count} member{count === 1 ? "" : "s"}
                                        </span>
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>

                <div className="sidebar__divider" />

                {/* Contacts */}
                <div className="sidebar__section">
                    <div className="sidebar__section-head">
                        <span className="sidebar__section-label">
                            Contacts {contactRows.length > 0 && <em>· {contactRows.length}</em>}
                        </span>
                    </div>

                    {isLoading ? (
                        <div className="sidebar__empty">Loading contacts…</div>
                    ) : error ? (
                        <div className="sidebar__empty sidebar__empty--error">
                            Failed to load contacts
                        </div>
                    ) : contactRows.length === 0 ? (
                        <div className="sidebar__empty">No contacts found</div>
                    ) : (
                        contactRows.map((row) => {
                            const isSelected = String(row.user.id) === activeContactId;
                            const isTyping = typingUsers.has(String(row.user.id));

                            return (
                                <button
                                    key={row.user.id}
                                    type="button"
                                    className={`sidebar-row${isSelected ? " sidebar-row--active" : ""}`}
                                    onClick={() => onSelectContact(row.user)}
                                    aria-current={isSelected}
                                >
                                    <span className="sidebar-row__avatar">
                                        {row.user.profile_photo ? (
                                            <img src={row.user.profile_photo} alt="" />
                                        ) : (
                                            initialsOf(row.primary)
                                        )}
                                        <span
                                            className={`sidebar-row__status${row.online ? " sidebar-row__status--online" : ""
                                                }`}
                                        />
                                    </span>

                                    <span className="sidebar-row__body">
                                        <span className="sidebar-row__name">{row.primary}</span>
                                        {isTyping ? (
                                            <span className="sidebar-row__typing">typing…</span>
                                        ) : (
                                            <>
                                                {row.secondary && (
                                                    <span className="sidebar-row__meta">{row.secondary}</span>
                                                )}
                                                <span
                                                    className={`sidebar-row__meta sidebar-row__meta--status${row.online ? " is-online" : ""
                                                        }`}
                                                >
                                                    {row.online ? "Online" : "Offline"}
                                                </span>
                                            </>
                                        )}
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
        </aside>
    );
}