import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

function renderApp(initialPath = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("application workflows", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("authenticates, loads the student workspace, and revokes the session on logout", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/auth/login") {
        return jsonResponse({ token: "session-token", user: { id: "student-1", name: "Ava Student", email: "ava@example.test", role: "STUDENT" } });
      }
      if (path === "/api/student/dashboard") {
        return jsonResponse({ applications: { total: 0, counts: {}, recent: [] }, savedJobs: 0, recommendations: [] });
      }
      if (path === "/api/auth/logout" && init?.method === "POST") return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderApp("/login");

    await user.type(screen.getByLabelText("Email address"), "ava@example.test");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Welcome back, Ava")).toBeInTheDocument();
    expect(localStorage.getItem("skillbridge_token")).toBe("session-token");
    await user.click(screen.getByRole("button", { name: /Log out/ }));

    expect(await screen.findByRole("heading", { name: "Sign in to your workspace" })).toBeInTheDocument();
    expect(localStorage.getItem("skillbridge_token")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" }));
  });

  it("redirects unauthenticated users from protected routes to sign in", async () => {
    vi.stubGlobal("fetch", vi.fn());
    renderApp("/admin/users");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in to your workspace" })).toBeInTheDocument());
  });

  it("clears an expired browser session and redirects to sign in", async () => {
    localStorage.setItem("skillbridge_token", "expired-session");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/me") {
        return jsonResponse({ id: "student-1", name: "Ava Student", email: "ava@example.test", role: "STUDENT" });
      }
      if (String(input) === "/api/student/dashboard") {
        return jsonResponse({ error: { code: "UNAUTHORIZED", message: "Session expired" } }, 401);
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }));

    renderApp("/student/dashboard");
    expect(await screen.findByRole("heading", { name: "Sign in to your workspace" })).toBeInTheDocument();
    expect(localStorage.getItem("skillbridge_token")).toBeNull();
  });
});
