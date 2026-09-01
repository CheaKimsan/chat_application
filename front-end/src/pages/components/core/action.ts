import { useUsersStore } from "../../../store/user.store";
import {reqGetUsers} from "../../../components/user/core/request";

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

