import { PrismaClient } from "@prisma/client";

// Singleton pattern: reuse the same Prisma instance across the app.
// Without this, every module import creates a new database connection pool.
// In development with hot reload, this leaks connections until PostgreSQL
// rejects new ones (max_connections exceeded).

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
