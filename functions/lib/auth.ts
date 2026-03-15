/**
 * JWT authentication utilities for Cloudflare Workers (edge-compatible)
 *
 * Uses Web Crypto API (no Node.js dependencies) for HMAC-SHA256 JWT signing.
 */

import type { UserRecord } from "./types";

interface JwtPayload {
  sub: string; // user id
  email: string;
  iat: number;
  exp: number;
}

const ALGORITHM = { name: "HMAC", hash: "SHA-256" };
const TOKEN_EXPIRY = 30 * 24 * 60 * 60; // 30 days in seconds

// ─── Encoding helpers ───

function base64UrlEncode(data: Uint8Array): string {
  const str = btoa(String.fromCharCode(...data));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function textToUint8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ─── Key management ───

async function getSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textToUint8(secret),
    ALGORITHM,
    false,
    ["sign", "verify"]
  );
}

// ─── JWT Creation ───

export async function createToken(
  user: UserRecord,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    iat: now,
    exp: now + TOKEN_EXPIRY,
  };

  const headerB64 = base64UrlEncode(
    textToUint8(JSON.stringify(header))
  );
  const payloadB64 = base64UrlEncode(
    textToUint8(JSON.stringify(payload))
  );
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textToUint8(signingInput)
  );

  const signatureB64 = base64UrlEncode(new Uint8Array(signature));
  return `${signingInput}.${signatureB64}`;
}

// ─── JWT Verification ───

export async function verifyToken(
  token: string,
  secret: string
): Promise<JwtPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;

    const key = await getSigningKey(secret);
    const signature = base64UrlDecode(signatureB64);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      textToUint8(signingInput)
    );

    if (!valid) return null;

    const payload: JwtPayload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadB64))
    );

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

// ─── Helpers ───

export function extractToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}

export function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, "0");
}

export function generateId(): string {
  return crypto.randomUUID();
}
