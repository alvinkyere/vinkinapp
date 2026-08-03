'use client';

import { createContext, useContext } from 'react';

export interface OperatorContextValue {
  operatorToken: string;
  operatorName: string;
  logout: () => void;
}

export const OperatorContext = createContext<OperatorContextValue | null>(null);

export function useOperator(): OperatorContextValue {
  const value = useContext(OperatorContext);
  if (value === null) throw new Error('useOperator() called outside AuthGate');
  return value;
}
