import {UserResponse} from "./model";
import {apiClient} from "../../../api/apiClient";

interface UsersResponse {
    users: UserResponse[] | null;
}

export const reqGetUsers = async (): Promise<UserResponse[]> => {
    try {
        const { data } = await apiClient.get<UsersResponse>("/users");
        return data.users ?? [];
    } catch (error) {
        console.error("Failed to fetch users:", error);
        throw error;
    }
};

export const reqGetBlockedUsers = async (): Promise<UserResponse[]> => {
    const { data } = await apiClient.get<UsersResponse>("/users/blocked");
    return data.users ?? [];
};

export const reqBlockUser = async (userId: string): Promise<void> => {
    await apiClient.post(`/users/${userId}/block`);
};

export const reqUnblockUser = async (userId: string): Promise<void> => {
    await apiClient.delete(`/users/${userId}/block`);
};