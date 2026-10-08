/**
 * Shared Nest/Node Sentry bootstrap (Wave D).
 * Import first in main.ts: `import './instrument';`
 */
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN?.trim();
const environment =
  process.env.SENTRY_ENVIRONMENT?.trim() ||
  process.env.APP_ENV?.trim() ||
  process.env.NODE_ENV ||
  'development';

const isProdLike = environment === 'production' || environment === 'staging';

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: Number(
      process.env.SENTRY_TRACES_SAMPLE_RATE ?? (isProdLike ? 0.1 : 1.0),
    ),
  });
} else if (isProdLike) {
  console.warn(
    `[instrument] SENTRY_DSN unset - error monitoring disabled (env=${environment})`,
  );
}
