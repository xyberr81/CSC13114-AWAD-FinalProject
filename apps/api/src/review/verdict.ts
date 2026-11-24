// The values of a verdict, shared by the parts of a review.

// Same values, in the same order, as the enums in db/schema.ts (a unit test compares them).
export const VERDICT_VALUES = ['pass', 'violation', 'unsure'] as const;
export const VERDICT_SOURCES = ['hard_rule', 'model'] as const;
export const UNSURE_REASONS = [
  'model_unsure',
  'bad_schema',
  'evidence_mismatch',
  'timeout',
  'cost_limit',
  'model_off',
] as const;

export type VerdictValue = (typeof VERDICT_VALUES)[number];
export type VerdictSource = (typeof VERDICT_SOURCES)[number];
export type UnsureReason = (typeof UNSURE_REASONS)[number];

/** `line` is 1-based and `text` is that line of the original, uncut source. */
export interface Evidence {
  line: number;
  text: string;
}
