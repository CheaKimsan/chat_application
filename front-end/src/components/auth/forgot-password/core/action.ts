import axios from "axios";
import {forgotPasswordRequest, resetPasswordRequest} from "./request";

 function validateResetPassword(
    token: string,
    newPassword: string,
    confirmPassword: string
): string | undefined {
    if (!token) return "Reset link is missing or invalid.";
    if (!newPassword) return "New password is required";
    if (newPassword.length < 6) return "Password must be at least 6 characters";
    if (newPassword !== confirmPassword) return "Passwords do not match";
    return undefined;
}

 async function handleResetPasswordSubmit(token: string, newPassword: string): Promise<void> {
    try {
        await resetPasswordRequest(token, newPassword);
    } catch (err) {
        let message = "Something went wrong. Please try again.";
        if (axios.isAxiosError(err)) {
            message = err.response?.data?.message ?? message;
        }
        throw new Error(message);
    }
}


 function validateForgotPassword(email: string): string | undefined {
    if (!email) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address";
    return undefined;
}

 async function handleForgotPasswordSubmit(email: string): Promise<void> {
    try {
        await forgotPasswordRequest(email);
    } catch (err) {
        let message = "Something went wrong. Please try again.";
        if (axios.isAxiosError(err)) {
            message = err.response?.data?.message ?? message;
        }
        throw new Error(message);
    }
}


export  {
    validateResetPassword,
    handleResetPasswordSubmit,
    validateForgotPassword,
    handleForgotPasswordSubmit
}