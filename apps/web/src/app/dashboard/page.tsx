import type { ReactElement } from 'react';

import Link from 'next/link';

import { API_BASE_URL } from '../../lib/api-base';

interface DashboardCard {
  title: string;
  description: string;
  href: string;
  roles: string[];
}

const DASHBOARD_CARDS: DashboardCard[] = [
  {
    title: 'Emergency Alerts',
    description: 'View and manage emergency alert states.',
    href: '/dashboard/emergency',
    roles: ['FAMILY_ADMIN', 'FAMILY_MEMBER', 'CAREGIVER', 'DOCTOR', 'OBSERVER'],
  },
  {
    title: 'Health Measurements',
    description: 'Review health data and trends.',
    href: '/dashboard/health',
    roles: ['FAMILY_ADMIN', 'FAMILY_MEMBER', 'CAREGIVER', 'DOCTOR', 'OBSERVER'],
  },
  {
    title: 'Medications',
    description: 'Medication schedules and adherence.',
    href: '/dashboard/medications',
    roles: ['FAMILY_ADMIN', 'FAMILY_MEMBER', 'CAREGIVER', 'DOCTOR'],
  },
  {
    title: 'Documents',
    description: 'Access health records and files.',
    href: '/dashboard/documents',
    roles: ['FAMILY_ADMIN', 'FAMILY_MEMBER', 'CAREGIVER', 'DOCTOR', 'OBSERVER'],
  },
  {
    title: 'Appointments',
    description: 'Upcoming and past appointments.',
    href: '/dashboard/appointments',
    roles: ['FAMILY_ADMIN', 'FAMILY_MEMBER', 'CAREGIVER', 'DOCTOR'],
  },
];

export default function DashboardPage(): ReactElement {
  return (
    <main style={{ padding: '2rem', maxWidth: 960, margin: '0 auto' }}>
      <h1>Dashboard</h1>
      <p>Phase 15 — Web dashboards (per-role).</p>
      <section aria-label="Role-aware navigation" style={{ marginTop: '2rem' }}>
        <h2>Available Views</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          {DASHBOARD_CARDS.map((card) => (
            <article key={card.title} style={{ border: '1px solid #ddd', borderRadius: 12, padding: '1rem', background: '#fff' }}>
              <h3 style={{ marginTop: 0 }}>{card.title}</h3>
              <p style={{ color: '#4a4a4a', marginBottom: '1rem' }}>{card.description}</p>
              <p style={{ fontSize: '0.875rem', color: '#777' }}>
                Roles: {card.roles.join(', ')}
              </p>
              <Link href={card.href} style={{ display: 'inline-block', marginTop: '0.5rem', padding: '0.5rem 1rem', background: '#0f4c81', color: '#fff', textDecoration: 'none', borderRadius: 8 }}>
                View
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section aria-label="API health" style={{ marginTop: '3rem', padding: '1rem', borderTop: '2px solid #0f4c81' }}>
        <h2>API Health</h2>
        <Link href="/health" style={{ color: '#0f4c81' }}>Check API health →</Link>
      </section>
    </main>
  );
}
