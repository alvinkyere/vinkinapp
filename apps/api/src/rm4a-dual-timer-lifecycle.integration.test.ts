/**
 * RM4A (D47) — the backend dual-timer lifecycle's own named tests, against real PostgreSQL:
 * the submission deadline is recomputed at open time (not anchored at DRAFT creation), join and
 * contribute fail closed on the deadline itself (not just on state, ahead of the next sweep
 * tick), the 10-minute card usage window's own sweep trigger tears a spent-nothing card down
 * back to the pool, and the refund auto-chain fires for both routes into FUNDING_REVERSAL —
 * the new card-window-expiry path this slice adds, and the pre-existing card-provisioning-
 * failure path (RM3B), which had the identical gap since before RM4A.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { runSweeps } from './jobs/sweeps.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';
import { DEFAULT_OPEN_DURATION_SECONDS } from '../../../packages/application/src/commands.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

describe('RM4A dual-timer lifecycle (PostgreSQL, D47)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let provider: MockFinancialProvider;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const stamp = Date.now();
  let userCounter = 0;

  before(async () => {
    db = await createIsolatedTestDb('rm4a');
    provider = new MockFinancialProvider();
    app = await buildApp({
      env: db.env,
      sql: db.sql,
      provider,
      checkDb: async () => {
        await db.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
  });

  after(async () => {
    await app.close();
    await db.drop();
  });

  async function registerAndLogin(): Promise<{ token: string; username: string }> {
    userCounter += 1;
    const username = `rm4a_${stamp}_${userCounter}`;
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username, displayName: username, password: 'integration-password-1' },
    });
    assert.equal(registered.statusCode, 201);
    return { token: registered.json().accessToken as string, username };
  }

  async function seedPoolCard(): Promise<void> {
    const { providerCardholderId } = await provider.createCardholder({
      idempotencyKey: `cardholder:it:${randomUUID()}`,
      externalAccountId: 'vinkin-financial-account',
      legalName: 'VinkIn Inc',
    });
    const issued = await provider.issueTemporaryCard({
      idempotencyKey: `issue:it:${randomUUID()}`,
      providerCardholderId,
      spendLimit: { amountMinor: 100_000, currency: 'USD' },
      metadata: {},
    });
    await provider.disableCard(issued.providerCardId);
    await db.sql`INSERT INTO cards (id, provider_card_id, display_last_four, status)
      VALUES (${randomUUID()}, ${issued.providerCardId}, '4242', 'AVAILABLE')`;
  }

  it('DEADLINE RECOMPUTED AT OPEN, NOT ANCHORED AT CREATION: an explicit near-term deadline set at DRAFT creation is overwritten by the real 7-minute default once the Vink actually opens', async () => {
    const organizer = await registerAndLogin();
    const member = await registerAndLogin();
    const createdAt = Date.now();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${organizer.token}` },
      // A DRAFT-time deadline just 2 seconds out — if this survived to OPEN, the vink would
      // already be past its deadline by the time we check below.
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 4_000,
        tipMinor: 0,
        submissionDeadline: new Date(createdAt + 2_000).toISOString(),
        organizerDisplayName: 'Organizer',
      },
    });
    assert.equal(created.statusCode, 201);
    const vinkId = created.json().vink.id as string;
    const organizerPid = created.json().participants[0].id as string;
    const draftDeadline = new Date(created.json().vink.submissionDeadline).getTime();
    assert.ok(
      draftDeadline - createdAt < 5_000,
      'sanity: the DRAFT row genuinely stored the short, explicit creation-time deadline',
    );

    // openVinkCommand requires at least one MEMBER besides the organizer, and a full
    // allocation, before it will open — unrelated to deadline timing, just a precondition.
    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: { username: member.username },
    });
    const memberPid = added.json().id as string;
    const split = await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: {
        method: 'CUSTOM_AMOUNT',
        amounts: [
          { participantId: organizerPid, amountMinor: 0 },
          { participantId: memberPid, amountMinor: 4_000 },
        ],
      },
    });
    assert.equal(split.statusCode, 200);

    // Time passes in DRAFT (setup wizard, organizer reviewing) — deliberately past the
    // explicit 2s creation-time deadline, before ever opening.
    await new Promise((resolve) => setTimeout(resolve, 2_100));

    const openedAt = Date.now();
    const opened = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: {},
    });
    assert.equal(opened.statusCode, 200, 'opening succeeds — DRAFT has no deadline precondition');

    const openDeadline = new Date(opened.json().submissionDeadline).getTime();
    // The real, current deadline reflects OPEN time plus the real configured default — not
    // creation time, and nowhere near the stale 2-second DRAFT-time value.
    assert.ok(
      Math.abs(openDeadline - (openedAt + DEFAULT_OPEN_DURATION_SECONDS * 1000)) < 10_000,
      `expected the open-time-recomputed deadline near open+${DEFAULT_OPEN_DURATION_SECONDS}s, got ${opened.json().submissionDeadline}`,
    );
    assert.notEqual(
      openDeadline,
      draftDeadline,
      'the DRAFT-time explicit deadline did not survive to the opened row',
    );
  });

  it('JOIN AND CONTRIBUTE FAIL CLOSED ON THE DEADLINE ITSELF, ahead of the next sweep tick: both reject once the deadline has passed, even though the Vink row is still OPEN in the database', async () => {
    const organizer = await registerAndLogin();
    const memberA = await registerAndLogin();
    const memberB = await registerAndLogin();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 4_000,
        tipMinor: 0,
        organizerDisplayName: 'Organizer',
      },
    });
    const vinkId = created.json().vink.id as string;
    const organizerPid = created.json().participants[0].id as string;
    const addedA = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: { username: memberA.username },
    });
    const memberAPid = addedA.json().id as string;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: {
        method: 'CUSTOM_AMOUNT',
        amounts: [
          { participantId: organizerPid, amountMinor: 0 },
          { participantId: memberAPid, amountMinor: 4_000 },
        ],
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: {},
    });

    // Simulate the deadline having already passed, by direct SQL — no sweep has run yet, and
    // the Vink row is deliberately left at OPEN to prove these two entry points don't rely on
    // the sweep having already flipped state (Plan §10's own "sweeps are optimizations, not the
    // only enforcement" discipline, applied consistently here for the first time).
    await db.sql`UPDATE vinks SET submission_deadline = ${new Date(Date.now() - 5_000).toISOString()}
      WHERE id = ${vinkId}`;
    assert.equal((await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state, 'OPEN');

    const lateJoin = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: { username: memberB.username },
    });
    assert.ok(lateJoin.statusCode >= 400, 'a member-add past the real deadline is rejected');

    const lateContribute = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
      headers: { authorization: `Bearer ${memberA.token}` },
      payload: {},
    });
    assert.ok(
      lateContribute.statusCode >= 400,
      'a contribution past the real deadline is rejected',
    );

    // Still OPEN — neither rejection was a side effect of the sweep having run.
    assert.equal((await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state, 'OPEN');
  });

  it('CARD-WINDOW SWEEP: an unused CARD_READY card past its 10-minute usage window reverses the Vink to EXPIRED and genuinely returns the card to AVAILABLE in the pool', async () => {
    await seedPoolCard();
    const organizer = await registerAndLogin();
    const member = await registerAndLogin();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 6_000,
        tipMinor: 0,
        submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
        organizerDisplayName: 'Organizer',
      },
    });
    const vinkId = created.json().vink.id as string;
    const organizerPid = created.json().participants[0].id as string;
    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: { username: member.username },
    });
    const memberPid = added.json().id as string;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: {
        method: 'CUSTOM_AMOUNT',
        amounts: [
          { participantId: organizerPid, amountMinor: 0 },
          { participantId: memberPid, amountMinor: 6_000 },
        ],
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: {},
    });
    assert.equal((await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state, 'FUNDED');

    // The regular sweep provisions the pool card, landing CARD_READY — same auto-completing
    // mock-only sequence RM3B already relies on.
    const provisioned = await runSweeps(db.sql, provider);
    assert.ok(provisioned.cardsProvisioned >= 1);
    assert.equal(
      (await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state,
      'CARD_READY',
    );

    const cardRow = await db.sql`SELECT card_id FROM card_assignments WHERE vink_id = ${vinkId}`;
    const cardId = (cardRow[0] as { card_id: string }).card_id;
    // Force the card usage window into the past — no purchase was ever made.
    await db.sql`UPDATE card_assignments SET usage_window_expires_at = ${new Date(Date.now() - 1_000).toISOString()}
      WHERE vink_id = ${vinkId}`;

    const swept = await runSweeps(db.sql, provider);
    assert.equal(swept.cardWindowsExpired, 1);

    assert.equal((await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state, 'EXPIRED');
    const history = await db.sql`SELECT to_state FROM vink_state_history
      WHERE vink_id = ${vinkId} ORDER BY seq`;
    assert.ok(
      history.some((row) => row.to_state === 'FUNDING_REVERSAL'),
      'the card-window exit reuses the same FUNDING_REVERSAL wind-down as card-provisioning failure',
    );

    // The card genuinely tore down and returned to the pool — reusable, not stranded assigned.
    const cardAfter = await db.sql`SELECT status FROM cards WHERE id = ${cardId}`;
    assert.equal((cardAfter[0] as { status: string }).status, 'AVAILABLE');
    const assignmentAfter =
      await db.sql`SELECT status FROM card_assignments WHERE vink_id = ${vinkId}`;
    assert.equal((assignmentAfter[0] as { status: string }).status, 'RETURNED');

    // RM4A's refund auto-chain (the CARD-WINDOW-EXPIRY path): the one CAPTURED contribution
    // reaches REFUNDED with no manual `/refund-failed-session` call anywhere in this test.
    const statuses = await db.sql`SELECT status FROM contributions WHERE vink_id = ${vinkId}`;
    assert.deepEqual(
      statuses.map((row) => row.status),
      ['REFUNDED'],
    );
  });

  it('REFUND AUTO-CHAIN, THE CARD-PROVISIONING-FAILURE PATH (RM3B, gap since before RM4A): a FUNDED vink whose card provisioning fails reaches EXPIRED with its captured contribution already REFUNDED, with no manual trigger', async () => {
    await seedPoolCard();
    const organizer = await registerAndLogin();
    const member = await registerAndLogin();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 5_000,
        tipMinor: 0,
        submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
        organizerDisplayName: 'Organizer',
      },
    });
    const vinkId = created.json().vink.id as string;
    const organizerPid = created.json().participants[0].id as string;
    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: { username: member.username },
    });
    const memberPid = added.json().id as string;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: {
        method: 'CUSTOM_AMOUNT',
        amounts: [
          { participantId: organizerPid, amountMinor: 0 },
          { participantId: memberPid, amountMinor: 5_000 },
        ],
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: {},
    });
    assert.equal((await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state, 'FUNDED');

    // One transient failure: enableCard fails, and — since nothing was ever provisioned —
    // provisionCardFromPoolCommand's own best-effort compensating cleanup (disableCard,
    // called with no queued failure left) succeeds cleanly this time, so the reversal itself
    // is a genuine, unforced success, not a swallowed secondary failure.
    provider.simulateTransientFailure();
    const swept = await runSweeps(db.sql, provider);
    assert.equal(swept.cardsProvisioned, 0);

    assert.equal((await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state, 'EXPIRED');

    // RM4A's refund auto-chain (the CARD-PROVISIONING-FAILURE path, RM3B's own pre-existing
    // gap): REFUNDED already, in the very same sweep tick — no `/refund-failed-session` call.
    const statuses = await db.sql`SELECT status FROM contributions WHERE vink_id = ${vinkId}`;
    assert.deepEqual(
      statuses.map((row) => row.status),
      ['REFUNDED'],
    );
  });
});
