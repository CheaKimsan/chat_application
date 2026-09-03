import { ChevronLeft } from 'lucide-react';
import { useAuthStore } from "../../store/auth.store";

const COLORS = {
    border: '#2A2F37',
    dim: '#8B92A0',
    teal: '#4FA9A0',
    faint: '#565C66',
};

export interface Contact {
    name: string;
    freq: string;
    online: boolean;
    initials: string;
    profilePhoto?: string;
}

function InitialsAvatar({ initials, online, profilePhoto }: { initials: string; online: boolean; profilePhoto?: string }) {
    return (
        <div style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
            <div
                style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: '#20242A',
                    border: `1px solid ${COLORS.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: 13,
                    fontWeight: 600,
                    color: COLORS.dim,
                    letterSpacing: 0.5,
                }}
            >
                {profilePhoto ? (
                    <img
                        src={profilePhoto}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                ) : (
                    initials
                )}
            </div>

            {online && (
                <span
                    style={{
                        position: 'absolute',
                        bottom: -2,
                        right: -2,
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: COLORS.teal,
                        border: '2px solid #1B1F24',
                    }}
                />
            )}
        </div>
    );
}

function TypingDots() {
    return (
        <span style={{ display: 'inline-flex', gap: 2 }}>
            {[0, 1, 2].map((i) => (
                <span
                    key={i}
                    style={{
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        background: COLORS.teal,
                        animation: 'typingBounce 1s infinite',
                        animationDelay: `${i * 0.15}s`,
                    }}
                />
            ))}
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
    const user = useAuthStore((s) => s.user);

    const display =
        contact ??
        {
            name: 'Unknown',
            freq: '--',
            online: false,
            initials: '??',
        };

    return (
        <div
            style={{
                fontFamily: "'Inter', sans-serif",
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 20px',
                borderBottom: `1px solid ${COLORS.border}`,
                background: '#14171B',
                color: '#E7E3DA',
            }}
        >
            <style>{`
                @keyframes freqPulse{0%,100%{transform:scaleY(0.5);}50%{transform:scaleY(1.3);}}
                @keyframes typingBounce{0%,60%,100%{transform:translateY(0);opacity:0.4;}30%{transform:translateY(-3px);opacity:1;}}
                @media (max-width:640px){.back-btn{display:inline-flex!important;}}
            `}</style>

            <button
                onClick={onBack}
                className="back-btn"
                style={{ display: 'none', background: 'none', border: 'none', color: COLORS.dim, cursor: 'pointer', padding: 4 }}
                aria-label="Back"
            >
                <ChevronLeft size={18} />
            </button>

            <InitialsAvatar
                initials={display?.initials ?? '??'}
                online={display?.online ?? false}
                profilePhoto={display?.profilePhoto}
            />

            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}>
                    {display?.name || 'Unknown'}
                </div>
                <div style={{ fontSize: 11.5, color: COLORS.dim, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isTyping ? (
                        <span style={{ color: COLORS.teal, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <TypingDots />
                            typing…
                        </span>
                    ) : (
                        <>
                            <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>CH {display?.freq ?? '--'}</span>
                            <span>·</span>
                            <span style={{ color: display?.online ? COLORS.teal : COLORS.faint }}>
                                {display?.online ? 'on channel' : 'off channel'}
                            </span>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}