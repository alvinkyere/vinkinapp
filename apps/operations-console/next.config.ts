import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// SH1-C (ZAP baseline scan finding, Medium): this app had ZERO security headers — ENG8's
// `@fastify/helmet` work only ever covered `apps/api`, never the two Next.js frontends. An
// operator's authenticated session makes clickjacking here specifically worth closing.
// Deliberately scoped to clickjacking/MIME-sniffing/referrer defenses only, not a full
// script-src CSP lockdown — the same "don't guess at a CSP that breaks hydration without
// dedicated testing" caution ENG8 disclosed for the API's own CSP (which it left off
// entirely for inline-script pages); `frame-ancestors 'none'` + `object-src`/`base-uri`
// restrictions are the part that's unambiguously safe to add without risking the app.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false, // SH1-C (ZAP): don't disclose the framework via X-Powered-By
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

const canUploadSourceMaps =
  process.env.SENTRY_AUTH_TOKEN !== undefined &&
  process.env.SENTRY_ORG !== undefined &&
  process.env.SENTRY_PROJECT !== undefined;

export default canUploadSourceMaps
  ? withSentryConfig(nextConfig, {
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: true,
      disableLogger: true,
    })
  : nextConfig;
