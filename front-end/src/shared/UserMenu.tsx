import React, { useEffect, useRef, useState } from 'react';
import {
    LogOut,
    Camera,
} from 'lucide-react';
import InviteButton from './Invitebutton';
import { useAuthStore } from '../store/auth.store';
import { apiClient } from '../api/apiClient';

interface UserMenuProps {
    username: string;
    email: string;
    onLogout: () => void;
}

export default function UserMenu({ username, email, onLogout }: UserMenuProps) {
    const [open, setOpen] = useState(false);
    const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const user = useAuthStore((s) => s.user);
    const token = useAuthStore((s) => s.token);
    const setUser = useAuthStore((s) => s.setUser);

    useEffect(() => {
        setProfilePhoto(user?.profile_photo ?? null);
    }, [user?.profile_photo]);

    const initials = username
        .split(' ')
        .map((part) => part[0]?.toUpperCase())
        .join('')
        .slice(0, 2)
        .toUpperCase();

    const usernameUpper = username.toUpperCase();

    const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !user) {
            return;
        }

        event.target.value = '';

        const previousPhoto = profilePhoto;
        const previewUrl = URL.createObjectURL(file);
        setProfilePhoto(previewUrl);

        const formData = new FormData();
        formData.append('photo', file);

        try {
            const response = await apiClient.post(`/users/${user.id}/photo`, formData);
            const updatedPhoto = response.data.user?.profile_photo;

            if (!updatedPhoto) {
                throw new Error('The server did not return a profile photo URL');
            }

            setProfilePhoto(updatedPhoto);
            setUser({ ...user, profile_photo: updatedPhoto }, token ?? '');
        } catch (error) {
            URL.revokeObjectURL(previewUrl);
            setProfilePhoto(previousPhoto);
            console.error('Failed to update profile photo:', error);
        }
    };

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
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handlePhotoChange}
            />

            <button
                onClick={() => setOpen((o) => !o)}
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: '1px solid #2A2D32',
                    background: 'linear-gradient(135deg, #5b5bf6, #8251ff)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 0 0 1px rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                    padding: 0,
                }}
                aria-label="Open user menu"
            >
                {profilePhoto ? (
                    <img
                        src={profilePhoto}
                        alt="Profile avatar"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                ) : (
                    initials
                )}
            </button>

            {open && (
                <div
                    style={{
                        position: 'absolute',
                        top: 42,
                        right: 0,
                        width: 360,
                        background: '#1b1d21',
                        border: '1px solid #30353b',
                        borderRadius: 16,
                        boxShadow: '0 22px 60px rgba(0,0,0,0.45)',
                        zIndex: 20,
                        overflow: 'hidden',
                    }}
                >
                    <div
                        style={{
                            background: '#2d3138',
                            padding: '20px 18px 18px',
                            borderBottom: '1px solid #3a4049',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            textAlign: 'center',
                        }}
                    >
                        <div
                            style={{
                                position: 'relative',
                                width: 72,
                                height: 72,
                                borderRadius: '50%',
                                border: '3px solid rgba(255,255,255,0.15)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                overflow: 'hidden',
                                marginBottom: 12,
                                cursor: 'pointer',
                            }}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            {profilePhoto ? (
                                <img
                                    src={profilePhoto}
                                    alt="Profile avatar"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                            ) : (
                                <span style={{ color: '#fff', fontWeight: 700, fontSize: 26 }}>
                                    {initials}
                                </span>
                            )}

                            <button
                                type="button"
                                aria-label="Upload profile photo"
                                style={{
                                    position: 'absolute',
                                    right: -2,
                                    bottom: -2,
                                    width: 24,
                                    height: 24,
                                    borderRadius: '50%',
                                    border: 'none',
                                    background: '#1a1d22',
                                    color: '#fff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    boxShadow: '0 0 0 2px rgba(255,255,255,0.1)',
                                }}
                            >
                                <Camera size={12} />
                            </button>
                        </div>

                        <div
                            style={{
                                color: '#f0f3f8',
                                fontSize: 17,
                                fontWeight: 600,
                                marginBottom: 6,
                            }}
                        >
                            {usernameUpper}
                        </div>

                        {email && (
                            <div
                                style={{
                                    color: '#cbd0d8',
                                    fontSize: 13,
                                    wordBreak: 'break-word',
                                }}
                            >
                                {email}
                            </div>
                        )}
                    </div>

                    <div style={{ height: 1, background: '#30353b' }} />

                    <div style={{ background: '#1b1d21', padding: '14px 0 10px' }}>
                        <div
                            style={{
                                color: '#edf2fa',
                                fontSize: 15,
                                fontWeight: 700,
                                padding: '0 16px 12px',
                            }}
                        >
                            Setting Application
                        </div>

                        <InviteButton />

                        <button
                            onClick={() => {
                                setOpen(false);
                                onLogout();
                            }}
                            style={{
                                width: '100%',
                                border: 'none',
                                background: 'transparent',
                                color: '#eef2f7',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '12px 16px 4px',
                                cursor: 'pointer',
                                textAlign: 'left',
                            }}
                        >
                            <LogOut size={18} color="#d9e0ee" />
                            <span style={{ fontSize: 14 }}>Sign out</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}