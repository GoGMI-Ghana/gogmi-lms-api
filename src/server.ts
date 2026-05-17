import express from "express";
import path from "path";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import courseRoutes from "./routes/courses";
import instructorRoutes from "./routes/instructor";
import assessmentRoutes from "./routes/assessments";


const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: env.CLIENT_URL, credentials: true, methods: ["GET", "POST", "PATCH", "DELETE"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.set("trust proxy", 1);

// Static files
app.use("/images", express.static(path.join(process.cwd(), "public/images")));
app.use("/materials", express.static(path.join(process.cwd(), "public/materials")));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests." } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { error: "Too many login attempts." }, skipSuccessfulRequests: true });

app.use("/api", globalLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", rateLimit({ windowMs: 60 * 60 * 1000, max: 3, message: { error: "Too many registration attempts." } }));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/instructor", instructorRoutes);
app.use("/api/assessments", assessmentRoutes);


app.get("/api/health", (_req, res) => { res.json({ status: "ok", timestamp: new Date().toISOString() }); });
app.use((_req, res) => { res.status(404).json({ error: "Endpoint not found" }); });
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(env.PORT, () => {
  console.log("✅ GoGMI LMS API running on port " + env.PORT);
  console.log("   Environment: " + env.NODE_ENV);
  console.log("   CORS origin: " + env.CLIENT_URL);
});