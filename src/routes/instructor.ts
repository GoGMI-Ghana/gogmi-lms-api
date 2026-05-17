import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

router.use(authenticate, authorize("INSTRUCTOR", "ADMIN"));

// ─── GET /api/instructor/dashboard — Dashboard stats ────────
router.get("/dashboard", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const courses = await prisma.course.findMany({
      where: { instructorId: userId },
      select: {
        id: true, title: true, thumbnailCode: true, thumbnailColor: true, thumbnailImage: true,
        _count: { select: { enrollments: true } },
        enrollments: { select: { progress: true, lastAccessAt: true, status: true } },
      },
    });

    let effectiveCourses = courses;
    if (courses.length === 0 && req.user!.role === "ADMIN") {
      effectiveCourses = await prisma.course.findMany({
        where: { published: true },
        select: {
          id: true, title: true, thumbnailCode: true, thumbnailColor: true, thumbnailImage: true,
          _count: { select: { enrollments: true } },
          enrollments: { select: { progress: true, lastAccessAt: true, status: true } },
        },
      });
    }

    const courseIds = effectiveCourses.map(c => c.id);
    const totalStudents = effectiveCourses.reduce((sum, c) => sum + c._count.enrollments, 0);
    const allProgress = effectiveCourses.flatMap(c => c.enrollments.map(e => e.progress));
    const avgProgress = allProgress.length > 0 ? Math.round(allProgress.reduce((a, b) => a + b, 0) / allProgress.length) : 0;

    const pendingSubmissions = await prisma.submission.findMany({
      where: { assessment: { courseId: { in: courseIds } }, status: "SUBMITTED" },
      select: {
        id: true, submittedAt: true,
        user: { select: { firstName: true, lastName: true, email: true } },
        assessment: { select: { title: true, type: true, courseId: true, course: { select: { title: true } } } },
      },
      orderBy: { submittedAt: "desc" },
      take: 10,
    });

    const upcomingAssessments = await prisma.assessment.findMany({
      where: { courseId: { in: courseIds }, dueDate: { gte: new Date() } },
      select: { id: true, title: true, type: true, dueDate: true, course: { select: { title: true } } },
      orderBy: { dueDate: "asc" },
      take: 5,
    });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeLearners = await prisma.enrollment.count({
      where: { courseId: { in: courseIds }, lastAccessAt: { gte: sevenDaysAgo } },
    });

    res.json({
      stats: { totalCourses: effectiveCourses.length, totalStudents, pendingGrades: pendingSubmissions.length, avgProgress, activeLearners },
      courses: effectiveCourses.map(c => ({ id: c.id, title: c.title, thumbnailCode: c.thumbnailCode, thumbnailColor: c.thumbnailColor, thumbnailImage: c.thumbnailImage, students: c._count.enrollments })),
      pendingSubmissions: pendingSubmissions.map(s => ({ id: s.id, student: s.user.firstName + " " + s.user.lastName, email: s.user.email, assignment: s.assessment.title, type: s.assessment.type, course: s.assessment.course.title, submittedAt: s.submittedAt })),
      upcomingAssessments: upcomingAssessments.map(a => ({ id: a.id, title: a.title, type: a.type, dueDate: a.dueDate, course: a.course.title })),
    });
  } catch (err) { console.error("Instructor dashboard:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/instructor/courses — Instructor's courses (with assessments) ─
router.get("/courses", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    let where: Record<string, unknown> = { instructorId: userId };
    if (req.user!.role === "ADMIN") where = { published: true };

    const courses = await prisma.course.findMany({
      where,
      select: {
        id: true, title: true, subtitle: true, category: true, level: true,
        duration: true, thumbnailCode: true, thumbnailColor: true, thumbnailImage: true,
        published: true, price: true, currency: true,
        modules: { select: { id: true, title: true, order: true, _count: { select: { lessons: true } } }, orderBy: { order: "asc" } },
        _count: { select: { enrollments: true, assessments: true } },
        enrollments: { select: { progress: true } },
        assessments: {
          select: {
            id: true, title: true, type: true, dueDate: true, maxScore: true,
            _count: { select: { submissions: true } },
            submissions: { select: { status: true, score: true } },
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(courses.map(c => {
      const avgProgress = c.enrollments.length > 0
        ? Math.round(c.enrollments.reduce((s, e) => s + e.progress, 0) / c.enrollments.length) : 0;
      return {
        ...c,
        students: c._count.enrollments,
        assessmentCount: c._count.assessments,
        totalSessions: c.modules.reduce((s, m) => s + m._count.lessons, 0),
        avgProgress,
        price: Number(c.price),
        enrollments: undefined,
        assessments: c.assessments.map(a => ({
          id: a.id, title: a.title, type: a.type, dueDate: a.dueDate, maxScore: a.maxScore,
          submissions: a._count.submissions,
          totalStudents: c._count.enrollments,
          avgScore: a.submissions.filter(s => s.score !== null).length > 0
            ? Math.round(a.submissions.filter(s => s.score !== null).reduce((sum, s) => sum + (s.score || 0), 0) / a.submissions.filter(s => s.score !== null).length)
            : null,
          pendingCount: a.submissions.filter(s => s.status === "SUBMITTED").length,
        })),
      };
    }));
  } catch (err) { console.error("Instructor courses:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/instructor/courses/:id — Course detail for instructor ─
router.get("/courses/:id", async (req: Request, res: Response) => {
  try {
    const course = await prisma.course.findUnique({
      where: { id: req.params.id },
      include: {
        modules: {
          select: {
            id: true, title: true, order: true,
            lessons: { select: { id: true, title: true, facilitator: true, duration: true, contentType: true, contentUrl: true, order: true }, orderBy: { order: "asc" } },
          },
          orderBy: { order: "asc" },
        },
        enrollments: {
          select: {
            id: true, progress: true, status: true, enrolledAt: true, lastAccessAt: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true, organization: true, country: true } },
          },
          orderBy: { enrolledAt: "desc" },
        },
        assessments: {
          select: {
            id: true, title: true, type: true, dueDate: true, maxScore: true,
            _count: { select: { submissions: true } },
            submissions: { select: { id: true, status: true, score: true } },
          },
          orderBy: { order: "asc" },
        },
      },
    });

    if (!course) { res.status(404).json({ error: "Course not found" }); return; }

    res.json({
      ...course,
      price: Number(course.price),
      students: course.enrollments.map(e => ({
        ...e.user,
        progress: e.progress,
        status: e.status,
        enrolledAt: e.enrolledAt,
        lastAccessAt: e.lastAccessAt,
      })),
      assessments: course.assessments.map(a => ({
        ...a,
        submissions: a._count.submissions,
        totalStudents: course.enrollments.length,
        avgScore: a.submissions.filter(s => s.score !== null).length > 0
          ? Math.round(a.submissions.filter(s => s.score !== null).reduce((sum, s) => sum + (s.score || 0), 0) / a.submissions.filter(s => s.score !== null).length)
          : null,
        pendingCount: a.submissions.filter(s => s.status === "SUBMITTED").length,
      })),
    });
  } catch (err) { console.error("Instructor course detail:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/instructor/students — All students across courses ─
router.get("/students", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    let courseFilter: Record<string, unknown> = { instructorId: userId };
    if (req.user!.role === "ADMIN") courseFilter = { published: true };

    const enrollments = await prisma.enrollment.findMany({
      where: { course: courseFilter },
      select: {
        progress: true, status: true, enrolledAt: true, lastAccessAt: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true, organization: true, country: true } },
        course: { select: { id: true, title: true } },
      },
      orderBy: { enrolledAt: "desc" },
    });

    res.json(enrollments.map(e => ({
      id: e.user.id, name: e.user.firstName + " " + e.user.lastName, email: e.user.email,
      organization: e.user.organization, country: e.user.country, course: e.course.title,
      courseId: e.course.id, progress: e.progress, status: e.status, enrolledAt: e.enrolledAt, lastAccessAt: e.lastAccessAt,
    })));
  } catch (err) { console.error("Instructor students:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/instructor/submissions — Submissions to grade ─
router.get("/submissions", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { status } = req.query;

    let courseFilter: Record<string, unknown> = { instructorId: userId };
    if (req.user!.role === "ADMIN") courseFilter = { published: true };

    const where: Record<string, unknown> = { assessment: { course: courseFilter } };
    if (status && status !== "all") where.status = status;

    const submissions = await prisma.submission.findMany({
      where,
      select: {
        id: true, status: true, score: true, feedback: true, submittedAt: true, gradedAt: true, fileUrl: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        assessment: { select: { id: true, title: true, type: true, maxScore: true, course: { select: { title: true } } } },
      },
      orderBy: { submittedAt: "desc" },
    });

    res.json(submissions.map(s => ({
      id: s.id, student: s.user.firstName + " " + s.user.lastName, studentEmail: s.user.email,
      assignment: s.assessment.title, type: s.assessment.type, course: s.assessment.course.title,
      maxScore: s.assessment.maxScore, status: s.status, score: s.score, feedback: s.feedback,
      fileUrl: s.fileUrl, submittedAt: s.submittedAt, gradedAt: s.gradedAt,
    })));
  } catch (err) { console.error("Instructor submissions:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── PATCH /api/instructor/submissions/:id/grade ────────────
const gradeSchema = z.object({ score: z.number().min(0).max(100), feedback: z.string().max(2000).optional() });

router.patch("/submissions/:id/grade", async (req: Request, res: Response) => {
  try {
    const parsed = gradeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const submission = await prisma.submission.update({
      where: { id: req.params.id },
      data: { score: parsed.data.score, feedback: parsed.data.feedback || null, status: "GRADED", gradedAt: new Date() },
      select: { id: true, score: true, status: true, user: { select: { firstName: true } }, assessment: { select: { title: true } } },
    });

    res.json({ message: submission.user.firstName + "'s " + submission.assessment.title + " graded: " + submission.score + "/100", submission });
  } catch (err) { console.error("Grade submission:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/instructor/assessments — Create assessment ───
const createAssessmentSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().min(1).max(200),
  type: z.enum(["QUIZ", "ASSIGNMENT", "EXAM"]),
  dueDate: z.string().optional(),
  maxScore: z.number().min(1).default(100),
});

router.post("/assessments", async (req: Request, res: Response) => {
  try {
    const parsed = createAssessmentSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const { courseId, title, type, dueDate, maxScore } = parsed.data;
    const count = await prisma.assessment.count({ where: { courseId } });

    const assessment = await prisma.assessment.create({
      data: { courseId, title, type, dueDate: dueDate ? new Date(dueDate) : null, maxScore, order: count },
    });

    res.status(201).json(assessment);
  } catch (err) { console.error("Create assessment:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/instructor/announcements ─────────────────────
const createAnnouncementSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(5000),
});

router.post("/announcements", async (req: Request, res: Response) => {
  try {
    const parsed = createAnnouncementSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { firstName: true, lastName: true } });

    const announcement = await prisma.announcement.create({
      data: { ...parsed.data, audience: "course", author: user ? user.firstName + " " + user.lastName : "Instructor" },
    });

    res.status(201).json(announcement);
  } catch (err) { console.error("Create announcement:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/instructor/announcements ──────────────────────
router.get("/announcements", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    let courseFilter: Record<string, unknown> = { instructorId: userId };
    if (req.user!.role === "ADMIN") courseFilter = { published: true };

    const courseIds = (await prisma.course.findMany({ where: courseFilter, select: { id: true } })).map(c => c.id);

    const announcements = await prisma.announcement.findMany({
      where: { OR: [{ courseId: { in: courseIds } }, { audience: "all" }] },
      orderBy: { createdAt: "desc" },
    });

    res.json(announcements);
  } catch (err) { console.error("Instructor announcements:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/instructor/analytics ──────────────────────────
router.get("/analytics", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    let courseFilter: Record<string, unknown> = { instructorId: userId };
    if (req.user!.role === "ADMIN") courseFilter = { published: true };

    const courses = await prisma.course.findMany({
      where: courseFilter,
      select: {
        id: true, title: true,
        modules: { select: { title: true, order: true, _count: { select: { lessons: true } } }, orderBy: { order: "asc" } },
        enrollments: { select: { progress: true, status: true, lastAccessAt: true } },
        assessments: { select: { title: true, submissions: { select: { score: true, status: true } } } },
      },
    });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const analytics = courses.map(c => {
      const enrolled = c.enrollments.length;
      const active = c.enrollments.filter(e => e.lastAccessAt && e.lastAccessAt >= sevenDaysAgo).length;
      const completed = c.enrollments.filter(e => e.status === "COMPLETED").length;
      const avgProgress = enrolled > 0 ? Math.round(c.enrollments.reduce((s, e) => s + e.progress, 0) / enrolled) : 0;
      const allScores = c.assessments.flatMap(a => a.submissions.filter(s => s.score !== null).map(s => s.score!));
      const avgScore = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : null;
      const totalSubmissions = c.assessments.reduce((s, a) => s + a.submissions.length, 0);

      return {
        courseId: c.id, courseTitle: c.title, enrolled, active, completed, avgProgress, avgScore, totalSubmissions,
        modules: c.modules.map(m => ({ title: "M" + (m.order + 1) + ": " + m.title, sessions: m._count.lessons })),
      };
    });

    res.json(analytics);
  } catch (err) { console.error("Instructor analytics:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── PATCH /api/instructor/lessons/:id — Update lesson content ─
const updateLessonSchema = z.object({
  contentType: z.string().optional(),
  contentUrl: z.string().optional(),
});

router.patch("/lessons/:id", async (req: Request, res: Response) => {
  try {
    const parsed = updateLessonSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const lesson = await prisma.lesson.update({
      where: { id: req.params.id },
      data: parsed.data,
    });

    res.json(lesson);
  } catch (err) { console.error("Update lesson:", err); res.status(500).json({ error: "An error occurred" }); }
});

export default router;