import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { JobStatus, JobType, PrismaClient, Role, WorkArrangement, ExperienceLevel } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { app, connectRateLimitStore, disconnectRateLimitStore } from "./index.js";
import { LocalResumeStorage } from "./resumeStorage.js";
import { capturedTestEmails } from "./email.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be configured for integration tests");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const password = "Integration-test-Password-123!";
const emailPrefix = `audit-${Date.now()}`;
const userIds: string[] = [];
const ownedFileKeys: string[] = [];
let student: { id: string; token: string };
let studentTwo: { id: string; token: string };
let recruiter: { id: string; token: string };
let recruiterTwo: { id: string; token: string };
let admin: { id: string; token: string };
let jobId: string;
let secondJobId: string;
let draftJobId: string;
let applicationId: string;

async function createUser(name: string, role: Role) {
  const hash = await bcrypt.hash(password, 4);
  const user = await prisma.user.create({
    data: {
      name,
      email: `${emailPrefix}-${role.toLowerCase()}-${userIds.length}@skillbridge.test`,
      passwordHash: hash,
      role,
      ...(role === Role.STUDENT ? { studentProfile: { create: { skills: ["TypeScript"] } } } : {}),
      ...(role === Role.RECRUITER ? { recruiterProfile: { create: { organisation: `${name} Org` } } } : {}),
    },
  });
  userIds.push(user.id);
  const jti = randomUUID();
  const csrf = randomUUID();
  const expiresAt = new Date(Date.now() + 60_000);
  const token = jwt.sign({ id: user.id, role, jti, csrf }, process.env.JWT_SECRET!, { expiresIn: 60 });
  await prisma.sessionToken.create({ data: { jti, userId: user.id, expiresAt } });
  return { id: user.id, token, email: user.email };
}

function auth(token: string) {
  const claims = jwt.decode(token);
  if (!claims || typeof claims === "string" || typeof claims.csrf !== "string") throw new Error("Test token has no CSRF claim");
  return { Cookie: `skillbridge_session=${token}; skillbridge_csrf=${claims.csrf}`, "X-CSRF-Token": claims.csrf };
}

function sessionToken(response: { headers: Record<string, string | string[] | undefined> }) {
  const setCookie = response.headers["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = cookies.find((value) => value.startsWith("skillbridge_session="));
  if (!cookie) throw new Error("Login response did not set a session cookie");
  return cookie.slice("skillbridge_session=".length).split(";")[0];
}

function emailActionToken(text: string) {
  const link = text.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error("Email does not contain an action link");
  const token = new URL(link).searchParams.get("token");
  if (!token) throw new Error("Email action link does not contain a token");
  return token;
}

function latestEmailFor(to: string) {
  return capturedTestEmails().slice().reverse().find((message) => message.to === to);
}

async function createJob(token: string, title: string, status = JobStatus.PUBLISHED) {
  const response = await request(app).post("/api/jobs").set(auth(token)).send({
    title,
    description: "A practical role for building production-quality software with an experienced team.",
    responsibilities: ["Build and test product features"],
    requirements: ["Strong fundamentals"],
    skills: ["TypeScript"],
    jobType: JobType.INTERNSHIP,
    workArrangement: WorkArrangement.REMOTE,
    location: "Remote",
    experienceLevel: ExperienceLevel.ENTRY,
    deadline: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    status,
  });
  expect(response.status).toBe(201);
  expect(response.body.status).toBe(status);
  return response.body.id as string;
}

describe("production-critical API workflows", () => {
  beforeAll(async () => {
    await connectRateLimitStore();
    student = await createUser("Audit Student", Role.STUDENT);
    studentTwo = await createUser("Second Audit Student", Role.STUDENT);
    recruiter = await createUser("Audit Recruiter", Role.RECRUITER);
    recruiterTwo = await createUser("Other Recruiter", Role.RECRUITER);
    admin = await createUser("Audit Administrator", Role.ADMIN);
    jobId = await createJob(recruiter.token, "Audit-owned opportunity");
    secondJobId = await createJob(recruiterTwo.token, "Other-owned opportunity");
    draftJobId = await createJob(recruiter.token, "Draft recruiter opportunity", JobStatus.DRAFT);
  });

  afterAll(async () => {
    await Promise.all(ownedFileKeys.map((key) => new LocalResumeStorage().delete(key)));
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await disconnectRateLimitStore();
  });

  it("registers permitted roles, hashes passwords, rejects duplicate emails and excludes admin registration", async () => {
    const email = `${emailPrefix}-register@skillbridge.test`;
    const registered = await request(app).post("/api/auth/register").send({ name: "Registered User", email, password, role: "STUDENT" });
    expect(registered.status).toBe(201);
    expect(registered.body.message).toMatch(/verify your address/i);
    expect(registered.body).not.toHaveProperty("token");
    expect(registered.headers["set-cookie"]).toBeUndefined();
    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).not.toBe(password);
    expect(stored.emailVerifiedAt).toBeNull();
    const verificationEmail = latestEmailFor(email);
    expect(verificationEmail).toBeDefined();
    const verificationToken = emailActionToken(verificationEmail!.text);
    expect((await request(app).post("/api/auth/login").send({ email, password })).body.error.code).toBe("EMAIL_NOT_VERIFIED");
    expect((await request(app).post("/api/auth/verify-email").send({ token: verificationToken })).status).toBe(200);
    expect((await request(app).post("/api/auth/verify-email").send({ token: verificationToken })).status).toBe(400);
    expect((await request(app).post("/api/auth/email-verification/resend").send({ email })).status).toBe(202);
    expect((await request(app).post("/api/auth/email-verification/resend").send({ email: `${emailPrefix}-unknown@skillbridge.test` })).status).toBe(202);
    const duplicate = await request(app).post("/api/auth/register").send({ name: "Duplicate User", email, password, role: "STUDENT" });
    expect(duplicate.status).toBe(409);
    const adminSignup = await request(app).post("/api/auth/register").send({ name: "Public Admin", email: `${emailPrefix}-admin@skillbridge.test`, password, role: "ADMIN" });
    expect(adminSignup.status).toBe(400);
    userIds.push(stored.id);
  });

  it("authenticates case-insensitive email and rejects bad, expired, malformed, and revoked sessions", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.id } });
    const login = await request(app).post("/api/auth/login").send({ email: user.email.toUpperCase(), password });
    expect(login.status).toBe(200);
    expect(login.body).not.toHaveProperty("token");
    expect(login.headers["set-cookie"]).toHaveLength(2);
    expect((await request(app).post("/api/auth/login").send({ email: user.email, password: "wrong-password" })).status).toBe(401);
    const invalid = jwt.sign({ id: student.id, role: "STUDENT", jti: "invalid-token", csrf: randomUUID() }, process.env.JWT_SECRET!, { expiresIn: 60 });
    expect((await request(app).get("/api/auth/me").set("Cookie", "skillbridge_session=not-a-jwt")).status).toBe(401);
    const expired = jwt.sign({ id: student.id, role: "STUDENT", jti: "expired-token", csrf: randomUUID() }, process.env.JWT_SECRET!, { expiresIn: -1 });
    expect((await request(app).get("/api/auth/me").set(auth(expired))).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set(auth(invalid))).status).toBe(401);
    const logout = await request(app).post("/api/auth/logout").set(auth(student.token));
    expect(logout.status).toBe(204);
    expect((await request(app).get("/api/auth/me").set(auth(student.token))).status).toBe(401);
    const freshLogin = await request(app).post("/api/auth/login").send({ email: user.email, password });
    expect(freshLogin.status).toBe(200);
    student.token = sessionToken(freshLogin);
    const csrfClaims = jwt.decode(student.token) as jwt.JwtPayload;
    const csrfRejected = await request(app).post(`/api/saved-jobs/${jobId}`)
      .set("Cookie", `skillbridge_session=${student.token}; skillbridge_csrf=${csrfClaims.csrf}`)
      .send({});
    expect(csrfRejected.status).toBe(403);
  });

  it("limits CORS to configured origins and returns baseline security headers", async () => {
    const allowedOrigin = process.env.CLIENT_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean)[0] ?? "http://localhost:5173";
    const allowed = await request(app).get("/api/health").set("Origin", allowedOrigin);
    expect(allowed.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    expect(allowed.headers["x-content-type-options"]).toBe("nosniff");
    const denied = await request(app).get("/api/health").set("Origin", "https://untrusted.invalid");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reports readiness only after its configured dependencies are reachable", async () => {
    const readiness = await request(app).get("/api/ready");
    expect(readiness.status).toBe(200);
    expect(readiness.body).toEqual({ status: "ready" });
  });

  it.skipIf(!process.env.REDIS_URL)("fails closed when the shared rate-limit store is unavailable", async () => {
    await disconnectRateLimitStore();
    const unavailable = await request(app).get("/api/health");
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe("RATE_LIMIT_UNAVAILABLE");
    await connectRateLimitStore();
    expect((await request(app).get("/api/health")).status).toBe(200);
  });

  it("enforces role guards and recruiter ownership for listing and applicants", async () => {
    expect((await request(app).get("/api/recruiter/jobs").set(auth(student.token))).status).toBe(403);
    expect((await request(app).get("/api/admin/dashboard").set(auth(recruiter.token))).status).toBe(403);
    expect((await request(app).patch(`/api/jobs/${jobId}`).set(auth(recruiterTwo.token)).send({ title: "Not yours" })).status).toBe(404);
    expect((await request(app).get(`/api/recruiter/jobs/${jobId}/applications`).set(auth(recruiterTwo.token))).status).toBe(404);
    const update = await request(app).patch(`/api/jobs/${jobId}`).set(auth(recruiter.token)).send({ title: "Updated owned opportunity" });
    expect(update.status).toBe(200);
    expect(update.body.title).toBe("Updated owned opportunity");
    const closed = await request(app).patch(`/api/jobs/${jobId}`).set(auth(recruiter.token)).send({ status: "CLOSED" });
    expect(closed.status).toBe(200);
    const reopened = await request(app).patch(`/api/jobs/${jobId}`).set(auth(recruiter.token)).send({ status: "PUBLISHED" });
    expect(reopened.status).toBe(200);
    const stored = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(stored.status).toBe("PUBLISHED");
    expect(stored.deadline.getTime()).toBeGreaterThan(Date.now());
    expect((await request(app).delete(`/api/jobs/${draftJobId}`).set(auth(recruiter.token))).status).toBe(204);
  });

  it("validates public job filters, searches recruiter organisations and paginates results", async () => {
    const search = await request(app).get("/api/jobs").query({ q: "Audit Recruiter Org", page: 1, pageSize: 1 });
    expect(search.status).toBe(200);
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0].id).toBe(jobId);
    expect(search.body.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
    expect((await request(app).get("/api/jobs").query({ jobType: "NOT_A_JOB_TYPE" })).status).toBe(400);
    expect((await request(app).get("/api/jobs").query({ page: 0 })).status).toBe(400);
  });

  it("validates PDF content, supports private resume retrieval, replacement and deletion", async () => {
    const validPdf = Buffer.from("%PDF-1.7\nSkillBridge test resume\n%%EOF");
    const invalid = await request(app).post("/api/users/me/resume").set(auth(student.token)).attach("resume", Buffer.from("not pdf"), { filename: "resume.pdf", contentType: "application/pdf" });
    expect(invalid.status).toBe(400);
    const invalidExtension = await request(app).post("/api/users/me/resume").set(auth(student.token)).attach("resume", validPdf, { filename: "resume.txt", contentType: "application/pdf" });
    expect(invalidExtension.status).toBe(400);
    const tooLarge = await request(app).post("/api/users/me/resume").set(auth(student.token)).attach("resume", Buffer.concat([validPdf, Buffer.alloc(5 * 1024 * 1024)]), { filename: "large.pdf", contentType: "application/pdf" });
    expect(tooLarge.status).toBe(413);
    const forbiddenRole = await request(app).post("/api/users/me/resume").set(auth(recruiter.token)).attach("resume", validPdf, { filename: "resume.pdf", contentType: "application/pdf" });
    expect(forbiddenRole.status).toBe(403);
    const upload = await request(app).post("/api/users/me/resume").set(auth(student.token)).attach("resume", validPdf, { filename: "resume.pdf", contentType: "application/pdf" });
    expect(upload.status).toBe(201);
    const profile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: student.id } });
    expect(profile.resumeKey).toBeTruthy();
    ownedFileKeys.push(profile.resumeKey!);
    const download = await request(app).get("/api/users/me/resume").set(auth(student.token));
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("application/pdf");
    expect(download.body.toString()).toContain("%PDF-");
    const replacement = await request(app).post("/api/users/me/resume").set(auth(student.token)).attach("resume", Buffer.from("%PDF-1.7\nReplacement resume\n%%EOF"), { filename: "replacement.pdf", contentType: "application/pdf" });
    expect(replacement.status).toBe(201);
    const updatedProfile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: student.id } });
    expect(updatedProfile.resumeName).toBe("replacement.pdf");
    expect(updatedProfile.resumeKey).not.toBe(profile.resumeKey);
    expect(await new LocalResumeStorage().get(profile.resumeKey!)).toBeNull();
    ownedFileKeys.push(updatedProfile.resumeKey!);
  });

  it("prevents duplicate applications and gives recruiters access only to their own applicant resumes", async () => {
    const applied = await request(app).post(`/api/jobs/${jobId}/applications`).set(auth(student.token)).send({ coverLetter: "I would like to apply." });
    expect(applied.status, JSON.stringify(applied.body)).toBe(201);
    expect(applied.body).not.toHaveProperty("resumeKey");
    applicationId = applied.body.id;
    const duplicate = await request(app).post(`/api/jobs/${jobId}/applications`).set(auth(student.token)).send({});
    expect(duplicate.status).toBe(409);
    expect(await prisma.notification.count({ where: { userId: student.id, title: "Application submitted" } })).toBe(1);
    const ownedApplicants = await request(app).get(`/api/recruiter/jobs/${jobId}/applications`).set(auth(recruiter.token));
    expect(ownedApplicants.status).toBe(200);
    expect(ownedApplicants.body.items[0].student.studentProfile).not.toHaveProperty("resumeKey");
    const pagedApplicants = await request(app).get("/api/recruiter/applicants").query({ page: 1, pageSize: 1 }).set(auth(recruiter.token));
    expect(pagedApplicants.status).toBe(200);
    expect(pagedApplicants.body.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
    expect((await request(app).get("/api/recruiter/applicants").query({ status: "UNKNOWN" }).set(auth(recruiter.token))).status).toBe(400);
    const listingApplicants = await request(app).get(`/api/recruiter/jobs/${jobId}/applications`).query({ page: 1, pageSize: 1 }).set(auth(recruiter.token));
    expect(listingApplicants.status).toBe(200);
    expect(listingApplicants.body.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
    const privateResume = await request(app).get(`/api/recruiter/applications/${applicationId}/resume`).set(auth(recruiter.token));
    expect(privateResume.status).toBe(200);
    expect(privateResume.body.toString()).toContain("%PDF-");
    expect((await request(app).delete("/api/users/me/resume").set(auth(student.token))).status).toBe(204);
    expect((await request(app).get("/api/users/me/resume").set(auth(student.token))).status).toBe(404);
    expect((await request(app).get(`/api/recruiter/applications/${applicationId}/resume`).set(auth(recruiter.token))).status).toBe(200);
    expect((await request(app).get(`/api/recruiter/applications/${applicationId}/resume`).set(auth(recruiterTwo.token))).status).toBe(404);
    expect((await request(app).get(`/api/recruiter/applications/${applicationId}/resume`).set(auth(studentTwo.token))).status).toBe(403);
  });

  it("enforces application status transitions and permits eligible student withdrawal only", async () => {
    const invalidStart = await request(app).patch(`/api/applications/${applicationId}/status`).set(auth(recruiter.token)).send({ status: "SHORTLISTED" });
    expect(invalidStart.status).toBe(409);
    expect((await request(app).patch(`/api/applications/${applicationId}/status`).set(auth(recruiter.token)).send({ status: "WITHDRAWN" })).status).toBe(400);
    for (const status of ["UNDER_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFERED"]) {
      const response = await request(app).patch(`/api/applications/${applicationId}/status`).set(auth(recruiter.token)).send({ status });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe(status);
    }
    expect((await request(app).patch(`/api/applications/${applicationId}/status`).set(auth(recruiter.token)).send({ status: "REJECTED" })).status).toBe(409);
    expect((await request(app).patch(`/api/applications/${applicationId}/withdraw`).set(auth(student.token))).status).toBe(409);
    expect((await request(app).patch(`/api/applications/${applicationId}/withdraw`).set(auth(studentTwo.token))).status).toBe(404);
    const secondApplication = await request(app).post(`/api/jobs/${secondJobId}/applications`).set(auth(studentTwo.token)).send({});
    expect(secondApplication.status).toBe(201);
    expect((await request(app).patch(`/api/applications/${secondApplication.body.id}/withdraw`).set(auth(studentTwo.token))).status).toBe(200);
    const dashboard = await request(app).get("/api/recruiter/dashboard").set(auth(recruiter.token));
    expect(dashboard.status).toBe(200);
    expect(dashboard.body).toMatchObject({ totalApplications: 1, activeListings: 1 });
    expect(dashboard.body.listingPerformance).toContainEqual(expect.objectContaining({ id: jobId, applications: 1 }));
  });

  it("limits saved jobs to the authenticated student and prevents duplicate records", async () => {
    expect((await request(app).post(`/api/saved-jobs/${jobId}`).set(auth(student.token))).status).toBe(201);
    expect((await request(app).post(`/api/saved-jobs/${jobId}`).set(auth(student.token))).status).toBe(201);
    const saved = await prisma.savedJob.count({ where: { studentId: student.id, jobId } });
    expect(saved).toBe(1);
    expect((await request(app).get("/api/saved-jobs").set(auth(recruiter.token))).status).toBe(403);
  });

  it("paginates notifications and returns an accurate unread count", async () => {
    await prisma.notification.createMany({
      data: [
        { userId: student.id, title: "Test notification one", message: "one", type: "INFO" },
        { userId: student.id, title: "Test notification two", message: "two", type: "INFO" },
      ],
    });
    const response = await request(app).get("/api/notifications").query({ page: 1, pageSize: 1 }).set(auth(student.token));
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.unreadCount).toBeGreaterThanOrEqual(2);
    expect(response.body.pagination).toMatchObject({ page: 1, pageSize: 1, totalPages: expect.any(Number) });
  });

  it("atomically audits administrative changes and suspends the target session", async () => {
    const created = await prisma.user.create({
      data: { name: "Suspension target", email: `${emailPrefix}-suspend@skillbridge.test`, passwordHash: await bcrypt.hash(password, 4), role: Role.STUDENT, studentProfile: { create: {} } },
    });
    userIds.push(created.id);
    const targetLogin = await request(app).post("/api/auth/login").send({ email: created.email, password });
    const targetToken = sessionToken(targetLogin);
    const suspended = await request(app).patch(`/api/admin/users/${created.id}/status`).set(auth(admin.token)).send({ accountStatus: "SUSPENDED" });
    expect(suspended.status).toBe(200);
    expect((await request(app).get("/api/auth/me").set(auth(targetToken))).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { actorId: admin.id, entityId: created.id, action: "SUSPEND_USER" } })).toBe(1);
    expect((await request(app).patch(`/api/admin/users/${admin.id}/status`).set(auth(admin.token)).send({ accountStatus: "SUSPENDED" })).status).toBe(403);
  });

  it("audits listing moderation and serves audit data only to administrators", async () => {
    const closed = await request(app).patch(`/api/admin/jobs/${jobId}/moderation`).set(auth(admin.token)).send({ status: "CLOSED", reason: "Test moderation" });
    expect(closed.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { actorId: admin.id, entityId: jobId, action: "CLOSE_LISTING" } })).toBe(1);
    expect((await request(app).delete(`/api/jobs/${jobId}`).set(auth(recruiter.token))).status).toBe(409);
    expect(await prisma.job.findUnique({ where: { id: jobId } })).not.toBeNull();
    const auditResponse = await request(app).get("/api/admin/audit-logs").query({ page: 1, pageSize: 1 }).set(auth(admin.token));
    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.pagination.pageSize).toBe(1);
    expect((await request(app).get("/api/admin/audit-logs").query({ page: 0 }).set(auth(admin.token))).status).toBe(400);
    expect((await request(app).get("/api/admin/audit-logs").set(auth(student.token))).status).toBe(403);
  });

  it("resets passwords with one-time hashed tokens and revokes existing sessions", async () => {
    const email = `${emailPrefix}-reset@skillbridge.test`;
    const user = await prisma.user.create({
      data: { name: "Reset target", email, passwordHash: await bcrypt.hash(password, 4), role: Role.STUDENT, studentProfile: { create: {} } },
    });
    userIds.push(user.id);
    const login = await request(app).post("/api/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    const oldSession = sessionToken(login);

    expect((await request(app).post("/api/auth/password-reset/request").send({ email: `${emailPrefix}-missing@skillbridge.test` })).status).toBe(202);
    const requestReset = await request(app).post("/api/auth/password-reset/request").send({ email });
    expect(requestReset.status).toBe(202);
    const resetEmail = latestEmailFor(email);
    expect(resetEmail).toBeDefined();
    const resetToken = emailActionToken(resetEmail!.text);
    const storedToken = await prisma.accountToken.findFirstOrThrow({ where: { userId: user.id, type: "PASSWORD_RESET" } });
    expect(storedToken.tokenHash).not.toBe(resetToken);
    await prisma.accountToken.update({ where: { id: storedToken.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    expect((await request(app).post("/api/auth/password-reset/confirm").send({ token: resetToken, password: "A-new-strong-password-123!" })).status).toBe(400);

    await request(app).post("/api/auth/password-reset/request").send({ email });
    const activeResetEmail = latestEmailFor(email);
    expect(activeResetEmail).toBeDefined();
    const activeResetToken = emailActionToken(activeResetEmail!.text);
    const activeTokenRecord = await prisma.accountToken.findFirstOrThrow({
      where: { userId: user.id, type: "PASSWORD_RESET", consumedAt: null },
    });
    expect(activeTokenRecord.tokenHash).not.toBe(activeResetToken);

    const changed = await request(app).post("/api/auth/password-reset/confirm").send({ token: activeResetToken, password: "A-new-strong-password-123!" });
    expect(changed.status).toBe(200);
    expect((await request(app).post("/api/auth/password-reset/confirm").send({ token: activeResetToken, password: "A-new-strong-password-123!" })).status).toBe(400);
    expect((await request(app).get("/api/auth/me").set(auth(oldSession))).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email, password })).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email, password: "A-new-strong-password-123!" })).status).toBe(200);
  });
});
