import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ACCESS_TOKEN_SECRET: z.string().min(32),
  REFRESH_TOKEN_SECRET: z.string().min(32),
  ACCESS_TOKEN_EXPIRY: z.string().default("15m"),
  REFRESH_TOKEN_EXPIRY: z.string().default("7d"),
  CLIENT_URL: z.string().default("http://localhost:5173"),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Microsoft Graph email
  MS_TENANT_ID: z.string().default(""),
  MS_CLIENT_ID: z.string().default(""),
  MS_CLIENT_SECRET: z.string().default(""),
  MS_SENDER_EMAIL: z.string().default(""),
  // Hostinger MySQL (for certificate verification)
  HOSTINGER_DB_HOST: z.string().default(""),
  HOSTINGER_DB_USER: z.string().default(""),
  HOSTINGER_DB_PASSWORD: z.string().default(""),
  HOSTINGER_DB_NAME: z.string().default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;