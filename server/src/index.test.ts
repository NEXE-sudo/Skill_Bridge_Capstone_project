import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { JobStatus, JobType, PrismaClient, Role, WorkArrangement, ExperienceLevel } from "@prisma/client";
import { app } from "./index.js";

const prisma = new PrismaClient();
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
  const expiresAt = new Date(Date.now() + 60_000);
  const token = jwt.sign({ id: user.id, role, jti }, process.env.JWT_SECRET!, { expiresIn: 60 });
  await prisma.sessionToken.create({ data: { jti, userId: user.id, expiresAt } });
  return { id: user.id, token, email: user.email };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
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
    await Promise.all(ownedFileKeys.map((key) => fs.rm(path.resolve(process.cwd(), "uploads", key), { force: true })));
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("registers permitted roles, hashes passwords, rejects duplicate emails and excludes admin registration", async () => {
    const email = `${emailPrefix}-register@skillbridge.test`;
    const registered = await request(app).post("/api/auth/register").send({ name: "Registered User", email, password, role: "STUDENT" });
    expect(registered.status).toBe(201);
    expect(registered.body.user).not.toHaveProperty("passwordHash");
    expect(registered.body).toHaveProperty("token");
    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).not.toBe(password);
    const duplicate = await request(app).post("/api/auth/register").send({ name: "Duplicate User", email, password, role: "STUDENT" });
    expect(duplicate.status).toBe(409);
    const adminSignup = await request(app).post("/api/auth/register").send({ name: "Public Admin", email: `${emailPrefix}-admin@skillbridge.test`, password, role: "ADMIN" });
    expect(adminSignup.status).toBe(400);
    userIds.push(stored.id);
  });

  it("authenticates case-insensitive email and rejects bad, expired, malformed, and revoked sessions", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.id } });
    expect((await request(app).post("/api/auth/login").send({ email: user.email.toUpperCase(), password })).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email: user.email, password: "wrong-password" })).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set(auth("not-a-jwt"))).status).toBe(401);
    const expired = jwt.sign({ id: student.id, role: "STUDENT", jti: "expired-token" }, process.env.JWT_SECRET!, { expiresIn: -1 });
    expect((await request(app).get("/api/auth/me").set(auth(expired))).status).toBe(401);
    const logout = await request(app).post("/api/auth/logout").set(auth(student.token));
    expect(logout.status).toBe(204);
    expect((await request(app).get("/api/auth/me").set(auth(student.token))).status).toBe(401);
    const freshLogin = await request(app).post("/api/auth/login").send({ email: user.email, password });
    expect(freshLogin.status).toBe(200);
    student.token = freshLogin.body.token;
  });

  it("limits CORS to configured origins and returns baseline security headers", async () => {
    const allowedOrigin = process.env.CLIENT_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean)[0] ?? "http://localhost:5173";
    const allowed = await request(app).get("/api/health").set("Origin", allowedOrigin);
    expect(allowed.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    expect(allowed.headers["x-content-type-options"]).toBe("nosniff");
    const denied = await request(app).get("/api/health").set("Origin", "https://untrusted.invalid");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
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
    expect(await fs.stat(path.resolve(process.cwd(), "uploads", profile.resumeKey!)).then(() => true, () => false)).toBe(false);
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
  });

  it("limits saved jobs to the authenticated student and prevents duplicate records", async () => {
    expect((await request(app).post(`/api/saved-jobs/${jobId}`).set(auth(student.token))).status).toBe(201);
    expect((await request(app).post(`/api/saved-jobs/${jobId}`).set(auth(student.token))).status).toBe(201);
    const saved = await prisma.savedJob.count({ where: { studentId: student.id, jobId } });
    expect(saved).toBe(1);
    expect((await request(app).get("/api/saved-jobs").set(auth(recruiter.token))).status).toBe(403);
  });

  it("atomically audits administrative changes and suspends the target session", async () => {
    const created = await prisma.user.create({
      data: { name: "Suspension target", email: `${emailPrefix}-suspend@skillbridge.test`, passwordHash: await bcrypt.hash(password, 4), role: Role.STUDENT, studentProfile: { create: {} } },
    });
    userIds.push(created.id);
    const targetToken = (await request(app).post("/api/auth/login").send({ email: created.email, password })).body.token as string;
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
});
