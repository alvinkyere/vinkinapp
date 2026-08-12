/**
 * RM4C-B (D49) — a thin transport binding over `paymentModeInfo` (D13: no business logic
 * lives here). Public, unauthenticated: nothing returned is sensitive — a Stripe publishable
 * key is designed to be embedded in client-side code, and the method list is static
 * configuration, not a specific vink's or user's data.
 */

import type { FastifyInstance } from 'fastify';
import { paymentModeInfo } from '../../../../../packages/application/src/index.ts';
import type { Env } from '../../config/env.ts';

export function registerPaymentMethodRoutes(app: FastifyInstance, env: Env): void {
  app.get('/api/v1/payment-methods', async () =>
    paymentModeInfo({
      financialProvider: env.VINKIN_FINANCIAL_PROVIDER,
      stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
    }),
  );
}
