import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '@/lib/security/crypto';

describe('Security & Cryptography: AES-256-GCM Token Encryption', () => {
  const validKey =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const alternativeKey =
    'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

  it('successfully encrypts and decrypts OAuth tokens round-trip', () => {
    const rawToken = 'BQCX9412...spotify_refresh_token_xyz_123456';
    const encrypted = encryptSecret(rawToken, validKey);

    expect(encrypted).not.toContain(rawToken);
    expect(encrypted.split(':')).toHaveLength(3);

    const decrypted = decryptSecret(encrypted, validKey);
    expect(decrypted).toBe(rawToken);
  });

  it('produces unique ciphertexts and IVs for identical plaintext', () => {
    const rawToken = 'consistent_refresh_token';
    const enc1 = encryptSecret(rawToken, validKey);
    const enc2 = encryptSecret(rawToken, validKey);

    expect(enc1).not.toBe(enc2);
    expect(enc1.split(':')[0]).not.toBe(enc2.split(':')[0]); // Unique IV

    expect(decryptSecret(enc1, validKey)).toBe(rawToken);
    expect(decryptSecret(enc2, validKey)).toBe(rawToken);
  });

  it('rejects decryption with the wrong encryption key', () => {
    const rawToken = 'confidential_access_token';
    const encrypted = encryptSecret(rawToken, validKey);

    expect(() => decryptSecret(encrypted, alternativeKey)).toThrow(
      /Decryption failed/i,
    );
  });

  it('detects tampering with ciphertext and fails integrity verification', () => {
    const rawToken = 'tamper_proof_token';
    const encrypted = encryptSecret(rawToken, validKey);
    const [iv, tag, ciphertext] = encrypted.split(':');

    // Flip a character in ciphertext
    const tamperedCiphertext =
      ciphertext.slice(0, -2) + (ciphertext.endsWith('0') ? '1' : '0');
    const tamperedPayload = `${iv}:${tag}:${tamperedCiphertext}`;

    expect(() => decryptSecret(tamperedPayload, validKey)).toThrow(
      /Decryption failed/i,
    );
  });

  it('detects tampering with authentication tag and fails integrity verification', () => {
    const rawToken = 'tamper_proof_token';
    const encrypted = encryptSecret(rawToken, validKey);
    const [iv, tag, ciphertext] = encrypted.split(':');

    // Flip a character in auth tag while preserving 16 bytes (32 hex characters)
    const tamperedTag = tag.slice(0, -1) + (tag.endsWith('0') ? '1' : '0');
    const tamperedPayload = `${iv}:${tamperedTag}:${ciphertext}`;

    expect(() => decryptSecret(tamperedPayload, validKey)).toThrow(
      /Decryption failed/i,
    );
  });

  it('rejects malformed keys that are not 32 bytes (64 hex chars)', () => {
    expect(() => encryptSecret('token', 'too_short_key')).toThrow(
      /exactly 32 bytes/i,
    );
    expect(() => encryptSecret('token', '')).toThrow(/non-empty string/i);
  });

  it('rejects invalid payload format', () => {
    expect(() => decryptSecret('invalid_no_colons', validKey)).toThrow(
      /Invalid encrypted payload format/i,
    );
  });
});
