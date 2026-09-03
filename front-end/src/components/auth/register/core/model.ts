interface RegisterPayload {
    username: string;
    email: string;
    password: string;
    public_key: string;
    invite_token?: string;
}

interface VerifyEmailPayload {
    email: string;
    otp: string;
}

interface RegisterFormData {
    username: string;
    email: string;
    password: string;
}

interface RegisterFormErrors {
    username?: string;
    email?: string;
    password?: string;
    form?: string;
    otp?: string;
}

export type {
    RegisterPayload,
    VerifyEmailPayload,
    RegisterFormData,
    RegisterFormErrors,
}