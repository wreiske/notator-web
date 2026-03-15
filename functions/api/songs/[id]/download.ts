/**
 * Song download endpoint
 *
 * GET /api/songs/:id/download — stream .SON file from R2
 */

import type { Env, SongRecord } from "../../../lib/types";
import { errorResponse } from "../../../lib/types";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const songId = params.id as string;

  const song = await env.DB.prepare(
    "SELECT * FROM songs WHERE id = ? AND is_public = 1"
  )
    .bind(songId)
    .first<SongRecord>();

  if (!song) {
    return errorResponse("Song not found", 404);
  }

  const object = await env.R2.get(song.r2_key);
  if (!object) {
    return errorResponse("File not found in storage", 404);
  }

  // Extract original filename from R2 key and sanitize for headers
  const rawFilename = song.r2_key.split("/").pop() || "download.son";
  const filename = rawFilename.replace(/["\r\n\x00-\x1f]/g, "_");

  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(object.size),
    },
  });
};
