import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { sendEmail, messageNotificationEmail } from "../lib/email";
import { env } from "../config/env";

const router = Router();
router.use(authenticate);

const sendMessageSchema = z.object({
  recipientId: z.string().min(1),
  subject: z.string().min(1).max(200),
  content: z.string().min(1).max(5000),
});

const replySchema = z.object({
  content: z.string().min(1).max(5000),
});

// ─── GET /api/messages — List conversations ─────────────────
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Get all messages where user is sender or recipient
    const messages = await prisma.message.findMany({
      where: { OR: [{ senderId: userId }, { recipientId: userId }] },
      select: {
        id: true, subject: true, content: true, read: true, createdAt: true,
        senderId: true, recipientId: true, parentId: true,
        sender: { select: { id: true, firstName: true, lastName: true, role: true } },
        recipient: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Group into conversations (by subject or parent thread)
    const conversationMap = new Map<string, {
      id: string; subject: string; lastMessage: string; lastDate: string;
      otherUser: { id: string; name: string; role: string };
      unread: number; messageCount: number;
    }>();

    for (const msg of messages) {
      // Use parentId or own id as thread key
      const threadId = msg.parentId || msg.id;
      const isIncoming = msg.recipientId === userId;
      const otherUser = isIncoming ? msg.sender : msg.recipient;

      if (!conversationMap.has(threadId)) {
        conversationMap.set(threadId, {
          id: threadId,
          subject: msg.subject || "(No subject)",
          lastMessage: msg.content.slice(0, 100),
          lastDate: msg.createdAt.toISOString(),
          otherUser: { id: otherUser.id, name: otherUser.firstName + " " + otherUser.lastName, role: otherUser.role },
          unread: 0,
          messageCount: 0,
        });
      }

      const conv = conversationMap.get(threadId)!;
      conv.messageCount++;
      if (isIncoming && !msg.read) conv.unread++;
      // Keep the latest message info
      if (new Date(msg.createdAt) > new Date(conv.lastDate)) {
        conv.lastMessage = msg.content.slice(0, 100);
        conv.lastDate = msg.createdAt.toISOString();
      }
    }

    const conversations = Array.from(conversationMap.values()).sort((a, b) => new Date(b.lastDate).getTime() - new Date(a.lastDate).getTime());

    res.json(conversations);
  } catch (err) { console.error("List messages:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/messages/:threadId — Get conversation thread ──
router.get("/:threadId", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const threadId = req.params.threadId;

    // Get the original message and all replies
    const messages = await prisma.message.findMany({
      where: { OR: [{ id: threadId }, { parentId: threadId }] },
      select: {
        id: true, subject: true, content: true, read: true, createdAt: true,
        senderId: true, recipientId: true,
        sender: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    if (messages.length === 0) { res.status(404).json({ error: "Conversation not found" }); return; }

    // Mark incoming messages as read
    await prisma.message.updateMany({
      where: { OR: [{ id: threadId }, { parentId: threadId }], recipientId: userId, read: false },
      data: { read: true },
    });

    res.json({
      threadId,
      subject: messages[0].subject,
      messages: messages.map(m => ({
        id: m.id,
        content: m.content,
        sender: { id: m.sender.id, name: m.sender.firstName + " " + m.sender.lastName, role: m.sender.role },
        isOwn: m.senderId === userId,
        createdAt: m.createdAt,
      })),
    });
  } catch (err) { console.error("Get thread:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/messages — Send new message ──────────────────
router.post("/", async (req: Request, res: Response) => {
  try {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const senderId = req.user!.userId;
    const { recipientId, subject, content } = parsed.data;

    if (senderId === recipientId) { res.status(400).json({ error: "Cannot message yourself" }); return; }

    const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { id: true, firstName: true, email: true } });
    if (!recipient) { res.status(404).json({ error: "Recipient not found" }); return; }

    const sender = await prisma.user.findUnique({ where: { id: senderId }, select: { firstName: true, lastName: true } });
    const senderName = sender ? sender.firstName + " " + sender.lastName : "Someone";

    const message = await prisma.message.create({
      data: { senderId, recipientId, subject, content },
    });

    // Send email notification
    if (env.MS_CLIENT_ID && env.MS_SENDER_EMAIL) {
      sendEmail({
        to: recipient.email,
        subject: "GoGMI — New message from " + senderName,
        html: messageNotificationEmail(recipient.firstName, senderName, subject, content),
      }).catch(err => console.error("Message notification email failed:", err));
    }

    res.status(201).json(message);
  } catch (err) { console.error("Send message:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── POST /api/messages/:threadId/reply — Reply to thread ───
router.post("/:threadId/reply", async (req: Request, res: Response) => {
  try {
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const senderId = req.user!.userId;
    const threadId = req.params.threadId;

    // Get the original message to find recipient and subject
    const original = await prisma.message.findUnique({
      where: { id: threadId },
      select: { senderId: true, recipientId: true, subject: true },
    });
    if (!original) { res.status(404).json({ error: "Thread not found" }); return; }

    // Reply goes to the other person
    const recipientId = original.senderId === senderId ? original.recipientId : original.senderId;

    const reply = await prisma.message.create({
      data: { senderId, recipientId, subject: original.subject, content: parsed.data.content, parentId: threadId },
      include: { sender: { select: { firstName: true, lastName: true } } },
    });

    // Send email notification
    const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { firstName: true, email: true } });
    if (recipient && env.MS_CLIENT_ID && env.MS_SENDER_EMAIL) {
      sendEmail({
        to: recipient.email,
        subject: "GoGMI — Reply from " + reply.sender.firstName + " " + reply.sender.lastName,
        html: messageNotificationEmail(recipient.firstName, reply.sender.firstName + " " + reply.sender.lastName, original.subject, parsed.data.content),
      }).catch(err => console.error("Reply notification email failed:", err));
    }

    res.status(201).json({
      id: reply.id,
      content: reply.content,
      sender: { id: senderId, name: reply.sender.firstName + " " + reply.sender.lastName },
      isOwn: true,
      createdAt: reply.createdAt,
    });
  } catch (err) { console.error("Reply message:", err); res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/messages/unread/count — Unread count ──────────
router.get("/unread/count", async (req: Request, res: Response) => {
  try {
    const count = await prisma.message.count({ where: { recipientId: req.user!.userId, read: false } });
    res.json({ count });
  } catch (err) { res.status(500).json({ error: "An error occurred" }); }
});

// ─── GET /api/messages/users/search — Search users to message ─
router.get("/users/search", async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || "").trim();
    if (q.length < 2) { res.json([]); return; }

    const users = await prisma.user.findMany({
      where: {
        id: { not: req.user!.userId },
        status: "ACTIVE",
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, role: true },
      take: 10,
    });

    res.json(users.map(u => ({ id: u.id, name: u.firstName + " " + u.lastName, role: u.role })));
  } catch (err) { res.status(500).json({ error: "An error occurred" }); }
});

export default router;