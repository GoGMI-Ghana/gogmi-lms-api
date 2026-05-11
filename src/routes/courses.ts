import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();

const enrollSchema = z.object({
  accessCode: z.string().min(1, "Access code is required"),
});

// ─── GET /api/courses — Published courses only ──────────────
router.get("/", async (_req: Request, res: Response) => {
  try {
    const courses = await prisma.course.findMany({
      where: { published: true },
      select: {
        id: true, title: true, subtitle: true, description: true, category: true,
        level: true, duration: true, thumbnailCode: true, thumbnailColor: true,
        thumbnailImage: true, price: true, currency: true, featured: true,
        format: true, targetGroup: true,
        tags: { select: { tag: true } },
        facilitators: { select: { name: true, title: true }, orderBy: { order: "asc" } },
        outcomes: { select: { outcome: true }, orderBy: { order: "asc" } },
        modules: {
          select: { id: true, title: true, order: true,
            lessons: { select: { id: true, title: true, facilitator: true, duration: true, order: true }, orderBy: { order: "asc" } },
          }, orderBy: { order: "asc" },
        },
        _count: { select: { enrollments: true } },
      },
      orderBy: { featured: "desc" },
    });

    res.json(courses.map(c => ({
      ...c, tags: c.tags.map(t => t.tag), outcomes: c.outcomes.map(o => o.outcome),
      students: c._count.enrollments, price: Number(c.price),
    })));
  } catch (err) { console.error("List courses:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/courses/:id ───────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const course = await prisma.course.findUnique({
      where: { id: req.params.id },
      include: {
        tags: { select: { tag: true } },
        facilitators: { select: { name: true, title: true }, orderBy: { order: "asc" } },
        outcomes: { select: { outcome: true }, orderBy: { order: "asc" } },
        modules: {
          select: { id: true, title: true, order: true,
            lessons: { select: { id: true, title: true, facilitator: true, duration: true, order: true }, orderBy: { order: "asc" } },
          }, orderBy: { order: "asc" },
        },
        _count: { select: { enrollments: true } },
      },
    });
    if (!course) { res.status(404).json({ error: "Course not found" }); return; }
    res.json({ ...course, tags: course.tags.map(t => t.tag), outcomes: course.outcomes.map(o => o.outcome), students: course._count.enrollments, price: Number(course.price) });
  } catch (err) { console.error("Get course:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/courses/enrolled/me ───────────────────────────
router.get("/enrolled/me", authenticate, async (req: Request, res: Response) => {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: req.user!.userId },
      include: {
        course: { select: { id: true, title: true, subtitle: true, category: true, level: true, duration: true, thumbnailCode: true, thumbnailColor: true, thumbnailImage: true } },
      },
      orderBy: { enrolledAt: "desc" },
    });
    res.json(enrollments);
  } catch (err) { console.error("Enrolled:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/courses/:id/access ────────────────────────────
router.get("/:id/access", authenticate, async (req: Request, res: Response) => {
  try {
    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: req.user!.userId, courseId: req.params.id } },
    });
    res.json({ hasAccess: !!enrollment, enrollment: enrollment || null });
  } catch (err) { console.error("Access check:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/courses/:id/enroll — Verify access code & enroll ─
router.post("/:id/enroll", authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = enrollSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const courseId = req.params.id;
    const userId = req.user!.userId;
    const { accessCode } = parsed.data;

    // Check course exists
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) { res.status(404).json({ error: "Course not found" }); return; }

    // Check not already enrolled
    const existing = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existing) { res.status(409).json({ error: "You are already enrolled in this course" }); return; }

    // ─── Verify access code ─────────────────────────────────
    // TODO: When Hostinger DB is ready, replace this block with:
    //   const valid = await verifyCodeFromHostinger(accessCode, courseId);
    // For now, check local course_access_codes table
    const codeRecord = await prisma.courseAccessCode.findUnique({
      where: { courseId_code: { courseId, code: accessCode } },
    });

    if (!codeRecord) {
      res.status(403).json({ error: "Invalid access code. Please check your course certificate ID and try again." });
      return;
    }

    if (codeRecord.usedBy) {
      res.status(403).json({ error: "This access code has already been used." });
      return;
    }

    // Mark code as used
    await prisma.courseAccessCode.update({
      where: { id: codeRecord.id },
      data: { usedBy: userId, usedAt: new Date() },
    });

    // Create enrollment
    const enrollment = await prisma.enrollment.create({
      data: { userId, courseId, courseAccessId: accessCode, status: "ACTIVE" },
      include: { course: { select: { title: true } } },
    });

    res.status(201).json({
      message: "Successfully enrolled in " + enrollment.course.title,
      enrollment: { id: enrollment.id, courseId, progress: 0, status: "ACTIVE" },
    });
  } catch (err) { console.error("Enroll:", err); res.status(500).json({ error: "An error occurred" }); }
});

export default router;