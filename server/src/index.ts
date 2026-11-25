import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { createClient } from "redis";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AccountTokenType, Prisma, PrismaClient, Role, JobStatus, ApplicationStatus } from "@prisma/client";
import { createResumeStorage } from "./resumeStorage.js";
import { emailProvider } from "./email.js";

const app = express();
const envFile = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../.env")].find((candidate) => fs.existsSync(candidate));
if (envFile) dotenv.config({ path: envFile });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be configured");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const resumeStorage = createResumeStorage();
const redisUrl = process.env.REDIS_URL;
if (process.env.NODE_ENV === "production" && !redisUrl) throw new Error("REDIS_URL must be configured in production");
const redisClient = redisUrl ? createClient({ url: redisUrl }) : null;
redisClient?.on("error", (error) => console.error("Redis client error", error));
const rateLimitPrefix = process.env.NODE_ENV === "test" ? `test:${process.pid}:` : "";
export async function connectRateLimitStore() {
  if (redisClient && !redisClient.isReady) await redisClient.connect();
}

export async function disconnectRateLimitStore() {
  if (redisClient?.isOpen) await redisClient.quit();
}

await connectRateLimitStore();

const trustProxySetting = process.env.TRUST_PROXY ?? "false";
if (trustProxySetting === "true") app.set("trust proxy", 1);
else if (trustProxySetting !== "false") {
  const trustedHops = z.coerce.number().int().min(0).safeParse(trustProxySetting);
  if (!trustedHops.success) throw new Error("TRUST_PROXY must be false, true, or a non-negative trusted-hop count");
  app.set("trust proxy", trustedHops.data);
}
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
const clientOrigins = process.env.CLIENT_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: clientOrigins?.length ? clientOrigins : ["http://localhost:5173"], credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

function createRateLimiter(prefix: string, limit: number) {
  const middleware = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    ...(redisClient ? {
      store: new RedisStore({
        prefix: `${rateLimitPrefix}${prefix}`,
        sendCommand: (...args) => redisClient.sendCommand(args),
      }),
    } : {}),
  });
  return (req: Request, res: Response, next: NextFunction) => middleware(req, res, (error?: unknown) => {
    if (error) {
      console.error("Rate-limit store request failed", error);
      return res.status(503).json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Request limiting is temporarily unavailable" } });
    }
    next();
  });
}

app.use(createRateLimiter("skillbridge:api:", 300));

type AuthUser = { id: string; role: Role };
declare global {
  // Express request augmentation requires a namespace declaration.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth?: AuthUser; authSessionJti?: string; authCsrfToken?: string }
  }
}

const jwtSecret = process.env.JWT_SECRET ?? "";
if (!jwtSecret || jwtSecret.length < 32) throw new Error("JWT_SECRET must be configured with at least 32 characters");
if (process.env.NODE_ENV === "production" && !process.env.CLIENT_ORIGIN) throw new Error("CLIENT_ORIGIN must be configured in production");
const cookieSameSite = z.enum(["lax", "strict", "none"]).parse(process.env.AUTH_COOKIE_SAME_SITE?.toLowerCase() ?? "lax");
const secureCookies = process.env.NODE_ENV === "production" || process.env.AUTH_COOKIE_SECURE === "true";
if (cookieSameSite === "none" && !secureCookies) throw new Error("AUTH_COOKIE_SECURE must be true when AUTH_COOKIE_SAME_SITE=none");
const sessionCookieName = "skillbridge_session";
const csrfCookieName = "skillbridge_csrf";
const cookieOptions = { path: "/", sameSite: cookieSameSite, secure: secureCookies };

async function signToken(user: AuthUser) {
  const jti = randomUUID();
  const csrfToken = randomBytes(32).toString("base64url");
  const token = jwt.sign({ ...user, jti, csrf: csrfToken }, jwtSecret, { expiresIn: (process.env.JWT_EXPIRES_IN || "7d") as jwt.SignOptions["expiresIn"] });
  const claims = jwt.decode(token);
  if (!claims || typeof claims === "string" || typeof claims.exp !== "number") throw new Error("Unable to create token expiry");
  await prisma.sessionToken.create({ data: { jti, userId: user.id, expiresAt: new Date(claims.exp * 1000) } });
  return { token, csrfToken, maxAge: Math.max(0, claims.exp * 1000 - Date.now()) };
}

async function auth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[sessionCookieName];
  if (typeof token !== "string") return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    return res.status(401).json({ error: { code: "INVALID_SESSION", message: "Session expired or invalid" } });
  }
  if (typeof payload === "string" || typeof payload.id !== "string" || typeof payload.jti !== "string" || typeof payload.csrf !== "string") {
    return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Session expired or invalid" } });
  }
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (isMutation && (req.cookies?.[csrfCookieName] !== payload.csrf || req.get("x-csrf-token") !== payload.csrf)) {
    return res.status(403).json({ error: { code: "CSRF_INVALID", message: "Request verification failed" } });
  }
  const session = await prisma.sessionToken.findUnique({
    where: { jti: payload.jti },
    include: { user: { select: { id: true, role: true, accountStatus: true } } },
  });
  if (!session || session.userId !== payload.id || session.revokedAt || session.expiresAt <= new Date() || session.user.accountStatus !== "ACTIVE") {
    return res.status(401).json({ error: { code: "INVALID_SESSION", message: "Session expired or invalid" } });
  }
  req.auth = { id: session.user.id, role: session.user.role };
  req.authSessionJti = session.jti;
  req.authCsrfToken = payload.csrf;
  next();
}

function setSessionCookies(res: Response, session: Awaited<ReturnType<typeof signToken>>) {
  res.cookie(sessionCookieName, session.token, { ...cookieOptions, httpOnly: true, maxAge: session.maxAge });
  res.cookie(csrfCookieName, session.csrfToken, { ...cookieOptions, httpOnly: false, maxAge: session.maxAge });
}

function clearSessionCookies(res: Response) {
  res.clearCookie(sessionCookieName, { ...cookieOptions, httpOnly: true });
  res.clearCookie(csrfCookieName, { ...cookieOptions, httpOnly: false });
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

function activeUser(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
  next();
}

const authRateLimit = createRateLimiter("skillbridge:auth:", process.env.NODE_ENV === "test" ? 100 : 10);

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

function hashAccountToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function issueAccountToken(userId: string, type: AccountTokenType, lifetimeMs: number) {
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.accountToken.updateMany({ where: { userId, type, consumedAt: null }, data: { consumedAt: new Date() } }),
    prisma.accountToken.create({
      data: { userId, type, tokenHash: hashAccountToken(token), expiresAt: new Date(Date.now() + lifetimeMs) },
    }),
  ]);
  return token;
}

function accountActionUrl(route: string, token: string) {
  const origin = process.env.PUBLIC_APP_URL ?? clientOrigins?.[0] ?? "http://localhost:5173";
  const url = new URL(route, origin);
  url.searchParams.set("token", token);
  return url.toString();
}

async function findValidAccountToken(token: string, type: AccountTokenType) {
  return prisma.accountToken.findUnique({
    where: { tokenHash: hashAccountToken(token) },
    include: { user: { select: { id: true, name: true, email: true, emailVerifiedAt: true } } },
  }).then((record) => record && record.type === type && !record.consumedAt && record.expiresAt > new Date() ? record : null);
}

app.get("/api/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

app.get("/api/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    if (redisClient && !redisClient.isReady) throw new Error("Redis connection is not ready");
    res.json({ status: "ready" });
  } catch (error) {
    console.error("API readiness check failed", error);
    res.status(503).json({ status: "not_ready" });
  }
});

app.post("/api/auth/register", authRateLimit, validate(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: { code: "EMAIL_EXISTS", message: "An account already exists for this email" } });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        name, email, passwordHash, role: role as Role, emailVerifiedAt: null,
        ...(role === "STUDENT" ? { studentProfile: { create: {} } } : { recruiterProfile: { create: {} } }),
      },
    });
    const token = await issueAccountToken(user.id, AccountTokenType.EMAIL_VERIFICATION, 24 * 60 * 60 * 1000);
    await emailProvider.send({
      to: user.email,
      subject: "Verify your SkillBridge email",
      text: `Hello ${user.name}, verify your email within 24 hours: ${accountActionUrl("/verify-email", token)}`,
    });
    res.status(201).json({ message: "Account created. Check your email to verify your address before signing in." });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return res.status(409).json({ error: { code: "EMAIL_EXISTS", message: "An account already exists for this email" } });
    next(error);
  }
});

app.post("/api/auth/verify-email", authRateLimit, async (req, res, next) => {
  try {
    const parsed = z.object({ token: z.string().min(40).max(64) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "INVALID_TOKEN", message: "Verification link is invalid or expired" } });
    const accountToken = await findValidAccountToken(parsed.data.token, AccountTokenType.EMAIL_VERIFICATION);
    if (!accountToken) return res.status(400).json({ error: { code: "INVALID_TOKEN", message: "Verification link is invalid or expired" } });
    const consumed = await prisma.$transaction(async (transaction) => {
      const result = await transaction.accountToken.updateMany({
        where: { id: accountToken.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (result.count !== 1) return false;
      await transaction.user.update({ where: { id: accountToken.userId }, data: { emailVerifiedAt: new Date() } });
      return true;
    });
    if (!consumed) return res.status(400).json({ error: { code: "INVALID_TOKEN", message: "Verification link is invalid or expired" } });
    res.json({ message: "Email verified. You can now sign in." });
  } catch (error) { next(error); }
});

app.post("/api/auth/email-verification/resend", authRateLimit, async (req, res, next) => {
  try {
    const parsed = z.object({ email: z.email().transform((value) => value.toLowerCase()) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter a valid email address" } });
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (user && !user.emailVerifiedAt) {
      const token = await issueAccountToken(user.id, AccountTokenType.EMAIL_VERIFICATION, 24 * 60 * 60 * 1000);
      await emailProvider.send({
        to: user.email,
        subject: "Verify your SkillBridge email",
        text: `Hello ${user.name}, verify your email within 24 hours: ${accountActionUrl("/verify-email", token)}`,
      });
    }
    res.status(202).json({ message: "If the account needs verification, an email will be sent." });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", authRateLimit, async (req, res, next) => {
  try {
    const parsed = z.object({ email: z.email(), password: z.string() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid credentials" } });
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } });
    if (user.accountStatus === "SUSPENDED") return res.status(403).json({ error: { code: "ACCOUNT_SUSPENDED", message: "This account is suspended" } });
    if (!user.emailVerifiedAt) return res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Verify your email address before signing in" } });
    const session = await signToken({ id: user.id, role: user.role });
    setSessionCookies(res, session);
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) { next(error); }
});

app.post("/api/auth/password-reset/request", authRateLimit, async (req, res, next) => {
  try {
    const parsed = z.object({ email: z.email().transform((value) => value.toLowerCase()) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter a valid email address" } });
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (user) {
      const token = await issueAccountToken(user.id, AccountTokenType.PASSWORD_RESET, 60 * 60 * 1000);
      await emailProvider.send({
        to: user.email,
        subject: "Reset your SkillBridge password",
        text: `Hello ${user.name}, reset your password within one hour: ${accountActionUrl("/reset-password", token)}`,
      });
    }
    res.status(202).json({ message: "If an account exists for this address, a password reset email will be sent." });
  } catch (error) { next(error); }
});

app.post("/api/auth/password-reset/confirm", authRateLimit, async (req, res, next) => {
  try {
    const parsed = z.object({ token: z.string().min(40).max(64), password: z.string().min(8).max(72) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Reset link or password is invalid" } });
    const accountToken = await findValidAccountToken(parsed.data.token, AccountTokenType.PASSWORD_RESET);
    if (!accountToken) return res.status(400).json({ error: { code: "INVALID_TOKEN", message: "Reset link is invalid or expired" } });
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const consumed = await prisma.$transaction(async (transaction) => {
      const result = await transaction.accountToken.updateMany({
        where: { id: accountToken.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (result.count !== 1) return false;
      await transaction.user.update({ where: { id: accountToken.userId }, data: { passwordHash } });
      await transaction.sessionToken.updateMany({ where: { userId: accountToken.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      return true;
    });
    if (!consumed) return res.status(400).json({ error: { code: "INVALID_TOKEN", message: "Reset link is invalid or expired" } });
    clearSessionCookies(res);
    res.json({ message: "Password updated. Sign in with your new password." });
  } catch (error) { next(error); }
});

app.post("/api/auth/logout", auth, async (req, res) => {
  await prisma.sessionToken.updateMany({ where: { jti: req.authSessionJti!, revokedAt: null }, data: { revokedAt: new Date() } });
  clearSessionCookies(res);
  res.status(204).send();
});

app.get("/api/auth/me", auth, activeUser, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.id },
    select: {
      id: true, name: true, email: true, role: true, accountStatus: true,
      studentProfile: { select: { id: true, phone: true, location: true, university: true, degree: true, branch: true, graduationYear: true, bio: true, skills: true, linkedinUrl: true, githubUrl: true, portfolioUrl: true, resumeName: true, resumeSize: true, resumeType: true, resumeUpdatedAt: true } },
      recruiterProfile: true,
    },
  });
  if (!user) return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, accountStatus: user.accountStatus, studentProfile: user.studentProfile, recruiterProfile: user.recruiterProfile });
});

app.get("/api/jobs", async (req, res, next) => {
  try {
    const query = z.object({
      q: z.string().trim().max(120).optional(),
      location: z.string().trim().max(120).optional(),
      jobType: z.enum(["FULL_TIME", "PART_TIME", "INTERNSHIP", "CONTRACT"]).optional(),
      workArrangement: z.enum(["REMOTE", "HYBRID", "ON_SITE"]).optional(),
      experienceLevel: z.enum(["ENTRY", "MID", "SENIOR"]).optional(),
      sort: z.enum(["newest", "oldest"]).default("newest"),
      page: z.coerce.number().int().min(1).max(100_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(30).default(12),
    }).safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid job search filters", details: query.error.flatten() } });
    const { q = "", location = "", jobType, workArrangement, experienceLevel, sort, page, pageSize } = query.data;
    const where: Prisma.JobWhereInput = {
      status: JobStatus.PUBLISHED,
      deadline: { gte: new Date() },
      ...(q ? { OR: [
        { title: { contains: q, mode: "insensitive" } },
        { location: { contains: q, mode: "insensitive" } },
        { skills: { has: q } },
        { recruiter: { recruiterProfile: { organisation: { contains: q, mode: "insensitive" } } } },
      ] } : {}),
      ...(location ? { location: { contains: location, mode: "insensitive" } } : {}),
      ...(jobType ? { jobType } : {}),
      ...(workArrangement ? { workArrangement } : {}),
      ...(experienceLevel ? { experienceLevel } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.job.findMany({ where, include: { recruiter: { select: { name: true, recruiterProfile: { select: { organisation: true, organisationLogo: true } } } } }, orderBy: { createdAt: sort === "newest" ? "desc" : "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
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
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.id },
    select: {
      id: true, name: true, email: true,
      studentProfile: { select: { id: true, phone: true, location: true, university: true, degree: true, branch: true, graduationYear: true, bio: true, skills: true, linkedinUrl: true, githubUrl: true, portfolioUrl: true, resumeName: true, resumeSize: true, resumeType: true, resumeUpdatedAt: true } },
      recruiterProfile: true,
    },
  });
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

async function removeResumeIfUnreferenced(key: string) {
  const references = await prisma.application.count({ where: { resumeKey: key } });
  if (!references) await resumeStorage.delete(key);
}

async function lockResumeReferences(transaction: Prisma.TransactionClient, userId: string) {
  await transaction.$queryRaw<{ locked: string }[]>`SELECT pg_advisory_xact_lock(hashtext(${userId}))::text AS locked`;
}

const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === "application/pdf" && path.extname(file.originalname).toLowerCase() === ".pdf"),
});

app.post("/api/users/me/resume", auth, activeUser, roles(Role.STUDENT), resumeUpload.single("resume"), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: { code: "INVALID_FILE", message: "A PDF resume is required" } });
  const uploadedFile = req.file;
  let storedKey: string | undefined;
  let profileUpdated = false;
  try {
    const bytes = uploadedFile.buffer;
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      return res.status(400).json({ error: { code: "INVALID_FILE", message: "The uploaded file is not a valid PDF" } });
    }
    const key = await resumeStorage.put(bytes);
    storedKey = key;
    const profile = await prisma.$transaction(async (transaction) => {
      await lockResumeReferences(transaction, req.auth!.id);
      const current = await transaction.studentProfile.findUnique({ where: { userId: req.auth!.id } });
      await transaction.studentProfile.update({
        where: { userId: req.auth!.id },
        data: { resumeKey: key, resumeName: path.basename(uploadedFile.originalname), resumeSize: uploadedFile.size, resumeType: "application/pdf", resumeUpdatedAt: new Date() },
      });
      return current;
    });
    profileUpdated = true;
    if (profile?.resumeKey) {
      try {
        await removeResumeIfUnreferenced(profile.resumeKey);
      } catch (cleanupError) {
        console.error("Failed to remove replaced resume", cleanupError);
      }
    }
    res.status(201).json({ name: path.basename(uploadedFile.originalname), size: uploadedFile.size, type: "application/pdf" });
  } catch (error) {
    if (storedKey && !profileUpdated) {
      try {
        await resumeStorage.delete(storedKey);
      } catch (cleanupError) {
        console.error("Failed to remove unreferenced uploaded resume", cleanupError);
      }
    }
    next(error);
  }
});

app.get("/api/users/me/resume", auth, activeUser, roles(Role.STUDENT), async (req, res, next) => {
  try {
    const profile = await prisma.studentProfile.findUnique({ where: { userId: req.auth!.id } });
    if (!profile?.resumeKey) return res.status(404).json({ error: { code: "NOT_FOUND", message: "No resume is available" } });
    const content = await resumeStorage.get(profile.resumeKey);
    if (!content) return res.status(404).json({ error: { code: "NOT_FOUND", message: "No resume is available" } });
    res.setHeader("Cache-Control", "private, no-store");
    res.type("application/pdf").attachment(profile.resumeName ?? "resume.pdf").send(content);
  } catch (error) { next(error); }
});

app.delete("/api/users/me/resume", auth, activeUser, roles(Role.STUDENT), async (req, res, next) => {
  try {
    const profile = await prisma.$transaction(async (transaction) => {
      await lockResumeReferences(transaction, req.auth!.id);
      const current = await transaction.studentProfile.findUnique({ where: { userId: req.auth!.id } });
      await transaction.studentProfile.update({ where: { userId: req.auth!.id }, data: { resumeKey: null, resumeName: null, resumeSize: null, resumeType: null, resumeUpdatedAt: null } });
      return current;
    });
    if (profile?.resumeKey) await removeResumeIfUnreferenced(profile.resumeKey);
    res.status(204).send();
  } catch (error) { next(error); }
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
    const application = await prisma.$transaction(async (transaction) => {
      await lockResumeReferences(transaction, req.auth!.id);
      const profile = await transaction.studentProfile.findUnique({ where: { userId: req.auth!.id } });
      const created = await transaction.application.create({
        data: { jobId: job.id, studentId: req.auth!.id, coverLetter: parsed.data.coverLetter, resumeKey: profile?.resumeKey ?? null, resumeName: profile?.resumeName ?? null },
        select: { id: true, jobId: true, status: true, appliedAt: true },
      });
      await transaction.notification.create({ data: { userId: req.auth!.id, title: "Application submitted", message: `Your application for ${job.title} was submitted.`, type: "APPLICATION" } });
      return created;
    });
    res.status(201).json(application);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return res.status(409).json({ error: { code: "DUPLICATE_APPLICATION", message: "You have already applied for this job" } });
    next(error);
  }
});

app.get("/api/applications/me", auth, activeUser, roles(Role.STUDENT), async (req, res) => {
  const parsed = z.object({
    status: z.enum(["APPLIED", "UNDER_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFERED", "REJECTED", "WITHDRAWN"]).optional(),
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(30).default(12),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid application filters" } });
  const { status = "", q = "", page, pageSize } = parsed.data;
  const where: Prisma.ApplicationWhereInput = { studentId: req.auth!.id, ...(status ? { status: status as ApplicationStatus } : {}), ...(q ? { job: { OR: [{ title: { contains: q, mode: "insensitive" } }, { location: { contains: q, mode: "insensitive" } }] } } : {}) };
  const [items, total] = await Promise.all([prisma.application.findMany({ where, select: { id: true, jobId: true, studentId: true, coverLetter: true, status: true, appliedAt: true, updatedAt: true, job: { include: { recruiter: { select: { recruiterProfile: { select: { organisation: true } } } } } } }, orderBy: { appliedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), prisma.application.count({ where })]);
  res.json({ items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

app.patch("/api/applications/:id/withdraw", auth, activeUser, roles(Role.STUDENT), async (req, res, next) => {
  try {
    const application = await prisma.application.findUnique({ where: { id: paramId(req) } });
    if (!application || application.studentId !== req.auth!.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Application not found" } });
    if (["OFFERED", "REJECTED", "WITHDRAWN"].includes(application.status)) return res.status(409).json({ error: { code: "WITHDRAWAL_NOT_ALLOWED", message: "This application cannot be withdrawn" } });
    const updated = await prisma.application.update({ where: { id: application.id }, data: { status: ApplicationStatus.WITHDRAWN }, select: { id: true, status: true, updatedAt: true } });
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
  responsibilities: z.array(z.string().trim().min(1).max(500)).max(30),
  requirements: z.array(z.string().trim().min(1).max(500)).max(30),
  skills: z.array(z.string().trim().min(1).max(50)).max(30),
  jobType: z.enum(["FULL_TIME", "PART_TIME", "INTERNSHIP", "CONTRACT"]),
  workArrangement: z.enum(["REMOTE", "HYBRID", "ON_SITE"]),
  location: z.string().trim().min(2).max(160),
  experienceLevel: z.enum(["ENTRY", "MID", "SENIOR"]),
  salaryMin: z.coerce.number().int().min(0).optional().nullable(),
  salaryMax: z.coerce.number().int().min(0).optional().nullable(),
  deadline: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  status: z.enum(["DRAFT", "PUBLISHED", "CLOSED"]),
});

async function ownsJob(recruiterId: string, jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  return job?.recruiterId === recruiterId ? job : null;
}

app.get("/api/recruiter/dashboard", auth, activeUser, roles(Role.RECRUITER), async (req, res) => {
  const recruiterId = req.auth!.id;
  const [activeListings, totalApplications, underReview, shortlisted, recentApplications, topListings] = await Promise.all([
    prisma.job.count({ where: { recruiterId, status: JobStatus.PUBLISHED } }),
    prisma.application.count({ where: { job: { recruiterId } } }),
    prisma.application.count({ where: { job: { recruiterId }, status: ApplicationStatus.UNDER_REVIEW } }),
    prisma.application.count({ where: { job: { recruiterId }, status: ApplicationStatus.SHORTLISTED } }),
    prisma.application.findMany({
      where: { job: { recruiterId } },
      select: { id: true, jobId: true, studentId: true, status: true, appliedAt: true, job: { select: { title: true } }, student: { select: { name: true, email: true, studentProfile: { select: { university: true, degree: true, branch: true, skills: true, resumeName: true, resumeSize: true } } } } },
      orderBy: { appliedAt: "desc" },
      take: 8,
    }),
    prisma.job.findMany({
      where: { recruiterId },
      select: { id: true, title: true, status: true, _count: { select: { applications: true } } },
      orderBy: { applications: { _count: "desc" } },
      take: 10,
    }),
  ]);
  res.json({
    activeListings,
    totalApplications,
    underReview,
    shortlisted,
    recentApplications,
    listingPerformance: topListings.map(({ _count, ...job }) => ({ ...job, applications: _count.applications })),
  });
});

app.get("/api/recruiter/jobs", auth, activeUser, roles(Role.RECRUITER), async (req, res) => {
  const parsed = z.object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(30).default(12),
    status: z.enum(["DRAFT", "PUBLISHED", "CLOSED"]).optional(),
    q: z.string().trim().max(120).optional(),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid listing filters" } });
  const { page, pageSize, status = "", q = "" } = parsed.data;
  const where: Prisma.JobWhereInput = { recruiterId: req.auth!.id, ...(status ? { status: status as JobStatus } : {}), ...(q ? { title: { contains: q, mode: "insensitive" } } : {}) };
  const [items, total] = await Promise.all([prisma.job.findMany({ where, include: { _count: { select: { applications: true } } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), prisma.job.count({ where })]);
  res.json({ items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

app.post("/api/jobs", auth, activeUser, roles(Role.RECRUITER), validate(jobSchema), async (req, res, next) => {
  try {
    const { organisation, deadline, ...data } = req.body;
    if (organisation) await prisma.recruiterProfile.upsert({ where: { userId: req.auth!.id }, create: { userId: req.auth!.id, organisation }, update: { organisation } });
    const job = await prisma.job.create({
      data: {
        ...data,
        responsibilities: data.responsibilities ?? [],
        requirements: data.requirements ?? [],
        skills: data.skills ?? [],
        status: data.status ?? JobStatus.DRAFT,
        recruiterId: req.auth!.id,
        deadline: new Date(deadline),
      },
    });
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
  if (job.status !== JobStatus.DRAFT) return res.status(409).json({ error: { code: "DRAFT_ONLY", message: "Only draft listings can be deleted" } });
  await prisma.job.delete({ where: { id: job.id } });
  res.status(204).send();
});

const applicantProfileSelect = {
  phone: true, location: true, university: true, degree: true, branch: true, graduationYear: true,
  bio: true, skills: true, linkedinUrl: true, githubUrl: true, portfolioUrl: true,
  resumeName: true, resumeSize: true, resumeUpdatedAt: true,
} satisfies Prisma.StudentProfileSelect;
const recruiterApplicantSelect = {
  id: true, jobId: true, studentId: true, coverLetter: true, status: true, appliedAt: true, updatedAt: true,
  student: {
    select: {
      id: true, name: true, email: true,
      studentProfile: { select: applicantProfileSelect },
    },
  },
} satisfies Prisma.ApplicationSelect;

app.get("/api/recruiter/jobs/:id/applications", auth, activeUser, roles(Role.RECRUITER), async (req, res) => {
  const job = await ownsJob(req.auth!.id, paramId(req));
  if (!job) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Listing not found or not owned by you" } });
  const parsed = z.object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(30).default(12),
    status: z.enum(["APPLIED", "UNDER_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFERED", "REJECTED", "WITHDRAWN"]).optional(),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid applicant filters" } });
  const { page, pageSize, status } = parsed.data;
  const where: Prisma.ApplicationWhereInput = { jobId: job.id, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    prisma.application.findMany({ where, select: recruiterApplicantSelect, orderBy: { appliedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.application.count({ where }),
  ]);
  res.json({ items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

app.get("/api/recruiter/applicants", auth, activeUser, roles(Role.RECRUITER), async (req, res) => {
  const parsed = z.object({
    status: z.enum(["APPLIED", "UNDER_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFERED", "REJECTED", "WITHDRAWN"]).optional(),
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(30).default(12),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid applicant filters" } });
  const { status = "", q = "", page, pageSize } = parsed.data;
  const where: Prisma.ApplicationWhereInput = {
    job: { recruiterId: req.auth!.id },
    ...(status ? { status: status as ApplicationStatus } : {}),
    ...(q ? { OR: [{ student: { name: { contains: q, mode: "insensitive" } } }, { job: { title: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const [items, total] = await Promise.all([prisma.application.findMany({
    where,
    select: { ...recruiterApplicantSelect, job: { select: { id: true, title: true } } },
    orderBy: { appliedAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  }), prisma.application.count({ where })]);
  res.json({ items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

app.get("/api/recruiter/applications/:id/resume", auth, activeUser, roles(Role.RECRUITER), async (req, res, next) => {
  try {
    const application = await prisma.application.findUnique({
      where: { id: paramId(req) },
      include: { job: { select: { recruiterId: true } } },
    });
    if (!application || application.job.recruiterId !== req.auth!.id) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Application not found or not owned by you" } });
    }
    if (!application.resumeKey) return res.status(404).json({ error: { code: "NOT_FOUND", message: "No resume was attached to this application" } });
    const content = await resumeStorage.get(application.resumeKey);
    if (!content) return res.status(404).json({ error: { code: "NOT_FOUND", message: "The attached resume is no longer available" } });
    res.setHeader("Cache-Control", "private, no-store");
    res.type("application/pdf").attachment(application.resumeName ?? "resume.pdf").send(content);
  } catch (error) { next(error); }
});

app.patch("/api/applications/:id/status", auth, activeUser, roles(Role.RECRUITER), async (req, res, next) => {
  try {
    const parsed = z.object({ status: z.enum(["UNDER_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFERED", "REJECTED"]) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid status" } });
    const application = await prisma.application.findUnique({ where: { id: paramId(req) }, include: { job: true } });
    if (!application || application.job.recruiterId !== req.auth!.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Application not found or not owned by you" } });
    const transitions: Record<ApplicationStatus, ApplicationStatus[]> = {
      APPLIED: [ApplicationStatus.UNDER_REVIEW, ApplicationStatus.REJECTED],
      UNDER_REVIEW: [ApplicationStatus.SHORTLISTED, ApplicationStatus.INTERVIEW, ApplicationStatus.REJECTED],
      SHORTLISTED: [ApplicationStatus.INTERVIEW, ApplicationStatus.OFFERED, ApplicationStatus.REJECTED],
      INTERVIEW: [ApplicationStatus.OFFERED, ApplicationStatus.REJECTED],
      OFFERED: [],
      REJECTED: [],
      WITHDRAWN: [],
    };
    if (!transitions[application.status].includes(parsed.data.status)) {
      return res.status(409).json({ error: { code: "INVALID_STATUS_TRANSITION", message: `Cannot move an application from ${application.status} to ${parsed.data.status}` } });
    }
    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.application.update({ where: { id: application.id }, data: { status: parsed.data.status }, select: { id: true, status: true, updatedAt: true } });
      await transaction.notification.create({ data: { userId: application.studentId, title: "Application status updated", message: `Your ${application.job.title} application is now ${parsed.data.status.replace("_", " ").toLowerCase()}.`, type: "APPLICATION" } });
      return result;
    });
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
  const parsed = z.object({
    role: z.enum(["STUDENT", "RECRUITER", "ADMIN"]).optional(),
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid user filters" } });
  const { role = "", q = "", page, pageSize } = parsed.data;
  const where: Prisma.UserWhereInput = { ...(role ? { role: role as Role } : {}), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}) };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, select: { id: true, name: true, email: true, role: true, accountStatus: true, createdAt: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.user.count({ where }),
  ]);
  res.json({ items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

app.patch("/api/admin/users/:id/status", auth, activeUser, roles(Role.ADMIN), async (req, res, next) => {
  try {
    const parsed = z.object({ accountStatus: z.enum(["ACTIVE", "SUSPENDED"]) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid account status" } });
    const target = await prisma.user.findUnique({ where: { id: paramId(req) } });
    if (!target) return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
    if (target.role === Role.ADMIN) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Administrator accounts cannot be changed through this endpoint" } });
    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.user.update({ where: { id: target.id }, data: { accountStatus: parsed.data.accountStatus }, select: { id: true, accountStatus: true } });
      await transaction.auditLog.create({ data: { actorId: req.auth!.id, action: parsed.data.accountStatus === "SUSPENDED" ? "SUSPEND_USER" : "REACTIVATE_USER", entityType: "USER", entityId: target.id, metadata: { accountStatus: parsed.data.accountStatus } } });
      return result;
    });
    res.json(updated);
  } catch (error) { next(error); }
});

app.get("/api/admin/jobs", auth, activeUser, roles(Role.ADMIN), async (req, res) => {
  const parsed = z.object({
    status: z.enum(["DRAFT", "PUBLISHED", "CLOSED"]).optional(),
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid listing filters" } });
  const { status = "", q = "", page, pageSize } = parsed.data;
  const where: Prisma.JobWhereInput = { ...(status ? { status: status as JobStatus } : {}), ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { location: { contains: q, mode: "insensitive" } }] } : {}) };
  const [items, total] = await Promise.all([
    prisma.job.findMany({ where, include: { recruiter: { select: { name: true, recruiterProfile: { select: { organisation: true } } } }, _count: { select: { applications: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.job.count({ where }),
  ]);
  res.json({ items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

app.patch("/api/admin/jobs/:id/moderation", auth, activeUser, roles(Role.ADMIN), async (req, res, next) => {
  try {
    const parsed = z.object({ status: z.enum(["PUBLISHED", "CLOSED"]), reason: z.string().max(1000).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid moderation action" } });
    const job = await prisma.job.findUnique({ where: { id: paramId(req) } });
    if (!job) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Listing not found" } });
    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.job.update({ where: { id: job.id }, data: { status: parsed.data.status } });
      await transaction.auditLog.create({ data: { actorId: req.auth!.id, action: parsed.data.status === "CLOSED" ? "CLOSE_LISTING" : "PUBLISH_LISTING", entityType: "JOB", entityId: job.id, metadata: { reason: parsed.data.reason ?? null, previousStatus: job.status } } });
      return result;
    });
    res.json(updated);
  } catch (error) { next(error); }
});

app.get("/api/notifications", auth, activeUser, async (req, res) => {
  const parsed = z.object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(30).default(10),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid notification pagination" } });
  const { page, pageSize } = parsed.data;
  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where: { userId: req.auth!.id }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.notification.count({ where: { userId: req.auth!.id } }),
    prisma.notification.count({ where: { userId: req.auth!.id, readAt: null } }),
  ]);
  res.json({ items, unreadCount, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

app.patch("/api/notifications/:id/read", auth, activeUser, async (req, res) => {
  const notification = await prisma.notification.findUnique({ where: { id: paramId(req) } });
  if (!notification || notification.userId !== req.auth!.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Notification not found" } });
  const updated = await prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
  res.json(updated);
});

app.get("/api/admin/audit-logs", auth, activeUser, roles(Role.ADMIN), async (req, res) => {
  const parsed = z.object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid audit-log pagination" } });
  const { page, pageSize } = parsed.data;
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      select: { id: true, action: true, entityType: true, entityId: true, metadata: true, createdAt: true, actor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count(),
  ]);
  res.json({ items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

// Express identifies error middleware by its four-argument signature.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: { code: "INVALID_FILE", message: error.code === "LIMIT_FILE_SIZE" ? "Resume must be 5 MB or smaller" : error.message } });
  if (error instanceof Error && error.message.includes("PDF")) return res.status(400).json({ error: { code: "INVALID_FILE", message: "Only PDF resumes are allowed" } });
  console.error(error);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
});

export { app, prisma };

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT) || 4000;
  const start = async () => {
    await connectRateLimitStore();
    const server = app.listen(port, () => console.log(`SkillBridge API listening on port ${port}`));
    const shutdown = () => {
      server.close(() => {
        void Promise.all([prisma.$disconnect(), disconnectRateLimitStore()]);
      });
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  };
  void start().catch((error: unknown) => {
    console.error("API startup failed", error);
    process.exitCode = 1;
  });
}
