interface UserResponse {
    id: string;
    username: string;
    email: string;
    role: string;
    profile_photo?: string;
}

export type {
    UserResponse
}