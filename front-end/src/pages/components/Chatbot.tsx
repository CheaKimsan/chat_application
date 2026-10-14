import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { AxiosError } from "axios";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Bot, LoaderCircle, Plus, Send, Sparkles, UserRound } from "lucide-react";
import { reqChatbotReply } from "../../api/apiClient";
import { useAuthStore } from "../../store/auth.store";
import "./Chatbot.css";

type ChatEntry = {
    id: number;
    role: "user" | "assistant";
    content: string;
};

const starterPrompts = [
    "Explain a tricky concept simply",
    "Help me improve a piece of writing",
    "Suggest a plan for my next project",
];

export default function Chatbot() {
    const username = useAuthStore((state) => state.user?.username);
    const [messages, setMessages] = useState<ChatEntry[]>([]);
    const [draft, setDraft] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState("");
    const nextId = useRef(0);
    const endOfMessagesRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [messages, isSending]);

    const sendMessage = async (value: string) => {
        const message = value.trim();
        if (!message || isSending) return;

        setError("");
        setDraft("");
        setMessages((current) => [...current, { id: nextId.current++, role: "user", content: message }]);
        setIsSending(true);

        try {
            const conversation = [...messages, { id: nextId.current, role: "user" as const, content: message }]
                .map((entry) => `${entry.role === "user" ? "User" : "Assistant"}: ${entry.content}`)
                .join("\n\n")
                .slice(-3000);
            const reply = await reqChatbotReply(`Continue this conversation and answer the latest user message:\n\n${conversation}`);
            setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: reply }]);
        } catch (requestError) {
            const apiError = requestError as AxiosError<{ error?: string }>;
            setError(apiError.response?.data?.error || "The assistant could not respond. Please try again.");
        } finally {
            setIsSending(false);
        }
    };

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void sendMessage(draft);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void sendMessage(draft);
        }
    };

    const startNewChat = () => {
        setMessages([]);
        setError("");
        setDraft("");
    };

    return (
        <section className="assistant-page" aria-label="AI Assistant">
            <header className="assistant-topbar">
                <Link className="assistant-back" to="/dashboard" aria-label="Back to messages">
                    <ArrowLeft size={17} />
                    <span>Messages</span>
                </Link>
                <div className="assistant-identity">
                    <span className="assistant-identity__icon"><Sparkles size={17} /></span>
                    <div>
                        <h1>AI Assistant</h1>
                        <span>Ready to help</span>
                    </div>
                </div>
                <button
                    className="assistant-new-chat"
                    type="button"
                    onClick={startNewChat}
                    disabled={messages.length === 0 && !draft}
                    title="Start a new chat"
                    aria-label="Start a new chat"
                >
                    <Plus size={17} />
                    <span>New chat</span>
                </button>
            </header>

            <div className={`assistant-thread${messages.length === 0 ? " assistant-thread--empty" : ""}`}>
                {messages.length === 0 ? (
                    <div className="assistant-welcome">
                        <span className="assistant-welcome__mark"><Sparkles size={22} /></span>
                        <p className="assistant-eyebrow">A fresh start</p>
                        <h2>What’s on your mind{username ? `, ${username}` : ""}?</h2>
                        <p className="assistant-welcome__copy">Bring a question, a rough draft, or an idea you want to shape.</p>
                        <div className="assistant-prompts" aria-label="Suggested prompts">
                            {starterPrompts.map((prompt) => (
                                <button key={prompt} type="button" onClick={() => void sendMessage(prompt)}>
                                    <span>{prompt}</span>
                                    <ArrowUpRight size={14} />
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="assistant-messages" aria-live="polite">
                        {messages.map((message) => (
                            <article key={message.id} className={`assistant-message assistant-message--${message.role}`}>
                                <span className="assistant-message__avatar" aria-hidden="true">
                                    {message.role === "assistant" ? <Bot size={16} /> : <UserRound size={16} />}
                                </span>
                                <div className="assistant-message__body">
                                    <span className="assistant-message__author">{message.role === "assistant" ? "Assistant" : "You"}</span>
                                    <p>{message.content}</p>
                                </div>
                            </article>
                        ))}
                        {isSending && (
                            <div className="assistant-message assistant-message--assistant" role="status" aria-label="Assistant is responding">
                                <span className="assistant-message__avatar"><Bot size={16} /></span>
                                <div className="assistant-message__body">
                                    <span className="assistant-message__author">Assistant</span>
                                    <span className="assistant-thinking"><i /><i /><i /></span>
                                </div>
                            </div>
                        )}
                        <div ref={endOfMessagesRef} />
                    </div>
                )}
            </div>

            <div className="assistant-compose-area">
                {error && <p className="assistant-error" role="alert">{error}</p>}
                <form className="assistant-composer" onSubmit={handleSubmit}>
                    <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Message the assistant..."
                        aria-label="Message the assistant"
                        maxLength={4000}
                        rows={1}
                        disabled={isSending}
                    />
                    <button
                        type="submit"
                        disabled={!draft.trim() || isSending}
                        title="Send message"
                        aria-label="Send message"
                    >
                        {isSending ? <LoaderCircle className="assistant-send-spinner" size={18} /> : <Send size={17} />}
                    </button>
                </form>
            </div>
        </section>
    );
}