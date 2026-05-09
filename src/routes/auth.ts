import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../lib/jwt";
import { logAudit } from "../lib/audit";
import { authenticate } from "../middleware/auth";
import { env } from "../config/env";

const router = Router();

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(20).optional(),
  organization: z.string().max(200).optional(),
  country: z.string().max(100).optional(),
  role: z.enum(["STUDENT", "INSTRUCTOR"]),
  // Instructor-only fields
  bio: z.string().max(2000).optional(),
  expertise: z.string().max(500).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_DURATION_MINUTES = 30;
const BCRYPT_SALT_ROUNDS = 12;
const REFRESH_TOKEN_DAYS = 7;

// ─── POST /api/auth/register ────────────────────────────────
router.post("/register", async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const data = parsed.data;
    const email = data.email.toLowerCase();

    // Check duplicate
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }

    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);

    // Students are active immediately. Instructors need admin approval.
    const status = data.role === "STUDENT" ? "ACTIVE" : "PENDING";

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        organization: data.organization,
        country: data.country,
        role: data.role,
        status,
        bio: data.bio,
        jobTitle: data.expertise,
      },
    });

    await logAudit("ACCOUNT_CREATED", req, user.id, "Self-registration as " + data.role);

    // If instructor, don't log them in — they need approval
    if (data.role === "INSTRUCTOR") {
      res.status(201).json({
        message: "Your instructor application has been submitted. You will be notified once your account is approved.",
        status: "PENDING",
      });
      return;
    }

    // Student — log them in immediately
    const tokenPayload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    const hashedRefreshToken = crypto.createHash("sha256").update(refreshToken).digest("hex");
    await prisma.refreshToken.create({
      data: {
        token: hashedRefreshToken,
        userId: user.id,
        userAgent: req.headers["user-agent"],
        ipAddress: req.ip || req.socket.remoteAddress,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
      path: "/api/auth",
    });

    await logAudit("LOGIN_SUCCESS", req, user.id);

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        initials: (user.firstName[0] + user.lastName[0]).toUpperCase(),
        organization: user.organization,
        country: user.country,
      },
      accessToken,
      status: "ACTIVE",
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "An error occurred. Please try again." });
  }
});

// ─── POST /api/auth/login ───────────────────────────────────
router.post("/login", async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid email or password format" });
      return;
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      await bcrypt.hash("dummy", BCRYPT_SALT_ROUNDS);
      await logAudit("LOGIN_FAILED", req, undefined, "Unknown email: " + email);
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    if (user.status === "SUSPENDED") {
      await logAudit("LOGIN_FAILED", req, user.id, "Account suspended");
      res.status(403).json({ error: "Your account has been suspended. Contact your administrator." });
      return;
    }

    if (user.status === "PENDING") {
      await logAudit("LOGIN_FAILED", req, user.id, "Account pending");
      res.status(403).json({ error: "Your account is pending approval. You will be notified once approved." });
      return;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      await logAudit("LOGIN_LOCKED", req, user.id);
      res.status(423).json({ error: "Account temporarily locked. Try again in " + minutesLeft + " minutes." });
      return;
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      const newFailedAttempts = user.failedAttempts + 1;
      const updateData: Record<string, unknown> = { failedAttempts: newFailedAttempts };
      if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        updateData.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
        await logAudit("LOGIN_LOCKED", req, user.id, "Locked after " + newFailedAttempts + " failed attempts");
      }
      await prisma.user.update({ where: { id: user.id }, data: updateData });
      await logAudit("LOGIN_FAILED", req, user.id, "Attempt " + newFailedAttempts);
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: req.ip || req.socket.remoteAddress },
    });

    const tokenPayload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    const hashedRefreshToken = crypto.createHash("sha256").update(refreshToken).digest("hex");
    await prisma.refreshToken.create({
      data: { token: hashedRefreshToken, userId: user.id, userAgent: req.headers["user-agent"], ipAddress: req.ip || req.socket.remoteAddress, expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000) },
    });

    res.cookie("refreshToken", refreshToken, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "strict", maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000, path: "/api/auth" });
    await logAudit("LOGIN_SUCCESS", req, user.id);

    res.json({
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, initials: (user.firstName[0] + user.lastName[0]).toUpperCase(), organization: user.organization, jobTitle: user.jobTitle, country: user.country },
      accessToken,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "An error occurred. Please try again." });
  }
});

// ─── POST /api/auth/refresh ─────────────────────────────────
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) { res.status(401).json({ error: "No refresh token" }); return; }

    let payload;
    try { payload = verifyRefreshToken(token); } catch { res.status(401).json({ error: "Invalid refresh token" }); return; }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const storedToken = await prisma.refreshToken.findUnique({ where: { token: hashedToken } });
    if (!storedToken) {
      await prisma.refreshToken.deleteMany({ where: { userId: payload.userId } });
      await logAudit("LOGIN_FAILED", req, payload.userId, "Refresh token reuse detected");
      res.status(401).json({ error: "Session expired. Please log in again." }); return;
    }

    await prisma.refreshToken.delete({ where: { id: storedToken.id } });
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || user.status !== "ACTIVE") { res.status(401).json({ error: "Account no longer active" }); return; }

    const newPayload = { userId: user.id, email: user.email, role: user.role };
    const newAccessToken = generateAccessToken(newPayload);
    const newRefreshToken = generateRefreshToken(newPayload);
    const newHashedToken = crypto.createHash("sha256").update(newRefreshToken).digest("hex");
    await prisma.refreshToken.create({ data: { token: newHashedToken, userId: user.id, userAgent: req.headers["user-agent"], ipAddress: req.ip || req.socket.remoteAddress, expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000) } });
    res.cookie("refreshToken", newRefreshToken, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "strict", maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000, path: "/api/auth" });
    await logAudit("TOKEN_REFRESH", req, user.id);
    res.json({ accessToken: newAccessToken });
  } catch (err) { console.error("Refresh error:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/auth/logout ──────────────────────────────────
router.post("/logout", authenticate, async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.refreshToken;
    if (token) { const h = crypto.createHash("sha256").update(token).digest("hex"); await prisma.refreshToken.deleteMany({ where: { token: h } }); }
    res.clearCookie("refreshToken", { path: "/api/auth" });
    await logAudit("LOGOUT", req, req.user?.userId);
    res.json({ message: "Logged out" });
  } catch (err) { console.error("Logout error:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/auth/logout-all ──────────────────────────────
router.post("/logout-all", authenticate, async (req: Request, res: Response) => {
  try {
    await prisma.refreshToken.deleteMany({ where: { userId: req.user!.userId } });
    res.clearCookie("refreshToken", { path: "/api/auth" });
    await logAudit("LOGOUT", req, req.user?.userId, "All sessions revoked");
    res.json({ message: "All sessions ended" });
  } catch (err) { console.error("Logout-all error:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/auth/change-password ─────────────────────────
router.post("/change-password", authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
    const { currentPassword, newPassword } = parsed.data;
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) { res.status(401).json({ error: "Current password is incorrect" }); return; }
    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword } });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    res.clearCookie("refreshToken", { path: "/api/auth" });
    await logAudit("PASSWORD_CHANGE", req, user.id);
    res.json({ message: "Password updated. Please log in again." });
  } catch (err) { console.error("Change password error:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/auth/me ───────────────────────────────────────
router.get("/me", authenticate, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, phone: true, organization: true, jobTitle: true, country: true, bio: true, status: true, lastLoginAt: true, createdAt: true },
    });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json({ ...user, initials: (user.firstName[0] + user.lastName[0]).toUpperCase() });
  } catch (err) { console.error("Me error:", err); res.status(500).json({ error: "An error occurred" }); }
});

export default router;