import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderEmail } from './templates.ts';

describe('renderEmail', () => {
  it('guest_invite includes organizer, purpose, share, deadline, and a join link', () => {
    const rendered = renderEmail(
      {
        kind: 'guest_invite',
        organizerName: 'Alvin',
        purpose: 'Grocery run',
        yourShareMinor: 4_000,
        deadline: '2026-08-10T18:00:00Z',
        link: 'https://join.vinkin.org/g/abc123',
      },
      true,
    );
    assert.match(rendered.subject, /Alvin/);
    assert.match(rendered.html, /Grocery run/);
    assert.match(rendered.html, /\$40\.00/);
    assert.match(rendered.html, /join\.vinkin\.org\/g\/abc123/);
    assert.match(rendered.text, /\$40\.00/);
    assert.match(rendered.text, /join\.vinkin\.org\/g\/abc123/);
  });

  it('guest_invite in non-production shows the test-mode banner; production does not', () => {
    const input = {
      kind: 'guest_invite' as const,
      organizerName: 'Alvin',
      purpose: 'Grocery run',
      yourShareMinor: 4_000,
      deadline: '2026-08-10T18:00:00Z',
      link: 'https://join.vinkin.org/g/abc123',
    };
    const dev = renderEmail(input, false);
    const prod = renderEmail(input, true);
    assert.match(dev.html, /Test invitation/);
    assert.doesNotMatch(prod.html, /Test invitation/);
  });

  it('member_invite carries no link, per D19/member-invite\'s own "no link" rule', () => {
    const rendered = renderEmail(
      {
        kind: 'member_invite',
        organizerName: 'Alvin',
        purpose: 'Grocery run',
        yourShareMinor: 2_500,
        deadline: '2026-08-10T18:00:00Z',
      },
      true,
    );
    assert.match(rendered.html, /Open the VinkIn app/);
    assert.doesNotMatch(rendered.html, /href="https?:\/\//);
  });

  it('email_verification, password_reset, and magic_link each render their own link and copy', () => {
    const verify = renderEmail({ kind: 'email_verification', link: 'https://x/verify' }, true);
    assert.match(verify.subject, /Verify/);
    assert.match(verify.html, /x\/verify/);

    const reset = renderEmail({ kind: 'password_reset', link: 'https://x/reset' }, true);
    assert.match(reset.subject, /Reset/);
    assert.match(reset.html, /x\/reset/);

    const magic = renderEmail({ kind: 'magic_link', link: 'https://x/magic' }, true);
    assert.match(magic.subject, /sign-in/i);
    assert.match(magic.html, /x\/magic/);
  });

  it('never leaks HTML from an untrusted-shaped field without escaping', () => {
    const rendered = renderEmail(
      {
        kind: 'guest_invite',
        organizerName: '<script>alert(1)</script>',
        purpose: 'Grocery run',
        yourShareMinor: 1_000,
        deadline: '2026-08-10T18:00:00Z',
        link: 'https://join.vinkin.org/g/abc',
      },
      true,
    );
    assert.doesNotMatch(rendered.html, /<script>/);
    assert.match(rendered.html, /&lt;script&gt;/);
  });
});
