import { loginRequest } from "../../../api/requestAuth";
import { useAuthStore } from "../../../store/auth.store";

interface LoginPayload {
    username: string;
    password: string;
}

export const handleAuthLogin = async (payload: LoginPayload) => {
    const data = await loginRequest(payload);
    console.log("user:", data.user);

    useAuthStore.getState().setUser(data.user, data.access_token);
    return data;
};


export const logout = () => {
    useAuthStore.getState().clearUser();
};