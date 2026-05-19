import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, authorize } from "../middleware/auth";
import { sendEmail, instructorApprovalEmail } from "../lib/email";
import { env } from "../config/env";

const router = Router();
router.use(authenticate, authorize("ADMIN"));

// ─── GET /api/admin/overview — Dashboard stats ─────────────
router.get("/overview", async (_req: Request, res: Response) => {
  try {
    const [totalUsers, totalStudents, totalInstructors, pendingInstructors, totalCourses, totalEnrollments, activeEnrollments, completedEnrollments, totalSubmissions, pendingSubmissions] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: "STUDENT" } }),
      prisma.user.count({ where: { role: "INSTRUCTOR" } }),
      prisma.user.count({ where: { role: "INSTRUCTOR", status: "PENDING" } }),
      prisma.course.count(),
      prisma.enrollment.count(),
      prisma.enrollment.count({ where: { status: "ACTIVE" } }),
      prisma.enrollment.count({ where: { status: "COMPLETED" } }),
      prisma.submission.count(),
      prisma.submission.count({ where: { status: "SUBMITTED" } }),
    ]);

    const recentUsers = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 });
    const recentEnrollments = await prisma.enrollment.findMany({ select: { enrolledAt: true, user: { select: { firstName: true, lastName: true } }, course: { select: { title: true } } }, orderBy: { enrolledAt: "desc" }, take: 5 });

    res.json({
      stats: { totalUsers, totalStudents, totalInstructors, pendingInstructors, totalCourses, totalEnrollments, activeEnrollments, completedEnrollments, totalSubmissions, pendingSubmissions },
      recentUsers,
      recentEnrollments: recentEnrollments.map(e => ({ student: e.user.firstName + " " + e.user.lastName, course: e.course.title, enrolledAt: e.enrolledAt })),
    });
  } catch (err) { console.error("Admin overview:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/admin/users — List all users ──────────────────
router.get("/users", async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, organization: true, country: true, role: true, status: true, jobTitle: true, bio: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(users);
  } catch (err) { console.error("Admin users:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/admin/users/:id ───────────────────────────────
router.get("/users/:id", async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, organization: true, country: true, role: true, status: true, jobTitle: true, bio: true, createdAt: true, lastLoginAt: true } });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json(user);
  } catch (err) { res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/admin/users — Create user ────────────────────
router.post("/users", async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, role } = req.body;
    const bcrypt = require("bcrypt");
    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { email, password: hash, firstName, lastName, role: role || "STUDENT", status: "ACTIVE" } });
    res.status(201).json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role });
  } catch (err: any) {
    if (err.code === "P2002") { res.status(409).json({ error: "Email already exists" }); return; }
    console.error(err); res.status(500).json({ error: "An error occurred" });
  }
});

// ─── PATCH /api/admin/users/:id — Update user ──────────────
router.patch("/users/:id", async (req: Request, res: Response) => {
  try {
    const data: Record<string, unknown> = {};
    if (req.body.firstName) data.firstName = req.body.firstName;
    if (req.body.lastName) data.lastName = req.body.lastName;
    if (req.body.role) data.role = req.body.role;
    if (req.body.status) data.status = req.body.status;
    if (req.body.organization) data.organization = req.body.organization;
    const user = await prisma.user.update({ where: { id: req.params.id }, data });
    res.json({ message: "Updated", user: { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role, status: user.status } });
  } catch (err) { res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/admin/users/:id/unlock ───────────────────────
router.post("/users/:id/unlock", async (req: Request, res: Response) => {
  try {
    await prisma.user.update({ where: { id: req.params.id }, data: { failedAttempts: 0, lockedUntil: null } });
    res.json({ message: "Account unlocked" });
  } catch (err) { res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/admin/users/:id/reset-password ───────────────
router.post("/users/:id/reset-password", async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }
    const bcrypt = require("bcrypt");
    const hash = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { id: req.params.id }, data: { password: hash, failedAttempts: 0, lockedUntil: null } });
    res.json({ message: "Password reset" });
  } catch (err) { res.status(500).json({ error: "An error occurred" }); }
});

// ─── PATCH /api/admin/users/:id/approve — Approve instructor ─
router.patch("/users/:id/approve", async (req: Request, res: Response) => {
  try {
    const { courseIds } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    await prisma.user.update({ where: { id: req.params.id }, data: { status: "ACTIVE" } });
    if (courseIds && Array.isArray(courseIds) && courseIds.length > 0) {
      for (const cid of courseIds) { await prisma.course.update({ where: { id: cid }, data: { instructorId: req.params.id } }); }
    }
    if (env.MS_CLIENT_ID && env.MS_SENDER_EMAIL) {
      const titles = courseIds?.length > 0 ? (await prisma.course.findMany({ where: { id: { in: courseIds } }, select: { title: true } })).map((c: any) => c.title) : [];
      sendEmail({ to: user.email, subject: "GoGMI — Your Instructor Application Has Been Approved!", html: instructorApprovalEmail(user.firstName, titles) }).catch((e: any) => console.error(e));
    }
    res.json({ message: user.firstName + " approved." });
  } catch (err) { console.error(err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── PATCH /api/admin/users/:id/reject ──────────────────────
router.patch("/users/:id/reject", async (_req: Request, res: Response) => {
  try { await prisma.user.update({ where: { id: _req.params.id }, data: { status: "SUSPENDED" } }); res.json({ message: "Rejected." }); }
  catch (err) { res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/admin/courses — All courses with stats ────────
router.get("/courses", async (_req: Request, res: Response) => {
  try {
    const courses = await prisma.course.findMany({
      select: {
        id: true, title: true, category: true, level: true, published: true, price: true, currency: true, duration: true,
        thumbnailCode: true, thumbnailColor: true,
        _count: { select: { enrollments: true, assessments: true, modules: true } },
        instructor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(courses.map((c: any) => ({
      ...c, price: Number(c.price),
      students: c._count.enrollments, assessments: c._count.assessments, modules: c._count.modules,
      instructor: c.instructor ? c.instructor.firstName + " " + c.instructor.lastName : null,
    })));
  } catch (err) { console.error("Admin courses:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── PATCH /api/admin/courses/:id — Update course ───────────
router.patch("/courses/:id", async (req: Request, res: Response) => {
  try {
    const data: Record<string, unknown> = {};
    if (req.body.published !== undefined) data.published = req.body.published;
    if (req.body.price !== undefined) data.price = req.body.price;
    if (req.body.featured !== undefined) data.featured = req.body.featured;
    const course = await prisma.course.update({ where: { id: req.params.id }, data });
    res.json({ message: "Course updated", course: { id: course.id, title: course.title, published: course.published } });
  } catch (err) { res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/admin/enrollments — All enrollments ───────────
router.get("/enrollments", async (_req: Request, res: Response) => {
  try {
    const enrollments = await prisma.enrollment.findMany({
      select: {
        id: true, progress: true, status: true, enrolledAt: true, courseAccessId: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true, organization: true, country: true } },
        course: { select: { id: true, title: true } },
      },
      orderBy: { enrolledAt: "desc" },
    });
    res.json(enrollments.map((e: any) => ({
      id: e.id, student: e.user.firstName + " " + e.user.lastName, email: e.user.email,
      organization: e.user.organization, country: e.user.country,
      course: e.course.title, courseId: e.course.id,
      progress: e.progress, status: e.status, enrolledAt: e.enrolledAt, certificateId: e.courseAccessId,
    })));
  } catch (err) { console.error("Admin enrollments:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/admin/announcements — All announcements ───────
router.get("/announcements", async (_req: Request, res: Response) => {
  try {
    const announcements = await prisma.announcement.findMany({ orderBy: { createdAt: "desc" } });
    res.json(announcements);
  } catch (err) { res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/admin/announcements — Create announcement ────
router.post("/announcements", async (req: Request, res: Response) => {
  try {
    const { courseId, title, content } = req.body;
    if (!title || !content) { res.status(400).json({ error: "Title and content required" }); return; }
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { firstName: true, lastName: true } });
    const announcement = await prisma.announcement.create({
      data: { courseId: courseId || null, title, content, audience: courseId ? "course" : "all", author: user ? user.firstName + " " + user.lastName : "Admin" },
    });
    res.status(201).json(announcement);
  } catch (err) { console.error(err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── DELETE /api/admin/announcements/:id ────────────────────
router.delete("/announcements/:id", async (req: Request, res: Response) => {
  try {
    await prisma.announcement.delete({ where: { id: req.params.id } });
    res.json({ message: "Deleted" });
  } catch (err) { res.status(500).json({ error: "An error occurred" }); }
});

export default router;