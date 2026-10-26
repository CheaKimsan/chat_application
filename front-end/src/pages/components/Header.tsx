import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, MoreVertical, ShieldBan, ShieldCheck } from 'lucide-react';

export interface Contact {
    name: string;
    freq: string;
    online: boolean;
    initials: string;
    profilePhoto?: string;
}

function InitialsAvatar({ initials, online, profilePhoto }: { initials: string; online: boolean; profilePhoto?: string }) {
    return (
        <div className="chat-header__avatar-wrap">
            <div className="chat-header__avatar">
                {profilePhoto ? (
                    <img src={profilePhoto} alt="" />
                ) : (
                    initials
                )}
            </div>
            {online && <span className="chat-header__status-dot" aria-label="Online" />}
        </div>
    );
}

function TypingDots() {
    return (
        <span className="typing-dots" aria-hidden="true">
            <span /><span /><span />
        </span>
    );
}

export default function ChatHeader({
    contact,
    onBack,
    isTyping = false,
    isBlocked = false,
    onToggleBlock,
    isUpdatingBlock = false,
    blockError,
}: {
    contact?: Contact;
    onBack?: () => void;
    isTyping?: boolean;
    isBlocked?: boolean;
    onToggleBlock?: () => void;
    isUpdatingBlock?: boolean;
    blockError?: string | null;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const display =
        contact ??
        {
            name: 'Unknown',
            freq: '--',
            online: false,
            initials: '??',
        };

    useEffect(() => {
        if (!menuOpen) return;

        const handlePointerDown = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setMenuOpen(false);
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [menuOpen]);

    return (
        <header className="chat-header">
            <button
                onClick={onBack}
                className="chat-header__back"
                aria-label="Back"
            >
                <ChevronLeft size={18} />
            </button>

            <InitialsAvatar
                initials={display?.initials ?? '??'}
                online={display?.online ?? false}
                profilePhoto={display?.profilePhoto}
            />

            <div className="chat-header__info">
                <div className="chat-header__name">
                    {display?.name || 'Unknown'}
                </div>
                <div className="chat-header__sub">
                    {isBlocked ? (
                        <span className="chat-header__status chat-header__status--blocked">Blocked</span>
                    ) : isTyping ? (
                        <span className="chat-header__typing">
                            <TypingDots />
                            typing…
                        </span>
                    ) : (
                        <span
                            className={`chat-header__status${display?.online ? ' chat-header__status--online' : ''}`}
                        >
                            {display?.online ? 'Online' : 'Offline'}
                        </span>
                    )}
                </div>
            </div>
            {onToggleBlock && (
                <div className="chat-header__menu" ref={menuRef}>
                    <button
                        type="button"
                        className="chat-header__menu-trigger"
                        onClick={() => setMenuOpen((open) => !open)}
                        aria-label="Chat options"
                        title="Chat options"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                    >
                        <MoreVertical size={19} />
                    </button>
                    {menuOpen && (
                        <div className="chat-header__menu-popover" role="menu">
                            <button
                                type="button"
                                role="menuitem"
                                className={`chat-header__menu-item${isBlocked ? '' : ' chat-header__menu-item--danger'}`}
                                onClick={() => {
                                    setMenuOpen(false);
                                    onToggleBlock();
                                }}
                                disabled={isUpdatingBlock}
                            >
                                {isBlocked ? <ShieldCheck size={16} /> : <ShieldBan size={16} />}
                                <span>{isUpdatingBlock ? 'Updating…' : isBlocked ? 'Unblock user' : 'Block user'}</span>
                            </button>
                            {blockError && <p className="chat-header__menu-error" role="alert">{blockError}</p>}
                        </div>
                    )}
                </div>
            )}
        </header>
    );
}