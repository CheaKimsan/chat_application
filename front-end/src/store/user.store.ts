import { create } from "zustand";
import { UserResponse } from "../pages/components/core/model";

type DrawerMode = "create" | "edit";

type DrawerState = {
    open: boolean;
    mode: DrawerMode;
    user: UserResponse | null;
};

type UsersState = {
    rows: UserResponse[];
    search: string;
    page: number;
    pageSize: number;
    drawer: DrawerState;

    setRows: (rows: UserResponse[]) => void;
    setSearch: (q: string) => void;
    setPage: (page: number) => void;
    setPageSize: (size: number) => void;

    openDrawer: (mode: DrawerMode, user?: UserResponse) => void;
    closeDrawer: () => void;
};

const useUsersStore = create<UsersState>((set) => ({
    rows: [],
    search: "",
    page: 0,
    pageSize: 10,
    drawer: { open: false, mode: "create", user: null },

    setRows: (rows) => set({ rows }),
    setSearch: (search) => set({ search, page: 0 }),
    setPage: (page) => set({ page }),
    setPageSize: (pageSize) => set({ pageSize, page: 0 }),

    openDrawer: (mode, user) =>
        set({ drawer: { open: true, mode, user: user ?? null } }),
    closeDrawer: () =>
        set((state) => ({ drawer: { ...state.drawer, open: false } })),
}));

export { useUsersStore };