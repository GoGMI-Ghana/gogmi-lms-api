import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, authorize } from "../middleware/auth";
import { logAudit } from "../lib/audit";

const router = Router();

// All admin routes require authentication + ADMIN role
router.use(authenticate, authorize("ADMIN"));

const BCRYPT_SALT_ROUNDS = 12;

// ─── Validation ─────────────────────────────────────────────
const createUserSchema = z.object({
  email: z.string().email().max(255),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: z.enum(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  organization: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  jobTitle: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
});

const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  role: z.enum(["STUDENT", "INSTRUCTOR", "ADMIN"]).optional(),
  organization: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  jobTitle: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "PENDING"]).optional(),
});

// ─── POST /api/admin/users — Create user ────────────────────
router.post("/users", async (req: Request, res: Response) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const data = parsed.data;
    const email = data.email.toLowerCase();

    // Check for duplicate email
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: "A user with this email already exists" });
      return;
    }

    // Generate a secure temporary password
    const tempPassword = crypto.randomBytes(12).toString("base64url");
    const hashedPassword = await bcrypt.hash(tempPassword, BCRYPT_SALT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        organization: data.organization,
        phone: data.phone,
        jobTitle: data.jobTitle,
        country: data.country,
        status: "ACTIVE",
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        organization: true,
        createdAt: true,
      },
    });

    await logAudit("ACCOUNT_CREATED", req, user.id, `Created by admin ${req.user!.userId}`);

    // TODO: Send email with temporary password
    // In production, integrate with an email service (SendGrid, AWS SES, etc.)
    // For now, return the temp password so the admin can share it manually

    res.status(201).json({
      user,
      temporaryPassword: tempPassword,
      message: "User created. Share the temporary password securely — the user must change it on first login.",
    });
  } catch (err) {
    console.error("Create user error:", err);
    res.status(500).json({ error: "An error occurred" });
  }
});

// ─── GET /api/admin/users — List users ──────────────────────
router.get("/users", async (req: Request, res: Response) => {
  try {
    const { search, role, status, page = "1", limit = "20" } = req.query;

    const where: Record<string, unknown> = {};

    if (search && typeof search === "string") {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { organization: { contains: search, mode: "insensitive" } },
      ];
    }

    if (role && role !== "all") where.role = role;
    if (status && status !== "all") where.status = status;

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          organization: true,
          jobTitle: true,
          country: true,
          lastLoginAt: true,
          createdAt: true,
          _count: { select: { enrollments: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      users: users.map((u) => ({
        ...u,
        initials: `${u.firstName[0]}${u.lastName[0]}`.toUpperCase(),
        enrolledCourses: u._count.enrollments,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("List users error:", err);
    res.status(500).json({ error: "An error occurred" });
  }
});

// ─── GET /api/admin/users/:id ───────────────────────────────
router.get("/users/:id", async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        phone: true,
        organization: true,
        jobTitle: true,
        country: true,
        bio: true,
        failedAttempts: true,
        lockedUntil: true,
        lastLoginAt: true,
        lastLoginIp: true,
        createdAt: true,
        updatedAt: true,
        enrollments: {
          select: {
            id: true,
            courseId: true,
            status: true,
            progress: true,
            enrolledAt: true,
            course: { select: { title: true } },
          },
        },
        certificates: true,
        cpdRecords: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(user);
  } catch (err) {
    console.error("Get user error:", err);
    res.status(500).json({ error: "An error occurred" });
  }
});

// ─── PATCH /api/admin/users/:id ─────────────────────────────
router.patch("/users/:id", async (req: Request, res: Response) => {
  try {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    // Prevent admin from changing their own role
    if (req.params.id === req.user!.userId && parsed.data.role) {
      res.status(400).json({ error: "You cannot change your own role" });
      return;
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: parsed.data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        organization: true,
      },
    });

    const action = parsed.data.status === "SUSPENDED" ? "ACCOUNT_SUSPENDED"
      : parsed.data.status === "ACTIVE" ? "ACCOUNT_ACTIVATED"
      : "ACCOUNT_UPDATED";

    await logAudit(action, req, user.id, `Updated by admin ${req.user!.userId}`);

    res.json(user);
  } catch (err) {
    console.error("Update user error:", err);
    res.status(500).json({ error: "An error occurred" });
  }
});

// ─── POST /api/admin/users/:id/unlock ───────────────────────
router.post("/users/:id/unlock", async (req: Request, res: Response) => {
  try {
    await prisma.user.update({
      where: { id: req.params.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });

    await logAudit("ACCOUNT_UNLOCKED", req, req.params.id, `Unlocked by admin ${req.user!.userId}`);

    res.json({ message: "Account unlocked" });
  } catch (err) {
    console.error("Unlock error:", err);
    res.status(500).json({ error: "An error occurred" });
  }
});

// ─── POST /api/admin/users/:id/reset-password ───────────────
router.post("/users/:id/reset-password", async (req: Request, res: Response) => {
  try {
    const tempPassword = crypto.randomBytes(12).toString("base64url");
    const hashedPassword = await bcrypt.hash(tempPassword, BCRYPT_SALT_ROUNDS);

    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        password: hashedPassword,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    // Revoke all sessions for this user
    await prisma.refreshToken.deleteMany({ where: { userId: req.params.id } });

    await logAudit("PASSWORD_CHANGE", req, req.params.id, `Reset by admin ${req.user!.userId}`);

    res.json({
      temporaryPassword: tempPassword,
      message: "Password reset. Share the new temporary password securely.",
    });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "An error occurred" });
  }
});

export default router;
