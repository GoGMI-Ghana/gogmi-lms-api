import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../lib/jwt";
import { logAudit } from "../lib/audit";
import { authenticate } from "../middleware/auth";
import { env } from "../config/env";
import { sendEmail, passwordResetEmail } from "../lib/email";

const router = Router();

const loginSchema = z.object({ email: z.string().email().max(255), password: z.string().min(1).max(128) });
const registerSchema = z.object({
  email: z.string().email().max(255), password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100), lastName: z.string().min(1).max(100),
  phone: z.string().max(20).optional(), organization: z.string().max(200).optional(),
  country: z.string().max(100).optional(), role: z.enum(["STUDENT", "INSTRUCTOR"]),
  bio: z.string().max(2000).optional(), expertise: z.string().max(500).optional(),
});
const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) });
const forgotPasswordSchema = z.object({ email: z.string().email().max(255) });
const resetPasswordSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(8).max(128) });

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_DURATION_MINUTES = 30;
const BCRYPT_SALT_ROUNDS = 12;
const REFRESH_TOKEN_DAYS = 7;

// ─── POST /api/auth/register ────────────────────────────────
router.post("/register", async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
    const data = parsed.data;
    const email = data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) { res.status(409).json({ error: "An account with this email already exists." }); return; }
    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);
    const status = data.role === "STUDENT" ? "ACTIVE" : "PENDING";
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, firstName: data.firstName, lastName: data.lastName, phone: data.phone, organization: data.organization, country: data.country, role: data.role, status, bio: data.bio, jobTitle: data.expertise },
    });
    await logAudit("ACCOUNT_CREATED", req, user.id, "Self-registration as " + data.role);
    if (data.role === "INSTRUCTOR") { res.status(201).json({ message: "Your instructor application has been submitted.", status: "PENDING" }); return; }
    const tokenPayload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);
    const hashedRefreshToken = crypto.createHash("sha256").update(refreshToken).digest("hex");
    await prisma.refreshToken.create({ data: { token: hashedRefreshToken, userId: user.id, userAgent: req.headers["user-agent"], ipAddress: req.ip || req.socket.remoteAddress, expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000) } });
    res.cookie("refreshToken", refreshToken, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "strict", maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000, path: "/api/auth" });
    await logAudit("LOGIN_SUCCESS", req, user.id);
    res.status(201).json({
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, initials: (user.firstName[0] + user.lastName[0]).toUpperCase(), organization: user.organization, country: user.country },
      accessToken, status: "ACTIVE",
    });
  } catch (err) { console.error("Register error:", err); res.status(500).json({ error: "An error occurred." }); }
});

// ─── POST /api/auth/login ───────────────────────────────────
router.post("/login", async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid email or password format" }); return; }
    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) { await bcrypt.hash("dummy", BCRYPT_SALT_ROUNDS); await logAudit("LOGIN_FAILED", req, undefined, "Unknown email: " + email); res.status(401).json({ error: "Invalid email or password" }); return; }
    if (user.status === "SUSPENDED") { await logAudit("LOGIN_FAILED", req, user.id, "Suspended"); res.status(403).json({ error: "Your account has been suspended. Contact your administrator." }); return; }
    if (user.status === "PENDING") { await logAudit("LOGIN_FAILED", req, user.id, "Pending"); res.status(403).json({ error: "Your account is pending approval." }); return; }
    if (user.lockedUntil && user.lockedUntil > new Date()) { const m = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000); await logAudit("LOGIN_LOCKED", req, user.id); res.status(423).json({ error: "Account locked. Try again in " + m + " minutes." }); return; }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      const n = user.failedAttempts + 1;
      const d: Record<string, unknown> = { failedAttempts: n };
      if (n >= MAX_FAILED_ATTEMPTS) { d.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000); await logAudit("LOGIN_LOCKED", req, user.id, "Locked after " + n); }
      await prisma.user.update({ where: { id: user.id }, data: d });
      await logAudit("LOGIN_FAILED", req, user.id, "Attempt " + n);
      res.status(401).json({ error: "Invalid email or password" }); return;
    }
    await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: req.ip || req.socket.remoteAddress } });
    const tokenPayload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);
    const hashed = crypto.createHash("sha256").update(refreshToken).digest("hex");
    await prisma.refreshToken.create({ data: { token: hashed, userId: user.id, userAgent: req.headers["user-agent"], ipAddress: req.ip || req.socket.remoteAddress, expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000) } });
    res.cookie("refreshToken", refreshToken, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "strict", maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000, path: "/api/auth" });
    await logAudit("LOGIN_SUCCESS", req, user.id);
    res.json({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, initials: (user.firstName[0] + user.lastName[0]).toUpperCase(), organization: user.organization, jobTitle: user.jobTitle, country: user.country }, accessToken });
  } catch (err) { console.error("Login error:", err); res.status(500).json({ error: "An error occurred." }); }
});

// ─── POST /api/auth/forgot-password ─────────────────────────
router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Please enter a valid email address." }); return; }

    // Always return success — don't reveal if email exists
    const successMsg = "If an account with that email exists, a password reset link has been sent.";

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user) { res.json({ message: successMsg }); return; }

    // Generate a reset token — JWT signed with secret + user's password hash
    // This means the token is automatically invalidated if password changes
    const resetSecret = env.REFRESH_TOKEN_SECRET + user.password;
    const resetToken = jwt.sign({ userId: user.id, purpose: "password-reset" }, resetSecret, { expiresIn: "1h" });

    const resetUrl = env.CLIENT_URL + "/reset-password?token=" + encodeURIComponent(resetToken) + "&id=" + user.id;

    // Send email
    if (env.MS_CLIENT_ID && env.MS_SENDER_EMAIL) {
      await sendEmail({
        to: user.email,
        subject: "Reset Your GoGMI Password",
        html: passwordResetEmail(user.firstName, resetUrl),
      });
      await logAudit("PASSWORD_CHANGE", req, user.id, "Password reset email sent");
    } else {
      // Dev mode — log the reset link
      console.log("\n📧 Password reset link for " + user.email + ":");
      console.log(resetUrl + "\n");
    }

    res.json({ message: successMsg });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.json({ message: "If an account with that email exists, a password reset link has been sent." });
  }
});

// ─── POST /api/auth/reset-password ──────────────────────────
router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const { token, newPassword } = parsed.data;

    // Decode token to get userId without verification first
    const decoded = jwt.decode(token) as { userId?: string; purpose?: string } | null;
    if (!decoded || !decoded.userId || decoded.purpose !== "password-reset") {
      res.status(400).json({ error: "Invalid or expired reset link." }); return;
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) { res.status(400).json({ error: "Invalid or expired reset link." }); return; }

    // Verify token with secret + current password hash
    // If password already changed, this will fail (token invalidated)
    try {
      jwt.verify(token, env.REFRESH_TOKEN_SECRET + user.password);
    } catch {
      res.status(400).json({ error: "This reset link has expired or already been used." }); return;
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword, failedAttempts: 0, lockedUntil: null } });

    // Revoke all sessions
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    await logAudit("PASSWORD_CHANGE", req, user.id, "Password reset via email link");

    res.json({ message: "Password has been reset. You can now sign in with your new password." });
  } catch (err) { console.error("Reset password error:", err); res.status(500).json({ error: "An error occurred." }); }
});

// ─── POST /api/auth/refresh ─────────────────────────────────
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) { res.status(401).json({ error: "No refresh token" }); return; }
    let payload;
    try { payload = verifyRefreshToken(token); } catch { res.status(401).json({ error: "Invalid refresh token" }); return; }
    const h = crypto.createHash("sha256").update(token).digest("hex");
    const stored = await prisma.refreshToken.findUnique({ where: { token: h } });
    if (!stored) { await prisma.refreshToken.deleteMany({ where: { userId: payload.userId } }); await logAudit("LOGIN_FAILED", req, payload.userId, "Refresh token reuse"); res.status(401).json({ error: "Session expired." }); return; }
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || user.status !== "ACTIVE") { res.status(401).json({ error: "Account no longer active" }); return; }
    const np = { userId: user.id, email: user.email, role: user.role };
    const nat = generateAccessToken(np);
    const nrt = generateRefreshToken(np);
    const nh = crypto.createHash("sha256").update(nrt).digest("hex");
    await prisma.refreshToken.create({ data: { token: nh, userId: user.id, userAgent: req.headers["user-agent"], ipAddress: req.ip || req.socket.remoteAddress, expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000) } });
    res.cookie("refreshToken", nrt, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "strict", maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000, path: "/api/auth" });
    await logAudit("TOKEN_REFRESH", req, user.id);
    res.json({ accessToken: nat });
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
    const hp = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { password: hp } });
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