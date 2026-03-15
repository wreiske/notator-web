/**
 * POST /api/auth/verify-otp
 *
 * Accepts { email, code }. Verifies the OTP, creates user if needed,
 * and returns a JWT session token.
 */

import { createToken, generateId } from "../../lib/auth";
import type { Env, OtpRecord, UserRecord, VerifyOtpBody } from "../../lib/types";
import { jsonResponse, errorResponse } from "../../lib/types";

const MAX_ATTEMPTS = 5;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  let body: VerifyOtpBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const email = body.email?.trim().toLowerCase();
  const code = body.code?.trim();

  if (!email || !code) {
    return errorResponse("Email and code are required", 400);
  }

  // Find the latest unused, unexpired OTP for this email
  const otp = await env.DB.prepare(
    "SELECT * FROM otp_codes WHERE email = ? AND used = 0 AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1"
  )
    .bind(email)
    .first<OtpRecord>();

  if (!otp) {
    return errorResponse("No valid verification code found. Please request a new one.", 400);
  }

  // Check attempts
  if (otp.attempts >= MAX_ATTEMPTS) {
    // Mark as used to prevent further attempts
    await env.DB.prepare("UPDATE otp_codes SET used = 1 WHERE id = ?")
      .bind(otp.id)
      .run();
    return errorResponse("Too many attempts. Please request a new code.", 429);
  }

  // Increment attempt counter
  await env.DB.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?")
    .bind(otp.id)
    .run();

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(otp.code, code)) {
    const remaining = MAX_ATTEMPTS - otp.attempts - 1;
    return errorResponse(
      `Invalid code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`,
      400
    );
  }

  // Mark OTP as used
  await env.DB.prepare("UPDATE otp_codes SET used = 1 WHERE id = ?")
    .bind(otp.id)
    .run();

  // Find or create user
  let user = await env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(email)
    .first<UserRecord>();

  if (!user) {
    const userId = generateId();
    const displayName = email.split("@")[0]; // Default display name from email prefix
    await env.DB.prepare(
      "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)"
    )
      .bind(userId, email, displayName)
      .run();

    user = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
      .bind(userId)
      .first<UserRecord>();
  }

  if (!user) {
    return errorResponse("Failed to create user account", 500);
  }

  // Create JWT
  const token = await createToken(user, env.JWT_SECRET);

  return jsonResponse({
    token,
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      bio: user.bio,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
    },
  });
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
