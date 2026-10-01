import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';

import styles from './login.module.css';
import LoginForm from './login-form';

/**
 * Phase 50 — sign-in page.
 *
 * A signed-in user is sent straight to the dashboard; an anonymous visitor is
 * shown the form. The check happens on the SERVER (this page reads the HTTP-only
 * session cookie), so no dashboard markup is ever rendered for an
 * unauthenticated request.
 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in · KinCare Connect' };

async function isSignedIn(): Promise<boolean> {
  const { readIdentity } = await import('@/app/api/_session');
  const user = await readIdentity();
  return user !== null;
}

export default async function LoginPage(): Promise<ReactElement> {
  if (await isSignedIn()) {
    redirect('/dashboard');
  }

  return (
    <main className={styles.main}>
      <section className={styles.card} aria-labelledby="signin-heading">
        <h1 id="signin-heading" className={styles.title}>
          Sign in
        </h1>
        <p className={styles.subtitle}>
          Use the account created for you on this platform. Access to a relative is granted through your care
          circle, not chosen here.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}