import axios from "axios";
import { getApiBaseUrl } from "../../../../config/runtime";

const API_BASE_URL = getApiBaseUrl();

async function forgotPasswordRequest(email: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/forgot-password`, { email });
}

async function resetPasswordRequest(token: string, newPassword: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/reset-password`, {
        token,
        new_password: newPassword,
    });
}

export {
    forgotPasswordRequest,
    resetPasswordRequest,
}