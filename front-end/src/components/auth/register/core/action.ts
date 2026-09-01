import axios from "axios";
import { sendInviteRequest } from "./requestInvite";

export function getAccessToken(): string | null {
    return localStorage.getItem("access_token");
}

export function validateInviteEmail(email: string): string | undefined {
    if (!email) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address";
    return undefined;
}

export async function handleInviteSubmit(email: string): Promise<void> {
    const accessToken = getAccessToken();
    if (!accessToken) {
        throw new Error("You must be logged in to send invites.");
    }

    try {
        await sendInviteRequest(email, accessToken);
    } catch (err) {
        let message = "Something went wrong. Please try again.";
        if (axios.isAxiosError(err)) {
            // Backend returns 409 if the email is already registered
            message = err.response?.data?.message ?? message;
        }
        throw new Error(message);
    }
}