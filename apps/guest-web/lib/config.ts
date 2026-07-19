export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3000';

export function wsBaseUrl(): string {
  return API_BASE_URL.replace(/^http/, 'ws');
}
