 interface FormErrors {
    username?: string;
    password?: string;
    form?: string;
}
interface FormData {
    username: string;
    password: string;
}

 interface LoginPayload {
     username: string;
     password: string;
 }

 interface ApiUser {
     id: string;
     username: string;
     email: string;
 }

 interface RawLoginResponse {
     status: string;
     access_token: string;
     refresh_token: string;
     user: ApiUser;
 }

 export interface LoginResponse {
     access_token: string;
     refresh_token: string;
     user: ApiUser;
 }
export type{
    FormErrors,
    FormData,
    LoginPayload,
    RawLoginResponse
}