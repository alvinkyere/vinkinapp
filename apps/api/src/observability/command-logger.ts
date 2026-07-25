/**
 * ENG4 Slice 3: adapts a Pino-shaped logger (Fastify's `request.log`, or the shared
 * `createLogger` factory for non-HTTP processes) to `packages/application`'s dependency-free
 * `CommandLogger` port.
 */

import type { CommandLogger } from '../../../../packages/application/src/index.ts';

export interface PinoLike {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export function toCommandLogger(log: PinoLike): CommandLogger {
  return {
    info: (event, data) => log.info(data ?? {}, event),
    error: (event, data) => log.error(data ?? {}, event),
  };
}
