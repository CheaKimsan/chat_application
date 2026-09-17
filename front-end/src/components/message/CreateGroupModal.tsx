import { useState } from "react";
import { X, Users, Search, Check } from "lucide-react";
import { UserResponse } from "../user/core/model";

interface CreateGroupModalProps {
    contacts: UserResponse[];
    onClose: () => void;
    onCreate: (name: string, memberIds: string[]) => Promise<void>;
}

const initialsOf = (name: string) =>
    name
        .split(" ")
        .map((p) => p[0]?.toUpperCase())
        .join("")
        .slice(0, 2) || "?";

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
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>

                {/* Header */}
                <div className="modal__header">
                    <div className="modal__title">
                        <span className="modal__title-icon">
                            <Users size={16} />
                        </span>
                        <span>New group</span>
                    </div>
                    <button
                        className="modal__close"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="modal__body">

                    {/* Group name */}
                    <div className="modal__field">
                        <label className="modal__label" htmlFor="groupName">
                            Group name
                        </label>
                        <input
                            id="groupName"
                            className="modal__input"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Design team"
                            autoFocus
                        />
                    </div>

                    {/* Member search */}
                    <div className="modal__field">
                        <label className="modal__label" htmlFor="memberSearch">
                            Members
                            {selected.size > 0 && (
                                <span className="modal__label-count">· {selected.size} selected</span>
                            )}
                        </label>
                        <div className="modal__search">
                            <Search size={14} />
                            <input
                                id="memberSearch"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search contacts…"
                            />
                        </div>
                    </div>

                    {/* Selected chips */}
                    {selected.size > 0 && (
                        <div className="modal__chips">
                            {Array.from(selected).map((id) => {
                                const c = contacts.find((x) => String(x.id) === id);
                                if (!c) return null;
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        className="modal__chip"
                                        onClick={() => toggleMember(id)}
                                        title="Remove"
                                    >
                                        {c.profile_photo ? (
                                            <img src={c.profile_photo} alt="" className="modal__chip-img" />
                                        ) : (
                                            <span className="modal__chip-initials">{initialsOf(c.username)}</span>
                                        )}
                                        <span className="modal__chip-name">{c.username}</span>
                                        <X size={12} className="modal__chip-x" />
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Member list */}
                    <div className="modal__list">
                        {filteredContacts.length === 0 ? (
                            <div className="modal__empty">No contacts found</div>
                        ) : (
                            filteredContacts.map((contact) => {
                                const id = String(contact.id);
                                const isChecked = selected.has(id);
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => toggleMember(id)}
                                        className={`modal__row${isChecked ? " modal__row--checked" : ""}`}
                                    >
                                        <span className="modal__row-avatar">
                                            {contact.profile_photo ? (
                                                <img src={contact.profile_photo} alt="" />
                                            ) : (
                                                initialsOf(contact.username)
                                            )}
                                        </span>

                                        <span className="modal__row-body">
                                            <span className="modal__row-name">{contact.username}</span>
                                            {contact.email && (
                                                <span className="modal__row-email">{contact.email}</span>
                                            )}
                                        </span>

                                        <span className={`modal__checkbox${isChecked ? " modal__checkbox--on" : ""}`}>
                                            {isChecked && <Check size={12} strokeWidth={3} />}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="modal__footer">
                    {error && <div className="modal__error">{error}</div>}
                    <button
                        className="modal__submit"
                        onClick={handleCreate}
                        disabled={isCreating}
                    >
                        {isCreating ? (
                            <>
                                <span className="modal__spinner" />
                                Creating…
                            </>
                        ) : (
                            `Create group${selected.size > 0 ? ` (${selected.size})` : ""}`
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}