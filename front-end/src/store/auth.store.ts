import { create } from 'zustand';

export interface User {
    id: string;
    username: string;
    email: string;
    role?: string;
    profile_photo?: string;
}

interface AuthState {
    user: User | null;
    token: string | null;
    setUser: (user: User, token: string) => void;
    clearUser: () => void;
}

function loadInitialUser(): { user: User | null; token: string | null } {
    try {
        const token = localStorage.getItem('token');
        const raw = localStorage.getItem('user');
        const user = raw ? (JSON.parse(raw) as User) : null;
        return { user, token };
    } catch (e) {
        return { user: null, token: null };
    }
}
const initial = loadInitialUser();

export const useAuthStore = create<AuthState>((set) => ({
    user: initial.user,
    token: initial.token,
    setUser: (user, token) => {
        try {
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(user));
        } catch (e) {

        }
        set({ user, token });
    },
    clearUser: () => {
        try {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
        } catch (e) { }
        set({ user: null, token: null });
    },
}));
