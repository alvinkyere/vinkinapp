/**
 * RM3B (D47) — the card-pool cutover's own named security/reassignment/MCC tests, against
 * real PostgreSQL. The full live E2E happy path (fund → sweep-provision → merchant auth →
 * capture → settle → COMPLETED, the card genuinely returned to the pool) is already proven by
 * `purchases.integration.test.ts`'s own rewritten EXIT GATE test — not duplicated here.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { runSweeps } from './jobs/sweeps.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

describe(
  'RM3B card-pool cutover: security, reassignment, MCC blocking (PostgreSQL, D47)',
  { skip: !RUN },
  () => {
    let db: IsolatedTestDb;
    let provider: MockFinancialProvider;
    let app: Awaited<ReturnType<typeof buildApp>>;
    const stamp = Date.now();
    let userCounter = 0;

    before(async () => {
      db = await createIsolatedTestDb('rm3b');
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
      const username = `rm3b_${stamp}_${userCounter}`;
      const registered = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { username, displayName: username, password: 'integration-password-1' },
      });
      assert.equal(registered.statusCode, 201);
      return { token: registered.json().accessToken as string, username };
    }

    /** A vink fully funded by ONE non-organizer member. */
    async function createFundedVink(requiredMinor = 6_000): Promise<string> {
      const organizer = await registerAndLogin();
      const member = await registerAndLogin();
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/vinks',
        headers: { authorization: `Bearer ${organizer.token}` },
        payload: {
          purchaseCategory: 'GROCERY',
          subtotalMinor: requiredMinor,
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
            { participantId: memberPid, amountMinor: requiredMinor },
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
      assert.equal(
        (await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state,
        'FUNDED',
      );
      return vinkId;
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

    async function provisionAndGetToken(vinkId: string): Promise<string> {
      const swept = await runSweeps(db.sql, provider);
      assert.ok(swept.cardsProvisioned >= 1);
      assert.equal(
        (await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state,
        'CARD_READY',
      );
      const rows = await db.sql`
        SELECT t.provider_token_id FROM card_assignments ca
        JOIN card_wallet_tokens t ON t.card_assignment_id = ca.id
        WHERE ca.vink_id = ${vinkId}`;
      return (rows[0] as { provider_token_id: string }).provider_token_id;
    }

    async function merchantAuth(vinkId: string, presentedWalletToken: string) {
      return app.inject({
        method: 'POST',
        url: `/internal/simulator/vinks/${vinkId}/merchant-authorizations`,
        payload: {
          merchantName: 'Corner Grocer',
          merchantIdentifier: 'GROCER-1',
          mcc: '5411',
          amountMinor: 6_000,
          presentedWalletToken,
        },
      });
    }

    it('THE SECURITY TEST: a stale/wrong presented wallet token is declined WALLET_TOKEN_MISMATCH even though the underlying card is genuinely ACTIVE', async () => {
      await seedPoolCard();
      const vinkId = await createFundedVink();
      const realToken = await provisionAndGetToken(vinkId);

      const wrong = await merchantAuth(vinkId, 'wrong_token_never_provisioned');
      assert.equal(wrong.statusCode, 201);
      assert.equal(wrong.json().outcome, 'DECLINED');
      const declineEvent = await db.sql`
        SELECT payload FROM outbox_events
        WHERE aggregate_id = ${vinkId} AND event_type = 'MerchantAuthorizationDeclined'
        ORDER BY seq DESC LIMIT 1`;
      assert.equal(
        (declineEvent[0] as { payload: { reason: string } }).payload.reason,
        'WALLET_TOKEN_MISMATCH',
      );
      // The vink is still CARD_READY — a declined authorization doesn't consume/lock anything.
      assert.equal(
        (await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state,
        'CARD_READY',
      );

      // The SAME card, with the CORRECT token, is approved without issue.
      const correct = await merchantAuth(vinkId, realToken);
      assert.equal(correct.statusCode, 201);
      assert.equal(correct.json().outcome, 'APPROVED');
    });

    it("REASSIGNMENT THROUGH THE LIVE FLOW: settlement returns the physical card to the pool, a second Vink reuses it, and the first Vink's old wallet token can never again authorize", async () => {
      // Exactly one pool card — forces the second vink to reuse the SAME physical card.
      await seedPoolCard();

      const vink1 = await createFundedVink();
      const token1 = await provisionAndGetToken(vink1);
      const card1Row = await db.sql`SELECT card_id FROM card_assignments WHERE vink_id = ${vink1}`;
      const cardId = (card1Row[0] as { card_id: string }).card_id;

      const auth1 = await merchantAuth(vink1, token1);
      assert.equal(auth1.json().outcome, 'APPROVED');
      const capture1 = await app.inject({
        method: 'POST',
        url: `/internal/simulator/authorizations/${auth1.json().authorizationId}/capture`,
        payload: {
          vinkId: vink1,
          providerAuthorizationId: auth1.json().providerAuthorizationId,
          settledAmountMinor: 6_000,
        },
      });
      assert.equal(capture1.json().vinkState, 'COMPLETED');
      // The card genuinely returned to the pool.
      const cardAfter1 = await db.sql`SELECT status FROM cards WHERE id = ${cardId}`;
      assert.equal((cardAfter1[0] as { status: string }).status, 'AVAILABLE');

      // A second, independent Vink reserves — with only one pool card, it MUST be the same one.
      const vink2 = await createFundedVink();
      const token2 = await provisionAndGetToken(vink2);
      const card2Row = await db.sql`SELECT card_id FROM card_assignments WHERE vink_id = ${vink2}`;
      assert.equal(
        (card2Row[0] as { card_id: string }).card_id,
        cardId,
        'the same physical card is genuinely reused',
      );
      assert.notEqual(token2, token1);

      // THE PROOF: Vink 1's old token can never again authorize — even against the SAME
      // physical card, now genuinely ACTIVE and assigned to Vink 2.
      const staleAttempt = await merchantAuth(vink2, token1);
      assert.equal(staleAttempt.json().outcome, 'DECLINED');
      const staleDecline = await db.sql`
        SELECT payload FROM outbox_events
        WHERE aggregate_id = ${vink2} AND event_type = 'MerchantAuthorizationDeclined'
        ORDER BY seq DESC LIMIT 1`;
      assert.equal(
        (staleDecline[0] as { payload: { reason: string } }).payload.reason,
        'WALLET_TOKEN_MISMATCH',
      );

      // Vink 2's own, genuinely current token works.
      const goodAttempt = await merchantAuth(vink2, token2);
      assert.equal(goodAttempt.json().outcome, 'APPROVED');
    });

    it('MCC blocking (§3.2/§36) is still enforced, provider-side, on a card-pool-provisioned card — closing the RM3B audit finding that enableCardCommand had no equivalent to legacy updateCardControls', async () => {
      await seedPoolCard();
      const vinkId = await createFundedVink();
      await provisionAndGetToken(vinkId);

      const cardRow = await db.sql`
        SELECT c.provider_card_id FROM card_assignments ca
        JOIN cards c ON c.id = ca.card_id WHERE ca.vink_id = ${vinkId}`;
      const providerCardId = (cardRow[0] as { provider_card_id: string }).provider_card_id;

      // Called directly against the provider (not the simulator HTTP route, which has its own,
      // separate, pre-existing quirk of calling VinkIn's engine regardless of the provider's
      // own decision — unrelated to RM3B, not fixed here, disclosed in the milestone report).
      // This proves the thing RM3B's own fix (calling `updateCardControls` inside
      // `provisionCardFromPoolCommand`) actually controls: the PROVIDER's real MCC block.
      const outcome = provider.simulateMerchantAuthorization({
        providerCardId,
        amount: { amountMinor: 1_000, currency: 'USD' },
        merchantId: 'CASH-ADVANCE-1',
        merchantName: 'Cash Advance Co',
        mcc: '6011', // cash-like — in BLOCKED_MCCS
        merchantCountry: 'US',
      });
      assert.equal(outcome.approved, false);
      assert.equal(outcome.declineReason, 'MCC_BLOCKED');
    });
  },
);
