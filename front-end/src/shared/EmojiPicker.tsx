import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";

const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
    {
        label: "Smileys",
        emojis: ["😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😜", "🤔", "😎", "🙄", "😭", "😢", "😡", "🥳", "😴", "🤗", "🙃", "😬", "🥲"],
    },
    {
        label: "Gestures",
        emojis: ["👍", "👎", "👏", "🙌", "🙏", "💪", "👋", "✌️", "🤝", "👌", "🤙", "🫶"],
    },
    {
        label: "Hearts",
        emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💕", "💔", "❣️", "💯"],
    },
    {
        label: "Objects",
        emojis: ["🔥", "🎉", "✨", "🎂", "☕", "🍕", "🍺", "⚽", "🎵", "📷", "💡", "🚀"],
    },
];

interface EmojiPickerProps {
    onSelect: (emoji: string) => void;
    // Rendered as the trigger button's className, so it can pick up the
    // same styling as your other composer icon buttons.
    triggerClassName?: string;
}

export default function EmojiPicker({ onSelect, triggerClassName }: EmojiPickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setIsOpen(false);
        };
        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleEscape);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [isOpen]);

    return (
        <div className="emoji-picker-wrap" ref={containerRef}>
            <button
                type="button"
                className={triggerClassName ?? "composer-icon-button"}
                onClick={() => setIsOpen((prev) => !prev)}
                title="Emoji"
                aria-label="Insert emoji"
                aria-expanded={isOpen}
            >
                <Smile size={18} />
            </button>

            {isOpen && (
                <div className="emoji-picker-popover" role="dialog" aria-label="Emoji picker">
                    {EMOJI_CATEGORIES.map((category) => (
                        <div className="emoji-picker-category" key={category.label}>
                            <div className="emoji-picker-category__label">{category.label}</div>
                            <div className="emoji-picker-grid">
                                {category.emojis.map((emoji) => (
                                    <button
                                        type="button"
                                        key={emoji}
                                        className="emoji-picker-item"
                                        onClick={() => {
                                            onSelect(emoji);
                                            setIsOpen(false);
                                        }}
                                    >
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}