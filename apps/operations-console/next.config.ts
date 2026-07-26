import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {/* config options here */};

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
