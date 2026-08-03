/**
 * Server-derived stable operation identities (§12). These are the ONLY way idempotency keys
 * are minted — never ad hoc per request/tap. Retries of the same business operation reuse
 * the same key; a definitive decline advances the attempt generation.
 */

export const operationId = {
  authorize: (contributionSlotId: string, attemptGeneration: number): string =>
    `authorize:v1:${contributionSlotId}:${attemptGeneration}`,

  capture: (contributionSlotId: string, captureGeneration: number): string =>
    `capture:v1:${contributionSlotId}:${captureGeneration}`,

  refund: (refundId: string): string => `refund:v1:${refundId}`,

  issueCard: (vinkId: string): string => `issue-card:v1:${vinkId}`,
} as const;

export type OperationScope = keyof typeof operationId;
