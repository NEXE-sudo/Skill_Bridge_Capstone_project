import { afterEach, describe, expect, it, vi } from "vitest";
import { api, authExpiredEvent } from "./api";

afterEach(() => {
  document.cookie = "skillbridge_csrf=; Max-Age=0; path=/";
  vi.unstubAllGlobals();
});

describe("browser API authentication", () => {
  it("uses credentialed cookies and sends the CSRF cookie in a request header", async () => {
    document.cookie = "skillbridge_csrf=csrf-test-token; path=/";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api("/api/profile", { method: "PATCH", body: "{}" })).resolves.toEqual({ ok: true });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(request.headers);
    expect(request.credentials).toBe("include");
    expect(headers.get("X-CSRF-Token")).toBe("csrf-test-token");
    expect(headers.has("Authorization")).toBe(false);
  });

  it("notifies the app when the cookie session has expired", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Expired" } }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const expired = vi.fn();
    window.addEventListener(authExpiredEvent, expired);

    await expect(api("/api/auth/me")).rejects.toThrow("Expired");

    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(authExpiredEvent, expired);
  });
});
