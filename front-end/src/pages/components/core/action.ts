import { QueryClient } from "@tanstack/react-query";
import { reqGetUsers } from "../../../api/requestUser";
import { disconnectSocket } from "../../../socket/socketClient";
import { useUsersStore } from "../../../store/user.store";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../../../store/auth.store";

export async function fetchUsers(): Promise<void> {
    const { setRows } = useUsersStore.getState();
    try {
        const users = await reqGetUsers();
        console.log(users);
        setRows(users);
    } catch (error) {
        console.error("fetchUsers failed:", error);
    }
}

