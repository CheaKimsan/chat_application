import axios from "axios";

const API_BASE_URL = "http://localhost:8000/api/v1";

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