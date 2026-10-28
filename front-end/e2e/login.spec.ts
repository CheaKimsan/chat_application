import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
    await page.goto("/");
});

test("shows validation errors for empty credentials", async ({ page }) => {
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Username is required")).toBeVisible();
    await expect(page.getByText("Password is required")).toBeVisible();
});

test("shows the server error when credentials are rejected", async ({ page }) => {
    await page.route("**/api/v1/login", async (route) => {
        await route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ message: "Invalid username or password" }),
        });
    });

    await page.getByLabel("Username").fill("testuser");
    await page.getByRole("textbox", { name: "Password" }).fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Invalid username or password")).toBeVisible();
    await expect(page).toHaveURL("/");
});

test("logs in and redirects to the dashboard", async ({ page }) => {
    await page.route("**/api/v1/login", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                status: "success",
                access_token: "test-access-token",
                refresh_token: "test-refresh-token",
                user: {
                    id: "1",
                    username: "testuser",
                    email: "test@example.com",
                },
            }),
        });
    });
    await page.route("**/api/v1/users**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ users: [] }),
        });
    });
    await page.route("**/api/v1/messages/conversations", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ conversations: [] }),
        });
    });

    await page.getByLabel("Username").fill("testuser");
    await page.getByRole("textbox", { name: "Password" }).fill("correct-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole("button", { name: "Open user menu" }).click();
    await expect(page.getByText("TESTUSER")).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("token"))).toBe("test-access-token");
});
