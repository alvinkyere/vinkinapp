/**
 * ENG4 Slice 5: proves `withSpan`/`tagActiveSpan` against a real, in-process OTel SDK — not
 * mocked. Uses the same `NodeSDK` class `otel.ts` already runs in production, configured with
 * an `InMemorySpanExporter` instead of the real OTLP one, so exported spans can be asserted on
 * directly: real span names, real attributes, real parent-child nesting, real error recording.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { withSpan, tagActiveSpan } from './tracing.ts';

describe('tracing (ENG4 Slice 5)', () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;

  before(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  after(async () => {
    await provider.shutdown();
  });

  function spans(): ReadableSpan[] {
    return exporter.getFinishedSpans();
  }

  it('withSpan creates a real span with the given name and attributes, then ends it', async () => {
    exporter.reset();
    await withSpan('test.op', { 'vink.id': 'v1', 'correlation.id': 'c1' }, async () => 'ok');

    const finished = spans();
    assert.equal(finished.length, 1);
    assert.equal(finished[0]!.name, 'test.op');
    assert.equal(finished[0]!.attributes['vink.id'], 'v1');
    assert.equal(finished[0]!.attributes['correlation.id'], 'c1');
    assert.equal(finished[0]!.status.code, 1); // SpanStatusCode.OK
  });

  it('withSpan records the exception and sets ERROR status on failure, then still rethrows', async () => {
    exporter.reset();
    await assert.rejects(
      () =>
        withSpan('test.failing-op', {}, async () => {
          throw new Error('boom');
        }),
      /boom/,
    );

    const finished = spans();
    assert.equal(finished.length, 1);
    assert.equal(finished[0]!.status.code, 2); // SpanStatusCode.ERROR
    assert.equal(finished[0]!.status.message, 'boom');
    assert.equal(
      finished[0]!.events.some((e) => e.name === 'exception'),
      true,
    );
  });

  it('a nested withSpan call becomes a real child of the outer span (propagation proof)', async () => {
    exporter.reset();
    await withSpan('outer', {}, async () => {
      await withSpan('inner', {}, async () => 'ok');
    });

    const finished = spans();
    assert.equal(finished.length, 2);
    const outer = finished.find((s) => s.name === 'outer')!;
    const inner = finished.find((s) => s.name === 'inner')!;
    assert.equal(inner.parentSpanContext?.spanId, outer.spanContext().spanId);
    assert.equal(inner.spanContext().traceId, outer.spanContext().traceId);
  });

  it('tagActiveSpan tags the currently-active span, visible on the exported span', async () => {
    exporter.reset();
    await withSpan('tagged-op', {}, async () => {
      tagActiveSpan({ 'vink.id': 'v2' });
    });

    const finished = spans();
    assert.equal(finished[0]!.attributes['vink.id'], 'v2');
  });

  it('tagActiveSpan is a safe no-op with no active span', () => {
    assert.doesNotThrow(() => tagActiveSpan({ 'vink.id': 'v3' }));
  });
});
