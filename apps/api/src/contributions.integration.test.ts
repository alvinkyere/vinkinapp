/**
 * Mock contribution flow end-to-end — the PV5 exit gate ("concurrent mock contributions
 * cannot overfund or double-count a Vink") plus the funded journey, decline→expiry,
 * lost-response recovery, and ledger enforcement. Real PostgreSQL; VINKIN_INTEGRATION=1.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { runSweeps } from './jobs/sweeps.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

describe('mock contribution flow end-to-end (PostgreSQL)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let provider: MockFinancialProvider;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const stamp = Date.now();
  const users = {
    organizer: `pv5_org_${stamp}`,
    memberA: `pv5_a_${stamp}`,
    memberB: `pv5_b_${stamp}`,
  };
  const tokens: Record<string, string> = {};

  function authed(who: keyof typeof users) {
    return { authorization: `Bearer ${tokens[who]}` };
  }

  async function createOpenVink(options: { requiredMinor?: number; deadlineMs?: number } = {}) {
    const required = options.requiredMinor ?? 12_000;
    const deadline = new Date(Date.now() + (options.deadlineMs ?? 60 * 60 * 1000)).toISOString();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: authed('organizer'),
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: required,
        tipMinor: 0,
        submissionDeadline: deadline,
        organizerDisplayName: 'Organizer',
      },
    });
    assert.equal(created.statusCode, 201);
    const vinkId = created.json().vink.id as string;
    const participantIds: Record<string, string> = {
      organizer: created.json().participants[0].id,
    };
    for (const member of ['memberA', 'memberB'] as const) {
      const added = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/participants`,
        headers: authed('organizer'),
        payload: { username: users[member] },
      });
      assert.equal(added.statusCode, 201);
      participantIds[member] = added.json().id;
    }
    const split = await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: authed('organizer'),
      payload: {
        method: 'CUSTOM_AMOUNT',
        amounts: [
          { participantId: participantIds.organizer, amountMinor: 0 },
          { participantId: participantIds.memberA, amountMinor: required / 2 },
          { participantId: participantIds.memberB, amountMinor: required / 2 },
        ],
      },
    });
    assert.equal(split.statusCode, 200);
    const opened = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: authed('organizer'),
      payload: {},
    });
    assert.equal(opened.statusCode, 200);
    return { vinkId };
  }

  async function ledgerTotals(vinkContributionIds?: string[]) {
    const rows = await db.sql`
      SELECT
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'DEBIT'), 0)::int AS debits,
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'CREDIT'), 0)::int AS credits
      FROM ledger_entries e
      JOIN ledger_transactions t ON t.id = e.transaction_id
      WHERE ${vinkContributionIds === undefined ? db.sql`TRUE` : db.sql`t.reference_id = ANY(${vinkContributionIds})`}`;
    return rows[0] as { debits: number; credits: number };
  }

  before(async () => {
    db = await createIsolatedTestDb('contrib');
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
    for (const [who, username] of Object.entries(users)) {
      const registered = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { username, displayName: username, password: 'integration-password-1' },
      });
      assert.equal(registered.statusCode, 201);
      tokens[who] = registered.json().accessToken;
    }
  });

  after(async () => {
    await app.close();
    await db.drop();
  });

  it('funded journey: both members authorize → FUNDED, captured, balanced ledger, events', async () => {
    const { vinkId } = await createOpenVink();
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
      headers: authed('memberA'),
      payload: {},
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().contribution.status, 'AUTHORIZED');
    assert.equal(first.json().vinkState, 'OPEN');

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
      headers: authed('memberB'),
      payload: {},
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().vinkState, 'FUNDED');
    assert.equal(second.json().contribution.status, 'CAPTURED');

    const vinkRow =
      await db.sql`SELECT state, funded_amount_minor::int AS funded FROM vinks WHERE id = ${vinkId}`;
    assert.deepEqual(vinkRow[0], { state: 'FUNDED', funded: 12_000 });

    const contributionRows =
      await db.sql`SELECT id, status FROM contributions WHERE vink_id = ${vinkId}`;
    assert.deepEqual(contributionRows.map((row) => row.status).sort(), ['CAPTURED', 'CAPTURED']);
    const totals = await ledgerTotals(contributionRows.map((row) => row.id as string));
    assert.equal(totals.debits, totals.credits);
    assert.equal(totals.debits, 24_000); // 2 × (capture 6000 + funding move 6000)

    const events = await db.sql`SELECT event_type FROM outbox_events
      WHERE aggregate_id = ${vinkId} ORDER BY seq`;
    const types = events.map((row) => row.event_type as string);
    for (const expected of [
      'SubmissionsClosed',
      'ProcessingGraceStarted',
      'ContributionCaptured',
      'VinkFunded',
    ]) {
      assert.ok(types.includes(expected), `missing ${expected}`);
    }
  });

  it('EXIT GATE: concurrent double-taps cannot double-count or overfund', async () => {
    const { vinkId } = await createOpenVink();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        app.inject({
          method: 'POST',
          url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
          headers: authed('memberA'),
          payload: {},
        }),
      ),
    );
    for (const response of responses) assert.equal(response.statusCode, 200);
    assert.equal(responses.filter((response) => response.json().replayed === false).length, 1);

    const rows = await db.sql`SELECT count(*)::int AS n FROM contributions c
      JOIN participants p ON p.id = c.participant_id
      WHERE c.vink_id = ${vinkId} AND p.user_id = (SELECT id FROM users WHERE username = ${users.memberA})`;
    assert.equal((rows[0] as { n: number }).n, 1);

    // Complete the funding; the funded amount is EXACTLY the required amount.
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
      headers: authed('memberB'),
      payload: {},
    });
    const vinkRow = await db.sql`SELECT state, funded_amount_minor::int AS funded,
      required_amount_minor::int AS required FROM vinks WHERE id = ${vinkId}`;
    const vink = vinkRow[0] as { state: string; funded: number; required: number };
    assert.equal(vink.state, 'FUNDED');
    assert.equal(vink.funded, vink.required);
  });

  it('ENG9 #14: two DIFFERENT participants contributing genuinely concurrently cannot double-fund or corrupt the D5 resolver', async () => {
    // Unlike the "double-taps" test above (one participant racing itself), this races two
    // different participants against each other for the vink's own row lock — the scenario
    // that actually decides FUNDED (D5's single resolver runs once, from whichever request
    // legitimately observes the vink fully funded first).
    const { vinkId } = await createOpenVink();
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
        headers: authed('memberA'),
        payload: {},
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
        headers: authed('memberB'),
        payload: {},
      }),
    ]);
    assert.equal(a.statusCode, 200);
    assert.equal(b.statusCode, 200);

    const contributionRows =
      await db.sql`SELECT id, status FROM contributions WHERE vink_id = ${vinkId}`;
    assert.equal(
      contributionRows.length,
      2,
      'exactly one contribution per participant, no duplicates',
    );
    assert.deepEqual(contributionRows.map((row) => row.status).sort(), ['CAPTURED', 'CAPTURED']);

    const vinkRow = await db.sql`SELECT state, funded_amount_minor::int AS funded,
      required_amount_minor::int AS required FROM vinks WHERE id = ${vinkId}`;
    const vink = vinkRow[0] as { state: string; funded: number; required: number };
    assert.equal(vink.state, 'FUNDED');
    assert.equal(vink.funded, vink.required, 'funded amount is exactly required — no overfund');

    // The D5 resolver runs exactly once: exactly one VinkFunded event, not zero (resolver
    // never fired) and not two (resolver raced itself and fired twice).
    const fundedEvents = await db.sql`SELECT count(*)::int AS n FROM outbox_events
      WHERE aggregate_id = ${vinkId} AND event_type = 'VinkFunded'`;
    assert.equal((fundedEvents[0] as { n: number }).n, 1);

    const totals = await ledgerTotals(contributionRows.map((row) => row.id as string));
    assert.equal(totals.debits, totals.credits);
  });

  it('decline + deadline: submissions close via sweep, grace expiry releases the hold (E2)', async () => {
    const { vinkId } = await createOpenVink({ deadlineMs: 1_200 });
    const declined = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
      headers: authed('memberA'),
      payload: { scenario: 'DECLINE' },
    });
    assert.equal(declined.json().contribution.status, 'DECLINED');
    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
      headers: authed('memberB'),
      payload: {},
    });
    assert.equal(ok.json().contribution.status, 'AUTHORIZED');

    await new Promise((resolve) => setTimeout(resolve, 1_300));
    // The real sweep body (BullMQ invokes the same function on a schedule). With one
    // DECLINED and one AUTHORIZED there are ZERO unresolved attempts, so the D5 resolver's
    // fast path decides EXPIRED at close — no idle grace wait (doc 03 §1).
    const swept = await runSweeps(db.sql, provider);
    assert.ok(swept.closed >= 1);
    const afterClose = await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`;
    assert.equal(afterClose[0]!.state, 'EXPIRED');

    // Late deadline runs are harmless no-ops (idempotent timers, Plan §10).
    const rerun = await app.inject({
      method: 'POST',
      url: `/internal/simulator/vinks/${vinkId}/run-deadlines`,
      payload: { nowOverride: new Date(Date.now() + 2 * 60 * 1000).toISOString() },
    });
    assert.equal(rerun.statusCode, 200);
    assert.equal(rerun.json().graceOutcome, 'NOT_DUE');

    const finalStates =
      await db.sql`SELECT status FROM contributions WHERE vink_id = ${vinkId} ORDER BY status`;
    assert.deepEqual(
      finalStates.map((row) => row.status),
      ['CANCELLED', 'DECLINED'],
    );
    const providerStatus = await provider.retrievePaymentStatus(
      (
        await db.sql`SELECT provider_reference FROM contributions
        WHERE vink_id = ${vinkId} AND status = 'CANCELLED'`
      )[0]!.provider_reference as string,
    );
    assert.equal(providerStatus.status, 'CANCELED');
    // Nothing was captured → nothing was posted for this vink's contributions.
    const ids = await db.sql`SELECT id FROM contributions WHERE vink_id = ${vinkId}`;
    const totals = await ledgerTotals(ids.map((row) => row.id as string));
    assert.equal(totals.debits, 0);
  });

  it('lost response (E5): RESOLUTION_PENDING, resolve replays the same key, one charge only', async () => {
    const { vinkId } = await createOpenVink();
    provider.simulateLostResponse();
    const lost = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
      headers: authed('memberA'),
      payload: {},
    });
    assert.equal(lost.json().contribution.status, 'RESOLUTION_PENDING');
    const contributionId = lost.json().contribution.id as string;

    const resolved = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/${contributionId}/resolve`,
      headers: authed('memberA'),
      payload: {},
    });
    assert.equal(resolved.statusCode, 200);
    assert.equal(resolved.json().contribution.status, 'AUTHORIZED');

    const rows =
      await db.sql`SELECT count(*)::int AS n FROM contributions WHERE vink_id = ${vinkId}`;
    assert.equal((rows[0] as { n: number }).n, 1);
  });

  it('delayed authorization resolves late and funds during grace (simulator pending-resolve)', async () => {
    const { vinkId } = await createOpenVink({ deadlineMs: 1_200 });
    const delayed = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
      headers: authed('memberA'),
      payload: { scenario: 'DELAYED' },
    });
    assert.equal(delayed.json().contribution.status, 'AUTHORIZATION_PENDING');
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
      headers: authed('memberB'),
      payload: {},
    });

    await new Promise((resolve) => setTimeout(resolve, 1_300));
    await runSweeps(db.sql, provider);
    assert.equal(
      (await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state,
      'PROCESSING_GRACE',
    );

    const confirmed = await app.inject({
      method: 'POST',
      url: `/internal/simulator/contributions/${delayed.json().contribution.id}/resolve-pending`,
      payload: { vinkId, outcome: 'AUTHORIZED' },
    });
    assert.equal(confirmed.statusCode, 200);
    assert.equal(confirmed.json().contribution.status, 'CAPTURED');
    assert.equal((await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state, 'FUNDED');
  });

  it('the ledger is append-only and refuses unbalanced transactions at commit', async () => {
    await assert.rejects(db.sql`UPDATE ledger_entries SET amount_minor = 1`, /append-only/);
    await assert.rejects(
      db.sql.begin(async (tx) => {
        const inserted = await tx`INSERT INTO ledger_transactions (reference_type, reference_id)
          VALUES ('contribution', gen_random_uuid()) RETURNING id`;
        await tx`INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_minor, entry_type)
          SELECT ${(inserted[0] as { id: string }).id}, id, 'DEBIT', 100, 'test'
          FROM ledger_accounts WHERE code = 'processor_clearing'`;
      }),
      /unbalanced/,
    );
  });
});
