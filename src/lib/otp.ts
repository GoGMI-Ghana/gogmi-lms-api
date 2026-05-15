import crypto from "crypto";

interface OtpEntry {
  code: string;
  email: string;
  userId: string;
  courseId: string;
  certificateId: string;
  registrantName: string;
  registrantEmail: string;
  expiresAt: number;
}

// In-memory OTP store. In production with multiple servers, use Redis.
const otpStore = new Map<string, OtpEntry>();

// Clean expired OTPs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of otpStore) {
    if (entry.expiresAt < now) otpStore.delete(key);
  }
}, 5 * 60 * 1000);

/**
 * Generate a 6-digit OTP and store it with context.
 * Returns the OTP code and a verification key.
 */
export function generateOtp(data: {
  email: string;
  userId: string;
  courseId: string;
  certificateId: string;
  registrantName: string;
  registrantEmail: string;
}): { code: string; verificationKey: string } {
  const code = crypto.randomInt(100000, 999999).toString();
  const verificationKey = crypto.randomBytes(32).toString("hex");

  otpStore.set(verificationKey, {
    code,
    email: data.email,
    userId: data.userId,
    courseId: data.courseId,
    certificateId: data.certificateId,
    registrantName: data.registrantName,
    registrantEmail: data.registrantEmail,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });

  return { code, verificationKey };
}

/**
 * Verify an OTP code against the verification key.
 * Returns the stored data if valid, null otherwise.
 * OTP is single-use — deleted after successful verification.
 */
export function verifyOtp(
  verificationKey: string,
  code: string
): OtpEntry | null {
  const entry = otpStore.get(verificationKey);

  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    otpStore.delete(verificationKey);
    return null;
  }
  if (entry.code !== code) return null;

  // Single-use: delete after successful verification
  otpStore.delete(verificationKey);
  return entry;
}

export function otpEmailHtml(firstName: string, code: string): string {
  return '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;background:#f7f7f7">' +
    '<div style="max-width:480px;margin:0 auto;background:white;border-radius:8px;padding:32px;border:1px solid #e5e5e5">' +
    '<div style="text-align:center;margin-bottom:24px"><strong style="font-size:18px;color:#0B1F3F">GoGMI Learning Platform</strong></div>' +
    '<p style="color:#333;font-size:15px">Hi ' + firstName + ',</p>' +
    '<p style="color:#555;font-size:14px;line-height:1.6">Use the code below to complete your course enrollment. This code expires in 10 minutes.</p>' +
    '<div style="text-align:center;margin:28px 0">' +
    '<div style="display:inline-block;background:#f0f4f8;border:2px solid #0B1F3F;border-radius:8px;padding:16px 40px;letter-spacing:8px;font-size:32px;font-weight:bold;color:#0B1F3F">' + code + '</div>' +
    '</div>' +
    '<p style="color:#888;font-size:12px;line-height:1.5">If you didn\'t request this, please ignore this email or contact support.</p>' +
    '<hr style="border:none;border-top:1px solid #eee;margin:24px 0">' +
    '<p style="color:#aaa;font-size:11px;text-align:center">Gulf of Guinea Maritime Institute (GoGMI)<br>info@gogmi.org.gh</p>' +
    '</div></body></html>';
}