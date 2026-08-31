import axios from "axios";
import { connectSocket } from "../socket/socketClient";
import { setTokens } from "./apiClient";

const API_BASE_URL = "http://localhost:8000/api/v1";

interface LoginPayload {
    username: string;
    password: string;
}
interface ApiUser {
    id: string;
    username: string;
    email: string;
}
interface RawLoginResponse {
    status: string;
    access_token: string;
    refresh_token: string;
    user: ApiUser;
}
export interface LoginResponse {
    access_token: string;
    refresh_token: string;
    user: ApiUser;
}
interface RegisterPayload {
    username: string;
    email: string;
    password: string;
    public_key: string;
}
const loginRequest = async (payload: LoginPayload): Promise<LoginResponse> => {
    const { data } = await axios.post<RawLoginResponse>(
        `${API_BASE_URL}/login`, payload
    );
    const { access_token, refresh_token, user } = data;
    setTokens(access_token, refresh_token);
    connectSocket(access_token);

    return { access_token, refresh_token, user };
};

async function registerRequest(payload: RegisterPayload) {
    const res = await axios.post(`${API_BASE_URL}/signup`, payload);
    return res.data;
}

async function forgotPasswordRequest(email: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/forgot-password`, { email });
}

async function resetPasswordRequest(token: string, newPassword: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/reset-password`, {
        token,
        new_password: newPassword,
    });
}

async function sendInviteRequest(email: string, accessToken: string): Promise<void> {
    await axios.post(
        `${API_BASE_URL}/invites`,
        { email },
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
}

 async function validateInviteRequest(token: string): Promise<{ email: string }> {
    const res = await axios.get(`${API_BASE_URL}/invites/validate`, {
        params: { token },
    });
    return res.data;
}


export {
    loginRequest,
    registerRequest,
    forgotPasswordRequest,
    resetPasswordRequest,
    sendInviteRequest,
    validateInviteRequest
}