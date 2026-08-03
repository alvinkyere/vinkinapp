'use client';

import { useState } from 'react';
import { clearOperatorSession, loadOperatorSession } from '../../lib/operator-session';
import type { OperatorSession } from '../../lib/operator-session';
import { useHasMounted } from '../../lib/use-has-mounted';
import { LoginForm } from './LoginForm';
import { OperatorContext } from './operator-context';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const hasMounted = useHasMounted();
  const [signedInSession, setSignedInSession] = useState<OperatorSession | null>(null);
  const session = signedInSession ?? (hasMounted ? loadOperatorSession() : null);

  if (!hasMounted) return null;

  if (session === null) {
    return <LoginForm onSignedIn={setSignedInSession} />;
  }

  return (
    <OperatorContext.Provider
      value={{
        operatorToken: session.operatorToken,
        operatorName: session.operatorName,
        logout: () => {
          clearOperatorSession();
          setSignedInSession(null);
        },
      }}
    >
      {children}
    </OperatorContext.Provider>
  );
}
