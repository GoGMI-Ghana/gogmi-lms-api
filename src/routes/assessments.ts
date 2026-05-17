import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

// ─── Instructor: Create/Edit Questions ──────────────────────

const questionSchema = z.object({
  questionText: z.string().min(1).max(2000),
  questionType: z.enum(["MCQ"]).default("MCQ"),
  points: z.number().min(1).max(100).default(1),
  options: z.array(z.object({
    optionText: z.string().min(1).max(500),
    isCorrect: z.boolean(),
  })).min(2).max(6),
});

const bulkQuestionsSchema = z.object({
  questions: z.array(questionSchema).min(1).max(100),
});

// GET /api/assessments/:id — Get assessment with questions
router.get("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const assessment = await prisma.assessment.findUnique({
      where: { id: req.params.id },
      include: {
        course: { select: { id: true, title: true } },
        questions: {
          orderBy: { order: "asc" },
          include: {
            options: {
              orderBy: { order: "asc" },
              select: {
                id: true,
                optionText: true,
                order: true,
                // Only show isCorrect to instructors/admins
                ...(req.user?.role === "INSTRUCTOR" || req.user?.role === "ADMIN" ? { isCorrect: true } : {}),
              },
            },
          },
        },
        _count: { select: { submissions: true } },
      },
    });

    if (!assessment) { res.status(404).json({ error: "Assessment not found" }); return; }

    // Check if student already submitted
    let studentSubmission = null;
    if (req.user?.role === "STUDENT") {
      studentSubmission = await prisma.submission.findUnique({
        where: { assessmentId_userId: { assessmentId: assessment.id, userId: req.user.userId } },
        include: { answers: { include: { selectedOption: true, question: { include: { options: true } } } } },
      });
    }

    const totalPoints = assessment.questions.reduce((s, q) => s + q.points, 0);

    res.json({
      ...assessment,
      totalPoints,
      questionCount: assessment.questions.length,
      submissions: assessment._count.submissions,
      studentSubmission,
    });
  } catch (err) { console.error("Get assessment:", err); res.status(500).json({ error: "An error occurred" }); }
});

// POST /api/assessments/:id/questions — Add questions (instructor/admin)
router.post("/:id/questions", authenticate, authorize("INSTRUCTOR", "ADMIN"), async (req: Request, res: Response) => {
  try {
    const parsed = bulkQuestionsSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const assessmentId = req.params.id;
    const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId } });
    if (!assessment) { res.status(404).json({ error: "Assessment not found" }); return; }

    // Get current question count for ordering
    const existingCount = await prisma.question.count({ where: { assessmentId } });

    // Create questions with options
    const created = [];
    for (let i = 0; i < parsed.data.questions.length; i++) {
      const q = parsed.data.questions[i];

      // Validate at least one correct answer
      const hasCorrect = q.options.some(o => o.isCorrect);
      if (!hasCorrect) { res.status(400).json({ error: "Question " + (i + 1) + " must have at least one correct answer." }); return; }

      const question = await prisma.question.create({
        data: {
          assessmentId,
          questionText: q.questionText,
          questionType: q.questionType,
          points: q.points,
          order: existingCount + i,
          options: {
            create: q.options.map((opt, j) => ({
              optionText: opt.optionText,
              isCorrect: opt.isCorrect,
              order: j,
            })),
          },
        },
        include: { options: true },
      });
      created.push(question);
    }

    // Update assessment max score to total points
    const totalPoints = await prisma.question.aggregate({ where: { assessmentId }, _sum: { points: true } });
    await prisma.assessment.update({ where: { id: assessmentId }, data: { maxScore: totalPoints._sum.points || 100 } });

    res.status(201).json({ message: created.length + " question(s) added", questions: created });
  } catch (err) { console.error("Add questions:", err); res.status(500).json({ error: "An error occurred" }); }
});

// PUT /api/assessments/questions/:questionId — Update a question
router.patch("/questions/:questionId", authenticate, authorize("INSTRUCTOR", "ADMIN"), async (req: Request, res: Response) => {
  try {
    const parsed = questionSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const { questionId } = req.params;
    const q = parsed.data;

    // Delete existing options and recreate
    await prisma.questionOption.deleteMany({ where: { questionId } });

    const updated = await prisma.question.update({
      where: { id: questionId },
      data: {
        questionText: q.questionText,
        points: q.points,
        options: {
          create: q.options.map((opt, j) => ({
            optionText: opt.optionText,
            isCorrect: opt.isCorrect,
            order: j,
          })),
        },
      },
      include: { options: true },
    });

    res.json(updated);
  } catch (err) { console.error("Update question:", err); res.status(500).json({ error: "An error occurred" }); }
});

// DELETE /api/assessments/questions/:questionId — Delete a question
router.delete("/questions/:questionId", authenticate, authorize("INSTRUCTOR", "ADMIN"), async (req: Request, res: Response) => {
  try {
    await prisma.question.delete({ where: { id: req.params.questionId } });
    res.json({ message: "Question deleted" });
  } catch (err) { console.error("Delete question:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── Student: Submit answers (auto-graded) ──────────────────

const submitSchema = z.object({
  answers: z.array(z.object({
    questionId: z.string().min(1),
    selectedOptionId: z.string().min(1),
  })),
});

router.post("/:id/submit", authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const assessmentId = req.params.id;
    const userId = req.user!.userId;

    // Check enrollment
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { course: true },
    });
    if (!assessment) { res.status(404).json({ error: "Assessment not found" }); return; }

    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId: assessment.courseId } },
    });
    if (!enrollment) { res.status(403).json({ error: "You are not enrolled in this course" }); return; }

    // Check if already submitted
    const existing = await prisma.submission.findUnique({
      where: { assessmentId_userId: { assessmentId, userId } },
    });
    if (existing && existing.status === "GRADED") {
      res.status(409).json({ error: "You have already completed this assessment" }); return;
    }

    // Get all questions with correct answers
    const questions = await prisma.question.findMany({
      where: { assessmentId },
      include: { options: true },
    });

    // Grade each answer
    let totalScore = 0;
    let totalPoints = 0;
    const gradedAnswers = parsed.data.answers.map(a => {
      const question = questions.find(q => q.id === a.questionId);
      if (!question) return null;

      totalPoints += question.points;
      const correctOption = question.options.find(o => o.isCorrect);
      const isCorrect = correctOption?.id === a.selectedOptionId;
      const pointsEarned = isCorrect ? question.points : 0;
      totalScore += pointsEarned;

      return {
        questionId: a.questionId,
        selectedOptionId: a.selectedOptionId,
        isCorrect,
        pointsEarned,
      };
    }).filter(Boolean);

    // Calculate percentage score
    const percentageScore = totalPoints > 0 ? Math.round((totalScore / totalPoints) * 100) : 0;

    // Create or update submission
    const submission = existing
      ? await prisma.submission.update({
          where: { id: existing.id },
          data: { score: percentageScore, status: "GRADED", submittedAt: new Date(), gradedAt: new Date(), feedback: "Auto-graded: " + totalScore + "/" + totalPoints + " points" },
        })
      : await prisma.submission.create({
          data: { assessmentId, userId, score: percentageScore, status: "GRADED", submittedAt: new Date(), gradedAt: new Date(), feedback: "Auto-graded: " + totalScore + "/" + totalPoints + " points" },
        });

    // Save individual answers
    for (const answer of gradedAnswers) {
      if (!answer) continue;
      await prisma.studentAnswer.upsert({
        where: { submissionId_questionId: { submissionId: submission.id, questionId: answer.questionId } },
        update: { selectedOptionId: answer.selectedOptionId, isCorrect: answer.isCorrect, pointsEarned: answer.pointsEarned },
        create: { submissionId: submission.id, ...answer },
      });
    }

    res.json({
      message: "Assessment submitted and graded",
      score: percentageScore,
      totalScore,
      totalPoints,
      correctCount: gradedAnswers.filter(a => a?.isCorrect).length,
      totalQuestions: questions.length,
      submission: { id: submission.id, score: percentageScore, status: "GRADED" },
    });
  } catch (err) { console.error("Submit assessment:", err); res.status(500).json({ error: "An error occurred" }); }
});

export default router;