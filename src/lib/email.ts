import { env } from "../config/env";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

async function getAccessToken(): Promise<string> {
  const url = "https://login.microsoftonline.com/" + env.MS_TENANT_ID + "/oauth2/v2.0/token";
  const body = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    client_secret: env.MS_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
  if (!res.ok) { const err = await res.text(); throw new Error("Failed to get Microsoft access token: " + err); }
  const data = await res.json();
  return data.access_token;
}

export async function sendEmail({ to, subject, html }: EmailOptions): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch("https://graph.microsoft.com/v1.0/users/" + env.MS_SENDER_EMAIL + "/sendMail", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: false }),
  });
  if (!res.ok) { const err = await res.text(); console.error("Email send failed:", err); throw new Error("Failed to send email"); }
}

export function passwordResetEmail(firstName: string, resetUrl: string): string {
  return emailWrapper(
    '<p style="color:#333;font-size:15px">Hi ' + firstName + ',</p>' +
    '<p style="color:#555;font-size:14px;line-height:1.6">We received a request to reset your password. Click the button below to create a new password. This link expires in 1 hour.</p>' +
    '<div style="text-align:center;margin:28px 0">' +
    '<a href="' + resetUrl + '" style="background:#0B1F3F;color:white;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">Reset Password</a>' +
    '</div>' +
    '<p style="color:#888;font-size:12px;line-height:1.5">If you didn\'t request this, you can safely ignore this email.</p>'
  );
}

export function announcementEmailHtml(studentName: string, authorName: string, courseName: string, title: string, content: string): string {
  return emailWrapper(
    '<p style="color:#333;font-size:15px">Hi ' + studentName + ',</p>' +
    '<p style="color:#555;font-size:14px;line-height:1.6">A new announcement has been posted for <strong>' + courseName + '</strong>.</p>' +
    '<div style="background:#f8f9fa;border-left:4px solid #0E7C86;border-radius:4px;padding:16px 20px;margin:20px 0">' +
    '<div style="font-size:16px;font-weight:600;color:#0B1F3F;margin-bottom:8px">' + title + '</div>' +
    '<div style="font-size:14px;color:#555;line-height:1.6">' + content + '</div>' +
    '<div style="font-size:12px;color:#999;margin-top:12px">— ' + authorName + '</div>' +
    '</div>' +
    '<div style="text-align:center;margin:24px 0">' +
    '<a href="' + env.CLIENT_URL + '/dashboard" style="background:#0B1F3F;color:white;padding:10px 28px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Go to Dashboard</a>' +
    '</div>'
  );
}

export function messageNotificationEmail(recipientName: string, senderName: string, subject: string, preview: string): string {
  return emailWrapper(
    '<p style="color:#333;font-size:15px">Hi ' + recipientName + ',</p>' +
    '<p style="color:#555;font-size:14px;line-height:1.6">You have a new message from <strong>' + senderName + '</strong>.</p>' +
    '<div style="background:#f8f9fa;border-left:4px solid #0E7C86;border-radius:4px;padding:16px 20px;margin:20px 0">' +
    '<div style="font-size:15px;font-weight:600;color:#0B1F3F;margin-bottom:6px">' + subject + '</div>' +
    '<div style="font-size:14px;color:#555;line-height:1.5">' + preview.slice(0, 200) + (preview.length > 200 ? "..." : "") + '</div>' +
    '</div>' +
    '<div style="text-align:center;margin:24px 0">' +
    '<a href="' + env.CLIENT_URL + '/messages" style="background:#0B1F3F;color:white;padding:10px 28px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">View Message</a>' +
    '</div>'
  );
}

function emailWrapper(body: string): string {
  return '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;background:#f7f7f7">' +
    '<div style="max-width:520px;margin:0 auto;background:white;border-radius:8px;padding:32px;border:1px solid #e5e5e5">' +
    '<div style="text-align:center;margin-bottom:24px"><strong style="font-size:18px;color:#0B1F3F">GoGMI Learning Platform</strong></div>' +
    body +
    '<hr style="border:none;border-top:1px solid #eee;margin:24px 0">' +
    '<p style="color:#aaa;font-size:11px;text-align:center">Gulf of Guinea Maritime Institute (GoGMI)<br>info@gogmi.org.gh</p>' +
    '</div></body></html>';
}