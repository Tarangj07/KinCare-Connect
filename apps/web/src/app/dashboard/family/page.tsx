import type { ReactElement } from 'react';

export default function SeniorDashboardPage(): ReactElement {
  return (
    <main style={{ padding: '2rem', maxWidth: 960, margin: '0 auto' }}>
      <h1>Family Dashboard</h1>
      <p>Role: family. Access to this view requires server-side authorization through CareCircle membership.</p>
      <p>No authorization decisions are made by the client; the backend verifies access independently.</p>
    </main>
  );
}
