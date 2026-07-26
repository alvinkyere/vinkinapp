import { execFileSync } from 'node:child_process';
import process from 'node:process';

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);

const forbidden = [
  /(^|\/)\.env(\.|$)/,
  /\.jks$/,
  /\.keystore$/,
  /\.p8$/,
  /\.p12$/,
  /google-services\.json$/,
  /GoogleService-Info\.plist$/,
  /key\.properties$/,
];

const allowedExamples = new Set(['.env.example']);
const violations = tracked.filter(
  (path) => !allowedExamples.has(path) && forbidden.some((pattern) => pattern.test(path)),
);
if (violations.length > 0) {
  console.error(`Refusing committed secret/signing files:\n${violations.join('\n')}`);
  process.exit(1);
}

console.log('Secret-file guard passed: no known credential or signing files are tracked.');
