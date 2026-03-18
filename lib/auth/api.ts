/**
 * API client for Notator backend
 *
 * Handles JWT token management and provides typed fetch wrappers.
 */

const API_BASE = (() => {
  if (typeof window === "undefined") return "/api";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const electronAPI = (window as any).electronAPI;
  return electronAPI?.isElectron ? "https://notator.online/api" : "/api";
})();
const TOKEN_KEY = "notator_token";

// ─── Token Management ───

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ─── Fetch Wrapper ───

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Don't set Content-Type for FormData (browser sets it with boundary)
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      (data as { error?: string }).error ||
        `Request failed: ${response.status}`,
      response.status,
    );
  }

  return response.json();
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Auth API ───

export async function requestOtp(email: string) {
  return apiFetch<{ success: boolean; message: string }>("/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function verifyOtp(email: string, code: string) {
  return apiFetch<{
    token: string;
    user: UserPublic;
  }>("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export async function getSession() {
  return apiFetch<{ user: UserPublic }>("/auth/session");
}

// ─── User API ───

export async function getUserProfile(userId: string) {
  return apiFetch<{
    user: UserPublic;
    songs: SongPublic[];
    stats: { songCount: number; totalPlays: number };
  }>(`/users/${userId}`);
}

export async function updateProfile(
  userId: string,
  data: { display_name?: string; bio?: string },
) {
  return apiFetch<{ user: UserPublic }>(`/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ─── Songs API ───

export async function listSongs(params?: {
  page?: number;
  limit?: number;
  sort?: string;
  tag?: string;
  q?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.sort) searchParams.set("sort", params.sort);
  if (params?.tag) searchParams.set("tag", params.tag);
  if (params?.q) searchParams.set("q", params.q);

  return apiFetch<{
    songs: SongPublic[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }>(`/songs?${searchParams.toString()}`);
}

export async function getSong(songId: string) {
  return apiFetch<{
    song: SongPublic;
    userLiked: boolean;
    userRating: number;
  }>(`/songs/${songId}`);
}

export async function publishSong(
  file: File,
  metadata: {
    title: string;
    description?: string;
    year?: string;
    tags?: string[];
    isPublic?: boolean;
    parentSongId?: string;
  },
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("metadata", JSON.stringify(metadata));

  return apiFetch<{ song: SongPublic }>("/songs", {
    method: "POST",
    body: formData,
  });
}

export async function updateSong(
  songId: string,
  data: Partial<{
    title: string;
    description: string;
    year: string;
    tags: string[];
    isPublic: boolean;
  }>,
) {
  return apiFetch<{ song: SongPublic }>(`/songs/${songId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteSong(songId: string) {
  return apiFetch<{ success: boolean }>(`/songs/${songId}`, {
    method: "DELETE",
  });
}

// ─── Comments API ───

export async function getComments(songId: string) {
  return apiFetch<{ comments: CommentPublic[] }>(`/songs/${songId}/comments`);
}

export async function addComment(songId: string, body: string) {
  return apiFetch<{ comment: CommentPublic }>(`/songs/${songId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

// ─── Likes API ───

export async function toggleLike(songId: string) {
  return apiFetch<{ liked: boolean; likeCount: number }>(
    `/songs/${songId}/like`,
    { method: "POST" },
  );
}

// ─── Ratings API ───

export async function rateSong(songId: string, score: number) {
  return apiFetch<{
    userRating: number;
    avgRating: number;
    ratingCount: number;
  }>(`/songs/${songId}/rate`, {
    method: "POST",
    body: JSON.stringify({ score }),
  });
}

// ─── Files API ───

export async function listFiles(folder?: string) {
  const params = folder ? `?folder=${encodeURIComponent(folder)}` : "";
  return apiFetch<{ files: FileRecord[]; folders: string[] }>(
    `/files${params}`,
  );
}

export async function uploadFile(file: File, folder?: string) {
  const formData = new FormData();
  formData.append("file", file);
  if (folder) formData.append("folder", folder);

  return apiFetch<{ file: FileRecord }>("/files", {
    method: "POST",
    body: formData,
  });
}

export async function deleteFile(fileId: string) {
  return apiFetch<{ success: boolean }>(`/files?id=${fileId}`, {
    method: "DELETE",
  });
}

export async function toggleFileShare(fileId: string) {
  return apiFetch<{
    shared: boolean;
    shareUrl?: string;
    token?: string;
  }>(`/files/${fileId}/share`, { method: "POST" });
}

export function uploadFileWithProgress(
  file: File,
  folder: string | undefined,
  onProgress: (loaded: number, total: number) => void,
): Promise<{ file: FileRecord }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);
    if (folder) formData.append("folder", folder);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded, e.total);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Invalid response"));
        }
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          reject(
            new ApiError(
              data.error || `Upload failed: ${xhr.status}`,
              xhr.status,
            ),
          );
        } catch {
          reject(new ApiError(`Upload failed: ${xhr.status}`, xhr.status));
        }
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.open("POST", `${API_BASE}/files`);
    const token = getToken();
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }
    xhr.send(formData);
  });
}

export async function downloadUserFile(
  fileId: string,
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}/files/${fileId}/download`, {
    headers,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      (data as { error?: string }).error ||
        `Download failed: ${response.status}`,
      response.status,
    );
  }

  // Extract filename from Content-Disposition
  let filename = "file.son";
  const disposition = response.headers.get("Content-Disposition");
  if (disposition) {
    const match = disposition.match(/filename="?([^";\n]+)"?/);
    if (match) filename = match[1];
  }

  const buffer = await response.arrayBuffer();
  return { buffer, filename };
}

// ─── Stats API ───

export async function getCommunityStats() {
  return apiFetch<{
    users: number;
    songs: number;
    plays: number;
    comments: number;
  }>("/stats");
}

// ─── Public Types ───

export interface UserPublic {
  id: string;
  email?: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface SongPublic {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  year: string | null;
  tags: string | null;
  file_size: number | null;
  is_public: number;
  version: number;
  parent_song_id: string | null;
  play_count: number;
  created_at: string;
  updated_at: string;
  // Joined fields
  author_name?: string;
  author_avatar?: string;
  avg_rating?: number;
  rating_count?: number;
  like_count?: number;
}

export interface CommentPublic {
  id: string;
  song_id: string;
  user_id: string;
  body: string;
  created_at: string;
  author_name?: string;
  author_avatar?: string;
}

export interface FileRecord {
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
