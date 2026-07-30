/**
 * RM3A (D47) — the capture-immediately funding engine's own named failure-case suite, against
 * real PostgreSQL. The owner's own 10-scenario list (see the RM3A milestone report) is split:
 * #3 is already proven, unchanged, by the existing `ENG9 #14` test in
 * `contributions.integration.test.ts` (it already exercises the new immediate-capture path,
 * since nothing in that test forces the old code path); #7/#8 are explicitly out of RM3A's own
 * scope (RM1/RM2's card pool isn't wired into the funding engine yet — that's RM3B). This file
 * covers the rest: #1, #2, #4, #5, #6, #9, #10.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { PostgresVinkStore } from './modules/vinks/store.ts';
import { runSweeps } from './jobs/sweeps.ts';
import { runReconciliation } from './modules/reconciliation/runner.ts';
import {
  authorizeContributionCommand,
  closeSubmissionsCommand,
  refundFailedSessionCommand,
  type ContributionCommandContext,
  type RefundCommandContext,
} from '../../../packages/application/src/index.ts';
import type { UnitOfWork, VinkTx } from '../../../packages/application/src/ports.ts';
import type { VinkId } from '../../../packages/domain/src/index.ts';
import {
  MockFinancialProvider,
  ProviderError,
} from '../../../packages/payment-provider/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

describe(
  'RM3A capture-immediately: the owner-required failure-case suite (PostgreSQL, D47)',
  { skip: !RUN },
  () => {
    let db: IsolatedTestDb;
    let provider: MockFinancialProvider;
    let app: Awaited<ReturnType<typeof buildApp>>;
    let store: PostgresVinkStore;
    const stamp = Date.now();
    let userCounter = 0;

    before(async () => {
      db = await createIsolatedTestDb('rm3a');
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
      store = new PostgresVinkStore(db.sql);
    });

    after(async () => {
      await app.close();
      await db.drop();
    });

    function ctx(): ContributionCommandContext & RefundCommandContext {
      return {
        uow: store,
        clock: { now: () => new Date() },
        correlationId: randomUUID(),
        provider,
      };
    }

    async function registerAndLogin(): Promise<{
      userId: string;
      token: string;
      username: string;
    }> {
      userCounter += 1;
      const username = `rm3a_${stamp}_${userCounter}`;
      const registered = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { username, displayName: username, password: 'integration-password-1' },
      });
      assert.equal(registered.statusCode, 201);
      return {
        userId: registered.json().user.id as string,
        token: registered.json().accessToken as string,
        username,
      };
    }

    /** A vink split evenly across N non-organizer members (organizer gets 0). */
    async function createOpenVinkWithMembers(
      memberCount: number,
      options: { requiredMinor?: number; deadlineMs?: number } = {},
    ): Promise<{ vinkId: string; members: { userId: string; token: string }[] }> {
      const required = options.requiredMinor ?? memberCount * 4_000;
      const share = required / memberCount;
      const organizer = await registerAndLogin();
      const deadline = new Date(Date.now() + (options.deadlineMs ?? 60 * 60 * 1000)).toISOString();
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/vinks',
        headers: { authorization: `Bearer ${organizer.token}` },
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
      const organizerParticipantId = created.json().participants[0].id as string;

      const members: { userId: string; token: string; participantId: string }[] = [];
      for (let i = 0; i < memberCount; i += 1) {
        const member = await registerAndLogin();
        const added = await app.inject({
          method: 'POST',
          url: `/api/v1/vinks/${vinkId}/participants`,
          headers: { authorization: `Bearer ${organizer.token}` },
          payload: { username: member.username },
        });
        assert.equal(added.statusCode, 201);
        members.push({ ...member, participantId: added.json().id as string });
      }

      const amounts = [
        { participantId: organizerParticipantId, amountMinor: 0 },
        ...members.map((m) => ({ participantId: m.participantId, amountMinor: share })),
      ];
      const split = await app.inject({
        method: 'PUT',
        url: `/api/v1/vinks/${vinkId}/split`,
        headers: { authorization: `Bearer ${organizer.token}` },
        payload: { method: 'CUSTOM_AMOUNT', amounts },
      });
      assert.equal(split.statusCode, 200);
      const opened = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/open`,
        headers: { authorization: `Bearer ${organizer.token}` },
        payload: {},
      });
      assert.equal(opened.statusCode, 200);

      // RM4A (D47): openVinkCommand now recomputes submissionDeadline/processingGraceDeadline
      // unconditionally at open time (the fixed 7-minute default), so whatever was requested at
      // creation — including a short `deadlineMs` meant to make sweep-timing tests fast — no
      // longer survives to the opened row. Patch it directly afterward, mirroring what
      // openVinkCommand itself would have written had a short duration genuinely been
      // configured; this simulates "time compression," not a different code path.
      if (options.deadlineMs !== undefined) {
        const submissionDeadline = new Date(Date.now() + options.deadlineMs);
        const processingGraceDeadline = new Date(submissionDeadline.getTime() + 60_000);
        await db.sql`UPDATE vinks SET submission_deadline = ${submissionDeadline.toISOString()},
          processing_grace_deadline = ${processingGraceDeadline.toISOString()} WHERE id = ${vinkId}`;
      }

      return { vinkId, members };
    }

    async function authorize(vinkId: string, token: string, scenario?: string) {
      return app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
        headers: { authorization: `Bearer ${token}` },
        payload: scenario === undefined ? {} : { scenario },
      });
    }

    async function ledgerTotals(contributionIds: string[]) {
      const rows = await db.sql`
      SELECT
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'DEBIT'), 0)::int AS debits,
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'CREDIT'), 0)::int AS credits
      FROM ledger_entries e
      JOIN ledger_transactions t ON t.id = e.transaction_id
      WHERE t.reference_id = ANY(${contributionIds})`;
      return rows[0] as { debits: number; credits: number };
    }

    async function insertWebhookEvent(opts: {
      eventType: string;
      objectId: string;
      occurredAt: Date;
      providerEventId?: string;
      payload?: Record<string, unknown>;
    }): Promise<string> {
      const id = randomUUID();
      const providerEventId = opts.providerEventId ?? randomUUID();
      await db.sql`
      INSERT INTO webhook_events (id, provider, provider_event_id, event_type, object_id,
        occurred_at, raw_body, payload, status)
      VALUES (${id}, 'mock', ${providerEventId}, ${opts.eventType}, ${opts.objectId},
        ${opts.occurredAt}, ${JSON.stringify({ fixture: true })},
        ${db.sql.json((opts.payload ?? {}) as postgres.JSONValue)}, 'received')`;
      return id;
    }

    async function findingFor(
      webhookEventId: string,
    ): Promise<Record<string, unknown> | undefined> {
      const rows = await db.sql`
      SELECT * FROM reconciliation_findings WHERE webhook_event_id = ${webhookEventId}`;
      return rows[0] as Record<string, unknown> | undefined;
    }

    /** A `UnitOfWork` wrapping the real store, whose `tx[methodName]` throws — simulating "the
     * provider call already genuinely succeeded, but a LATER write in the same local transaction
     * fails," the exact class of risk RM2 already fixed once for card quarantine (see
     * `card-pool.ts`'s own header comment) and RM3A's own module doc comment discloses as the
     * disclosed, reconciliation-recovered risk for capture/refund. */
    function storeThatFailsOn(methodName: keyof VinkTx): UnitOfWork {
      return {
        async run<T>(fn: (tx: VinkTx) => Promise<T>): Promise<T> {
          return store.run(async (tx) => {
            const proxied = new Proxy(tx as object, {
              get(target, prop) {
                if (prop === methodName) {
                  return async () => {
                    throw new Error(
                      `SIMULATED_LOCAL_FAILURE_AFTER_PROVIDER_SUCCESS:${String(prop)}`,
                    );
                  };
                }
                // Bind to the REAL target, not the proxy — PostgresVinkTx's methods read a
                // true private #sql field, which throws if `this` is the Proxy rather than a
                // genuine class instance.
                const value = Reflect.get(target, prop, target);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }) as VinkTx;
            return fn(proxied);
          });
        },
      };
    }

    it('#1 — a provider capture succeeds but the local transaction fails: reconciliation surfaces it as ORPHANED (no local record survives the rollback), not silently lost', async () => {
      const { vinkId, members } = await createOpenVinkWithMembers(1);
      const failingCtx: ContributionCommandContext = {
        ...ctx(),
        uow: storeThatFailsOn('insertLedgerPosting'),
      };

      await assert.rejects(
        authorizeContributionCommand(failingCtx, {
          vinkId: vinkId as VinkId,
          requester: { kind: 'user', userId: members[0]!.userId },
        }),
        /SIMULATED_LOCAL_FAILURE_AFTER_PROVIDER_SUCCESS/,
      );

      // The whole transaction rolled back — nothing local survives.
      const rows =
        await db.sql`SELECT count(*)::int AS n FROM contributions WHERE vink_id = ${vinkId}`;
      assert.equal((rows[0] as { n: number }).n, 0);

      // But the provider genuinely captured real money — proven independently of our own
      // now-rolled-back local record, via the provider's own event log and status API.
      const capturedEvent = provider
        .drainEvents()
        .find((event) => event.type === 'payment.captured');
      assert.ok(capturedEvent, 'the provider really did capture, even though we lost the record');
      const providerPaymentId = capturedEvent!.objectId;
      const status = await provider.retrievePaymentStatus(providerPaymentId);
      assert.equal(status.status, 'CAPTURED');

      // Reconciliation — not automatic blind recapture — is the disclosed recovery mechanism.
      const eventId = await insertWebhookEvent({
        eventType: 'payment.captured',
        objectId: providerPaymentId,
        occurredAt: new Date(),
        payload: { amountMinor: status.capturedTotal?.amountMinor ?? 0 },
      });
      await runReconciliation(db.sql, 100);
      const finding = await findingFor(eventId);
      assert.equal(finding?.classification, 'ORPHANED');
    });

    it('#2 — a local command retries after a successful provider capture: EITHER the original contribution row survives (idempotent replay succeeds, no double capture) OR it does not (the provider correctly REFUSES an unsafe replay, never silently double-captures)', async () => {
      const { vinkId, members } = await createOpenVinkWithMembers(1);

      // First attempt: the provider genuinely authorizes and captures, but a LATER local write
      // in the same transaction fails, so the whole thing — including the CREATED contribution
      // row itself — rolls back together (real Postgres transaction semantics; the DB's own
      // append-only trigger on ledger_entries makes deleting rows after the fact impossible,
      // which is exactly the point: nothing here was ever committed in the first place).
      const failingCtx: ContributionCommandContext = {
        ...ctx(),
        uow: storeThatFailsOn('insertLedgerPosting'),
      };
      await assert.rejects(
        authorizeContributionCommand(failingCtx, {
          vinkId: vinkId as VinkId,
          requester: { kind: 'user', userId: members[0]!.userId },
        }),
        /SIMULATED_LOCAL_FAILURE_AFTER_PROVIDER_SUCCESS/,
      );
      const rows =
        await db.sql`SELECT count(*)::int AS n FROM contributions WHERE vink_id = ${vinkId}`;
      assert.equal((rows[0] as { n: number }).n, 0, 'nothing local survived the rollback');
      const firstCapture = provider
        .drainEvents()
        .find((event) => event.type === 'payment.captured');
      assert.ok(firstCapture, 'the provider really did capture on the first attempt');

      // RM3A FINDING (disclosed in the milestone report, not silently absorbed): because the
      // CREATED contribution row itself never persisted, a plain retry generates a BRAND NEW
      // contribution id — and that id is embedded in the provider call's own `metadata`
      // (`authorizeContribution`'s `metadata.contributionId`). The operationId STRING is
      // identical (`authorize:v1:{participantId}:1`, since attemptNumber recomputes to 1 either
      // way), but the underlying PARAMETERS differ — and the mock's own idempotency guard (§12:
      // "same key + different params is a conflict, not a silent overwrite," already contract-
      // tested) correctly REFUSES to treat this as a safe replay, rather than silently adopting
      // the earlier capture under a new, unrelated local identity. This is the actual, load-
      // bearing safety property: retrying after losing the ORIGINAL row's identity does not
      // resolve automatically — it needs reconciliation (proven by case #1 above against this
      // exact captured payment), never a blind client retry.
      await assert.rejects(
        authorizeContributionCommand(ctx(), {
          vinkId: vinkId as VinkId,
          requester: { kind: 'user', userId: members[0]!.userId },
        }),
        (error: unknown) => error instanceof ProviderError && error.code === 'IDEMPOTENCY_CONFLICT',
      );
      // Still zero local rows — the refused retry did not fabricate a second, wrongly-linked
      // local record either.
      const stillZero =
        await db.sql`SELECT count(*)::int AS n FROM contributions WHERE vink_id = ${vinkId}`;
      assert.equal((stillZero[0] as { n: number }).n, 0);

      // The OTHER, realistic half of this scenario — the original row SURVIVES (a genuine E5
      // lost-response, not a full rollback) and a later retry/resolve DOES safely replay via the
      // same surviving id — is already proven by `contributions.test.ts`'s and `contributions
      // .integration.test.ts`'s own "lost response (E5)" tests, re-verified under this exact
      // RM3A capture-immediately code path (both updated and green as part of this milestone).
    });

    it('#4 — Vink expiry races with the final contribution: exactly one correct global outcome, never a lost or double capture', async () => {
      const { vinkId, members } = await createOpenVinkWithMembers(2, { deadlineMs: 1_200 });
      const first = await authorize(vinkId, members[0]!.token);
      assert.equal(first.json().contribution.status, 'CAPTURED');

      await new Promise((resolve) => setTimeout(resolve, 1_300));
      // Genuinely race the final contribution against the deadline sweep for the vink's own row
      // lock — whichever transaction acquires it first runs to completion before the other even
      // starts (no partial execution to interleave), per the existing FOR UPDATE serialization.
      const [second] = await Promise.all([
        authorize(vinkId, members[1]!.token),
        runSweeps(db.sql, provider),
      ]);

      const vinkRow = await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`;
      const state = (vinkRow[0] as { state: string }).state;
      const contributionRows =
        await db.sql`SELECT status FROM contributions WHERE vink_id = ${vinkId}`;
      const statuses = contributionRows.map((row) => row.status as string).sort();

      if (state === 'FUNDED') {
        // The final authorize won the race: both captured, both funded, nothing to refund.
        assert.equal(second.statusCode, 200);
        assert.deepEqual(statuses, ['CAPTURED', 'CAPTURED']);
      } else {
        // The sweep won the race: the vink expired with member 1's money already captured, so
        // it must be REFUNDED, not silently lost — and member 2's request, once unblocked, sees
        // a vink that is no longer OPEN.
        assert.equal(state, 'EXPIRED');
        assert.ok(second.statusCode >= 400);
        assert.deepEqual(statuses, ['REFUNDED']);
      }
      const ids = await db.sql`SELECT id FROM contributions WHERE vink_id = ${vinkId}`;
      const totals = await ledgerTotals(ids.map((row) => row.id as string));
      assert.equal(totals.debits, totals.credits);
    });

    it('#5 — a refund succeeds at the provider but the local refund recording fails: reconciliation surfaces it as MISMATCHED (the local row is stale, not missing)', async () => {
      const { vinkId, members } = await createOpenVinkWithMembers(1);
      const authorized = await authorize(vinkId, members[0]!.token);
      assert.equal(authorized.json().contribution.status, 'CAPTURED');
      const providerReferenceRow =
        await db.sql`SELECT provider_reference FROM contributions WHERE vink_id = ${vinkId}`;
      const providerReference = (providerReferenceRow[0] as { provider_reference: string })
        .provider_reference;

      // Fixture-only direct SQL (matching this codebase's own reconciliation-test precedent for
      // states the command layer wouldn't naturally leave a vink in): force the vink to EXPIRED
      // so `refundFailedSessionCommand`'s own precondition is satisfied, with its one CAPTURED
      // contribution still needing a refund.
      await db.sql`UPDATE vinks SET state = 'EXPIRED' WHERE id = ${vinkId}`;

      const failingCtx: RefundCommandContext = {
        ...ctx(),
        uow: storeThatFailsOn('insertLedgerPosting'),
      };
      await assert.rejects(
        refundFailedSessionCommand(failingCtx, { vinkId: vinkId as VinkId }),
        /SIMULATED_LOCAL_FAILURE_AFTER_PROVIDER_SUCCESS/,
      );

      // The local row is stale — still CAPTURED, since the REFUND_SUCCEEDED write rolled back.
      const row = await db.sql`SELECT status FROM contributions WHERE vink_id = ${vinkId}`;
      assert.equal((row[0] as { status: string }).status, 'CAPTURED');

      // But the provider genuinely refunded the money.
      const status = await provider.retrievePaymentStatus(providerReference);
      assert.equal(status.status, 'REFUNDED');

      const eventId = await insertWebhookEvent({
        eventType: 'refund.completed',
        objectId: providerReference,
        occurredAt: new Date(),
        payload: { amountMinor: status.refundedTotal?.amountMinor ?? 0 },
      });
      await runReconciliation(db.sql, 100);
      const finding = await findingFor(eventId);
      assert.equal(finding?.classification, 'MISMATCHED');
    });

    it('#6 — one refund succeeds while another fails: the Vink lands REFUND_RECOVERY_REQUIRED, not EXPIRED, each contribution independently correct', async () => {
      const { vinkId, members } = await createOpenVinkWithMembers(3, { deadlineMs: 1_200 });
      // Two capture successfully; the third is declined outright — the vink can never reach
      // FUNDED via the fast path, so the deadline sweep is what drives the failure branch.
      await authorize(vinkId, members[0]!.token);
      await authorize(vinkId, members[1]!.token);
      const declined = await authorize(vinkId, members[2]!.token, 'DECLINE');
      assert.equal(declined.json().contribution.status, 'DECLINED');

      await new Promise((resolve) => setTimeout(resolve, 1_300));
      // The next refund attempt fails transiently — whichever of the two CAPTURED contributions
      // the failure branch processes first.
      provider.simulateTransientFailure();
      const swept = await runSweeps(db.sql, provider);
      assert.ok(swept.closed >= 1 || swept.graceResolved >= 1);

      const vinkRow = await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`;
      assert.equal((vinkRow[0] as { state: string }).state, 'REFUND_RECOVERY_REQUIRED');

      const statuses = (await db.sql`SELECT status FROM contributions WHERE vink_id = ${vinkId}`)
        .map((row) => row.status as string)
        .sort();
      assert.deepEqual(statuses, ['DECLINED', 'REFUNDED', 'REFUND_FAILED'].sort());

      // The sweep's own auto-retry (RM3A) eventually resolves it without operator intervention —
      // simulate "a minute later" so the retry cooldown has genuinely elapsed, rather than a
      // real 60s wait in this test.
      const laterNow = new Date(Date.now() + 65_000);
      const retried = await runSweeps(db.sql, provider, laterNow);
      assert.equal(retried.refundsRetried, 1);
      const afterRetry = await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`;
      assert.equal((afterRetry[0] as { state: string }).state, 'EXPIRED');
      const finalStatuses = (
        await db.sql`SELECT status FROM contributions WHERE vink_id = ${vinkId} ORDER BY status`
      ).map((row) => row.status as string);
      assert.deepEqual(finalStatuses, ['DECLINED', 'REFUNDED', 'REFUNDED']);
    });

    it('#9 — duplicate, out-of-order provider webhooks for a genuinely capture-immediately-produced contribution: occurred_at decides, replay creates no duplicate finding', async () => {
      const { vinkId, members } = await createOpenVinkWithMembers(1);
      await authorize(vinkId, members[0]!.token);
      const providerReferenceRow =
        await db.sql`SELECT provider_reference FROM contributions WHERE vink_id = ${vinkId}`;
      const providerReference = (providerReferenceRow[0] as { provider_reference: string })
        .provider_reference;

      const earlier = new Date('2026-02-01T00:00:00.000Z');
      const later = new Date('2026-02-01T00:05:00.000Z');
      // Arrival order is deliberately reversed relative to occurred_at — genuine out-of-order
      // delivery. (A genuinely DUPLICATE delivery — same provider_event_id twice — is a real
      // `webhook_events.(provider, provider_event_id)` UNIQUE constraint violation at the DB
      // level; that dedupe is proven separately and already, by webhooks.integration.test.ts's
      // own "REPLAY PROTECTION" test — not re-tested here.)
      const capturedLate = await insertWebhookEvent({
        eventType: 'payment.captured',
        objectId: providerReference,
        occurredAt: later,
        payload: { amountMinor: 4_000 },
      });
      const authorizedEarly = await insertWebhookEvent({
        eventType: 'payment.authorized',
        objectId: providerReference,
        occurredAt: earlier,
        payload: { amountMinor: 4_000 },
      });

      await runReconciliation(db.sql, 100);
      const lateFinding = await findingFor(capturedLate);
      const earlyFinding = await findingFor(authorizedEarly);
      assert.equal(lateFinding?.classification, 'EXPECTED');
      assert.equal(earlyFinding?.classification, 'EXPECTED');
      // Re-running reconciliation over the same events creates zero new findings — idempotent
      // replay, not a duplicate.
      const before = await db.sql`SELECT count(*)::int AS n FROM reconciliation_findings`;
      await runReconciliation(db.sql, 100);
      const after = await db.sql`SELECT count(*)::int AS n FROM reconciliation_findings`;
      assert.equal((before[0] as { n: number }).n, (after[0] as { n: number }).n);
    });

    it('#10 — a historical AUTHORIZED (uncaptured hold) contribution, predating the capture-immediately engine, is caught up correctly by the compatibility shim', async () => {
      const { vinkId, members } = await createOpenVinkWithMembers(1);
      // Manufacture the OLD shape directly: an AUTHORIZED hold with no capture, exactly what
      // authorizeContributionCommand could produce before RM3A — impossible via the new code
      // path, but real pre-deploy data must not crash the new resolver.
      const { providerCustomerId } = await provider.createCustomer({
        idempotencyKey: `legacy-customer:v1:${randomUUID()}`,
        externalUserId: members[0]!.userId,
      });
      const { providerMethodId } = await provider.setupPaymentMethod({
        idempotencyKey: `legacy-method:v1:${randomUUID()}`,
        providerCustomerId,
        methodToken: 'tok_ok',
        usage: 'CONTRIBUTION',
      });
      const held = await provider.authorizeContribution({
        idempotencyKey: `legacy:v1:${randomUUID()}`,
        providerCustomerId,
        providerMethodId,
        amount: { amountMinor: 4_000, currency: 'USD' },
        captureMode: 'MANUAL',
        metadata: { vinkId, participantId: 'legacy', contributionId: 'legacy' },
      });
      assert.equal(held.status, 'AUTHORIZED');

      const participantRow = await db.sql`SELECT id FROM participants
      WHERE vink_id = ${vinkId} AND user_id = ${members[0]!.userId}`;
      const participantId = (participantRow[0] as { id: string }).id;
      const contributionId = randomUUID();
      await db.sql`INSERT INTO contributions (id, vink_id, participant_id, requested_amount_minor,
        authorized_amount_minor, status, provider_reference, idempotency_key)
      VALUES (${contributionId}, ${vinkId}, ${participantId}, 4000, 4000, 'AUTHORIZED',
        ${held.providerPaymentId}, ${`legacy_${contributionId}`})`;

      // Drive the deadline sweep (simulating "well past the deadline," rather than a real wait)
      // — resolveFunding's compatibility shim must catch this legacy AUTHORIZED row up (capture
      // it) using the EXACT pre-RM3A logic, then correctly fund. Since the deadline is already
      // reached, closeSubmissionsCommand's own call into the resolver decides it in one step —
      // resolveGraceCommand afterward is correctly a no-op (the vink is no longer PROCESSING_
      // GRACE by then), mirroring the fast-path shape this codebase already uses elsewhere.
      const wellPastDeadline = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const outcome = await closeSubmissionsCommand(ctx(), {
        vinkId: vinkId as VinkId,
        now: wellPastDeadline,
      });
      assert.equal(outcome, 'FUNDED');

      const finalRow = await db.sql`SELECT status FROM contributions WHERE id = ${contributionId}`;
      assert.equal((finalRow[0] as { status: string }).status, 'CAPTURED');
      const vinkRow = await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`;
      assert.equal((vinkRow[0] as { state: string }).state, 'FUNDED');
    });
  },
);
