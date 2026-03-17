/**
 * POST /api/auth/request-otp
 *
 * Accepts { email } and sends a 6-digit OTP code via Mailgun.
 * Rate limited: 1 OTP per email per 60 seconds.
 */

import { generateOtp, generateId } from "../../lib/auth";
import type { Env, OtpRecord, RequestOtpBody } from "../../lib/types";
import { jsonResponse, errorResponse } from "../../lib/types";
import { sendOtpEmail } from "../../lib/email";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  let body: RequestOtpBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return errorResponse("Valid email is required", 400);
  }

  // Rate limit: check for recent OTP
  const recent = await env.DB.prepare(
    "SELECT * FROM otp_codes WHERE email = ? AND used = 0 AND created_at > datetime('now', '-60 seconds') ORDER BY created_at DESC LIMIT 1",
  )
    .bind(email)
    .first<OtpRecord>();

  if (recent) {
    return errorResponse(
      "Please wait 60 seconds before requesting another code",
      429,
    );
  }

  // Clean up expired OTPs (prevent table bloat)
  await env.DB.prepare(
    "DELETE FROM otp_codes WHERE expires_at < datetime('now', '-1 hour')",
  ).run();

  // Generate OTP
  const code = generateOtp();
  const id = generateId();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min expiry

  // Store OTP
  await env.DB.prepare(
    "INSERT INTO otp_codes (id, email, code, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, email, code, expiresAt)
    .run();

  // Send email via Mailgun
  try {
    await sendOtpEmail(email, code, env);
  } catch (err) {
    console.error("Failed to send OTP email:", err);
    return errorResponse("Failed to send verification email", 500);
  }

  return jsonResponse({ success: true, message: "Verification code sent" });
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
