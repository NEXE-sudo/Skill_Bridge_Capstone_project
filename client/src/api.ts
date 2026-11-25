export type Role = "STUDENT" | "RECRUITER" | "ADMIN";
export type User = { id: string; name: string; email: string; role: Role; studentProfile?: Record<string, unknown>; recruiterProfile?: Record<string, unknown> };
const tokenKey = "skillbridge_token";
export const authExpiredEvent = "skillbridge:auth-expired";

export function getToken() { return localStorage.getItem(tokenKey); }
export function setToken(token: string) { localStorage.setItem(tokenKey, token); }
export function clearToken() {
  localStorage.removeItem(tokenKey);
  window.dispatchEvent(new Event(authExpiredEvent));
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, {
    ...options,
    headers,
  });
  if (response.status === 204) return undefined as T;
  const body: { error?: { message?: string } } | undefined = await response.json().catch(() => undefined);
  if (response.status === 401 && token) clearToken();
  if (!response.ok) throw new Error(body?.error?.message ?? "Request failed");
  if (body === undefined) throw new Error("The server returned an invalid response");
  return body as T;
}
