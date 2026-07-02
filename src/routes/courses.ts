import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { verifyCertificateId } from "../lib/hostinger";
import { generateOtp, verifyOtp, otpEmailHtml } from "../lib/otp";
import { sendEmail } from "../lib/email";
import { env } from "../config/env";

const router = Router();

const verifySchema = z.object({ certificateId: z.string().min(1, "Certificate ID is required") });
const otpSchema = z.object({ verificationKey: z.string().min(1), otp: z.string().length(6, "OTP must be 6 digits") });

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

// ─── GET /api/courses/dashboard/student — Student dashboard ─
router.get("/dashboard/student", authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const enrollments = await prisma.enrollment.findMany({
      where: { userId },
      include: {
        course: {
          select: {
            id: true, title: true, subtitle: true, category: true, thumbnailImage: true,
            thumbnailCode: true, thumbnailColor: true, duration: true,
            modules: { select: { _count: { select: { lessons: true } } } },
            facilitators: { select: { name: true }, orderBy: { order: "asc" as const }, take: 1 },
          },
        },
      },
      orderBy: { enrolledAt: "desc" },
    });


    // ─── ADD THESE ROUTES to src/routes/courses.ts ───────────────
// Place them AFTER the /dashboard/student route and BEFORE /:id routes

// GET /api/courses/student/assessments — Student's assessments
router.get("/student/assessments", authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const courseIds = (await prisma.enrollment.findMany({ where: { userId }, select: { courseId: true } })).map(e => e.courseId);

    const assessments = await prisma.assessment.findMany({
      where: { courseId: { in: courseIds } },
      select: { id: true, title: true, type: true, dueDate: true, maxScore: true, courseId: true, course: { select: { title: true } }, submissions: { where: { userId }, select: { status: true, score: true, submittedAt: true } } },
      orderBy: { dueDate: "asc" },
    });

    res.json(assessments.map(a => {
      const sub = a.submissions[0];
      return {
        id: a.id, title: a.title, type: a.type, dueDate: a.dueDate, maxScore: a.maxScore,
        course: a.course.title, courseId: a.courseId,
        status: sub ? sub.status : "NOT_SUBMITTED",
        score: sub?.score ?? null,
        submittedAt: sub?.submittedAt ?? null,
      };
    }));
  } catch (err) { console.error("Student assessments:", err); res.status(500).json({ error: "An error occurred" }); }
});

    const courseIds = enrollments.map(e => e.courseId);

    const upcomingAssessments = await prisma.assessment.findMany({
      where: { courseId: { in: courseIds }, dueDate: { gte: new Date() } },
      select: { id: true, title: true, type: true, dueDate: true, maxScore: true, course: { select: { title: true } } },
      orderBy: { dueDate: "asc" },
      take: 5,
    });

    const submissions = await prisma.submission.findMany({
      where: { userId, status: "GRADED" },
      select: { score: true, assessment: { select: { title: true, maxScore: true } } },
      orderBy: { gradedAt: "desc" },
      take: 5,
    });

    const announcements = await prisma.announcement.findMany({
      where: { OR: [{ courseId: { in: courseIds } }, { audience: "all" }] },
      select: { id: true, title: true, content: true, author: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 3,
    });

    const completedCourses = enrollments.filter(e => e.status === "COMPLETED").length;
    const avgProgress = enrollments.length > 0
      ? Math.round(enrollments.reduce((s, e) => s + e.progress, 0) / enrollments.length) : 0;
    const totalAssessments = await prisma.submission.count({ where: { userId } });

    res.json({
      stats: { enrolledCourses: enrollments.length, completedCourses, avgProgress, totalAssessments, upcomingDeadlines: upcomingAssessments.length },
      enrollments: enrollments.map(e => ({
        courseId: e.courseId, progress: e.progress, status: e.status, enrolledAt: e.enrolledAt,
        course: {
          ...e.course,
          totalLessons: e.course.modules.reduce((s, m) => s + m._count.lessons, 0),
          facilitator: e.course.facilitators[0]?.name || "GoGMI Faculty",
        },
      })),
      upcomingAssessments: upcomingAssessments.map(a => ({
        id: a.id, title: a.title, type: a.type, dueDate: a.dueDate, maxScore: a.maxScore, course: a.course.title,
      })),
      recentScores: submissions.map(s => ({
        title: s.assessment.title, score: s.score, maxScore: s.assessment.maxScore,
      })),
      announcements,
    });
  } catch (err) { console.error("Student dashboard:", err); res.status(500).json({ error: "An error occurred" }); }
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

// ─── GET /api/courses/:id ───────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const course = await prisma.course.findUnique({
      where: { id: req.params.id },
      include: {
        tags: { select: { tag: true } },
        facilitators: { select: { name: true, title: true, bio: true, email: true, phone: true, linkedIn: true, photo: true }, orderBy: { order: "asc" } },
        outcomes: { select: { outcome: true }, orderBy: { order: "asc" } },
        modules: {
          select: { id: true, title: true, order: true,
            lessons: { select: { id: true, title: true, facilitator: true, duration: true, contentType: true, contentUrl: true, order: true }, orderBy: { order: "asc" } },
          }, orderBy: { order: "asc" },
        },
        _count: { select: { enrollments: true } },
      },
    });
    if (!course) { res.status(404).json({ error: "Course not found" }); return; }
    res.json({ ...course, tags: course.tags.map(t => t.tag), outcomes: course.outcomes.map(o => o.outcome), students: course._count.enrollments, price: Number(course.price) });
  } catch (err) { console.error("Get course:", err); res.status(500).json({ error: "An error occurred" }); }
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

// ─── POST /api/courses/:id/verify — Step 1: Verify certificate ─
router.post("/:id/verify", authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const courseId = req.params.id;
    const userId = req.user!.userId;
    const { certificateId } = parsed.data;

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) { res.status(404).json({ error: "Course not found" }); return; }

    const existing = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } } });
    if (existing) { res.status(409).json({ error: "You are already enrolled in this course" }); return; }

    const usedEnrollment = await prisma.enrollment.findFirst({ where: { courseAccessId: certificateId } });
    if (usedEnrollment) { res.status(403).json({ error: "This certificate ID has already been used." }); return; }

    if (env.HOSTINGER_DB_HOST) {
      const record = await verifyCertificateId(certificateId);
      if (!record) { res.status(403).json({ error: "Invalid certificate ID." }); return; }

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, email: true } });
      if (!user) { res.status(401).json({ error: "User not found" }); return; }

      const otp = generateOtp({ email: record.email, userId, courseId, certificateId, registrantName: record.full_name, registrantEmail: record.email });

      if (env.MS_CLIENT_ID && env.MS_SENDER_EMAIL) {
        await sendEmail({ to: record.email, subject: "GoGMI Course Enrollment — Verification Code", html: otpEmailHtml(record.full_name.split(" ")[0], otp.code) });
      } else {
        console.log("\n📧 OTP for " + record.email + ": " + otp.code + "\n");
      }

      const emailParts = record.email.split("@");
      const maskedEmail = emailParts[0].substring(0, 3) + "***@" + emailParts[1];

      res.json({ message: "Verification code sent to " + maskedEmail, verificationKey: otp.verificationKey, registrantName: record.full_name, maskedEmail, applicantType: record.applicant_type });
    } else {
      const codeRecord = await prisma.courseAccessCode.findUnique({ where: { courseId_code: { courseId, code: certificateId } } });
      if (!codeRecord) { res.status(403).json({ error: "Invalid certificate ID." }); return; }
      if (codeRecord.usedBy) { res.status(403).json({ error: "This certificate ID has already been used." }); return; }

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, email: true } });
      if (!user) { res.status(401).json({ error: "User not found" }); return; }

      const otp = generateOtp({ email: user.email, userId, courseId, certificateId, registrantName: user.firstName, registrantEmail: user.email });
      console.log("\n📧 OTP for " + user.email + ": " + otp.code + "\n");

      const emailParts = user.email.split("@");
      const maskedEmail = emailParts[0].substring(0, 3) + "***@" + emailParts[1];

      res.json({ message: "Verification code sent to " + maskedEmail, verificationKey: otp.verificationKey, registrantName: user.firstName, maskedEmail, applicantType: "member" });
    }
  } catch (err) {
    console.error("Verify certificate:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Verification failed" });
  }
});

// ─── POST /api/courses/:id/enroll — Step 2: Verify OTP & enroll ─
router.post("/:id/enroll", authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = otpSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const { verificationKey, otp } = parsed.data;
    const otpData = verifyOtp(verificationKey, otp);
    if (!otpData) { res.status(403).json({ error: "Invalid or expired verification code." }); return; }

    if (otpData.userId !== req.user!.userId || otpData.courseId !== req.params.id) {
      res.status(403).json({ error: "Invalid verification." }); return;
    }

    if (!env.HOSTINGER_DB_HOST) {
      await prisma.courseAccessCode.updateMany({
        where: { courseId: otpData.courseId, code: otpData.certificateId },
        data: { usedBy: otpData.userId, usedAt: new Date() },
      });
    }

    const enrollment = await prisma.enrollment.create({
      data: { userId: otpData.userId, courseId: otpData.courseId, courseAccessId: otpData.certificateId, status: "ACTIVE" },
      include: { course: { select: { title: true } } },
    });

    res.status(201).json({
      message: "Successfully enrolled in " + enrollment.course.title,
      enrollment: { id: enrollment.id, courseId: otpData.courseId, progress: 0, status: "ACTIVE" },
    });
  } catch (err) { console.error("Enroll:", err); res.status(500).json({ error: "Enrollment failed." }); }
});

// ─── POST /api/courses/:id/admin-enroll — Admin direct enrollment ─
router.post("/:id/admin-enroll", authenticate, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== "ADMIN") { res.status(403).json({ error: "Admin only" }); return; }
    const courseId = req.params.id;
    const userId = req.user!.userId;
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) { res.status(404).json({ error: "Course not found" }); return; }
    const existing = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } } });
    if (existing) { res.status(409).json({ error: "Already enrolled" }); return; }
    const enrollment = await prisma.enrollment.create({
      data: { userId, courseId, courseAccessId: "ADMIN-BYPASS", status: "ACTIVE" },
      include: { course: { select: { title: true } } },
    });
    res.status(201).json({ message: "Enrolled in " + enrollment.course.title, enrollment: { id: enrollment.id, courseId, progress: 0, status: "ACTIVE" } });
  } catch (err) { console.error("Admin enroll:", err); res.status(500).json({ error: "Enrollment failed" }); }
});

export default router;