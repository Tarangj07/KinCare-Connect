'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/**
 * Phase 50 — login form.
 *
 * Posts to the SAME-ORIGIN BFF (`/api/auth/login`), which performs the real
 * API call server-side. This component never sees, stores or logs a token: the
 * server sets an HTTP-only cookie and the response body contains only the
 * public identity fields.
 *
 * Failure is displayed as failure. There is no path in this file that turns a
 * rejected sign-in into an authenticated-looking state.
 */
interface ApiErrorBody {
  error?: string;
  message?: string;
}

export default function LoginForm(): JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return; // no duplicate submission
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        let body: ApiErrorBody = {};
        try {
          body = (await response.json()) as ApiErrorBody;
        } catch {
          body = {};
        }
        // Distinguish an authentication failure from a service problem, and
        // never render a success message.
        setError(
          response.status === 401
            ? 'That email and password combination was not accepted.'
            : (body.message ?? 'Sign-in is currently unavailable. Please try again.'),
        );
        return;
      }

      // Session is now an HTTP-only cookie held by the server. Force a fresh
      // server render so the protected layout re-reads the cookie.
      router.replace('/dashboard');
      router.refresh();
    } catch {
      setError('The service could not be reached. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form" noValidate>
      <div className="field">
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          disabled={submitting}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          disabled={submitting}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <button type="submit" disabled={submitting} aria-busy={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </form>
  );
}