/**
 * Real-time channel end-to-end — the PV8 exit gate ("multiple clients observe the same
 * authoritative Vink state without manual refresh"). Requires a real listening HTTP server
 * (WebSocket upgrades cannot go through Fastify's `.inject()`) and real PostgreSQL;
 * VINKIN_INTEGRATION=1.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { RealtimeHub } from './realtime/hub.ts';
import { startOutboxPublisher } from './realtime/outbox-publisher.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const PUBLISH_INTERVAL_MS = 30;

type Message = Record<string, unknown>;

function collector(ws: WebSocket): Message[] {
  const messages: Message[] = [];
  ws.addEventListener('message', (event) => {
    messages.push(JSON.parse(String(event.data)) as Message);
  });
  return messages;
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error(`connection failed: ${url}`)));
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number }> {
  return new Promise((resolve) => {
    ws.addEventListener('close', (event) => resolve({ code: event.code }));
  });
}

async function waitFor(
  messages: readonly Message[],
  predicate: (message: Message) => boolean,
  timeoutMs = 4_000,
): Promise<Message> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = messages.find(predicate);
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for a matching message; saw: ${JSON.stringify(messages)}`);
}

describe('real-time channel end-to-end (PostgreSQL + WebSocket)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let hub: RealtimeHub;
  let stopPublisher: () => void;
  let baseUrl: string;
  const stamp = Date.now();
  const users = { organizer: `pv8_org_${stamp}`, memberA: `pv8_a_${stamp}` };
  const tokens: Record<string, string> = {};

  function liveUrl(vinkId: string, who: keyof typeof users = 'organizer'): string {
    return `${baseUrl}/api/v1/vinks/${vinkId}/live?token=${tokens[who]}`;
  }

  before(async () => {
    db = await createIsolatedTestDb('realtime');
    hub = new RealtimeHub();
    const provider = new MockFinancialProvider();
    app = await buildApp({
      env: db.env,
      sql: db.sql,
      provider,
      hub,
      checkDb: async () => {
        await db.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    stopPublisher = startOutboxPublisher(db.sql, hub, PUBLISH_INTERVAL_MS);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}`;

    for (const [who, username] of Object.entries(users)) {
      const registered = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { username, displayName: username, password: 'integration-password-1' },
      });
      tokens[who] = registered.json().accessToken;
    }
  });

  after(async () => {
    stopPublisher();
    await app.close();
    await db.drop();
  });

  it('EXIT GATE: two clients on the same channel observe identical state without refreshing', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${tokens.organizer}` },
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
      headers: { authorization: `Bearer ${tokens.organizer}` },
      payload: { username: users.memberA },
    });
    const memberPid = added.json().id as string;

    const client1 = await connect(liveUrl(vinkId));
    const client2 = await connect(liveUrl(vinkId));
    const messages1 = collector(client1);
    const messages2 = collector(client2);

    // Both connections get an immediate, authoritative snapshot (Plan §14 reconnection rule
    // applies to every connection, first or not).
    const snapshot1 = await waitFor(messages1, (m) => m.type === 'snapshot');
    const snapshot2 = await waitFor(messages2, (m) => m.type === 'snapshot');
    assert.deepEqual(snapshot1, snapshot2);
    assert.equal((snapshot1.snapshot as { vink: { state: string } }).vink.state, 'DRAFT');

    // A REST action fans out to both live clients with matching content.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: { authorization: `Bearer ${tokens.organizer}` },
      payload: {
        method: 'CUSTOM_AMOUNT',
        amounts: [
          { participantId: organizerPid, amountMinor: 0 },
          { participantId: memberPid, amountMinor: 6_000 },
        ],
      },
    });
    const progress1 = await waitFor(messages1, (m) => m.type === 'funding_progress_updated');
    const progress2 = await waitFor(messages2, (m) => m.type === 'funding_progress_updated');
    assert.deepEqual(progress1, progress2);
    assert.equal(progress1.vinkId, vinkId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: { authorization: `Bearer ${tokens.organizer}` },
      payload: {},
    });
    const opened1 = await waitFor(messages1, (m) => m.eventType === 'VinkOpened');
    const opened2 = await waitFor(messages2, (m) => m.eventType === 'VinkOpened');
    assert.deepEqual(opened1, opened2);
    assert.equal(opened1.state, 'OPEN');

    // Funding the vink in one call cascades through several events, ending in vink_funded —
    // both clients see the SAME final state, live, with no manual refresh.
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
      headers: { authorization: `Bearer ${tokens.memberA}` },
      payload: {},
    });
    const funded1 = await waitFor(messages1, (m) => m.type === 'vink_funded');
    const funded2 = await waitFor(messages2, (m) => m.type === 'vink_funded');
    assert.deepEqual(funded1, funded2);
    assert.equal(funded1.state, 'FUNDED');
    assert.equal(funded1.fundedAmountMinor, 6_000);

    client1.close();
    client2.close();
  });

  it('reconnection replaces stale local state with a fresh authoritative snapshot', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${tokens.organizer}` },
      payload: {
        purchaseCategory: 'RETAIL',
        subtotalMinor: 3_000,
        tipMinor: 0,
        submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
        organizerDisplayName: 'Organizer',
      },
    });
    const vinkId = created.json().vink.id as string;

    const first = await connect(liveUrl(vinkId));
    const firstMessages = collector(first);
    const initialSnapshot = await waitFor(firstMessages, (m) => m.type === 'snapshot');
    assert.equal(
      (initialSnapshot.snapshot as { participants: unknown[] }).participants.length,
      1, // organizer only
    );
    first.close();
    await waitForClose(first);

    // State changes while this client is disconnected — it must never see the stale value.
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: { authorization: `Bearer ${tokens.organizer}` },
      payload: { username: users.memberA },
    });

    const second = await connect(liveUrl(vinkId));
    const secondMessages = collector(second);
    const freshSnapshot = await waitFor(secondMessages, (m) => m.type === 'snapshot');
    assert.equal(
      (freshSnapshot.snapshot as { participants: unknown[] }).participants.length,
      2, // reflects the change made while disconnected — never the stale count
    );
    second.close();
  });

  it('rejects unauthenticated, forbidden, and unknown-vink connections with distinct close codes', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${tokens.organizer}` },
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 1_000,
        tipMinor: 0,
        submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
        organizerDisplayName: 'Organizer',
      },
    });
    const vinkId = created.json().vink.id as string;

    const noToken = await connect(`${baseUrl}/api/v1/vinks/${vinkId}/live`);
    assert.equal((await waitForClose(noToken)).code, 4401);

    const notOwner = await connect(liveUrl(vinkId, 'memberA'));
    assert.equal((await waitForClose(notOwner)).code, 4403);

    const unknownVink = await connect(liveUrl('00000000-0000-4000-8000-000000000000'));
    assert.equal((await waitForClose(unknownVink)).code, 4404);
  });
});
