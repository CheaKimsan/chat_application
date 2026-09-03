import axios from "axios";
import { RegisterPayload, VerifyEmailPayload } from "./model";

const API_BASE_URL = "http://localhost:8000/api/v1";

export async function registerRequest(payload: RegisterPayload) {
    const res = await axios.post(`${API_BASE_URL}/signup`, payload);
    return res.data;
}

export async function verifyEmailRequest(payload: VerifyEmailPayload) {
    const res = await axios.post(`${API_BASE_URL}/verify-email`, payload);
    return res.data;
}

export async function resendVerificationRequest(email: string) {
    const res = await axios.post(`${API_BASE_URL}/resend-verification`, { email });
    return res.data;
}

