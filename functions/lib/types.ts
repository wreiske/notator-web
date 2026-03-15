/**
 * Cloudflare environment bindings and shared API types
 */

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  MAILGUN_API_KEY: string;
  MAILGUN_DOMAIN: string;
  JWT_SECRET: string;
}

// Extend the PagesFunction context
export interface AppContext {
  env: Env;
  user?: UserRecord | null;
}

// ─── Database Records ───

export interface UserRecord {
  id: string;
  email: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface OtpRecord {
  id: string;
  email: string;
  code: string;
  expires_at: string;
  used: number;
  attempts: number;
  created_at: string;
}

export interface SongRecord {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  year: string | null;
  tags: string | null;
  r2_key: string;
  file_size: number | null;
  is_public: number;
  version: number;
  parent_song_id: string | null;
  play_count: number;
  created_at: string;
  updated_at: string;
}

export interface UserFileRecord {
  id: string;
  user_id: string;
  filename: string;
  folder: string;
  r2_key: string;
  file_size: number | null;
  is_shared: number;
  share_token: string | null;
  created_at: string;
}

export interface CommentRecord {
  id: string;
  song_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

export interface LikeRecord {
  song_id: string;
  user_id: string;
  created_at: string;
}

export interface RatingRecord {
  song_id: string;
  user_id: string;
  score: number;
  created_at: string;
}

// ─── API Request/Response Types ───

export interface RequestOtpBody {
  email: string;
}

export interface VerifyOtpBody {
  email: string;
  code: string;
}

export interface AuthResponse {
  token: string;
  user: UserRecord;
}

export interface PublishSongBody {
  title: string;
  description?: string;
  year?: string;
  tags?: string[];
  isPublic?: boolean;
  parentSongId?: string;
}

export interface UpdateProfileBody {
  display_name?: string;
  bio?: string;
}

// ─── API Helpers ───

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}
