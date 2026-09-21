-- Host-owned admission control; social domain tables stay provider-owned.
CREATE TABLE abuse_windows (
  started_at INTEGER PRIMARY KEY NOT NULL,
  secret TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE abuse_counters (
  window_start INTEGER NOT NULL REFERENCES abuse_windows(started_at) ON DELETE CASCADE,
  bucket TEXT NOT NULL,
  hits INTEGER NOT NULL CHECK (hits > 0),
  PRIMARY KEY (window_start, bucket)
);

-- Runs on INSERT attempts, including UPSERTs, so active traffic reaps old
-- windows and their counters. An idle database is cleaned on its next request.
CREATE TRIGGER abuse_windows_prune
BEFORE INSERT ON abuse_windows
BEGIN
  DELETE FROM abuse_windows WHERE expires_at <= NEW.started_at;
END;
