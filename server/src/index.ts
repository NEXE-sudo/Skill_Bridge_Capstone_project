import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { Prisma, PrismaClient, Role, JobStatus, ApplicationStatus } from "@prisma/client";

const prisma = new PrismaClient();
const app = express();

app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(",") ?? ["http://localhost:5173"], credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));

type AuthUser = { id: string; role: Role };
declare global {
  namespace Express {
    interface Request { auth?: AuthUser }
  }
}

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) console.warn("JWT_SECRET is not configured");

function signToken(user: AuthUser) {
  return jwt.sign(user, jwtSecret || "development-only-secret-change-me", { expiresIn: (process.env.JWT_EXPIRES_IN || "7d") as jwt.SignOptions["expiresIn"] });
}

function auth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
  try {
    const payload = jwt.verify(header.slice(7), jwtSecret || "development-only-secret-change-me") as AuthUser;
    req.auth = { id: payload.id, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: { code: "TOKEN_EXPIRED", message: "Session expired or invalid" } });
  }
}

function roles(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !allowed.includes(req.auth.role)) return res.status(403).json({ error: { code: "FORBIDDEN", message: "You do not have permission" } });
    next();
  };
}

function paramId(req: Request) {
  return Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
}

function paramName(req: Request, name: string) {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

async function activeUser(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
  const user = await prisma.user.findUnique({ where: { id: req.auth.id }, select: { id: true, accountStatus: true, role: true } });
  if (!user || user.accountStatus === "SUSPENDED") return res.status(403).json({ error: { code: "ACCOUNT_SUSPENDED", message: "This account is suspended" } });
  next();
}

function validate<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.flatten() } });
    req.body = parsed.data;
    next();
  };
}

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(72),
  role: z.enum(["STUDENT", "RECRUITER"]),
});

app.get("/api/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

app.post("/api/auth/register", validate(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: { code: "EMAIL_EXISTS", message: "An account already exists for this email" } });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        name, email, passwordHash, role: role as Role,
        ...(role === "STUDENT" ? { studentProfile: { create: {} } } : { recruiterProfile: { create: {} } }),
      },
    });
    res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, token: signToken({ id: user.id, role: user.role }) });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const parsed = z.object({ email: z.email(), password: z.string() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid credentials" } });
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } });
    if (user.accountStatus === "SUSPENDED") return res.status(403).json({ error: { code: "ACCOUNT_SUSPENDED", message: "This account is suspended" } });
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, token: signToken({ id: user.id, role: user.role }) });
  } catch (error) { next(error); }
});

app.post("/api/auth/logout", auth, (_req, res) => res.status(204).send());

app.get("/api/auth/me", auth, activeUser, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.id },
    include: { studentProfile: true, recruiterProfile: true },
  });
  if (!user) return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, accountStatus: user.accountStatus, studentProfile: user.studentProfile, recruiterProfile: user.recruiterProfile });
});

app.get("/api/jobs", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const location = typeof req.query.location === "string" ? req.query.location : "";
    const jobType = typeof req.query.jobType === "string" ? req.query.jobType : "";
    const arrangement = typeof req.query.workArrangement === "string" ? req.query.workArrangement : "";
    const experience = typeof req.query.experienceLevel === "string" ? req.query.experienceLevel : "";
    const sort = req.query.sort === "relevant" ? "relevant" : "newest";
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(30, Math.max(1, Number(req.query.pageSize) || 12));
    const where: Prisma.JobWhereInput = { status: JobStatus.PUBLISHED, deadline: { gte: new Date() }, ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { location: { contains: q, mode: "insensitive" } }, { skills: { hasSome: [q] } }] } : {}), ...(location ? { location: { contains: location, mode: "insensitive" } } : {}), ...(jobType ? { jobType: jobType as Prisma.EnumJobTypeFilter["equals"] } : {}), ...(arrangement ? { workArrangement: arrangement as never } : {}), ...(experience ? { experienceLevel: experience as never } : {}) };
    const [items, total] = await Promise.all([
      prisma.job.findMany({ where, include: { recruiter: { select: { name: true, recruiterProfile: { select: { organisation: true, organisationLogo: true } } } } }, orderBy: sort === "relevant" ? [{ title: "asc" }, { createdAt: "desc" }] : { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.job.count({ where }),
    ]);
    res.json({ items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
  } catch (error) { next(error); }
});

app.get("/api/jobs/:id", async (req, res, next) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: paramId(req) }, include: { recruiter: { select: { name: true, recruiterProfile: true } } } });
    if (!job) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Listing not found" } });
    if (job.status !== JobStatus.PUBLISHED) return res.status(410).json({ error: { code: "LISTING_UNAVAILABLE", message: "This listing is no longer available" } });
    if (job.deadline < new Date()) return res.status(410).json({ error: { code: "LISTING_EXPIRED", message: "The application deadline has passed" } });
    res.json(job);
  } catch (error) { next(error); }
});

app.get("/api/users/me/profile", auth, activeUser, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.id }, include: { studentProfile: true, recruiterProfile: true } });
  res.json({ user: { id: user!.id, name: user!.name, email: user!.email }, studentProfile: user!.studentProfile, recruiterProfile: user!.recruiterProfile });
});

const studentProfileSchema = z.object({
  name: z.string().trim().min(2).optional(), phone: z.string().max(30).optional(), location: z.string().max(120).optional(),
  university: z.string().max(160).optional(), degree: z.string().max(160).optional(), branch: z.string().max(160).optional(),
  graduationYear: z.coerce.number().int().min(1950).max(2100).optional().nullable(), bio: z.string().max(2000).optional(),
  skills: z.array(z.string().trim().min(1).max(50)).max(30).optional(), linkedinUrl: z.url().optional().or(z.literal("")),
  githubUrl: z.url().optional().or(z.literal("")),
  portfolioUrl: z.url().optional().or(z.literal("")),
});

app.patch("/api/users/me/profile", auth, activeUser, validate(studentProfileSchema), async (req, res, next) => {
  try {
    const { name, ...profile } = req.body;
    if (req.auth!.role === "STUDENT") {
      await prisma.studentProfile.upsert({ where: { userId: req.auth!.id }, create: { userId: req.auth!.id, ...profile }, update: profile });
    } else if (req.auth!.role === "RECRUITER") {
      await prisma.recruiterProfile.upsert({ where: { userId: req.auth!.id }, create: { userId: req.auth!.id, ...profile }, update: profile });
    }
    if (name) await prisma.user.update({ where: { id: req.auth!.id }, data: { name } });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

const uploadDir = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const resumeUpload = multer({
  storage: multer.diskStorage({ destination: uploadDir, filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase() || ".pdf"}`) }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === "application/pdf"),
});

app.post("/api/users/me/resume", auth, activeUser, roles(Role.STUDENT), resumeUpload.single("resume"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: { code: "INVALID_FILE", message: "A PDF resume is required" } });
  const profile = await prisma.studentProfile.findUnique({ where: { userId: req.auth!.id } });
  if (profile?.resumeKey && fs.existsSync(path.resolve(uploadDir, path.basename(profile.resumeKey)))) fs.unlinkSync(path.resolve(uploadDir, path.basename(profile.resumeKey)));
  await prisma.studentProfile.update({ where: { userId: req.auth!.id }, data: { resumeKey: req.file.filename, resumeName: req.file.originalname, resumeSize: req.file.size, resumeType: req.file.mimetype, resumeUpdatedAt: new Date() } });
  res.status(201).json({ name: req.file.originalname, size: req.file.size, type: req.file.mimetype });
});

app.delete("/api/users/me/resume", auth, activeUser, roles(Role.STUDENT), async (req, res) => {
  const profile = await prisma.studentProfile.findUnique({ where: { userId: req.auth!.id } });
  if (profile?.resumeKey) {
    const file = path.resolve(uploadDir, path.basename(profile.resumeKey));
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  await prisma.studentProfile.update({ where: { userId: req.auth!.id }, data: { resumeKey: null, resumeName: null, resumeSize: null, resumeType: null, resumeUpdatedAt: null } });
  res.status(204).send();
});

app.get("/api/saved-jobs", auth, activeUser, roles(Role.STUDENT), async (req, res) => {
  const items = await prisma.savedJob.findMany({ where: { studentId: req.auth!.id }, include: { job: { include: { recruiter: { select: { recruiterProfile: { select: { organisation: true } } } } } } }, orderBy: { createdAt: "desc" } });
  res.json({ items });
});

app.post("/api/saved-jobs/:jobId", auth, activeUser, roles(Role.STUDENT), async (req, res, next) => {
  try {
    const jobId = paramName(req, "jobId");
    await prisma.savedJob.upsert({ where: { studentId_jobId: { studentId: req.auth!.id, jobId } }, create: { studentId: req.auth!.id, jobId }, update: {} });
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

app.delete("/api/saved-jobs/:jobId", auth, activeUser, roles(Role.STUDENT), async (req, res) => {
  const jobId = paramName(req, "jobId");
  await prisma.savedJob.deleteMany({ where: { studentId: req.auth!.id, jobId } });
  res.status(204).send();
});

app.post("/api/jobs/:id/applications", auth, activeUser, roles(Role.STUDENT), async (req, res, next) => {
  try {
    const jobId = paramId(req);
    const parsed = z.object({ coverLetter: z.string().max(3000).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid application" } });
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.status !== JobStatus.PUBLISHED) return res.status(410).json({ error: { code: "LISTING_UNAVAILABLE", message: "This listing is unavailable" } });
    if (job.deadline < new Date()) return res.status(410).json({ error: { code: "LISTING_EXPIRED", message: "The application deadline has passed" } });
    const profile = await prisma.studentProfile.findUnique({ where: { userId: req.auth!.id } });
    const application = await prisma.application.create({ data: { jobId: job.id, studentId: req.auth!.id, coverLetter: parsed.data.coverLetter, resumeKey: profile?.resumeKey ?? null } });
    await prisma.notification.create({ data: { userId: req.auth!.id, title: "Application submitted", message: `Your application for ${job.title} was submitted.`, type: "APPLICATION" } });
    res.status(201).json(application);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return res.status(409).json({ error: { code: "DUPLICATE_APPLICATION", message: "You have already applied for this job" } });
    next(error);
  }
});

app.get("/api/applications/me", auth, activeUser, roles(Role.STUDENT), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(30, Math.max(1, Number(req.query.pageSize) || 12));
  const where: Prisma.ApplicationWhereInput = { studentId: req.auth!.id, ...(status ? { status: status as ApplicationStatus } : {}), ...(q ? { job: { OR: [{ title: { contains: q, mode: "insensitive" } }, { location: { contains: q, mode: "insensitive" } }] } } : {}) };
  const [items, total] = await Promise.all([prisma.application.findMany({ where, include: { job: { include: { recruiter: { select: { recruiterProfile: { select: { organisation: true } } } } } } }, orderBy: { appliedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), prisma.application.count({ where })]);
  res.json({ items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

app.patch("/api/applications/:id/withdraw", auth, activeUser, roles(Role.STUDENT), async (req, res, next) => {
  try {
    const application = await prisma.application.findUnique({ where: { id: paramId(req) } });
    if (!application || application.studentId !== req.auth!.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Application not found" } });
    if (["OFFERED", "REJECTED", "WITHDRAWN"].includes(application.status)) return res.status(409).json({ error: { code: "WITHDRAWAL_NOT_ALLOWED", message: "This application cannot be withdrawn" } });
    const updated = await prisma.application.update({ where: { id: application.id }, data: { status: ApplicationStatus.WITHDRAWN } });
    res.json(updated);
  } catch (error) { next(error); }
});

app.get("/api/student/dashboard", auth, activeUser, roles(Role.STUDENT), async (req, res) => {
  const studentId = req.auth!.id;
  const [applications, totalApplications, saved, profile] = await Promise.all([
    prisma.application.findMany({ where: { studentId }, include: { job: { select: { id: true, title: true, skills: true, recruiter: { select: { recruiterProfile: { select: { organisation: true } } } } } } }, orderBy: { appliedAt: "desc" }, take: 10 }),
    prisma.application.count({ where: { studentId } }),
    prisma.savedJob.count({ where: { studentId } }),
    prisma.studentProfile.findUnique({ where: { userId: studentId } }),
  ]);
  const statusRows = await prisma.application.groupBy({ by: ["status"], where: { studentId }, _count: { _all: true } });
  const counts = statusRows.reduce((acc, item) => ({ ...acc, [item.status]: item._count._all }), {} as Record<string, number>);
  const skills = new Set(profile?.skills ?? []);
  const recommendations = skills.size ? await prisma.job.findMany({ where: { status: JobStatus.PUBLISHED, deadline: { gte: new Date() }, skills: { hasSome: [...skills] } }, include: { recruiter: { select: { recruiterProfile: { select: { organisation: true } } } } }, take: 6, orderBy: { createdAt: "desc" } }) : [];
  res.json({ applications: { total: totalApplications, counts, recent: applications }, savedJobs: saved, recommendations });
});

const jobSchema = z.object({
  title: z.string().trim().min(3).max(160),
  organisation: z.string().trim().max(160).optional(),
  description: z.string().trim().min(20).max(10000),
  responsibilities: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  requirements: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  skills: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  jobType: z.enum(["FULL_TIME", "PART_TIME", "INTERNSHIP", "CONTRACT"]),
  workArrangement: z.enum(["REMOTE", "HYBRID", "ON_SITE"]),
  location: z.string().trim().min(2).max(160),
  experienceLevel: z.enum(["ENTRY", "MID", "SENIOR"]),
  salaryMin: z.coerce.number().int().min(0).optional().nullable(),
  salaryMax: z.coerce.number().int().min(0).optional().nullable(),
  deadline: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  status: z.enum(["DRAFT", "PUBLISHED", "CLOSED"]).default("DRAFT"),
});

async function ownsJob(recruiterId: string, jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  return job?.recruiterId === recruiterId ? job : null;
}

app.get("/api/recruiter/dashboard", auth, activeUser, roles(Role.RECRUITER), async (req, res) => {
  const recruiterId = req.auth!.id;
  const jobs = await prisma.job.findMany({ where: { recruiterId }, include: { applications: true } });
  const applications = jobs.flatMap((job) => job.applications);
  const activeListings = jobs.filter((job) => job.status === JobStatus.PUBLISHED).length;
  const underReview = applications.filter((item) => item.status === "UNDER_REVIEW").length;
  const shortlisted = applications.filter((item) => item.status === "SHORTLISTED").length;
  const recent = await prisma.application.findMany({
    where: { job: { recruiterId } },
    include: { job: { select: { title: true } }, student: { select: { name: true, email: true, studentProfile: true } } },
    orderBy: { appliedAt: "desc" },
    take: 8,
  });
  res.json({ activeListings, totalApplications: applications.length, underReview, shortlisted, recentApplications: recent, listingPerformance: jobs.map((job) => ({ id: job.id, title: job.title, status: job.status, applications: job.applications.length })) });
});

app.get("/api/recruiter/jobs", auth, activeUser, roles(Role.RECRUITER), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(30, Math.max(1, Number(req.query.pageSize) || 12));
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const where: Prisma.JobWhereInput = { recruiterId: req.auth!.id, ...(status ? { status: status as JobStatus } : {}), ...(q ? { title: { contains: q, mode: "insensitive" } } : {}) };
  const [items, total] = await Promise.all([prisma.job.findMany({ where, include: { _count: { select: { applications: true } } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), prisma.job.count({ where })]);
  res.json({ items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

app.post("/api/jobs", auth, activeUser, roles(Role.RECRUITER), validate(jobSchema), async (req, res, next) => {
  try {
    const { organisation, deadline, ...data } = req.body;
    if (organisation) await prisma.recruiterProfile.upsert({ where: { userId: req.auth!.id }, create: { userId: req.auth!.id, organisation }, update: { organisation } });
    const job = await prisma.job.create({ data: { ...data, recruiterId: req.auth!.id, deadline: new Date(deadline) } });
    res.status(201).json(job);
  } catch (error) { next(error); }
});

app.patch("/api/jobs/:id", auth, activeUser, roles(Role.RECRUITER), validate(jobSchema.partial()), async (req, res, next) => {
  try {
    const job = await ownsJob(req.auth!.id, paramId(req));
    if (!job) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Listing not found or not owned by you" } });
    const { organisation, deadline, ...data } = req.body;
    if (organisation) await prisma.recruiterProfile.upsert({ where: { userId: req.auth!.id }, create: { userId: req.auth!.id, organisation }, update: { organisation } });
    const updated = await prisma.job.update({ where: { id: job.id }, data: { ...data, ...(deadline ? { deadline: new Date(deadline) } : {}) } });
    res.json(updated);
  } catch (error) { next(error); }
});

app.delete("/api/jobs/:id", auth, activeUser, roles(Role.RECRUITER), async (req, res) => {
  const job = await ownsJob(req.auth!.id, paramId(req));
  if (!job) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Listing not found or not owned by you" } });
  if (job.status === JobStatus.PUBLISHED) return res.status(409).json({ error: { code: "CLOSE_BEFORE_DELETE", message: "Close the listing before deleting it" } });
  await prisma.job.delete({ where: { id: job.id } });
  res.status(204).send();
});

app.get("/api/recruiter/jobs/:id/applications", auth, activeUser, roles(Role.RECRUITER), async (req, res) => {
  const job = await ownsJob(req.auth!.id, paramId(req));
  if (!job) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Listing not found or not owned by you" } });
  const items = await prisma.application.findMany({ where: { jobId: job.id }, include: { student: { select: { id: true, name: true, email: true, studentProfile: true } } }, orderBy: { appliedAt: "desc" } });
  res.json({ items });
});

app.get("/api/recruiter/applicants", auth, activeUser, roles(Role.RECRUITER), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const where: Prisma.ApplicationWhereInput = {
    job: { recruiterId: req.auth!.id },
    ...(status ? { status: status as ApplicationStatus } : {}),
    ...(q ? { OR: [{ student: { name: { contains: q, mode: "insensitive" } } }, { job: { title: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const items = await prisma.application.findMany({ where, include: { job: { select: { id: true, title: true } }, student: { select: { id: true, name: true, email: true, studentProfile: true } } }, orderBy: { appliedAt: "desc" } });
  res.json({ items });
});

app.patch("/api/applications/:id/status", auth, activeUser, roles(Role.RECRUITER), async (req, res, next) => {
  try {
    const parsed = z.object({ status: z.enum(["APPLIED", "UNDER_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFERED", "REJECTED", "WITHDRAWN"]) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid status" } });
    const application = await prisma.application.findUnique({ where: { id: paramId(req) }, include: { job: true } });
    if (!application || application.job.recruiterId !== req.auth!.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Application not found or not owned by you" } });
    const updated = await prisma.application.update({ where: { id: application.id }, data: { status: parsed.data.status } });
    await prisma.notification.create({ data: { userId: application.studentId, title: "Application status updated", message: `Your ${application.job.title} application is now ${parsed.data.status.replace("_", " ").toLowerCase()}.`, type: "APPLICATION" } });
    res.json(updated);
  } catch (error) { next(error); }
});

app.patch("/api/users/me/recruiter-profile", auth, activeUser, roles(Role.RECRUITER), async (req, res, next) => {
  try {
    const schema = z.object({ organisation: z.string().max(160).optional(), organisationLogo: z.string().max(500).optional().or(z.literal("")), designation: z.string().max(160).optional(), website: z.url().optional().or(z.literal("")), industry: z.string().max(160).optional(), location: z.string().max(160).optional(), description: z.string().max(3000).optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid profile", details: parsed.error.flatten() } });
    const profile = await prisma.recruiterProfile.upsert({ where: { userId: req.auth!.id }, create: { userId: req.auth!.id, ...parsed.data }, update: parsed.data });
    res.json(profile);
  } catch (error) { next(error); }
});

app.get("/api/admin/dashboard", auth, activeUser, roles(Role.ADMIN), async (_req, res) => {
  const [users, students, recruiters, listings, published, applications] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: Role.STUDENT } }),
    prisma.user.count({ where: { role: Role.RECRUITER } }),
    prisma.job.count(),
    prisma.job.count({ where: { status: JobStatus.PUBLISHED } }),
    prisma.application.count(),
  ]);
  res.json({ totalUsers: users, totalStudents: students, totalRecruiters: recruiters, totalListings: listings, publishedListings: published, totalApplications: applications });
});

app.get("/api/admin/users", auth, activeUser, roles(Role.ADMIN), async (req, res) => {
  const role = typeof req.query.role === "string" ? req.query.role : "";
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const where: Prisma.UserWhereInput = { ...(role ? { role: role as Role } : {}), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}) };
  const items = await prisma.user.findMany({ where, select: { id: true, name: true, email: true, role: true, accountStatus: true, createdAt: true }, orderBy: { createdAt: "desc" } });
  res.json({ items });
});

app.patch("/api/admin/users/:id/status", auth, activeUser, roles(Role.ADMIN), async (req, res, next) => {
  try {
    const parsed = z.object({ accountStatus: z.enum(["ACTIVE", "SUSPENDED"]) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid account status" } });
    const target = await prisma.user.findUnique({ where: { id: paramId(req) } });
    if (!target) return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
    if (target.role === Role.ADMIN) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Administrator accounts cannot be changed through this endpoint" } });
    const updated = await prisma.user.update({ where: { id: target.id }, data: { accountStatus: parsed.data.accountStatus } });
    await prisma.auditLog.create({ data: { actorId: req.auth!.id, action: parsed.data.accountStatus === "SUSPENDED" ? "SUSPEND_USER" : "REACTIVATE_USER", entityType: "USER", entityId: target.id, metadata: { accountStatus: parsed.data.accountStatus } } });
    res.json({ id: updated.id, accountStatus: updated.accountStatus });
  } catch (error) { next(error); }
});

app.get("/api/admin/jobs", auth, activeUser, roles(Role.ADMIN), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const where: Prisma.JobWhereInput = { ...(status ? { status: status as JobStatus } : {}), ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { location: { contains: q, mode: "insensitive" } }] } : {}) };
  const items = await prisma.job.findMany({ where, include: { recruiter: { select: { name: true, recruiterProfile: { select: { organisation: true } } } }, _count: { select: { applications: true } } }, orderBy: { createdAt: "desc" } });
  res.json({ items });
});

app.patch("/api/admin/jobs/:id/moderation", auth, activeUser, roles(Role.ADMIN), async (req, res, next) => {
  try {
    const parsed = z.object({ status: z.enum(["PUBLISHED", "CLOSED"]), reason: z.string().max(1000).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid moderation action" } });
    const job = await prisma.job.findUnique({ where: { id: paramId(req) } });
    if (!job) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Listing not found" } });
    const updated = await prisma.job.update({ where: { id: job.id }, data: { status: parsed.data.status } });
    await prisma.auditLog.create({ data: { actorId: req.auth!.id, action: parsed.data.status === "CLOSED" ? "CLOSE_LISTING" : "PUBLISH_LISTING", entityType: "JOB", entityId: job.id, metadata: { reason: parsed.data.reason ?? null, previousStatus: job.status } } });
    res.json(updated);
  } catch (error) { next(error); }
});

app.get("/api/notifications", auth, activeUser, async (req, res) => {
  const items = await prisma.notification.findMany({ where: { userId: req.auth!.id }, orderBy: { createdAt: "desc" }, take: 30 });
  res.json({ items });
});

app.patch("/api/notifications/:id/read", auth, activeUser, async (req, res) => {
  const notification = await prisma.notification.findUnique({ where: { id: paramId(req) } });
  if (!notification || notification.userId !== req.auth!.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Notification not found" } });
  const updated = await prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
  res.json(updated);
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: { code: "INVALID_FILE", message: error.code === "LIMIT_FILE_SIZE" ? "Resume must be 5 MB or smaller" : error.message } });
  if (error instanceof Error && error.message.includes("PDF")) return res.status(400).json({ error: { code: "INVALID_FILE", message: "Only PDF resumes are allowed" } });
  console.error(error);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
});

export { app, prisma };

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT) || 4000;
  app.listen(port, () => console.log(`SkillBridge API listening on http://localhost:${port}`));
}
