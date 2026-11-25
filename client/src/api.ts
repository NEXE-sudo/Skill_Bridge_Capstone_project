export type Role = "STUDENT" | "RECRUITER" | "ADMIN";
export type User = { id: string; name: string; email: string; role: Role; studentProfile?: Record<string, unknown>; recruiterProfile?: Record<string, unknown> };
export const authExpiredEvent = "skillbridge:auth-expired";

export function clearAuth() {
  window.dispatchEvent(new Event(authExpiredEvent));
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const method = (options.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrfCookie = document.cookie.split("; ").find((cookie) => cookie.startsWith("skillbridge_csrf="));
    if (csrfCookie) headers.set("X-CSRF-Token", decodeURIComponent(csrfCookie.slice("skillbridge_csrf=".length)));
  }
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "include",
  });
  if (response.status === 204) return undefined as T;
  const body: { error?: { message?: string } } | undefined = await response.json().catch(() => undefined);
  if (response.status === 401) clearAuth();
  if (!response.ok) throw new Error(body?.error?.message ?? "Request failed");
  if (body === undefined) throw new Error("The server returned an invalid response");
  return body as T;
}
