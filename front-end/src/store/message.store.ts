import { create } from "zustand";
import { UserResponse } from "../pages/components/core/model";

export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export type Message = {
    id: string;
    senderId: string;
    receiverId: string;
    content: string;
    timestamp: string;
    status: MessageStatus;
};

type MessagesState = {
    messages: Message[];
    activeContact: UserResponse | null;
    draft: string;
    loading: boolean;

    setMessages: (messages: Message[]) => void;
    addMessage: (message: Message) => void;
    updateMessageStatus: (id: string, status: MessageStatus) => void;
    removeMessage: (id: string) => void;
    clearMessages: () => void;

    setActiveContact: (contact: UserResponse | null) => void;
    setDraft: (text: string) => void;
    setLoading: (loading: boolean) => void;
};

const useMessagesStore = create<MessagesState>((set) => ({
    messages: [],
    activeContact: null,
    draft: "",
    loading: false,

    setMessages: (messages) => set({ messages }),
    addMessage: (message) =>
        set((state) => ({ messages: [...state.messages, message] })),
    updateMessageStatus: (id, status) =>
        set((state) => ({
            messages: state.messages.map((m) =>
                m.id === id ? { ...m, status } : m
            ),
        })),
    removeMessage: (id) =>
        set((state) => ({
            messages: state.messages.filter((m) => m.id !== id),
        })),
    clearMessages: () => set({ messages: [] }),

    setActiveContact: (activeContact) => set({ activeContact }),
    setDraft: (draft) => set({ draft }),
    setLoading: (loading) => set({ loading }),
}));

export { useMessagesStore };