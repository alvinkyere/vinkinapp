// The operator token lives in localStorage — a deliberate PV11 simplification (D17: a
// shared operator credential, not per-operator accounts), matching guest-web's own
// documented tradeoff for the same reason: this is a mock-money validation build, and the
// console is meant for a handful of trusted people, not a multi-tenant product.
const TOKEN_KEY = 'vinkin.ops.token';
const NAME_KEY = 'vinkin.ops.operatorName';

export interface OperatorSession {
  operatorToken: string;
  operatorName: string;
}

export function loadOperatorSession(): OperatorSession | null {
  if (typeof window === 'undefined') return null;
  const operatorToken = window.localStorage.getItem(TOKEN_KEY);
  const operatorName = window.localStorage.getItem(NAME_KEY);
  if (operatorToken === null || operatorName === null) return null;
  return { operatorToken, operatorName };
}

export function saveOperatorSession(session: OperatorSession): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, session.operatorToken);
  window.localStorage.setItem(NAME_KEY, session.operatorName);
}

export function clearOperatorSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(NAME_KEY);
}
