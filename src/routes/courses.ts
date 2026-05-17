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

// ─── POST /api/courses/:id/verify — Step 1: Verify certificate ID ─
router.post("/:id/verify", authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const courseId = req.params.id;
    const userId = req.user!.userId;
    const { certificateId } = parsed.data;

    // Check course exists
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) { res.status(404).json({ error: "Course not found" }); return; }

    // Check not already enrolled
    const existing = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existing) { res.status(409).json({ error: "You are already enrolled in this course" }); return; }

    // Check if certificate ID is already used by another user in LMS
    const usedEnrollment = await prisma.enrollment.findFirst({
      where: { courseAccessId: certificateId },
    });
    if (usedEnrollment) {
      res.status(403).json({ error: "This certificate ID has already been used for enrollment." });
      return;
    }

    // Verify against Hostinger database
    if (env.HOSTINGER_DB_HOST) {
      const record = await verifyCertificateId(certificateId);
      if (!record) {
        res.status(403).json({ error: "Invalid certificate ID. Please check and try again." });
        return;
      }

      // Get current user's email
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, email: true } });
      if (!user) { res.status(401).json({ error: "User not found" }); return; }

      // Generate OTP and send to registrant's email from Hostinger record
      const otp = generateOtp({
        email: record.email,
        userId,
        courseId,
        certificateId,
        registrantName: record.full_name,
        registrantEmail: record.email,
      });

      // Send OTP email
      if (env.MS_CLIENT_ID && env.MS_SENDER_EMAIL) {
        await sendEmail({
          to: record.email,
          subject: "GoGMI Course Enrollment — Verification Code",
          html: otpEmailHtml(record.full_name.split(" ")[0], otp.code),
        });
      } else {
        // Dev mode
        console.log("\n📧 OTP for " + record.email + ": " + otp.code + "\n");
      }

      // Mask email for frontend display
      const emailParts = record.email.split("@");
      const maskedEmail = emailParts[0].substring(0, 3) + "***@" + emailParts[1];

      res.json({
        message: "A verification code has been sent to " + maskedEmail,
        verificationKey: otp.verificationKey,
        registrantName: record.full_name,
        maskedEmail,
        applicantType: record.applicant_type,
      });
    } else {
      // Fallback: local access codes table (for dev/testing)
      const codeRecord = await prisma.courseAccessCode.findUnique({
        where: { courseId_code: { courseId, code: certificateId } },
      });
      if (!codeRecord) { res.status(403).json({ error: "Invalid certificate ID." }); return; }
      if (codeRecord.usedBy) { res.status(403).json({ error: "This certificate ID has already been used." }); return; }

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, email: true } });
      if (!user) { res.status(401).json({ error: "User not found" }); return; }

      const otp = generateOtp({
        email: user.email,
        userId,
        courseId,
        certificateId,
        registrantName: user.firstName,
        registrantEmail: user.email,
      });

      console.log("\n📧 OTP for " + user.email + ": " + otp.code + "\n");

      const emailParts = user.email.split("@");
      const maskedEmail = emailParts[0].substring(0, 3) + "***@" + emailParts[1];

      res.json({
        message: "A verification code has been sent to " + maskedEmail,
        verificationKey: otp.verificationKey,
        registrantName: user.firstName,
        maskedEmail,
        applicantType: "member",
      });
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

    // Verify OTP
    const otpData = verifyOtp(verificationKey, otp);
    if (!otpData) {
      res.status(403).json({ error: "Invalid or expired verification code. Please try again." });
      return;
    }

    // Ensure the OTP belongs to this user and course
    if (otpData.userId !== req.user!.userId || otpData.courseId !== req.params.id) {
      res.status(403).json({ error: "Invalid verification." });
      return;
    }

    // Mark local access code as used (if using local fallback)
    if (!env.HOSTINGER_DB_HOST) {
      await prisma.courseAccessCode.updateMany({
        where: { courseId: otpData.courseId, code: otpData.certificateId },
        data: { usedBy: otpData.userId, usedAt: new Date() },
      });
    }

    // Create enrollment
    const enrollment = await prisma.enrollment.create({
      data: {
        userId: otpData.userId,
        courseId: otpData.courseId,
        courseAccessId: otpData.certificateId,
        status: "ACTIVE",
      },
      include: { course: { select: { title: true } } },
    });

    res.status(201).json({
      message: "Successfully enrolled in " + enrollment.course.title,
      enrollment: { id: enrollment.id, courseId: otpData.courseId, progress: 0, status: "ACTIVE" },
    });
  } catch (err) {
    console.error("Enroll:", err);
    res.status(500).json({ error: "Enrollment failed. Please try again." });
  }
});

// ─── ADD THIS ROUTE to src/routes/courses.ts ────────────────
// Place it before the `export default router;` line

// POST /api/courses/:id/admin-enroll — Admin direct enrollment
router.post("/:id/admin-enroll", authenticate, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== "ADMIN") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const courseId = req.params.id;
    const userId = req.user!.userId;

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) { res.status(404).json({ error: "Course not found" }); return; }

    const existing = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existing) { res.status(409).json({ error: "Already enrolled" }); return; }

    const enrollment = await prisma.enrollment.create({
      data: { userId, courseId, courseAccessId: "ADMIN-BYPASS", status: "ACTIVE" },
      include: { course: { select: { title: true } } },
    });

    res.status(201).json({
      message: "Enrolled in " + enrollment.course.title,
      enrollment: { id: enrollment.id, courseId, progress: 0, status: "ACTIVE" },
    });
  } catch (err) { console.error("Admin enroll:", err); res.status(500).json({ error: "Enrollment failed" }); }
});

// Admin direct enrollment (no certificate needed)
router.post("/:id/admin-enroll", authenticate, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== "ADMIN") { res.status(403).json({ error: "Admin only" }); return; }
    const courseId = req.params.id;
    const userId = req.user!.userId;
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) { res.status(404).json({ error: "Course not found" }); return; }
    const existing = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } } });
    if (existing) { res.status(409).json({ error: "Already enrolled" }); return; }
    const enrollment = await prisma.enrollment.create({ data: { userId, courseId, courseAccessId: "ADMIN-BYPASS", status: "ACTIVE" }, include: { course: { select: { title: true } } } });
    res.status(201).json({ message: "Enrolled in " + enrollment.course.title, enrollment: { id: enrollment.id, courseId, progress: 0, status: "ACTIVE" } });
  } catch (err) { console.error("Admin enroll:", err); res.status(500).json({ error: "Enrollment failed" }); }
});

export default router;