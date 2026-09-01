interface RegisterPayload {
    username: string;
    email: string;
    password: string;
    public_key: string;
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
}

export type {
    RegisterPayload,
    RegisterFormData,
    RegisterFormErrors,
}