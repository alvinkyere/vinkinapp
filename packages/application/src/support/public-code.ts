import { randomBytes } from 'node:crypto';

/** Crockford-style alphabet without ambiguous characters (0/O, 1/I/L). */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 10;

/** Cryptographically random public code — never sequential, never guessable (Plan §21). */
export function newPublicCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}
