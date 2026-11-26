import crypto from 'node:crypto';

/** Hex-encoded SHA-256 of the given content (the repo-wide raw-ingest content hash). */
export function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
