/**
 * Community stats API (public)
 *
 * GET /api/stats — returns aggregate community statistics
 */

import type { Env } from "../lib/types";
import { jsonResponse } from "../lib/types";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;

  const stats = await env.DB.prepare(
    `
    SELECT
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM songs WHERE is_public = 1) as total_songs,
      (SELECT COALESCE(SUM(play_count), 0) FROM songs WHERE is_public = 1) as total_plays,
      (SELECT COUNT(*) FROM comments) as total_comments
  `,
  ).first<{
    total_users: number;
    total_songs: number;
    total_plays: number;
    total_comments: number;
  }>();

  return jsonResponse({
    users: stats?.total_users || 0,
    songs: stats?.total_songs || 0,
    plays: stats?.total_plays || 0,
    comments: stats?.total_comments || 0,
  });
};
