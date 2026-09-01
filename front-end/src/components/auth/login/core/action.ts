import axios from "axios";
import { loginRequest } from "./requestLogin";
import { FormData, FormErrors } from "./login.model";
import {useAuthStore} from "../../../../store/auth.store";

export function validateLogin(formData: FormData): FormErrors {
    const errors: FormErrors = {};

    if (!formData.username) {
        errors.username = "Username is required";
    } else if (formData.username.length < 3) {
        errors.username = "Username must be at least 3 characters";
    }

    if (!formData.password) {
        errors.password = "Password is required";
    } else if (formData.password.length < 6) {
        errors.password = "Password must be at least 6 characters";
    }

    return errors;
}

export async function handleLoginSubmit(formData: FormData): Promise<void> {
    try {
        const data = await loginRequest(formData);
        useAuthStore.getState().setUser(data.user, data.access_token);
    } catch (err) {
        let message = "Login failed. Please try again.";
        if (axios.isAxiosError(err)) {
            message = err.response?.data?.message ?? message;
        }
        throw new Error(message);
    }
}