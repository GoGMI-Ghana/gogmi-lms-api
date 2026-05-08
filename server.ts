import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";

const app = express();

// ─── Security middleware (order matters) ────────────────────

// Helmet: sets 15+ HTTP security headers in one line.
// X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, etc.
// Without this, browsers are more vulnerable to clickjacking, MIME sniffing, XSS.
app.use(helmet());

// CORS: only your frontend can call this API.
// Without this, any website could make requests to your API
// using your users' cookies (CSRF attacks).
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true, // Required for cookies
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Body parsing with size limits.
// Without the limit, an attacker could send a 500MB JSON payload
// and crash your server (denial of service).
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Trust proxy — required when behind Nginx/Vercel for correct IP detection
app.set("trust proxy", 1);

// ─── Rate limiting ──────────────────────────────────────────

// Global: 100 requests per 15 minutes per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

// Auth-specific: 5 login attempts per 15 minutes per IP
// This stops brute force attacks. Even if account lockout fails,
// the attacker can only try 5 passwords every 15 minutes.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
  // Only count failed requests (status >= 400)
  skipSuccessfulRequests: true,
});

app.use("/api", globalLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/refresh", rateLimit({ windowMs: 60 * 1000, max: 10 }));

// ─── Routes ─────────────────────────────────────────────────

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

// Health check — for monitoring and load balancers
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── 404 handler ────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// ─── Global error handler ───────────────────────────────────
// Express requires all 4 params to recognize this as an error handler.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  // Never expose error details to the client in production.
  // Internal errors could reveal database structure, file paths, etc.
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start server ───────────────────────────────────────────
app.listen(env.PORT, () => {
  console.log(`✅ GoGMI LMS API running on port ${env.PORT}`);
  console.log(`   Environment: ${env.NODE_ENV}`);
  console.log(`   CORS origin: ${env.CLIENT_URL}`);
});
