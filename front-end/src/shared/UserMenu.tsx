import React, { useEffect, useRef, useState } from 'react';
import InviteButton from './Invitebutton';

interface UserMenuProps {
    username: string;
    email: string;
    onLogout: () => void;
}

export default function UserMenu({ username, email, onLogout }: UserMenuProps) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

    const initials = username
        .split(' ')
        .map((part) => part[0]?.toUpperCase())
        .join('')
        .slice(0, 2);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div ref={menuRef} style={{ position: 'relative' }}>
            <button
                onClick={() => setOpen((o) => !o)}
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: '1px solid #2A2D32',
                    background: '#4F46E5',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                }}
            >
                {initials}
            </button>

            {open && (
                <div
                    style={{
                        position: 'absolute',
                        top: 40,
                        right: 0,
                        minWidth: 220,
                        background: '#101317',
                        border: '1px solid #2A2D32',
                        borderRadius: 8,
                        padding: 12,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                        zIndex: 20,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: '50%',
                                background: '#4F46E5',
                                color: '#fff',
                                fontWeight: 700,
                                fontSize: 14,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            {initials}
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: '#E7E3DA', fontWeight: 600, fontSize: 14 }}>
                                {username}
                            </div>
                            {email && (
                                <div
                                    style={{
                                        color: '#8B92A0',
                                        fontSize: 12,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                    }}
                                >
                                    {email}
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{ height: 1, background: '#2A2D32' }} />

                    <div onClick={() => setOpen(false)}>
                        <InviteButton />
                    </div>

                    <button
                        onClick={() => {
                            setOpen(false);
                            onLogout();
                        }}
                        style={{
                            padding: '8px 10px',
                            borderRadius: 6,
                            border: '1px solid #2A2D32',
                            background: '#1a1c1f',
                            color: '#E7E3DA',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: 13,
                            textAlign: 'left',
                        }}
                    >
                        Logout
                    </button>
                </div>
            )}
        </div>
    );
}