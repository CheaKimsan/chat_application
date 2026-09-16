import { ChevronLeft } from 'lucide-react';

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
}: {
    contact?: Contact;
    onBack?: () => void;
    isTyping?: boolean;
}) {
    const display =
        contact ??
        {
            name: 'Unknown',
            freq: '--',
            online: false,
            initials: '??',
        };

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
                    {isTyping ? (
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
        </header>
    );
}