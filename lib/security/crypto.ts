import crypto from 'node:crypto';

/**
 * Server-side authenticated encryption using AES-256-GCM.
 * Protects sensitive OAuth tokens at rest before database persistence.
 * Format: `<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96 bits recommended for AES-GCM
const KEY_LENGTH_BYTES = 32; // 256 bits

function parseKey(secretKeyHex: string): Buffer {
  if (!secretKeyHex || typeof secretKeyHex !== 'string') {
    throw new Error('Encryption secret key must be a non-empty string.');
  }

  const trimmed = secretKeyHex.trim();
  const buffer = Buffer.from(trimmed, 'hex');

  if (buffer.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `Encryption secret key must be exactly ${KEY_LENGTH_BYTES} bytes (${KEY_LENGTH_BYTES * 2} hex characters). Received ${buffer.length} bytes.`,
    );
  }

  return buffer;
}

/**
 * Encrypts plaintext using AES-256-GCM with a randomized IV and authentication tag.
 */
export function encryptSecret(plaintext: string, secretKeyHex: string): string {
  if (typeof plaintext !== 'string') {
    throw new Error('Plaintext to encrypt must be a string.');
  }

  const key = parseKey(secretKeyHex);
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts an AES-256-GCM payload and verifies the integrity authentication tag.
 * Throws if the payload has been tampered with or if the key is incorrect.
 */
export function decryptSecret(
  encryptedPayload: string,
  secretKeyHex: string,
): string {
  if (!encryptedPayload || typeof encryptedPayload !== 'string') {
    throw new Error('Encrypted payload must be a non-empty string.');
  }

  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error(
      'Invalid encrypted payload format. Expected <iv>:<auth_tag>:<ciphertext>.',
    );
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = parseKey(secretKeyHex);

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error(`Invalid IV length. Expected ${IV_LENGTH_BYTES} bytes.`);
  }

  if (authTag.length !== 16) {
    throw new Error('Invalid GCM auth tag length. Expected 16 bytes.');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (error) {
    throw new Error(
      `Decryption failed: integrity verification failed or key mismatch (${error instanceof Error ? error.message : 'tampered data'}).`,
    );
  }
}
