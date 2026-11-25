export type Role = "STUDENT" | "RECRUITER" | "ADMIN";
export type User = { id: string; name: string; email: string; role: Role; studentProfile?: Record<string, unknown>; recruiterProfile?: Record<string, unknown> };
const tokenKey = "skillbridge_token";

export function getToken() { return localStorage.getItem(tokenKey); }
export function setToken(token: string) { localStorage.setItem(tokenKey, token); }
export function clearToken() { localStorage.removeItem(tokenKey); }

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({ error: { code: "NETWORK_ERROR", message: "The server could not be reached" } }));
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body as T;
}
