import axios, { AxiosError, AxiosRequestConfig } from "axios";
import { getApiBaseUrl } from "../config/runtime";

const BASE_URL = getApiBaseUrl();

let refreshPromise: Promise<string> | null = null;

interface PublicKeyResponse {
    user_id: string;
    public_key: string;
}

export interface ShopProduct {
    id: number;
    name: string;
    description: string;
    price_cents: number;
    stock: number;
}

export interface ShopOrderLine {
    name: string;
    quantity: number;
    price_cents: number;
}

export interface ShopOrder {
    id: number;
    status: string;
    total_cents: number;
    created_at: string;
    lines: ShopOrderLine[];
}


export function getAccessToken(): string | null {
    return localStorage.getItem("access_token");
}

export function getRefreshToken(): string | null {
    return localStorage.getItem("refresh_token");
}

export function setTokens(accessToken: string, refreshToken: string) {
    localStorage.setItem("access_token", accessToken);
    localStorage.setItem("refresh_token", refreshToken);
}

export function clearTokens() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
}

export const apiClient = axios.create({ baseURL: BASE_URL });

apiClient.interceptors.request.use((config) => {
    const token = getAccessToken();
    if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// --- single-flight refresh ---
// If multiple requests 401 at the same moment (e.g. the dashboard fires
// /users and /messages/11 in parallel, like in your screenshot), only the
// FIRST one should trigger a real /refresh call. Since your refresh
// tokens rotate (single-use), letting each failed request refresh
// independently would mean only the first refresh succeeds and every
// other one fails with "already revoked" even though nothing is wrong.


export async function refreshAccessToken(): Promise<string> {
    if (refreshPromise) {
        // A refresh is already in flight — wait on that one instead of
        // starting a second one.
        return refreshPromise;
    }

    refreshPromise = (async () => {
        const refreshToken = getRefreshToken();
        if (!refreshToken) {
            throw new Error("no refresh token available");
        }

        try {
            const { data } = await axios.post(`${BASE_URL}/refresh`, {
                refresh_token: refreshToken,
            });
            setTokens(data.access_token, data.refresh_token);
            return data.access_token as string;
        } catch (err) {
            // Refresh token itself is dead (expired / revoked) — nothing
            // left to do but force a real login.
            clearTokens();
            throw err;
        } finally {
            refreshPromise = null;
        }
    })();

    return refreshPromise;
}

apiClient.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

        const isUnauthorized = error.response?.status === 401;
        const alreadyRetried = originalRequest?._retry;

        if (!isUnauthorized || alreadyRetried || !originalRequest) {
            return Promise.reject(error);
        }

        originalRequest._retry = true;

        try {
            const newAccessToken = await refreshAccessToken();
            if (originalRequest.headers) {
                originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            }
            return apiClient(originalRequest);
        } catch (refreshError) {
            window.location.href = "/";
            return Promise.reject(refreshError);
        }
    }
);

export const reqGetPublicKey = async (userId: string | number): Promise<string> => {
    try {
        const response = await apiClient.get<PublicKeyResponse>(`/users/${userId}/public-key`);
        return response.data.public_key || "";
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            return "";
        }
        throw error;
    }
};

export const reqUpdateMyPublicKey = async (publicKeyB64: string): Promise<void> => {
    await apiClient.put("/users/me/public-key", { public_key: publicKeyB64 });
};

export const reqChatbotReply = async (message: string): Promise<string> => {
    const response = await apiClient.post<{ reply: string }>("/chatbot", { message });
    return response.data.reply;
};

export const reqListShopProducts = async (params: { q?: string; max_cents?: number }): Promise<ShopProduct[]> => {
    const response = await apiClient.get<{ products: ShopProduct[] }>("/shop/products", {
        params: { ...params, limit: 50 },
    });
    return response.data.products;
};

export const reqShopAssistantReply = async (message: string): Promise<string> => {
    const response = await apiClient.post<{ reply: string }>("/shop/assistant", { message });
    return response.data.reply;
};

export const reqListShopOrders = async (): Promise<ShopOrder[]> => {
    const response = await apiClient.get<{ orders: ShopOrder[] }>("/shop/orders");
    return response.data.orders;
};

export const reqPlaceShopOrder = async (cart: Record<number, number>): Promise<ShopOrder> => {
    const response = await apiClient.post<{ order: ShopOrder }>("/shop/orders", { cart });
    return response.data.order;
};
