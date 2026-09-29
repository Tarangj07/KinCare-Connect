/**
 * Phase 26 (WS6) — a self-provisioned throwaway PostgreSQL.
 *
 * Shared by `scripts/verify-release-artifact.mjs` and
 * `scripts/verify-ci-parity.mjs`, both of which previously defaulted to a
 * hardcoded `127.0.0.1:55432/ecc_p23` that they did not create. Two gates
 * sharing one hardcoded port is worse than one: they collide, and — the
 * failure that motivated this module — a reviewer running a gate alone got a
 * confusing `P1001: Can't reach database server` that reads like a defect in
 * the artifact rather than a missing prerequisite the gate should have
 * created for itself.
 *
 * Properties this module guarantees, because each one is a way the previous
 * behaviour could silently produce a WRONG answer rather than an error:
 *
 *   - **Unique container name.** Per-run suffix, so two concurrent runs never
 *     share a database.
 *   - **Unique database name.** Not just a unique server: a unique schema
 *     namespace inside it.
 *   - **Ephemeral host port**, allocated by the Docker daemon. A hardcoded
 *     port is exactly what makes one gate able to connect to another's
 *     database. Publishing on loopback only means the throwaway database is
 *     never reachable off-host.
 *   - **Real readiness**, not a single `pg_isready`. The official image runs a
 *     temporary server during init and then restarts; a single successful
 *     probe can be followed immediately by "the database system is shutting
 *     down".
 *   - **Idempotent destruction**, safe to call twice and safe on an absent
 *     container, so a `finally`, an `exit` handler and a signal handler can
 *     all call it without coordinating.
 *   - **Never targets `ecc`.** The database name is always prefixed, so a
 *     developer database cannot be reached even by a bug.
 *
 * It never modifies the Prisma schema or the migrations; `migrate()` runs
 * `migrate deploy` against the throwaway database, which is a read of the
 * migrations and a write only to the throwaway server.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const PG_IMAGE = 'postgres:16-alpine';

function docker(args) {
  return spawnSync('docker', args, { encoding: 'utf8' });
}

/**
 * A per-run identifier. The pid alone is insufficient — separate shells can
 * reuse one — so a random suffix is mixed in.
 */
function newRunId() {
  return `${process.pid.toString(36)}${randomBytes(4).toString('hex')}`;
}

export function createThrowawayPostgres({ label = 'p26' } = {}) {
  const runId = newRunId();
  const slug = runId.replace(/[^a-z0-9]/g, '');
  const container = `ecc-${label}-pg-${runId}`;
  const database = `ecc_${label}_${slug}`;
  const user = 'ecc';
  // Generated per run. It is printed nowhere and means nothing once the
  // container is gone, so it cannot be a credential worth leaking.
  const password = `${label}-${randomBytes(8).toString('hex')}`;

  let hostPort = null;

  function url() {
    if (!hostPort) throw new Error(`the throwaway database ${container} is not running`);
    return `postgresql://${user}:${password}@127.0.0.1:${hostPort}/${database}?connection_limit=5`;
  }

  function destroy() {
    // `docker rm -f` succeeds on an absent container, so this is safe to call
    // from a `finally`, an `exit` handler and a signal handler at once.
    docker(['rm', '-f', container]);
    hostPort = null;
  }

  function allocatedHostPort() {
    const res = docker(['port', container, '5432/tcp']);
    const first = (res.stdout ?? '').trim().split('\n')[0] ?? '';
    const m = /:(\d+)\s*$/.exec(first);
    if (!m) {
      throw new Error(`could not determine the published port of ${container}:\n${res.stdout}${res.stderr}`);
    }
    return Number(m[1]);
  }

  function acceptsQueries() {
    const r = docker(['exec', container, 'psql', '-U', user, '-d', database, '-tAc', 'select 1']);
    return r.status === 0;
  }

  function waitForReady() {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const live = docker([
        'ps',
        '--filter',
        `name=^${container}$`,
        '--filter',
        'status=running',
        '-q',
      ]).stdout.trim();
      if (!live) {
        const logs = docker(['logs', '--tail', '20', container]);
        throw new Error(`the throwaway PostgreSQL container exited during startup:\n${logs.stdout}${logs.stderr}`);
      }
      if (acceptsQueries()) {
        // Settle, then re-check. The gap catches a container still in the
        // entrypoint's temporary-server phase, where a query can succeed and
        // then the server shuts down.
        spawnSync('sleep', ['2']);
        if (acceptsQueries()) return;
      }
      spawnSync('sleep', ['1']);
    }
    const logs = docker(['logs', '--tail', '20', container]);
    throw new Error(`throwaway PostgreSQL never accepted queries within 90s:\n${logs.stdout}${logs.stderr}`);
  }

  function start() {
    const run = docker([
      'run',
      '-d',
      '--rm',
      '--name',
      container,
      '-e',
      `POSTGRES_USER=${user}`,
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      `POSTGRES_DB=${database}`,
      '-p',
      '127.0.0.1::5432',
      PG_IMAGE,
    ]);
    if (run.status !== 0) {
      throw new Error(`could not start the throwaway PostgreSQL container:\n${run.stderr}`);
    }
    try {
      hostPort = allocatedHostPort();
      waitForReady();
    } catch (err) {
      // A container that started but never became ready must not be left
      // behind holding a published port.
      destroy();
      throw err;
    }
    return url();
  }

  /**
   * Apply the migrations. Without this, any check that boots the application
   * fails on its first query, and the failure is indistinguishable from a
   * defect in the artifact.
   */
  function migrate(cwd) {
    const res = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url() },
      timeout: 10 * 60 * 1000,
    });
    if (res.status !== 0) {
      throw new Error(
        `prisma migrate deploy failed against the throwaway database:\n${(res.stdout ?? '').slice(-3000)}\n${(res.stderr ?? '').slice(-3000)}`,
      );
    }
  }

  return {
    container,
    database,
    start,
    url,
    migrate,
    destroy,
    /** Registers cleanup on exit and on the usual termination signals. */
    installCleanupHandlers() {
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.on(signal, () => {
          destroy();
          process.exit(130);
        });
      }
      process.on('exit', () => destroy());
      process.on('uncaughtException', (err) => {
        console.error(err);
        destroy();
        process.exit(1);
      });
    },
  };
}
