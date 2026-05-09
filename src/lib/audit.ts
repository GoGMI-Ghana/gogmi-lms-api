import { prisma } from "./prisma";
import type { Request } from "express";

export type AuditAction =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGIN_LOCKED"
  | "LOGOUT"
  | "TOKEN_REFRESH"
  | "PASSWORD_CHANGE"
  | "ACCOUNT_CREATED"
  | "ACCOUNT_UPDATED"
  | "ACCOUNT_SUSPENDED"
  | "ACCOUNT_ACTIVATED"
  | "ACCOUNT_UNLOCKED";

export async function logAudit(
  action: AuditAction,
  req: Request,
  userId?: string,
  detail?: string
) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        userId,
        detail,
        ipAddress: req.ip || req.socket.remoteAddress || "unknown",
        userAgent: req.headers["user-agent"] || "unknown",
      },
    });
  } catch (err) {
    // Audit logging should never crash the app.
    // Log to console as fallback — in production, send to external logging service.
    console.error("Audit log failed:", err);
  }
}
