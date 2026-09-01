import {UserResponse} from "./model";
import {apiClient} from "../../../api/apiClient";

interface UsersResponse {
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