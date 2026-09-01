import axios from "axios";

const API_BASE_URL = "http://localhost:8000/api/v1";

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
    sendInviteRequest,
    validateInviteRequest
}
