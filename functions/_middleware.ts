/**
 * Global middleware for Cloudflare Pages Functions
 *
 * Handles:
 * - CORS headers for API routes
 * - JWT session extraction (sets data.user on context)
 */

import { verifyToken, extractToken } from "./lib/auth";
import type { Env, UserRecord } from "./lib/types";

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;
  const url = new URL(request.url);

  // Only apply to /api/ routes
  if (!url.pathname.startsWith("/api/")) {
    return context.next();
  }

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }

  // Extract and verify JWT if present
  const token = extractToken(request);
  if (token && context.env.JWT_SECRET) {
    const payload = await verifyToken(token, context.env.JWT_SECRET);
    if (payload) {
      // Look up user from DB
      const user = await context.env.DB.prepare(
        "SELECT * FROM users WHERE id = ?"
      )
        .bind(payload.sub)
        .first<UserRecord>();
      context.data.user = user || null;
    }
  }

  // Continue to the actual handler
  const response = await context.next();

  // Add CORS headers to response
  const headers = corsHeaders(request);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  return response;
};

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  const ALLOWED_ORIGINS = [
    "https://notator.online",
    "https://www.notator.online",
    "http://localhost:3000",
    "http://localhost:8788", // wrangler pages dev
  ];
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

