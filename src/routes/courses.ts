import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();

// ─── GET /api/courses — Public course catalog ───────────────
router.get("/", async (req: Request, res: Response) => {
  try {
    const { category, level, search } = req.query;

    const where: Record<string, unknown> = { published: true };
    if (category && category !== "All") where.category = category;
    if (level && level !== "All Levels") where.level = level;
    if (search && typeof search === "string") {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const courses = await prisma.course.findMany({
      where,
      select: {
        id: true,
        title: true,
        subtitle: true,
        description: true,
        category: true,
        level: true,
        duration: true,
        thumbnailCode: true,
        thumbnailColor: true,
        price: true,
        currency: true,
        featured: true,
        format: true,
        targetGroup: true,
        tags: { select: { tag: true } },
        facilitators: { select: { name: true, title: true }, orderBy: { order: "asc" } },
        outcomes: { select: { outcome: true }, orderBy: { order: "asc" } },
        modules: {
          select: {
            id: true,
            title: true,
            order: true,
            lessons: {
              select: { id: true, title: true, facilitator: true, duration: true, order: true },
              orderBy: { order: "asc" },
            },
          },
          orderBy: { order: "asc" },
        },
        _count: { select: { enrollments: true } },
      },
      orderBy: { featured: "desc" },
    });

    res.json(
      courses.map((c) => ({
        ...c,
        tags: c.tags.map((t) => t.tag),
        outcomes: c.outcomes.map((o) => o.outcome),
        students: c._count.enrollments,
        price: Number(c.price),
      }))
    );
  } catch (err) {
    console.error("List courses error:", err);
    res.status(500).json({ error: "An error occurred" });
  }
});

// ─── GET /api/courses/:id — Course detail ───────────────────
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const course = await prisma.course.findUnique({
      where: { id: req.params.id },
      include: {
        tags: { select: { tag: true } },
        facilitators: { select: { name: true, title: true }, orderBy: { order: "asc" } },
        outcomes: { select: { outcome: true }, orderBy: { order: "asc" } },
        modules: {
          select: {
            id: true,
            title: true,
            order: true,
            lessons: {
              select: { id: true, title: true, facilitator: true, duration: true, order: true },
              orderBy: { order: "asc" },
            },
          },
          orderBy: { order: "asc" },
        },
        _count: { select: { enrollments: true } },
      },
    });

    if (!course) {
      res.status(404).json({ error: "Course not found" });
      return;
    }

    res.json({
      ...course,
      tags: course.tags.map((t) => t.tag),
      outcomes: course.outcomes.map((o) => o.outcome),
      students: course._count.enrollments,
      price: Number(course.price),
    });
  } catch (err) {
    console.error("Get course error:", err);
    res.status(500).json({ error: "An error occurred" });
  }
});

// ─── GET /api/courses/enrolled/me — My enrolled courses ─────
router.get("/enrolled/me", authenticate, async (req: Request, res: Response) => {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: req.user!.userId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            subtitle: true,
            category: true,
            level: true,
            duration: true,
            thumbnailCode: true,
            thumbnailColor: true,
          },
        },
      },
      orderBy: { enrolledAt: "desc" },
    });

    res.json(enrollments);
  } catch (err) {
    console.error("Enrolled courses error:", err);
    res.status(500).json({ error: "An error occurred" });
  }
});

// ─── GET /api/courses/:id/access — Check if user has access ─
router.get("/:id/access", authenticate, async (req: Request, res: Response) => {
  try {
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        userId_courseId: {
          userId: req.user!.userId,
          courseId: req.params.id,
        },
      },
    });

    res.json({
      hasAccess: !!enrollment,
      enrollment: enrollment || null,
    });
  } catch (err) {
    console.error("Check access error:", err);
    res.status(500).json({ error: "An error occurred" });
  }
});

export default router;