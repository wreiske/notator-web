-- Notator Community Platform — Initial Schema
-- Run: wrangler d1 execute notator-db --file=./migrations/0001_initial.sql

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- OTP codes for email authentication
CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Published songs (shared with community)
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  year TEXT,
  tags TEXT,                    -- JSON array of tags
  r2_key TEXT NOT NULL,         -- R2 object key for .SON file
  file_size INTEGER,
  is_public INTEGER DEFAULT 1,
  version INTEGER DEFAULT 1,
  parent_song_id TEXT REFERENCES songs(id),
  play_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- User files (private drive)
CREATE TABLE IF NOT EXISTS user_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  folder TEXT DEFAULT '/',
  r2_key TEXT NOT NULL,
  file_size INTEGER,
  is_shared INTEGER DEFAULT 0,
  share_token TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Comments on published songs
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Likes (toggle)
CREATE TABLE IF NOT EXISTS likes (
  song_id TEXT NOT NULL REFERENCES songs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (song_id, user_id)
);

-- Ratings (1-5 stars)
CREATE TABLE IF NOT EXISTS ratings (
  song_id TEXT NOT NULL REFERENCES songs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  score INTEGER NOT NULL CHECK(score >= 1 AND score <= 5),
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (song_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_songs_user_id ON songs(user_id);
CREATE INDEX IF NOT EXISTS idx_songs_is_public ON songs(is_public);
CREATE INDEX IF NOT EXISTS idx_songs_created_at ON songs(created_at);
CREATE INDEX IF NOT EXISTS idx_user_files_user_id ON user_files(user_id);
CREATE INDEX IF NOT EXISTS idx_user_files_share_token ON user_files(share_token);
CREATE INDEX IF NOT EXISTS idx_comments_song_id ON comments(song_id);
CREATE INDEX IF NOT EXISTS idx_likes_song_id ON likes(song_id);
CREATE INDEX IF NOT EXISTS idx_ratings_song_id ON ratings(song_id);
CREATE INDEX IF NOT EXISTS idx_otp_codes_email ON otp_codes(email);
