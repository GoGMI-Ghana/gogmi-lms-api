import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);

const createThreadSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().min(1).max(300),
  content: z.string().min(1).max(5000),
});

const createReplySchema = z.object({
  content: z.string().min(1).max(5000),
});

// ─── GET /api/discussions?courseId= — List threads ───────────
router.get("/", async (req: Request, res: Response) => {
  try {
    const { courseId } = req.query;

    const where: Record<string, unknown> = {};
    if (courseId) where.courseId = courseId;

    const discussions = await prisma.discussion.findMany({
      where,
      select: {
        id: true, title: true, content: true, pinned: true, createdAt: true,
        courseId: true,
        course: { select: { title: true } },
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
        _count: { select: { replies: true } },
        replies: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    });

    res.json(discussions.map(d => ({
      id: d.id,
      title: d.title,
      content: d.content,
      pinned: d.pinned,
      courseId: d.courseId,
      courseName: d.course.title,
      author: d.user.firstName + " " + d.user.lastName,
      authorRole: d.user.role,
      authorId: d.user.id,
      replies: d._count.replies,
      createdAt: d.createdAt,
      lastActivity: d.replies[0]?.createdAt || d.createdAt,
    })));
  } catch (err) { console.error("List discussions:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/discussions/:id — Thread with replies ─────────
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const discussion = await prisma.discussion.findUnique({
      where: { id: req.params.id },
      include: {
        course: { select: { title: true } },
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
        replies: {
          include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!discussion) { res.status(404).json({ error: "Discussion not found" }); return; }

    res.json({
      id: discussion.id,
      title: discussion.title,
      content: discussion.content,
      pinned: discussion.pinned,
      courseId: discussion.courseId,
      courseName: discussion.course.title,
      author: discussion.user.firstName + " " + discussion.user.lastName,
      authorRole: discussion.user.role,
      authorId: discussion.user.id,
      createdAt: discussion.createdAt,
      replies: discussion.replies.map(r => ({
        id: r.id,
        content: r.content,
        author: r.user.firstName + " " + r.user.lastName,
        authorRole: r.user.role,
        authorId: r.user.id,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) { console.error("Get discussion:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/discussions — Create thread ──────────────────
router.post("/", async (req: Request, res: Response) => {
  try {
    const parsed = createThreadSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const discussion = await prisma.discussion.create({
      data: { ...parsed.data, userId: req.user!.userId },
    });

    res.status(201).json(discussion);
  } catch (err) { console.error("Create discussion:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/discussions/:id/replies — Add reply ──────────
router.post("/:id/replies", async (req: Request, res: Response) => {
  try {
    const parsed = createReplySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const discussion = await prisma.discussion.findUnique({ where: { id: req.params.id } });
    if (!discussion) { res.status(404).json({ error: "Discussion not found" }); return; }

    const reply = await prisma.discussionReply.create({
      data: { discussionId: req.params.id, userId: req.user!.userId, content: parsed.data.content },
      include: { user: { select: { firstName: true, lastName: true, role: true } } },
    });

    res.status(201).json({
      id: reply.id,
      content: reply.content,
      author: reply.user.firstName + " " + reply.user.lastName,
      authorRole: reply.user.role,
      createdAt: reply.createdAt,
    });
  } catch (err) { console.error("Create reply:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── PATCH /api/discussions/:id/pin — Toggle pin ────────────
router.patch("/:id/pin", async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== "ADMIN" && req.user!.role !== "INSTRUCTOR") {
      res.status(403).json({ error: "Only instructors and admins can pin" }); return;
    }

    const discussion = await prisma.discussion.findUnique({ where: { id: req.params.id } });
    if (!discussion) { res.status(404).json({ error: "Discussion not found" }); return; }

    const updated = await prisma.discussion.update({
      where: { id: req.params.id },
      data: { pinned: !discussion.pinned },
    });

    res.json({ pinned: updated.pinned });
  } catch (err) { console.error("Pin discussion:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── DELETE /api/discussions/:id — Delete thread ────────────
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== "ADMIN" && req.user!.role !== "INSTRUCTOR") {
      res.status(403).json({ error: "Only instructors and admins can delete" }); return;
    }

    await prisma.discussion.delete({ where: { id: req.params.id } });
    res.json({ message: "Discussion deleted" });
  } catch (err) { console.error("Delete discussion:", err); res.status(500).json({ error: "An error occurred" }); }
});

export default router;