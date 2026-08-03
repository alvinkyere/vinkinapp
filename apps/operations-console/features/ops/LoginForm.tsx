'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { login } from '../../lib/api';
import { ApiError } from '../../lib/api-error';
import { saveOperatorSession } from '../../lib/operator-session';
import type { OperatorSession } from '../../lib/operator-session';

export function LoginForm({ onSignedIn }: { onSignedIn: (session: OperatorSession) => void }) {
  const [operatorName, setOperatorName] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => login(operatorName.trim(), password),
    onSuccess: (result) => {
      const session = { operatorToken: result.operatorToken, operatorName: result.operatorName };
      saveOperatorSession(session);
      onSignedIn(session);
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">VinkIn Operations Console</h1>
        <p className="mt-1 text-sm text-gray-500">
          Internal tool — mock-money validation build only.
        </p>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (operatorName.trim().length === 0 || password.length === 0) return;
          mutation.mutate();
        }}
      >
        <label htmlFor="operatorName" className="text-sm font-medium text-gray-700">
          Your name
        </label>
        <input
          id="operatorName"
          value={operatorName}
          onChange={(event) => setOperatorName(event.target.value)}
          required
          className="rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
          placeholder="e.g. Alex"
        />
        <label htmlFor="password" className="text-sm font-medium text-gray-700">
          Operator password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        {mutation.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Sign-in failed.'}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="mt-2 rounded-lg bg-gray-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
