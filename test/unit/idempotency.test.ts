import { describe, expect, it } from 'vitest';
import { isValidIdempotencyKey, submissionFingerprint } from '../../src/idempotency.js';

describe('isValidIdempotencyKey()', () => {
  it('accepts 1 to 255 characters from ! to ~', () => {
    expect(isValidIdempotencyKey('a')).toBe(true);
    expect(isValidIdempotencyKey('5f0c8a3e-2b1d-4c47-9e0a-6a1f2b3c4d5e')).toBe(true);
    expect(isValidIdempotencyKey('!~'.repeat(127) + '!')).toBe(true);
  });

  it('rejects missing, empty, too long, spaces, control and non-ASCII characters', () => {
    for (const k of [undefined, '', 'k'.repeat(256), 'a b', 'a\tb', 'clé', 'ключ', ['a']]) {
      expect(isValidIdempotencyKey(k), JSON.stringify(k)).toBe(false);
    }
  });
});

describe('submissionFingerprint()', () => {
  it('is the same for the same lab, language and code', () => {
    expect(submissionFingerprint(7, 'cpp', 'int main(){}')).toBe(
      submissionFingerprint(7, 'cpp', 'int main(){}'),
    );
  });

  it('differs when the lab or the code differs', () => {
    const base = submissionFingerprint(7, 'cpp', 'int main(){}');
    expect(submissionFingerprint(8, 'cpp', 'int main(){}')).not.toBe(base);
    expect(submissionFingerprint(7, 'cpp', 'int main(){ }')).not.toBe(base);
  });

  it('cannot be confused by moving characters between fields', () => {
    expect(submissionFingerprint(7, 'cp', 'pint main(){}')).not.toBe(
      submissionFingerprint(7, 'cpp', 'int main(){}'),
    );
  });
});
