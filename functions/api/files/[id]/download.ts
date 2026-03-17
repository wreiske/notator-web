/**
 * File download API (auth required — owner only)
 *
 * GET /api/files/:id/download — serve file binary from R2
 */

import type { Env, UserRecord, UserFileRecord } from "../../../lib/types";
import { errorResponse } from "../../../lib/types";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const user = context.data.user as UserRecord | null;
  const fileId = params.id as string;

  if (!user) {
    return errorResponse("Authentication required", 401);
  }

  const file = await env.DB.prepare(
    "SELECT * FROM user_files WHERE id = ? AND user_id = ?",
  )
    .bind(fileId, user.id)
    .first<UserFileRecord>();

  if (!file) {
    return errorResponse("File not found", 404);
  }

  const object = await env.R2.get(file.r2_key);
  if (!object) {
    return errorResponse("File not found in storage", 404);
  }

  const safeFilename = file.filename.replace(/["\r\n\x00-\x1f]/g, "_");

  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Content-Length": String(object.size),
    },
  });
};
