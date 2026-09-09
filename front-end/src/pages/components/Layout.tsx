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
import { Camera, Lock, MessageCircle, Mic, Paperclip, Send, Square } from 'lucide-react';
import CallPanel from '../../components/call/CallPanel';


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
    const [isRecording, setIsRecording] = useState(false);
    const [isVideoRecording, setIsVideoRecording] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const videoRecorderRef = useRef<MediaRecorder | null>(null);
    const recordingChunksRef = useRef<Blob[]>([]);
    const videoChunksRef = useRef<Blob[]>([]);
    const recordingStartedAtRef = useRef<number | null>(null);
    const maxRecordingSeconds = 120;

    useEffect(() => {
        const isRecordingAny = isRecording || isVideoRecording;
        if (!isRecordingAny) return;

        const timer = window.setInterval(() => {
            const startedAt = recordingStartedAtRef.current;
            if (!startedAt) return;

            const elapsed = Math.floor((Date.now() - startedAt) / 1000);
            setRecordingSeconds(Math.min(elapsed, maxRecordingSeconds));
            if (elapsed >= maxRecordingSeconds) {
                if (isVideoRecording) videoRecorderRef.current?.stop();
                else mediaRecorderRef.current?.stop();
            }
        }, 250);

        return () => window.clearInterval(timer);
    }, [isRecording, isVideoRecording]);



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
            setUploadError(null);
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
            const responseData = (err as { response?: { data?: { message?: string; errors?: Array<{ error?: string }> } } })
                .response?.data;
            const responseMessage = responseData?.errors?.map((failure) => failure.error).filter(Boolean).join(', ')
                || responseData?.message;
            setUploadError(responseMessage || (err instanceof Error ? err.message : 'Upload failed.'));
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
            setUploadedBytes(0);
            setUploadTotalBytes(0);
            setUploadFileCount(0);
            event.target.value = '';
        }
    };

    const handleVoiceMessage = async () => {
        if (!selectedContact || isUploading || isVideoRecording) return;

        if (isRecording) {
            mediaRecorderRef.current?.stop();
            return;
        }

        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
            console.error('Voice recording is not supported by this browser.');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recordingType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
                .find((type) => MediaRecorder.isTypeSupported(type));
            if (!recordingType) {
                stream.getTracks().forEach((track) => track.stop());
                throw new Error('This browser does not support a compatible audio recording format.');
            }

            const recorder = new MediaRecorder(stream, { mimeType: recordingType });
            recordingChunksRef.current = [];
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) recordingChunksRef.current.push(event.data);
            };

            recorder.onstop = async () => {
                stream.getTracks().forEach((track) => track.stop());
                setIsRecording(false);
                setIsUploading(true);
                setUploadError(null);

                try {
                    const audioBlob = new Blob(recordingChunksRef.current, { type: recordingType });
                    const extension = recordingType.startsWith('audio/ogg') ? 'ogg' : 'webm';
                    const audioFile = new File([audioBlob], `voice-${Date.now()}.${extension}`, {
                        type: recordingType,
                    });
                    const createdMessage = await sendMutation.mutateAsync({
                        to_user: String(selectedContact.id),
                        body: undefined,
                        encrypted: false,
                    });
                    await reqUploadFile(createdMessage.id, [audioFile]);
                    queryClient.invalidateQueries({ queryKey: ['messages', selectedContact.id] });
                } catch (err) {
                    console.error('Failed to send voice message:', err);
                    const responseData = (err as { response?: { data?: { message?: string; errors?: Array<{ error?: string }> } } })
                        .response?.data;
                    const responseMessage = responseData?.errors?.map((failure) => failure.error).filter(Boolean).join(', ')
                        || responseData?.message;
                    setUploadError(responseMessage || (err instanceof Error ? err.message : 'Voice message failed to send.'));
                } finally {
                    setIsUploading(false);
                    recordingChunksRef.current = [];
                    mediaRecorderRef.current = null;
                }
            };

            recorder.start();
            recordingStartedAtRef.current = Date.now();
            setRecordingSeconds(0);
            setIsRecording(true);
        } catch (err) {
            console.error('Microphone permission was denied or unavailable:', err);
            setUploadError(err instanceof Error ? err.message : 'Microphone permission was denied.');
        }
    };

    const handleVideoMessage = async () => {
        if (!selectedContact || isUploading) return;

        if (isVideoRecording) {
            videoRecorderRef.current?.stop();
            return;
        }

        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
            setUploadError('Video recording is not supported by this browser.');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            const recordingType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
                .find((type) => MediaRecorder.isTypeSupported(type));
            if (!recordingType) {
                stream.getTracks().forEach((track) => track.stop());
                throw new Error('This browser does not support a compatible video recording format.');
            }

            const recorder = new MediaRecorder(stream, { mimeType: recordingType });
            videoChunksRef.current = [];
            videoRecorderRef.current = recorder;
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) videoChunksRef.current.push(event.data);
            };
            recorder.onstop = async () => {
                stream.getTracks().forEach((track) => track.stop());
                setIsVideoRecording(false);
                setIsUploading(true);
                setUploadError(null);

                try {
                    const videoBlob = new Blob(videoChunksRef.current, { type: recordingType });
                    const videoFile = new File([videoBlob], `video-${Date.now()}.webm`, { type: recordingType });
                    const createdMessage = await sendMutation.mutateAsync({
                        to_user: String(selectedContact.id),
                        body: undefined,
                        encrypted: false,
                    });
                    await reqUploadFile(createdMessage.id, [videoFile]);
                    queryClient.invalidateQueries({ queryKey: ['messages', selectedContact.id] });
                } catch (err) {
                    console.error('Failed to send video message:', err);
                    const responseData = (err as { response?: { data?: { message?: string; errors?: Array<{ error?: string }> } } })
                        .response?.data;
                    const responseMessage = responseData?.errors?.map((failure) => failure.error).filter(Boolean).join(', ')
                        || responseData?.message;
                    setUploadError(responseMessage || (err instanceof Error ? err.message : 'Video message failed to send.'));
                } finally {
                    setIsUploading(false);
                    videoChunksRef.current = [];
                    videoRecorderRef.current = null;
                }
            };
            recorder.start();
            recordingStartedAtRef.current = Date.now();
            setRecordingSeconds(0);
            setIsVideoRecording(true);
        } catch (err) {
            console.error('Camera or microphone permission was denied:', err);
            setUploadError(err instanceof Error ? err.message : 'Camera permission was denied.');
        }
    };

    const handleSelectContact = (u: UserResponse) => {
        stopTyping();
        setSelectedContact(u);
    };

    return (
        <div className="layout-shell">
            <Sidebar onSelectContact={handleSelectContact} />

            <main className="layout-main">
                {selectedContact && <ChatHeader contact={contact} isTyping={isTyping} />}
                {selectedContact && <CallPanel contactId={selectedContact.id} />}

                <div className="layout-user-menu">
                    {user && <UserMenu username={user.username} email={user.email} onLogout={handleLogout} />}
                </div>
                <div className="layout-content">
                    <div className="layout-scroll">
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
                            className="chat-composer"
                        >

                            {uploadError && (
                                <div className="upload-error">
                                    {uploadError}
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={() => setIsEncrypted(!isEncrypted)}
                                disabled={!selectedContact || sendMutation.isPending}
                                title={isEncrypted ? 'Encrypted chat' : 'Normal chat'}
                                className="composer-icon-button"
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
                                accept="image/*,.pdf,.txt,.mp4,audio/*"
                            />

                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={!selectedContact || isUploading || isRecording || isVideoRecording}
                                className="composer-file-button"
                            >
                                {isUploading ? (
                                    <>
                                        <div className="upload-spinner" />
                                        Uploading...
                                    </>
                                ) : <Paperclip size={16} />}
                            </button>

                            <button
                                type="button"
                                onClick={handleVoiceMessage}
                                disabled={!selectedContact || isUploading || isVideoRecording}
                                title={isRecording ? 'Stop recording' : 'Record voice message'}
                                className={`recording-button${isRecording ? ' recording-button--active' : ''}`}
                            >
                                {isRecording ? <Square size={16} /> : <Mic size={18} />}
                            </button>

                            <button
                                type="button"
                                onClick={handleVideoMessage}
                                disabled={!selectedContact || isUploading || isRecording}
                                title={isVideoRecording ? 'Stop video recording' : 'Record video message'}
                                className={`recording-button${isVideoRecording ? ' recording-button--active' : ''}`}
                            >
                                {isVideoRecording ? <Square size={16} /> : <Camera size={18} />}
                            </button>

                            {(isRecording || isVideoRecording) && (
                                <div className="recording-timeline">
                                    <span className="recording-timeline__time">
                                        {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
                                    </span>
                                    <div className="recording-timeline__track">
                                        <div
                                            className="recording-timeline__progress"
                                            style={{ width: `${(recordingSeconds / maxRecordingSeconds) * 100}%` }}
                                        />
                                    </div>
                                    <span className="recording-timeline__hint">Stop to send</span>
                                </div>
                            )}

                            <input
                                type="text"
                                value={outletInput}
                                onChange={handleInputChange}
                                placeholder="Type here..."
                                disabled={!selectedContact}
                                className="composer-text-input"
                            />
                            <button
                                type="submit"
                                disabled={!outletInput.trim() || !selectedContact || sendMutation.isPending}
                                className={`composer-send-button${outletInput.trim() && selectedContact ? ' composer-send-button--ready' : ''}`}
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