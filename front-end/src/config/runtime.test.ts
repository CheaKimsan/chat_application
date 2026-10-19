import { buildWebSocketUrl, getApiBaseUrl } from "./runtime";

describe("runtime config", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it("adds /api/v1 when a base URL override omits it", () => {
        process.env.REACT_APP_API_BASE_URL = "http://localhost:8000";
        expect(getApiBaseUrl()).toBe("http://localhost:8000/api/v1");
    });

    it("builds a websocket URL from the API base URL", () => {
        process.env.REACT_APP_API_BASE_URL = "http://localhost:8000";
        expect(buildWebSocketUrl("/messages", "abc123")).toBe("ws://localhost:8000/api/v1/messages?token=abc123");
    });
});
