import { apiClient } from "./apiClient";
import { UserResponse } from "../pages/components/core/model";

export interface UsersResponse {
    users: UserResponse[];
}

export const reqGetUsers = async (): Promise<UserResponse[]> => {
    try {
        const { data } = await apiClient.get<UsersResponse>("/users");
        return data.users;
    } catch (error) {
        console.error("Failed to fetch users:", error);
        throw error;
    }
};