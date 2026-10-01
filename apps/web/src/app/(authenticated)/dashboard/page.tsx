import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';

import styles from '../shell.module.css';
import { loadAppShell, loadAppointments, loadMedications } from '@/lib/shell-data';
import { formatDateOfBirth, seniorLabel } from '@/lib/seniors';

/**
 * Phase 50 — authenticated dashboard.
 *
 * Shows only what the backend actually returned for the selected senior.
 * Counts shown are real list lengths from real API responses; nothing is
 * estimated or hardcoded.
 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dashboard · KinCare Connect' };

export default async function DashboardPage(): Promise<ReactElement> {
  const shell = await loadAppShell();

  if (shell.seniorsError) {
    return (
      <section aria-labelledby="load-error">
        <h1 id="load-error">We could not load your seniors</h1>
        <p role="alert" className={styles.error}>
          {shell.seniorsError.message}
        </p>
        <p className={styles.muted}>
          This is a problem with the service, not a sign-in problem. Your session is still valid — please try again
          shortly.
        </p>
      </section>
    );
  }

  if (shell.seniors.isEmpty) {
    return (
      <section aria-labelledby="no-seniors">
        <h1 id="no-seniors">No seniors are linked to your account yet</h1>
        <p>
          Access to a relative is granted through a care circle. When someone adds you to their relative&apos;s care
          circle, that senior will appear here.
        </p>
        <p className={styles.muted}>
          There is no self-service way to link a senior in this release, and we will not claim otherwise.
        </p>
      </section>
    );
  }

  if (!shell.seniors.selected) {
    return (
      <section aria-labelledby="choose-senior">
        <h1 id="choose-senior">Choose a senior</h1>
        <p>You have access to {shell.seniors.seniors.length} seniors. Select one to continue.</p>
        <ul className={styles.seniorList}>
          {shell.seniors.seniors.map((s) => (
            <li key={s.id}>
              <Link href={`/seniors?senior=${encodeURIComponent(s.id)}`}>{seniorLabel(s)}</Link>{' '}
              <span className={styles.muted}>({s.role.replace('_', ' ').toLowerCase()})</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const senior = shell.seniors.selected;
  const [medications, appointments] = await Promise.all([
    loadMedications(senior.id),
    loadAppointments(senior.id),
  ]);

  return (
    <section aria-labelledby="dashboard-heading">
      <h1 id="dashboard-heading">{seniorLabel(senior)}</h1>
      <dl className={styles.facts}>
        <div>
          <dt>Date of birth</dt>
          <dd>{formatDateOfBirth(senior.dateOfBirth)}</dd>
        </div>
        <div>
          <dt>Care circles</dt>
          <dd>{senior.circleNames.length > 0 ? senior.circleNames.join(', ') : 'None recorded'}</dd>
        </div>
      </dl>

      <p className={styles.muted}>
        Your relationship to this senior: <strong>{senior.role.replace('_', ' ').toLowerCase()}</strong>
        {senior.circleNames.length > 0 ? ` in ${senior.circleNames.join(', ')}` : ''}
      </p>

      <div className={styles.grid}>
        <MedicationPanel result={medications} />
        <AppointmentPanel result={appointments} />
      </div>
    </section>
  );
}

function MedicationPanel({
  result,
}: {
  result: { data: Array<{ id: string; name: string; dosage: string; isActive: boolean }> | null; error: { kind: string; message: string } | null };
}): ReactElement {
  return (
    <article className={styles.card}>
      <h2>Medications</h2>
      {result.error ? (
        <p role="alert" className={styles.error}>
          {result.error.kind === 'forbidden'
            ? 'You are not permitted to view medications for this senior.'
            : result.error.message}
        </p>
      ) : result.data === null ? (
        <p>Not available yet.</p>
      ) : result.data.length === 0 ? (
        <p className={styles.muted}>No medications recorded.</p>
      ) : (
        <>
          <p className={styles.muted}>{result.data.length} recorded</p>
          <ul className={styles.plainList}>
            {result.data.map((m) => (
              <li key={m.id}>
                <strong>{m.name}</strong> — {m.dosage}
                {m.isActive ? '' : ' (inactive)'}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className={styles.notAvailable}>Medication management (add/edit) is not available yet.</p>
    </article>
  );
}

function AppointmentPanel({
  result,
}: {
  result: { data: Array<{ id: string; title: string; startsAt: string; status: string }> | null; error: { kind: string; message: string } | null };
}): ReactElement {
  return (
    <article className={styles.card}>
      <h2>Appointments</h2>
      {result.error ? (
        <p role="alert" className={styles.error}>
          {result.error.kind === 'forbidden'
            ? 'You are not permitted to view appointments for this senior.'
            : result.error.message}
        </p>
      ) : result.data === null ? (
        <p>Not available yet.</p>
      ) : result.data.length === 0 ? (
        <p className={styles.muted}>No appointments recorded.</p>
      ) : (
        <>
          <p className={styles.muted}>{result.data.length} recorded</p>
          <ul className={styles.plainList}>
            {result.data.map((a) => (
              <li key={a.id}>
                <strong>{a.title}</strong> — {new Date(a.startsAt).toLocaleDateString('en-GB')} ({a.status})
              </li>
            ))}
          </ul>
        </>
      )}
      <p className={styles.notAvailable}>Appointment management (add/edit) is not available yet.</p>
    </article>
  );
}