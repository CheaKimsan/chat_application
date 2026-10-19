const withoutTrailingSlash = (value: string) => value.trim().replace(/\/+$/, "");

const withApiV1 = (value: string): string => {
    const normalized = withoutTrailingSlash(value);
    if (/\/api\/v1$/i.test(normalized)) {
        return normalized;
    }
    if (/\/api$/i.test(normalized)) {
        return `${normalized}/v1`;
    }
    return `${normalized}/api/v1`;
};

export const getApiBaseUrl = (): string => {
    const override = process.env.REACT_APP_API_BASE_URL || process.env.REACT_APP_API_URL;
    if (override) {
        return withApiV1(override);
    }

    const { protocol, hostname, origin } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
        return `${protocol}//${hostname}:8000/api/v1`;
    }

    return `${origin}/api/v1`;
};

export const buildWebSocketUrl = (path: string, token?: string): string => {
    const apiBaseUrl = new URL(getApiBaseUrl());
    const protocol = apiBaseUrl.protocol === "https:" ? "wss" : "ws";
    const socketPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${apiBaseUrl.origin}${apiBaseUrl.pathname}${socketPath}`);
    url.protocol = protocol;

    if (token) {
        url.searchParams.set("token", token);
    }

    return url.toString();
};
