// Official VinkIn product screenshot capture for the guest experience (website use). Runs a
// real production build of apps/guest-web (see playwright.config.ts for why not `next dev`)
// at the iPhone 16 Pro viewport — matched to the organizer app's own screenshot device
// (integration_test/screenshot_test.dart) — against the REAL local backend. Drives the same
// deterministic showcase Vink shape (Alvin organizer, Ama + Jordan existing members, Nana a
// guest, $120 / 4 = $30.00 each) through Nana's own real journey — never a staged screen.
//
// Refresh pass (2026-08-05): builds with NEXT_PUBLIC_GUEST_CONTRIBUTION_STATUS_UI=1 (the
// D23/D24/D25-correct SessionViewV2, already shipped, off by default) — that is the ONLY
// guest-web view that renders RM4C's real `PaymentPanel`/Stripe Elements at all; the flag-off
// legacy SessionView still calls the old provider-agnostic direct-authorize route, which has
// no real card-collection UI. Requires the real backend booted with
// VINKIN_FINANCIAL_PROVIDER=stripe_sandbox, VINKIN_STRIPE_WEBHOOKS_ENABLED=1, and a live
// `stripe listen --forward-to http://127.0.0.1:3000/webhooks/stripe/sandbox` process, plus
// STRIPE_SECRET_KEY in this process's own env (used only to confirm Alvin/Ama/Jordan's
// contributions server-side, via the same documented Stripe test-PaymentMethod technique
// `packages/providers/src/stripe/stripe.contract.test.ts` uses — their own UI is out of this
// guest-facing app's scope). Nana's OWN payment, unlike mobile's, is driven through the real
// browser end to end — Stripe's Payment Element is a normal in-page iframe here, not a native
// platform view controller, so unlike the mobile app it CAN be filled by real automation.

import { test, devices } from '@playwright/test';
import path from 'node:path';

test.use({ ...devices['iPhone 16 Pro'], browserName: 'chromium' });

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const OUT_DIR = path.resolve(__dirname, '../../../artifacts/product-screenshots/raw');

interface RegisterResponse {
  accessToken: string;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

async function registerUser(username: string, displayName: string): Promise<string> {
  const response = await api('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, displayName, password: 'showcase-password-1' }),
  });
  const body = (await response.json()) as RegisterResponse;
  return body.accessToken;
}

/** Confirms a Stripe PaymentIntent server-side using Stripe's own documented always-succeeds
 * test PaymentMethod (https://docs.stripe.com/testing) — the same technique
 * `stripe.contract.test.ts`'s `confirmContributionPaymentIntent` hook uses. `clientSecret` is
 * `pi_..._secret_...`; the PaymentIntent id is everything before `_secret_`. */
async function confirmStripePaymentIntent(clientSecret: string): Promise<void> {
  const intentId = clientSecret.split('_secret_')[0];
  const auth = Buffer.from(`${STRIPE_SECRET_KEY}:`).toString('base64');
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${intentId}/confirm`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${auth}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'payment_method=pm_card_visa',
  });
  if (!response.ok) {
    throw new Error(`Stripe confirm failed: ${response.status} ${await response.text()}`);
  }
}

/** Creates a real RM4C payment session for a member/organizer (their own UI is the mobile
 * app's scope, not this guest-facing app's) and confirms it the same server-side way. */
async function payMemberViaStripe(vinkId: string, bearerToken: string): Promise<void> {
  const response = await api(`/api/v1/vinks/${vinkId}/contributions/payment-session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearerToken}` },
    // `api()` always sets content-type: application/json — Fastify rejects a truly empty body
    // under that content-type (FST_ERR_CTP_EMPTY_JSON_BODY), so an explicit empty object.
    body: '{}',
  });
  const body = (await response.json()) as { clientSecret?: string | null; error?: string };
  if (!response.ok || body.clientSecret === undefined) {
    throw new Error(`payment-session failed: ${response.status} ${JSON.stringify(body)}`);
  }
  if (body.clientSecret === null) return; // an in-flight session was replayed
  await confirmStripePaymentIntent(body.clientSecret);
}

test('capture the guest-web product screenshots', async ({ page }) => {
  test.skip(
    !STRIPE_SECRET_KEY,
    'set STRIPE_SECRET_KEY to confirm Alvin/Ama/Jordan\'s contributions server-side',
  );
  const stamp = Date.now();

  // --- Build the same showcase Vink shape as the organizer screenshots -------------
  const alvinToken = await registerUser(`alvin_web_${stamp}`, 'Alvin');
  const amaToken = await registerUser(`amak_web_${stamp}`, 'Ama');
  const jordanToken = await registerUser(`jordank_web_${stamp}`, 'Jordan');

  const created = await (
    await api('/api/v1/vinks', {
      method: 'POST',
      headers: { authorization: `Bearer ${alvinToken}` },
      body: JSON.stringify({
        purpose: 'Groceries for movie night',
        purchaseCategory: 'GROCERY',
        subtotalMinor: 12_000,
        tipMinor: 0,
        organizerDisplayName: 'Alvin',
      }),
    })
  ).json();
  const vinkId = created.vink.id as string;
  const publicCode = created.vink.publicCode as string;

  await api(`/api/v1/vinks/${vinkId}/participants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${alvinToken}` },
    body: JSON.stringify({ username: `amak_web_${stamp}` }),
  });
  await api(`/api/v1/vinks/${vinkId}/participants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${alvinToken}` },
    body: JSON.stringify({ username: `jordank_web_${stamp}` }),
  });
  const guestInvite = await (
    await api(`/api/v1/vinks/${vinkId}/guests`, {
      method: 'POST',
      headers: { authorization: `Bearer ${alvinToken}` },
      body: JSON.stringify({ displayName: 'Nana' }),
    })
  ).json();
  const guestToken = guestInvite.guestToken as string;

  await api(`/api/v1/vinks/${vinkId}/split`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${alvinToken}` },
    body: JSON.stringify({ method: 'EQUAL' }),
  });
  await api(`/api/v1/vinks/${vinkId}/open`, {
    method: 'POST',
    headers: { authorization: `Bearer ${alvinToken}` },
    body: JSON.stringify({}),
  });

  // --- Nana redeems her real invite link — no account, entirely through the browser -
  await page.goto(`/g/${guestToken}`);
  await page.waitForURL(`**/join/${publicCode}`);
  await page.getByText('Hi, Nana').waitFor();
  await page.waitForTimeout(500); // let the entrance layout settle before capturing

  await page.screenshot({ path: path.join(OUT_DIR, '10-guest-join.png') });

  // --- The real Stripe sandbox payment-method panel: sandbox banner + method list ----
  await page.getByText('Test mode — no real money will be charged.').waitFor({ timeout: 10_000 });
  await page.getByText('Debit or credit card').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, '11-guest-contribution.png') });

  // --- Real Stripe Elements card entry — a real, live-typed test card, unlike mobile's
  // native PaymentSheet, this IS drivable: Stripe's Payment Element is a normal in-page
  // iframe here.
  await page.getByText('Debit or credit card').click();
  // Stripe's unified Payment Element renders TWO "Secure payment input frame"-titled iframes:
  // the first hosts a Card/Bank/Klarna tab selector (this sandbox account has more than one
  // payment method type enabled on the PaymentIntent), the second (the "easel" frame) only
  // populates its actual input fields once "Card" is explicitly selected.
  const tabsFrame = page.frameLocator('iframe[title="Secure payment input frame"]').first();
  await tabsFrame.getByRole('button', { name: 'Card', exact: true }).click();
  const stripeFrame = page.frameLocator('iframe[title="Secure payment input frame"]').last();
  await stripeFrame.locator('input[name="number"]').fill('4242424242424242');
  await stripeFrame.locator('input[name="expiry"]').fill('12/34');
  await stripeFrame.locator('input[name="cvc"]').fill('123');
  const postal = stripeFrame.locator('input[name="postalCode"]');
  if (await postal.count()) {
    await postal.fill('94103');
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, '17-guest-stripe-card-entry.png') });

  await page.getByRole('button', { name: /^Pay \$30\.00$/ }).click();

  // --- Nana's own outcome. A real, disclosed product gap this run confirmed (not a bug to
  // route around): `SessionView.tsx`'s own `paymentInProgress` is "cleared only on reload"
  // by design (RM4C-C's own comment) — even once the real webhook confirms the payment
  // server-side (proven directly: the DOM's own sr-only status word flips to "Paid"), the
  // visible card stays on "Processing your payment…" until the guest manually reloads,
  // never advancing to the "You're in." success sentence on its own. This capture is that
  // real, current screen — not a staged "success" moment `contributionStatusSentence` would
  // otherwise produce.
  await page.getByText('Processing your payment…').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1_500); // let the webhook-confirmed sr-only status settle too
  await page.screenshot({ path: path.join(OUT_DIR, '12-guest-live-progress.png') });

  // --- D44/Invites: with VINKIN_INVITES_ENABLED=1, `addParticipantCommand` inserted Ama and
  // Jordan as INVITED, not JOINED — `createContributionPaymentSessionCommand`'s own
  // `findOwnParticipant` requires JOINED, so they accept their real invites first, exactly as
  // today's real product requires (same real interaction the mobile capture run caught).
  await api(`/api/v1/vinks/${vinkId}/participants/me/accept`, {
    method: 'POST',
    headers: { authorization: `Bearer ${amaToken}` },
    body: '{}',
  });
  await api(`/api/v1/vinks/${vinkId}/participants/me/accept`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jordanToken}` },
    body: '{}',
  });

  // --- Alvin, Ama, and Jordan pay their own shares the real way (server-side Stripe
  // confirmation — their own UI is the organizer app's scope, not this guest's browser
  // session) — Nana's page must pick this up live, no reload.
  await payMemberViaStripe(vinkId, alvinToken);
  await payMemberViaStripe(vinkId, amaToken);
  await payMemberViaStripe(vinkId, jordanToken);

  await page.getByText('$120.00 of $120.00 funded').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, '13-guest-funded.png') });
});
