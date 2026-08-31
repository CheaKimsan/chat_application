// hooks/useTypingUsers.ts
import { useEffect, useState } from "react";

type TypingPayload = {
    from_user: string;
    to_user: string;
    is_typing: boolean;
};


export function useTypingUsers(currentUserId: string | number | undefined) {
    const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!currentUserId) return;

        const handler = (e: Event) => {
            const detail = (e as CustomEvent<TypingPayload>).detail;

            // Only care about typing events directed at me
            if (String(detail.to_user) !== String(currentUserId)) return;

            setTypingUsers((prev) => {
                const next = new Set(prev);
                if (detail.is_typing) {
                    next.add(detail.from_user);
                } else {
                    next.delete(detail.from_user);
                }
                return next;
            });
        };

        window.addEventListener("chat:typing", handler);
        return () => window.removeEventListener("chat:typing", handler);
    }, [currentUserId]);

    return typingUsers;
}