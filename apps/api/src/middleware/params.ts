/**
 * Shared Zod schemas for path parameters (ENG2 §2: every route boundary validates its own
 * input, not just request bodies). Every domain id (`VinkId`, `ParticipantId`,
 * `ContributionId`, `PurchaseAuthorizationId` — `packages/domain/src/ids.ts`) is a
 * `randomUUID()`-backed branded string, so `z.uuid()` is the correct validator for all of
 * them.
 *
 * `app.ts`'s global error handler already turns a thrown `ZodError` into a
 * `400 { error: 'VALIDATION_FAILED', issues: [...] }` response — the same handler request
 * bodies rely on (`schema.parse(request.body)` throughout the route modules). Route handlers
 * use these schemas the same way: `schema.parse(request.params)`, no separate reply-shaping
 * needed here.
 *
 * `publicCode` deliberately does NOT validate against `newPublicCode()`'s exact alphabet/
 * length (`packages/application/src/support/public-code.ts`): this param only ever reaches
 * the public, unauthenticated join surface, where every unknown code already replies 404.
 * A stricter 400-on-malformed-shape response would leak the valid code alphabet/length to
 * an anonymous caller probing the surface — worse for a code-guessing attack than today's
 * uniform "not found." The loose bound below still rejects the pathological cases (missing,
 * empty, absurdly long) without narrowing the "not found" signal.
 */

import { z } from 'zod';

export const vinkIdParams = z.object({ vinkId: z.uuid() });
export const vinkAndParticipantIdParams = z.object({
  vinkId: z.uuid(),
  participantId: z.uuid(),
});
export const vinkAndContributionIdParams = z.object({
  vinkId: z.uuid(),
  contributionId: z.uuid(),
});
export const contributionIdParams = z.object({ contributionId: z.uuid() });
export const authorizationIdParams = z.object({ authorizationId: z.uuid() });
export const webhookEventIdParams = z.object({ webhookEventId: z.uuid() });
export const findingIdParams = z.object({ findingId: z.uuid() });
export const publicCodeParams = z.object({
  publicCode: z.string().min(1).max(64),
});
