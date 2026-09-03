import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import ChatHeader from './Header';
import { useAuthStore } from '../../store/auth.store';
import Sidebar from './Sidebar';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTypingUsers } from '../../store/typing.store';
import { connectSocket, disconnectSocket, sendTyping } from '../../socket/socketClient';
import UserMenu from "../../shared/UserMenu";
import { UserResponse } from "../../components/user/core/model";
import { reqSendMessage, reqUploadFile } from "../../components/message/core/request";
import { Lock, MessageCircle, Paperclip, Send } from 'lucide-react';


export default function Layout() {
    const user = useAuthStore((s) => s.user);
    const token = useAuthStore((s) => s.token);
    const queryClient = useQueryClient();

    const clearUser = useAuthStore((s) => s.clearUser);
    const navigate = useNavigate();

    useEffect(() => {
        if (!token) return;
        connectSocket(token);
        return () => {
            disconnectSocket();
        };
    }, [token]);


    const [selectedContact, setSelectedContact] = useState<UserResponse | undefined>(undefined);

    const contact = selectedContact
        ? {
            name: selectedContact.username,
            freq: '104.2',
            online: true,
            profilePhoto: selectedContact.profile_photo,
            initials: (selectedContact.username)
                .split(' ')
                .map((part: string) => part[0]?.toUpperCase())
                .join('')
                .slice(0, 2),
        }
        : user
            ? {
                name: user.username,
                freq: '104.2',
                online: true,
                profilePhoto: user.profile_photo,
                initials: user.username
                    .split(' ')
                    .map((part: string) => part[0]?.toUpperCase())
                    .join('')
                    .slice(0, 2),
            }
            : undefined;

    const typingUsers = useTypingUsers(user?.id);
    const isTyping = selectedContact ? typingUsers.has(String(selectedContact.id)) : false;

    const [outletInput, setOutletInput] = useState('');
    const [isEncrypted, setIsEncrypted] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadedBytes, setUploadedBytes] = useState(0);
    const [uploadTotalBytes, setUploadTotalBytes] = useState(0);
    const [uploadFileCount, setUploadFileCount] = useState(0);
    const fileInputRef = useRef<HTMLInputElement | null>(null);



    const handleLogout = () => {
        disconnectSocket();
        clearUser();
        queryClient.clear();
        navigate('/');
    };


    const typingTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const isTypingRef = useRef(false);

    const stopTyping = () => {
        if (!selectedContact) return;
        clearTimeout(typingTimeout.current);
        if (isTypingRef.current) {
            isTypingRef.current = false;
            sendTyping(String(selectedContact.id), false);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setOutletInput(e.target.value);

        if (!selectedContact) return;

        if (!isTypingRef.current) {
            isTypingRef.current = true;
            sendTyping(String(selectedContact.id), true);
        }

        clearTimeout(typingTimeout.current);
        typingTimeout.current = setTimeout(() => {
            isTypingRef.current = false;
            sendTyping(String(selectedContact.id), false);
        }, 2000);
    };

    const sendMutation = useMutation({
        mutationFn: reqSendMessage,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["messages", selectedContact?.id] });
        },
        onError: (err) => {
            console.error('Failed to send message:', err);
        },
    });

    const handleSend = () => {
        const trimmed = outletInput.trim();
        if (!trimmed || !selectedContact) return;

        stopTyping();

        sendMutation.mutate({
            to_user: String(selectedContact.id),
            body: trimmed,
            encrypted: isEncrypted,
        });
        setOutletInput('');
    };

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = event.target.files;
        if (!fileList || fileList.length === 0 || !selectedContact) return;

        const files = Array.from(fileList);
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);

        try {
            setIsUploading(true);
            setUploadProgress(0);
            setUploadedBytes(0);
            setUploadTotalBytes(totalSize);
            setUploadFileCount(files.length);

            const createdMessage = await sendMutation.mutateAsync({
                to_user: String(selectedContact.id),
                body: undefined,
            });

            const messageId = createdMessage?.id;
            if (!messageId) {
                throw new Error('Message was not created successfully.');
            }

            await reqUploadFile(messageId, files, (progress, loaded, total) => {
                setUploadProgress(progress);
                if (loaded !== undefined) setUploadedBytes(loaded);
                if (total !== undefined) setUploadTotalBytes(total);
            });
            queryClient.invalidateQueries({ queryKey: ["messages", selectedContact.id] });
        } catch (err) {
            console.error('Failed to upload file:', err);
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
            setUploadedBytes(0);
            setUploadTotalBytes(0);
            setUploadFileCount(0);
            event.target.value = '';
        }
    };

    const handleSelectContact = (u: UserResponse) => {
        stopTyping();
        setSelectedContact(u);
    };

    return (
        <div style={{ display: 'flex', height: '100vh', background: '#0B0C0D', overflow: 'hidden' }}>
            <style>{`
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `}</style>
            <Sidebar onSelectContact={handleSelectContact} />

            <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100vh', overflow: 'hidden' }}>
                {selectedContact && <ChatHeader contact={contact} isTyping={isTyping} />}

                <div
                    style={{
                        position: 'absolute',
                        top: 12,
                        right: 16,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                    }}
                >
                    <div
                        style={{
                            position: 'absolute',
                            top: 12,
                            right: 16,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                        }}
                    >
                        {user && <UserMenu username={user.username} email={user.email} onLogout={handleLogout} />}
                    </div>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
                        <Outlet context={{
                            outletInput,
                            setOutletInput,
                            selectedContact,
                            isUploading,
                            uploadProgress,
                            uploadedBytes,
                            uploadTotalBytes,
                            uploadFileCount
                        }} />
                    </div>

                    {selectedContact && (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                handleSend();
                            }}
                            style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #161719', background: '#070809' }}
                        >

                            <button
                                type="button"
                                onClick={() => setIsEncrypted(!isEncrypted)}
                                disabled={!selectedContact || sendMutation.isPending}
                                title={isEncrypted ? 'Encrypted chat' : 'Normal chat'}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 40,
                                    height: 40,
                                    borderRadius: 6,
                                    border: '1px solid #2A2D32',
                                    background: '#101317',
                                    color: '#E7E3DA',
                                    cursor: selectedContact ? 'pointer' : 'not-allowed',
                                }}
                            >
                                {isEncrypted ? (
                                    <Lock size={18} />
                                ) : (
                                    <MessageCircle size={18} />
                                )}
                            </button>

                            <input
                                ref={fileInputRef}
                                type="file"
                                hidden
                                multiple
                                onChange={handleFileSelect}
                                accept="image/*,.pdf,.txt,.mp4"
                            />

                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={!selectedContact || isUploading}
                                style={{
                                    padding: '10px 14px',
                                    borderRadius: 6,
                                    border: '1px solid #2A2D32',
                                    background: '#101317',
                                    color: '#E7E3DA',
                                    cursor: selectedContact && !isUploading ? 'pointer' : 'not-allowed',
                                    fontWeight: 600,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    opacity: isUploading ? 0.7 : 1,
                                }}
                            >
                                {isUploading ? (
                                    <>
                                        <div style={{
                                            width: 14,
                                            height: 14,
                                            border: '2px solid #666',
                                            borderTop: '2px solid #4F46E5',
                                            borderRadius: '50%',
                                            animation: 'spin 0.8s linear infinite',
                                        }} />
                                        Uploading...
                                    </>
                                ) : <Paperclip size={16} />}
                            </button>

                            <input
                                type="text"
                                value={outletInput}
                                onChange={handleInputChange}
                                placeholder="Type here..."
                                disabled={!selectedContact}
                                style={{ flex: 1, padding: 10, borderRadius: 6, border: '1px solid #222', background: '#0B0C0D', color: '#fff' }}
                            />
                            <button
                                type="submit"
                                disabled={!outletInput.trim() || !selectedContact || sendMutation.isPending}
                                style={{
                                    padding: '10px 16px',
                                    borderRadius: 6,
                                    border: 'none',
                                    background: outletInput.trim() && selectedContact ? '#4F46E5' : '#2A2D32',
                                    color: '#fff',
                                    cursor: outletInput.trim() && selectedContact ? 'pointer' : 'not-allowed',
                                    fontWeight: 600,
                                }}
                            >
                                {sendMutation.isPending ? 'Sending...' : <Send size={16} />}
                            </button>
                        </form>
                    )}
                </div>
            </main>
        </div>
    );
}