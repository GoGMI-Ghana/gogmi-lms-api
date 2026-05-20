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
import { generateOtp, verifyOtp, otpEmailHtml } from "../lib/otp";

const router = Router();

const loginSchema = z.object({ email: z.string().email().max(255), password: z.string().min(1).max(128) });
const loginVerifySchema = z.object({ verificationKey: z.string().min(1), otp: z.string().length(6) });
const registerInitSchema = z.object({
  email: z.string().email().max(255), password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100), lastName: z.string().min(1).max(100),
  phone: z.string().max(20).optional(), organization: z.string().max(200).optional(),
  country: z.string().max(100).optional(), role: z.enum(["STUDENT", "INSTRUCTOR"]),
  bio: z.string().max(2000).optional(), expertise: z.string().max(500).optional(),
});
const registerVerifySchema = z.object({ verificationKey: z.string().min(1), otp: z.string().length(6) });
const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) });
const forgotPasswordSchema = z.object({ email: z.string().email().max(255) });
const resetPasswordSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(8).max(128) });

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_DURATION_MINUTES = 30;
const BCRYPT_SALT_ROUNDS = 12;
const REFRESH_TOKEN_DAYS = 7;

// In-memory store for pending registrations (OTP verified → create account)
const pendingRegistrations = new Map<string, { data: z.infer<typeof registerInitSchema>; hashedPassword: string; expiresAt: number }>();
setInterval(() => { const now = Date.now(); for (const [k, v] of pendingRegistrations) { if (v.expiresAt < now) pendingRegistrations.delete(k); } }, 5 * 60 * 1000);

// In-memory store for login OTP context
const pendingLogins = new Map<string, { userId: string; expiresAt: number }>();
setInterval(() => { const now = Date.now(); for (const [k, v] of pendingLogins) { if (v.expiresAt < now) pendingLogins.delete(k); } }, 5 * 60 * 1000);

// ─── Helper: issue tokens and set cookie ────────────────────
async function issueTokens(user: { id: string; email: string; role: string }, req: Request, res: Response) {
  const tokenPayload = { userId: user.id, email: user.email, role: user.role as "STUDENT" | "INSTRUCTOR" | "ADMIN" };
  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);
  const hashed = crypto.createHash("sha256").update(refreshToken).digest("hex");
  await prisma.refreshToken.create({ data: { token: hashed, userId: user.id, userAgent: req.headers["user-agent"], ipAddress: req.ip || req.socket.remoteAddress, expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000) } });
  res.cookie("refreshToken", refreshToken, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "strict", maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000, path: "/api/auth" });
  return accessToken;
}

// ═══════════════════════════════════════════════════════════
// REGISTER — Step 1: Validate + send OTP
// ═══════════════════════════════════════════════════════════
router.post("/register", async (req: Request, res: Response) => {
  try {
    const parsed = registerInitSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
    const data = parsed.data;
    const email = data.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) { res.status(409).json({ error: "An account with this email already exists." }); return; }

    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);

    // Generate OTP
    const otp = generateOtp({ email, userId: "pending", courseId: "register", certificateId: "", registrantName: data.firstName, registrantEmail: email });

    // Store pending registration
    pendingRegistrations.set(otp.verificationKey, { data: { ...data, email }, hashedPassword, expiresAt: Date.now() + 10 * 60 * 1000 });

    // Send OTP
    if (env.MS_CLIENT_ID && env.MS_SENDER_EMAIL) {
      await sendEmail({ to: email, subject: "GoGMI — Verify Your Email", html: otpEmailHtml(data.firstName, otp.code) });
    } else {
      console.log("\n📧 Registration OTP for " + email + ": " + otp.code + "\n");
    }

    const emailParts = email.split("@");
    const maskedEmail = emailParts[0].substring(0, 3) + "***@" + emailParts[1];

    res.json({ message: "Verification code sent to " + maskedEmail, verificationKey: otp.verificationKey, maskedEmail });
  } catch (err) { console.error("Register error:", err); res.status(500).json({ error: "An error occurred." }); }
});

// ═══════════════════════════════════════════════════════════
// REGISTER — Step 2: Verify OTP + create account
// ═══════════════════════════════════════════════════════════
router.post("/register/verify", async (req: Request, res: Response) => {
  try {
    const parsed = registerVerifySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const { verificationKey, otp } = parsed.data;

    const otpResult = verifyOtp(verificationKey, otp);
    if (!otpResult) { res.status(403).json({ error: "Invalid or expired verification code." }); return; }

    const pending = pendingRegistrations.get(verificationKey);
    if (!pending) { res.status(403).json({ error: "Registration session expired. Please try again." }); return; }
    pendingRegistrations.delete(verificationKey);

    const data = pending.data;
    const status = data.role === "STUDENT" ? "ACTIVE" : "PENDING";

    // Double-check email not taken (race condition)
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) { res.status(409).json({ error: "An account with this email already exists." }); return; }

    const user = await prisma.user.create({
      data: { email: data.email, password: pending.hashedPassword, firstName: data.firstName, lastName: data.lastName, phone: data.phone, organization: data.organization, country: data.country, role: data.role, status, bio: data.bio, jobTitle: data.expertise },
    });

    await logAudit("ACCOUNT_CREATED", req, user.id, "Self-registration as " + data.role);

    if (data.role === "INSTRUCTOR") {
      res.status(201).json({ message: "Your instructor application has been submitted.", status: "PENDING" });
      return;
    }

    const accessToken = await issueTokens(user, req, res);
    await logAudit("LOGIN_SUCCESS", req, user.id);

    res.status(201).json({
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, initials: (user.firstName[0] + user.lastName[0]).toUpperCase(), organization: user.organization, country: user.country },
      accessToken, status: "ACTIVE",
    });
  } catch (err) { console.error("Register verify error:", err); res.status(500).json({ error: "An error occurred." }); }
});

// ═══════════════════════════════════════════════════════════
// LOGIN — Step 1: Verify credentials + send OTP
// ═══════════════════════════════════════════════════════════
router.post("/login", async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid email or password format" }); return; }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) { await bcrypt.hash("dummy", BCRYPT_SALT_ROUNDS); await logAudit("LOGIN_FAILED", req, undefined, "Unknown email: " + email); res.status(401).json({ error: "Invalid email or password" }); return; }
    if (user.status === "SUSPENDED") { res.status(403).json({ error: "Your account has been suspended. Contact your administrator." }); return; }
    if (user.status === "PENDING") { res.status(403).json({ error: "Your account is pending approval." }); return; }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const m = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      res.status(423).json({ error: "Account locked. Try again in " + m + " minutes." }); return;
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      const n = user.failedAttempts + 1;
      const d: Record<string, unknown> = { failedAttempts: n };
      if (n >= MAX_FAILED_ATTEMPTS) { d.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000); }
      await prisma.user.update({ where: { id: user.id }, data: d });
      await logAudit("LOGIN_FAILED", req, user.id, "Attempt " + n);
      res.status(401).json({ error: "Invalid email or password" }); return;
    }

    // Credentials valid — send OTP
    const otp = generateOtp({ email: user.email, userId: user.id, courseId: "login", certificateId: "", registrantName: user.firstName, registrantEmail: user.email });

    pendingLogins.set(otp.verificationKey, { userId: user.id, expiresAt: Date.now() + 10 * 60 * 1000 });

    if (env.MS_CLIENT_ID && env.MS_SENDER_EMAIL) {
      await sendEmail({ to: user.email, subject: "GoGMI — Login Verification Code", html: otpEmailHtml(user.firstName, otp.code) });
    } else {
      console.log("\n📧 Login OTP for " + user.email + ": " + otp.code + "\n");
    }

    const emailParts = user.email.split("@");
    const maskedEmail = emailParts[0].substring(0, 3) + "***@" + emailParts[1];

    res.json({ step: "otp", message: "Verification code sent to " + maskedEmail, verificationKey: otp.verificationKey, maskedEmail });
  } catch (err) { console.error("Login error:", err); res.status(500).json({ error: "An error occurred." }); }
});

// ═══════════════════════════════════════════════════════════
// LOGIN — Step 2: Verify OTP + issue tokens
// ═══════════════════════════════════════════════════════════
router.post("/login/verify", async (req: Request, res: Response) => {
  try {
    const parsed = loginVerifySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const { verificationKey, otp } = parsed.data;

    const otpResult = verifyOtp(verificationKey, otp);
    if (!otpResult) { res.status(403).json({ error: "Invalid or expired verification code." }); return; }

    const loginCtx = pendingLogins.get(verificationKey);
    if (!loginCtx) { res.status(403).json({ error: "Login session expired. Please try again." }); return; }
    pendingLogins.delete(verificationKey);

    const user = await prisma.user.findUnique({ where: { id: loginCtx.userId } });
    if (!user || user.status !== "ACTIVE") { res.status(403).json({ error: "Account no longer active." }); return; }

    await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: req.ip || req.socket.remoteAddress } });

    const accessToken = await issueTokens(user, req, res);
    await logAudit("LOGIN_SUCCESS", req, user.id);

    res.json({
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, initials: (user.firstName[0] + user.lastName[0]).toUpperCase(), organization: user.organization, jobTitle: user.jobTitle, country: user.country },
      accessToken,
    });
  } catch (err) { console.error("Login verify error:", err); res.status(500).json({ error: "An error occurred." }); }
});

// ─── POST /api/auth/forgot-password ─────────────────────────
router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Please enter a valid email." }); return; }
    const successMsg = "If an account with that email exists, a password reset link has been sent.";
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user) { res.json({ message: successMsg }); return; }
    const resetSecret = env.REFRESH_TOKEN_SECRET + user.password;
    const resetToken = jwt.sign({ userId: user.id, purpose: "password-reset" }, resetSecret, { expiresIn: "1h" });
    const resetUrl = env.CLIENT_URL + "/reset-password?token=" + encodeURIComponent(resetToken) + "&id=" + user.id;
    if (env.MS_CLIENT_ID && env.MS_SENDER_EMAIL) {
      await sendEmail({ to: user.email, subject: "Reset Your GoGMI Password", html: passwordResetEmail(user.firstName, resetUrl) });
    } else { console.log("\n📧 Reset link for " + user.email + ":\n" + resetUrl + "\n"); }
    res.json({ message: successMsg });
  } catch (err) { console.error("Forgot password:", err); res.json({ message: "If an account with that email exists, a password reset link has been sent." }); }
});

// ─── POST /api/auth/reset-password ──────────────────────────
router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
    const { token, newPassword } = parsed.data;
    const decoded = jwt.decode(token) as { userId?: string; purpose?: string } | null;
    if (!decoded || !decoded.userId || decoded.purpose !== "password-reset") { res.status(400).json({ error: "Invalid or expired reset link." }); return; }
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) { res.status(400).json({ error: "Invalid or expired reset link." }); return; }
    try { jwt.verify(token, env.REFRESH_TOKEN_SECRET + user.password); } catch { res.status(400).json({ error: "This reset link has expired or been used." }); return; }
    const hp = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { password: hp, failedAttempts: 0, lockedUntil: null } });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    await logAudit("PASSWORD_CHANGE", req, user.id, "Reset via email");
    res.json({ message: "Password has been reset. You can now sign in." });
  } catch (err) { console.error("Reset password:", err); res.status(500).json({ error: "An error occurred." }); }
});

// ─── Refresh / Logout / Change Password / Me ────────────────
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) { res.status(401).json({ error: "No refresh token" }); return; }
    let payload;
    try { payload = verifyRefreshToken(token); } catch { res.status(401).json({ error: "Invalid refresh token" }); return; }
    const h = crypto.createHash("sha256").update(token).digest("hex");
    const stored = await prisma.refreshToken.findUnique({ where: { token: h } });
    if (!stored) { await prisma.refreshToken.deleteMany({ where: { userId: payload.userId } }); res.status(401).json({ error: "Session expired." }); return; }
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || user.status !== "ACTIVE") { res.status(401).json({ error: "Account no longer active" }); return; }
    const accessToken = await issueTokens(user, req, res);
    await logAudit("TOKEN_REFRESH", req, user.id);
    res.json({ accessToken });
  } catch (err) { console.error("Refresh:", err); res.status(500).json({ error: "An error occurred" }); }
});

router.post("/logout", authenticate, async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.refreshToken;
    if (token) { const h = crypto.createHash("sha256").update(token).digest("hex"); await prisma.refreshToken.deleteMany({ where: { token: h } }); }
    res.clearCookie("refreshToken", { path: "/api/auth" });
    await logAudit("LOGOUT", req, req.user?.userId);
    res.json({ message: "Logged out" });
  } catch (err) { res.status(500).json({ error: "An error occurred" }); }
});

router.post("/logout-all", authenticate, async (req: Request, res: Response) => {
  try {
    await prisma.refreshToken.deleteMany({ where: { userId: req.user!.userId } });
    res.clearCookie("refreshToken", { path: "/api/auth" });
    res.json({ message: "All sessions ended" });
  } catch (err) { res.status(500).json({ error: "An error occurred" }); }
});

router.post("/change-password", authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    const isValid = await bcrypt.compare(parsed.data.currentPassword, user.password);
    if (!isValid) { res.status(401).json({ error: "Current password is incorrect" }); return; }
    await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(parsed.data.newPassword, BCRYPT_SALT_ROUNDS) } });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    res.clearCookie("refreshToken", { path: "/api/auth" });
    await logAudit("PASSWORD_CHANGE", req, user.id);
    res.json({ message: "Password updated. Please log in again." });
  } catch (err) { res.status(500).json({ error: "An error occurred" }); }
});

router.get("/me", authenticate, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { id: true, email: true, firstName: true, lastName: true, role: true, phone: true, organization: true, jobTitle: true, country: true, bio: true, status: true, lastLoginAt: true, createdAt: true } });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json({ ...user, initials: (user.firstName[0] + user.lastName[0]).toUpperCase() });
  } catch (err) { res.status(500).json({ error: "An error occurred" }); }
});


// ─── ADD THESE ROUTES to src/routes/auth.ts before export default router ───

// PATCH /api/auth/profile — Update own profile
router.patch("/profile", authenticate, async (req: Request, res: Response) => {
  try {
    const data: Record<string, string> = {};
    if (req.body.firstName) data.firstName = req.body.firstName;
    if (req.body.lastName) data.lastName = req.body.lastName;
    if (req.body.phone !== undefined) data.phone = req.body.phone;
    if (req.body.organization !== undefined) data.organization = req.body.organization;
    if (req.body.country !== undefined) data.country = req.body.country;

    await prisma.user.update({ where: { id: req.user!.userId }, data });
    res.json({ message: "Profile updated" });
  } catch (err) { console.error("Update profile:", err); res.status(500).json({ error: "An error occurred" }); }
});

// POST /api/auth/change-password — Change own password
router.post("/change-password", authenticate, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) { res.status(400).json({ error: "Both passwords required" }); return; }
    if (newPassword.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const bcrypt = require("bcrypt");
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) { res.status(403).json({ error: "Current password is incorrect" }); return; }

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user!.userId }, data: { password: hash } });
    res.json({ message: "Password changed" });
  } catch (err) { console.error("Change password:", err); res.status(500).json({ error: "An error occurred" }); }
});



export default router;