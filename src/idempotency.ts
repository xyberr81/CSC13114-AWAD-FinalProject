import { createHash } from 'node:crypto';

/** 1–255 characters, each from `!` to `~` (contract §4.1). */
export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7E]{1,255}$/.test(value);
}

/**
 * Fingerprint of what a submission request asks for. Built from the parsed values, so key order,
 * whitespace and unknown fields in the JSON body do not change it.
 */
export function submissionFingerprint(labId: number, language: string, code: string): string {
  return createHash('sha256')
    .update(JSON.stringify([labId, language, code]))
    .digest('hex');
}
