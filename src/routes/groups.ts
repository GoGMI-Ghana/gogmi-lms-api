import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, authorize } from "../middleware/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import cors from "cors";

const router = Router();
router.use(authenticate);

const uploadDir = path.join(process.cwd(), "uploads", "content");
if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir, { recursive: true }); }
const corsOpts = cors({ origin: process.env.CLIENT_URL || "https://lms.gogmi.org.gh", credentials: true });
const storage = multer.diskStorage({ destination: (_r, _f, cb) => cb(null, uploadDir), filename: (_r, f, cb) => { const ext = path.extname(f.originalname); const name = f.originalname.replace(ext, "").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 50); cb(null, Date.now() + "-" + name + ext); } });
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ─── GET /api/groups/:courseId — List groups for a course ───
router.get("/:courseId", async (req: Request, res: Response) => {
  try {
    const groups = await prisma.$queryRaw`
      SELECT sg.id, sg.name, sg.created_at,
        (SELECT COUNT(*)::int FROM student_group_members sgm WHERE sgm.group_id = sg.id) as member_count
      FROM student_groups sg WHERE sg.course_id = ${req.params.courseId}
      ORDER BY sg.name` as any[];
    
    // Get members for each group
    for (const g of groups) {
      const members = await prisma.$queryRaw`
        SELECT u.id, u.first_name, u.last_name, u.email
        FROM student_group_members sgm
        JOIN users u ON u.id = sgm.user_id
        WHERE sgm.group_id = ${g.id}
        ORDER BY u.first_name` as any[];
      g.members = members.map((m: any) => ({ id: m.id, name: m.first_name + " " + m.last_name, email: m.email }));
    }

    res.json(groups);
  } catch (err) { console.error("List groups:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/groups/:courseId — Create a group ────────────
router.post("/:courseId", authorize("INSTRUCTOR", "ADMIN"), async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) { res.status(400).json({ error: "Group name required" }); return; }
    const result = await prisma.$executeRaw`
      INSERT INTO student_groups (id, course_id, name) VALUES (gen_random_uuid(), ${req.params.courseId}, ${name})
      ON CONFLICT (course_id, name) DO NOTHING`;
    res.status(201).json({ message: "Group created" });
  } catch (err) { console.error(err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/groups/:groupId/members — Add members ────────
router.post("/:groupId/members", authorize("INSTRUCTOR", "ADMIN"), async (req: Request, res: Response) => {
  try {
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds)) { res.status(400).json({ error: "userIds array required" }); return; }
    for (const userId of userIds) {
      await prisma.$executeRaw`
        INSERT INTO student_group_members (id, group_id, user_id) VALUES (gen_random_uuid(), ${req.params.groupId}, ${userId})
        ON CONFLICT (group_id, user_id) DO NOTHING`;
    }
    res.json({ message: userIds.length + " members added" });
  } catch (err) { console.error(err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── DELETE /api/groups/:groupId/members/:userId — Remove member
router.delete("/:groupId/members/:userId", authorize("INSTRUCTOR", "ADMIN"), async (req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`DELETE FROM student_group_members WHERE group_id = ${req.params.groupId} AND user_id = ${req.params.userId}`;
    res.json({ message: "Member removed" });
  } catch (err) { res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/groups/assessment — Create group assessment with file ─
router.options("/assessment", corsOpts);
router.post("/assessment", corsOpts, authorize("INSTRUCTOR", "ADMIN"), upload.single("questionFile"), async (req: Request, res: Response) => {
  try {
    const { courseId, groupId, title, dueDate, maxScore } = req.body;
    if (!courseId || !groupId || !title) { res.status(400).json({ error: "courseId, groupId, and title required" }); return; }

    const questionFileUrl = req.file ? "/api/files/" + req.file.filename : null;
    const count = await prisma.assessment.count({ where: { courseId } });

    const assessment = await prisma.$executeRaw`
      INSERT INTO assessments (id, course_id, title, type, mode, group_id, question_file_url, due_date, max_score, "order")
      VALUES (gen_random_uuid(), ${courseId}, ${title}, 'ASSIGNMENT', 'GROUP', ${groupId}, ${questionFileUrl}, ${dueDate ? new Date(dueDate) : null}, ${parseInt(maxScore) || 100}, ${count})`;

    res.status(201).json({ message: "Group assessment created", questionFileUrl });
  } catch (err) { console.error("Create group assessment:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/groups/assessment/individual — Create individual assessment
router.post("/assessment/individual", authorize("INSTRUCTOR", "ADMIN"), async (req: Request, res: Response) => {
  try {
    const { courseId, title, type, dueDate, maxScore } = req.body;
    if (!courseId || !title) { res.status(400).json({ error: "courseId and title required" }); return; }
    const count = await prisma.assessment.count({ where: { courseId } });
    const assessment = await prisma.assessment.create({
      data: { courseId, title, type: type || "ASSIGNMENT", dueDate: dueDate ? new Date(dueDate) : null, maxScore: maxScore || 100, order: count },
    });
    res.status(201).json(assessment);
  } catch (err) { console.error(err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/groups/submit/:assessmentId — Student submits answer file
router.options("/submit/:assessmentId", corsOpts);
router.post("/submit/:assessmentId", corsOpts, upload.single("answerFile"), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const assessmentId = req.params.assessmentId;

    // Check assessment exists and get group info
    const assessment = await prisma.$queryRaw`
      SELECT a.id, a.group_id, a.due_date, a.mode FROM assessments a WHERE a.id = ${assessmentId}` as any[];
    
    if (!assessment.length) { res.status(404).json({ error: "Assessment not found" }); return; }
    const assess = assessment[0];

    // If group assessment, verify student is in the correct group
    if (assess.mode === 'GROUP' && assess.group_id) {
      const membership = await prisma.$queryRaw`
        SELECT 1 FROM student_group_members WHERE group_id = ${assess.group_id} AND user_id = ${userId}` as any[];
      if (!membership.length) { res.status(403).json({ error: "You are not in this assessment group" }); return; }
    }

    // Check deadline
    if (assess.due_date && new Date(assess.due_date) < new Date()) {
      res.status(400).json({ error: "Deadline has passed" }); return;
    }

    const fileUrl = req.file ? "/api/files/" + req.file.filename : null;
    if (!fileUrl) { res.status(400).json({ error: "Please upload your answer file" }); return; }

    // Check if already submitted
    const existing = await prisma.submission.findUnique({ where: { assessmentId_userId: { assessmentId, userId } } });
    if (existing) {
      // Update existing submission
      await prisma.submission.update({ where: { id: existing.id }, data: { fileUrl, status: "SUBMITTED", submittedAt: new Date() } });
      res.json({ message: "Submission updated" });
    } else {
      await prisma.submission.create({ data: { assessmentId, userId, fileUrl, status: "SUBMITTED", submittedAt: new Date() } });
      res.json({ message: "Submission received" });
    }
  } catch (err) { console.error("Submit:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/groups/my-assessments — Student's group assessments ─
router.get("/my-assessments/:courseId", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const courseId = req.params.courseId;

    // Find which groups this student belongs to
    const myGroups = await prisma.$queryRaw`
      SELECT sg.id, sg.name FROM student_groups sg
      JOIN student_group_members sgm ON sgm.group_id = sg.id
      WHERE sg.course_id = ${courseId} AND sgm.user_id = ${userId}` as any[];

    const myGroupIds = myGroups.map((g: any) => g.id);

    // Get all assessments for this course
    const assessments = await prisma.$queryRaw`
      SELECT a.id, a.title, a.type, a.mode, a.group_id, a.question_file_url, a.due_date, a.max_score,
        sg.name as group_name,
        s.id as submission_id, s.status as submission_status, s.score, s.feedback, s.file_url as answer_file_url, s.submitted_at
      FROM assessments a
      LEFT JOIN student_groups sg ON sg.id = a.group_id
      LEFT JOIN submissions s ON s.assessment_id = a.id AND s.user_id = ${userId}
      WHERE a.course_id = ${courseId}
        AND (a.mode = 'INDIVIDUAL' OR a.group_id = ANY(${myGroupIds.length > 0 ? myGroupIds : ['none']}::text[]))
      ORDER BY a.due_date ASC NULLS LAST` as any[];

    res.json({
      groups: myGroups,
      assessments: assessments.map((a: any) => ({
        id: a.id, title: a.title, type: a.type, mode: a.mode,
        groupName: a.group_name, questionFileUrl: a.question_file_url,
        dueDate: a.due_date, maxScore: a.max_score,
        submission: a.submission_id ? { id: a.submission_id, status: a.submission_status, score: a.score, feedback: a.feedback, answerFileUrl: a.answer_file_url, submittedAt: a.submitted_at } : null,
      })),
    });
  } catch (err) { console.error("My assessments:", err); res.status(500).json({ error: "An error occurred" }); }
});

export default router;