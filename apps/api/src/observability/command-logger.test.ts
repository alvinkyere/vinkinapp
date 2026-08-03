import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toCommandLogger, type PinoLike } from './command-logger.ts';

function recordingPino(): { log: PinoLike; calls: Array<[Record<string, unknown>, string]> } {
  const calls: Array<[Record<string, unknown>, string]> = [];
  return {
    calls,
    log: {
      info: (obj, msg) => calls.push([obj, msg]),
      error: (obj, msg) => calls.push([obj, msg]),
    },
  };
}

describe('toCommandLogger (ENG4 Slice 3)', () => {
  it('adapts .info to Pino call order (mergingObject, msg)', () => {
    const { log, calls } = recordingPino();
    const logger = toCommandLogger(log);
    logger.info('command_ran', { correlationId: 'abc', vinkId: 'v1' });
    assert.deepEqual(calls[0], [{ correlationId: 'abc', vinkId: 'v1' }, 'command_ran']);
  });

  it('adapts .error the same way, and defaults data to an empty object when omitted', () => {
    const { log, calls } = recordingPino();
    const logger = toCommandLogger(log);
    logger.error('command_failed');
    assert.deepEqual(calls[0], [{}, 'command_failed']);
  });
});
