import { useState } from "react";
import { X, Users, Search, Check } from "lucide-react";
import { UserResponse } from "../user/core/model";

const C = {
    bg: "#0F1113",
    subBg: "#131518",
    border: "#23262A",
    text: "#DCE1E6",
    muted: "#8B92A0",
    accent: "#4FA9A0",
    accentDim: "rgba(79, 169, 160, 0.12)",
    danger: "#E27D7D",
};

interface CreateGroupModalProps {
    contacts: UserResponse[];
    onClose: () => void;
    onCreate: (name: string, memberIds: string[]) => Promise<void>;
}

export default function CreateGroupModal({ contacts, onClose, onCreate }: CreateGroupModalProps) {
    const [name, setName] = useState("");
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const toggleMember = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const filteredContacts = contacts.filter((c) =>
        `${c.username} ${c.email}`.toLowerCase().includes(search.toLowerCase())
    );

    const handleCreate = async () => {
        if (!name.trim()) {
            setError("Group name is required.");
            return;
        }
        if (selected.size === 0) {
            setError("Pick at least one member.");
            return;
        }
        setIsCreating(true);
        setError(null);
        try {
            await onCreate(name.trim(), Array.from(selected));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create group.");
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: 380,
                    maxHeight: "80vh",
                    display: "flex",
                    flexDirection: "column",
                    background: C.subBg,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    color: C.text,
                    overflow: "hidden",
                }}
            >
                {/* Header */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "16px 16px 14px",
                        borderBottom: `1px solid ${C.border}`,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15 }}>
                        <Users size={18} color={C.accent} />
                        New group
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            width: 28,
                            height: 28,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "transparent",
                            border: "none",
                            borderRadius: 6,
                            color: C.muted,
                            cursor: "pointer",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#191c1f")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Group name input */}
                <div style={{ padding: "14px 16px 10px" }}>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Group name"
                        autoFocus
                        style={{
                            width: "100%",
                            height: 38,
                            padding: "0 12px",
                            borderRadius: 8,
                            background: C.bg,
                            border: `1px solid ${C.border}`,
                            color: C.text,
                            fontSize: 13,
                            outline: "none",
                            boxSizing: "border-box",
                        }}
                    />
                </div>

                {/* Member search */}
                <div style={{ padding: "0 16px 10px" }}>
                    <label
                        style={{
                            height: 34,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "0 10px",
                            borderRadius: 8,
                            background: C.bg,
                            border: `1px solid ${C.border}`,
                            color: C.muted,
                        }}
                    >
                        <Search size={14} />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search contacts"
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

                {/* Member list */}
                <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px", minHeight: 120 }}>
                    {filteredContacts.length === 0 ? (
                        <div style={{ padding: 16, fontSize: 13, color: C.muted, textAlign: "center" }}>
                            No contacts found
                        </div>
                    ) : (
                        filteredContacts.map((contact) => {
                            const id = String(contact.id);
                            const isChecked = selected.has(id);
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => toggleMember(id)}
                                    style={{
                                        width: "100%",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        padding: "8px 10px",
                                        borderRadius: 8,
                                        background: isChecked ? C.accentDim : "transparent",
                                        border: "none",
                                        textAlign: "left",
                                        cursor: "pointer",
                                        color: C.text,
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isChecked) e.currentTarget.style.background = "#191c1f";
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isChecked) e.currentTarget.style.background = "transparent";
                                    }}
                                >
                                    <span
                                        style={{
                                            width: 32,
                                            height: 32,
                                            flexShrink: 0,
                                            borderRadius: 9,
                                            background: "#20242A",
                                            border: `1px solid ${C.border}`,
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            overflow: "hidden",
                                            color: C.muted,
                                            fontSize: 11,
                                            fontWeight: 700,
                                        }}
                                    >
                                        {contact.profile_photo ? (
                                            <img src={contact.profile_photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                        ) : (
                                            contact.username.split(" ").map((p) => p[0]?.toUpperCase()).join("").slice(0, 2)
                                        )}
                                    </span>

                                    <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{contact.username}</span>

                                    <span
                                        style={{
                                            width: 18,
                                            height: 18,
                                            flexShrink: 0,
                                            borderRadius: 5,
                                            border: `1px solid ${isChecked ? C.accent : C.border}`,
                                            background: isChecked ? C.accent : "transparent",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                        }}
                                    >
                                        {isChecked && <Check size={12} color={C.bg} />}
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>

                {/* Error */}
                {error && (
                    <div style={{ padding: "0 16px 8px", fontSize: 12, color: C.danger }}>
                        {error}
                    </div>
                )}

                {/* Footer */}
                <div style={{ padding: 16, borderTop: `1px solid ${C.border}` }}>
                    <button
                        onClick={handleCreate}
                        disabled={isCreating}
                        style={{
                            width: "100%",
                            height: 38,
                            borderRadius: 8,
                            border: "none",
                            background: isCreating ? "#2a2f33" : C.accent,
                            color: isCreating ? C.muted : "#0F1113",
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: isCreating ? "default" : "pointer",
                        }}
                    >
                        {isCreating ? "Creating…" : `Create group${selected.size > 0 ? ` (${selected.size})` : ""}`}
                    </button>
                </div>
            </div>
        </div>
    );
}