import axios from "axios";
import { LoginPayload, LoginResponse, RawLoginResponse } from "./login.model";
import { setTokens } from "../../../../api/apiClient";
import { connectSocket } from "../../../../socket/socketClient";
import { getApiBaseUrl } from "../../../../config/runtime";

const API_BASE_URL = getApiBaseUrl();

export const loginRequest = async (payload: LoginPayload): Promise<LoginResponse> => {
    const { data } = await axios.post<RawLoginResponse>(
        `${API_BASE_URL}/login`, payload
    );
    const { access_token, refresh_token, user } = data;
    setTokens(access_token, refresh_token);
    connectSocket(access_token);

    return { access_token, refresh_token, user };
};

