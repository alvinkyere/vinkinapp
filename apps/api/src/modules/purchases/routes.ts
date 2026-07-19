/**
 * Card + purchase transport (PV6). The genuine card lifecycle (provision, settle) is a thin
 * binding over the engine. The MERCHANT side — a swipe, a capture — is inherently a
 * simulator concern: those endpoints call the mock's provider-side helpers to obtain a
 * providerAuthorizationId, then invoke VinkIn's §17 decision engine. All simulator routes
 * are environment-allowlisted (governance §5) and mock-only.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  ApplicationError,
  authorizeMerchantPurchaseCommand,
  provisionCardCommand,
  reverseAuthorizationCommand,
  settlePurchaseCommand,
  type PurchaseCommandContext,
} from '../../../../../packages/application/src/index.ts';
import {
  DomainError,
  IllegalTransitionError,
  type VinkId,
} from '../../../../../packages/domain/src/index.ts';
import {
  MockFinancialProvider,
  type FinancialProvider,
} from '../../../../../packages/payment-provider/src/index.ts';
import type { Env } from '../../config/env.ts';
import type { Sql } from '../../db/client.ts';
import { simulatorRoutesPermitted } from '../../config/simulator-guard.ts';
import { PostgresVinkStore } from '../vinks/store.ts';

const merchantSchema = z.object({
  merchantName: z.string().min(1).max(120).default('Simulated Merchant'),
  merchantIdentifier: z.string().min(1).max(120).default('SIM-MERCHANT-1'),
  mcc: z
    .string()
    .regex(/^\d{4}$/)
    .default('5411'),
  amountMinor: z.number().int().positive(),
});

function mapError(error: unknown): { status: number; body: Record<string, unknown> } | null {
  if (error instanceof ApplicationError) {
    const status =
      error.code === 'VINK_NOT_FOUND' || error.code === 'PARTICIPANT_NOT_FOUND' ? 404 : 422;
    return { status, body: { error: error.code, message: error.message } };
  }
  if (error instanceof IllegalTransitionError) {
    return { status: 409, body: { error: error.code, message: error.message } };
  }
  if (error instanceof DomainError) {
    return { status: 422, body: { error: error.code, message: error.message } };
  }
  return null;
}

export function registerPurchaseRoutes(
  app: FastifyInstance,
  env: Env,
  sql: Sql,
  provider: FinancialProvider,
): void {
  if (!simulatorRoutesPermitted(env.VINKIN_ENV)) return; // PV6 surface is simulator-only
  const store = new PostgresVinkStore(sql);

  function contextFor(requestId: string): PurchaseCommandContext {
    return { uow: store, clock: { now: () => new Date() }, correlationId: requestId, provider };
  }

  async function handle(
    reply: FastifyReply,
    status: number,
    action: () => Promise<unknown>,
  ): Promise<unknown> {
    try {
      return reply.code(status).send(await action());
    } catch (error) {
      const mapped = mapError(error);
      if (mapped === null) throw error;
      return reply.code(mapped.status).send(mapped.body);
    }
  }

  // Provision the temporary card once a Vink is FUNDED.
  app.post('/internal/simulator/vinks/:vinkId/provision-card', async (request, reply) => {
    const { vinkId } = request.params as { vinkId: string };
    return handle(reply, 201, async () => {
      const card = await provisionCardCommand(contextFor(String(request.id)), {
        vinkId: vinkId as VinkId,
      });
      return {
        card: {
          id: card.id,
          status: card.status,
          displayLastFour: card.displayLastFour,
          spendingLimitMinor: card.spendingLimit.amountMinor,
        },
      };
    });
  });

  // A merchant swipes the card: provider-side auth (mock) → VinkIn §17 decision (engine).
  app.post('/internal/simulator/vinks/:vinkId/merchant-authorizations', async (request, reply) => {
    const { vinkId } = request.params as { vinkId: string };
    const body = merchantSchema.parse(request.body ?? {});
    return handle(reply, 201, async () => {
      const card = await store.getCardByVink(vinkId as VinkId);
      if (card === null) throw new ApplicationError('PARTICIPANT_NOT_FOUND', 'no card to charge');
      let providerAuthorizationId = `ext_auth_${Date.now()}`;
      if (provider instanceof MockFinancialProvider) {
        const outcome = provider.simulateMerchantAuthorization({
          providerCardId: card.providerCardId,
          amount: { amountMinor: body.amountMinor, currency: 'USD' },
          merchantId: body.merchantIdentifier,
          merchantName: body.merchantName,
          mcc: body.mcc,
          merchantCountry: 'US',
        });
        if (outcome.providerAuthorizationId !== undefined) {
          providerAuthorizationId = outcome.providerAuthorizationId;
        }
      }
      const result = await authorizeMerchantPurchaseCommand(contextFor(String(request.id)), {
        vinkId: vinkId as VinkId,
        providerAuthorizationId,
        merchantName: body.merchantName,
        merchantIdentifier: body.merchantIdentifier,
        mcc: body.mcc,
        amountMinor: body.amountMinor,
      });
      return {
        outcome: result.outcome,
        authorizationId: result.authorization.id,
        providerAuthorizationId,
        vinkState: result.vinkState,
      };
    });
  });

  app.post(
    '/internal/simulator/authorizations/:authorizationId/reverse',
    async (request, reply) => {
      const { authorizationId } = request.params as { authorizationId: string };
      const body = z.object({ vinkId: z.uuid() }).parse(request.body);
      return handle(reply, 200, async () => {
        const vink = await reverseAuthorizationCommand(contextFor(String(request.id)), {
          vinkId: body.vinkId as VinkId,
          authorizationId,
        });
        return { vinkState: vink.state };
      });
    },
  );

  // The merchant captures/settles against the authorization.
  app.post(
    '/internal/simulator/authorizations/:authorizationId/capture',
    async (request, reply) => {
      const { authorizationId } = request.params as { authorizationId: string };
      const body = z
        .object({
          vinkId: z.uuid(),
          providerAuthorizationId: z.string().optional(),
          settledAmountMinor: z.number().int().positive(),
        })
        .parse(request.body);
      return handle(reply, 200, async () => {
        if (
          provider instanceof MockFinancialProvider &&
          body.providerAuthorizationId !== undefined
        ) {
          provider.simulateMerchantCapture(body.providerAuthorizationId, {
            amountMinor: body.settledAmountMinor,
            currency: 'USD',
          });
        }
        const result = await settlePurchaseCommand(contextFor(String(request.id)), {
          vinkId: body.vinkId as VinkId,
          authorizationId,
          settledAmountMinor: body.settledAmountMinor,
        });
        return {
          settlementStatus: result.settlement.status,
          varianceMinor: result.settlement.varianceAmount.amountMinor,
          vinkState: result.vinkState,
        };
      });
    },
  );
}
