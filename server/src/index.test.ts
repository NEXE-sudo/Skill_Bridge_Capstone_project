import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "./index.js";

describe("SkillBridge API", () => {
  it("returns API health", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });

  it("rejects invalid login credentials", async () => {
    const response = await request(app).post("/api/auth/login").send({ email: "missing@skillbridge.local", password: "wrong-password" });
    expect(response.status).toBe(401);
  });

  it("lists published jobs", async () => {
    const response = await request(app).get("/api/jobs?pageSize=5");
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
  });

  it("rejects protected routes without a token", async () => {
    const response = await request(app).get("/api/student/dashboard");
    expect(response.status).toBe(401);
  });

  it("rejects admin registration through public auth", async () => {
    const response = await request(app).post("/api/auth/register").send({ name: "Should Not Exist", email: "admin-forbidden@skillbridge.local", password: "Password123!", role: "ADMIN" });
    expect(response.status).toBe(400);
  });
});
