import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();

// Ensure upload directory exists
const uploadDir = path.join(process.cwd(), "uploads", "content");
if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir, { recursive: true }); }

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = file.originalname.replace(ext, "").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 50);
    cb(null, Date.now() + "-" + name + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".txt", ".zip", ".png", ".jpg", ".jpeg"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) { cb(null, true); } else { cb(new Error("File type not allowed")); }
  },
});

// POST /api/files/upload — Upload a document
router.post("/upload", authenticate, upload.single("file"), (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const fileUrl = "/api/files/" + req.file.filename;
    res.json({ url: fileUrl, filename: req.file.originalname, size: req.file.size });
  } catch (err) { console.error("Upload:", err); res.status(500).json({ error: "Upload failed" }); }
});

// GET /api/files/:filename — Serve uploaded file
router.get("/:filename", (req: Request, res: Response) => {
  const filePath = path.join(uploadDir, req.params.filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.sendFile(filePath);
});

export default router;