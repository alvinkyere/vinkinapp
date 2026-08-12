import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ResendDeliveryProvider } from './resend-delivery-provider.ts';
import type { ResendClientLike } from './resend-delivery-provider.ts';

const TEMPLATE = {
  kind: 'guest_invite' as const,
  organizerName: 'Alvin',
  purpose: 'Grocery run',
  yourShareMinor: 4_000,
  deadline: '2026-08-10T18:00:00Z',
  link: 'https://join.vinkin.org/g/abc123',
};

function fakeClient(impl: ResendClientLike['emails']['send']): ResendClientLike {
  return { emails: { send: impl } };
}

describe('ResendDeliveryProvider', () => {
  it('sends the rendered subject/html/text from the configured fromEmail, and returns the provider message id', async () => {
    const calls: { from: string; to: string; subject: string; html: string; text: string }[] = [];
    const client = fakeClient(async (params) => {
      calls.push(params);
      return { data: { id: 'msg_123' }, error: null };
    });
    const provider = new ResendDeliveryProvider(
      { apiKey: 're_fake', fromEmail: 'VinkIn <hello@vinkin.org>' },
      {},
      client,
    );

    const result = await provider.send({
      destination: 'guest@example.com',
      method: 'EMAIL',
      template: TEMPLATE,
    });

    assert.equal(result.accepted, true);
    assert.equal(result.providerMessageId, 'msg_123');
    assert.equal(provider.providerName, 'resend');
    assert.equal(calls.length, 1);
    const captured = calls[0]!;
    assert.equal(captured.from, 'VinkIn <hello@vinkin.org>');
    assert.equal(captured.to, 'guest@example.com');
    assert.match(captured.subject, /Alvin/);
    assert.match(captured.html, /Grocery run/);
  });

  it('an SMS-method input resolves accepted:false rather than throwing or silently no-oping', async () => {
    const client = fakeClient(async () => {
      throw new Error('should never be called for SMS');
    });
    const provider = new ResendDeliveryProvider(
      { apiKey: 're_fake', fromEmail: 'hello@vinkin.org' },
      {},
      client,
    );
    const result = await provider.send({
      destination: '+15555550100',
      method: 'SMS',
      template: TEMPLATE,
    });
    assert.equal(result.accepted, false);
    assert.equal(result.failureReason, 'SMS_NOT_SUPPORTED_BY_RESEND');
  });

  it('an ordinary provider-side rejection (e.g. sandbox-domain recipient restriction) resolves accepted:false, never throws', async () => {
    const client = fakeClient(async () => ({
      data: null,
      error: {
        name: 'validation_error',
        message: 'You can only send testing emails to your own email address.',
      },
    }));
    const provider = new ResendDeliveryProvider(
      { apiKey: 're_fake', fromEmail: 'hello@vinkin.org' },
      {},
      client,
    );
    const result = await provider.send({
      destination: 'someone-else@example.com',
      method: 'EMAIL',
      template: TEMPLATE,
    });
    assert.equal(result.accepted, false);
    assert.match(result.failureReason ?? '', /validation_error/);
  });

  it('a misconfigured-adapter error (invalid/missing API key) throws rather than resolving accepted:false', async () => {
    const client = fakeClient(async () => ({
      data: null,
      error: { name: 'invalid_api_key', message: 'API key is invalid' },
    }));
    const provider = new ResendDeliveryProvider(
      { apiKey: 're_bad', fromEmail: 'hello@vinkin.org' },
      {},
      client,
    );
    await assert.rejects(
      () =>
        provider.send({ destination: 'guest@example.com', method: 'EMAIL', template: TEMPLATE }),
      /invalid_api_key/,
    );
  });

  it('isProduction:false renders the test-mode banner; isProduction:true does not', async () => {
    let capturedHtml = '';
    const client = fakeClient(async (params) => {
      capturedHtml = params.html;
      return { data: { id: 'msg_1' }, error: null };
    });
    const provider = new ResendDeliveryProvider(
      { apiKey: 're_fake', fromEmail: 'hello@vinkin.org' },
      { isProduction: false },
      client,
    );
    await provider.send({ destination: 'guest@example.com', method: 'EMAIL', template: TEMPLATE });
    assert.match(capturedHtml, /Test invitation/);
  });
});
