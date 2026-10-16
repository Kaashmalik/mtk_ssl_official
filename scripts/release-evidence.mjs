import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Acceptance attestations, not unit-test counts. No skipped/waived check can pass.
export const RELEASE_REQUIREMENTS = Object.freeze({
  'REL-01/migration-chain': 'real-postgres',
  'REL-01/isolation': 'real-postgres',
  'REL-01/concurrency': 'real-postgres',
  'REL-02/web-journeys': 'authenticated-browser',
  'REL-02/mobile-recovery': 'authenticated-device',
  'REL-03/publication-fanout': 'deployed-infrastructure',
  'REL-03/load-latency-quotas': 'deployed-infrastructure',
  'REL-03/outbox-recovery': 'deployed-infrastructure',
  'REL-04/storage-exports': 'authenticated-browser',
  'REL-04/privacy-retention-abuse': 'operator-drill',
  'REL-05/backup-restore': 'operator-drill',
  'REL-05/migration-rollback': 'real-postgres',
  'REL-05/secret-account-device-recovery': 'operator-drill',
  'REL-06/email-otp': 'provider-sandbox',
  'REL-06/payments': 'provider-sandbox',
  'REL-06/domain-https': 'deployed-infrastructure',
  'REL-07/deploy-rollback': 'operator-drill',
  'REL-07/feature-review': 'owner-review',
});

const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const TARGET = /^[a-z0-9][a-z0-9._-]{2,99}$/;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
const timestamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
  return Number.isFinite(time) && new Date(time).toISOString() === normalized ? time : NaN;
};
function fresh(value, now) {
  const time = timestamp(value);
  return Number.isFinite(time) && time <= now && now - time <= MAX_AGE_MS;
}

/** Cross-run artifacts must originate in a reviewed same-repository candidate run. */
export function isCandidateAcceptanceRun(run, { commit, repository }) {
  return SHA.test(commit ?? '') && text(repository) && object(run) && run.head_sha === commit
    && run.head_repository?.full_name === repository && run.event === 'workflow_dispatch'
    && run.head_branch === 'main' && run.status === 'completed' && run.conclusion === 'success';
}

/** Validate declarations only. Artifact integrity is checked separately below. */
export function validateReleaseEvidence(input, { commit, target, now = Date.now() }) {
  const errors = [];
  if (!SHA.test(commit ?? '')) errors.push('Expected commit must be a full lowercase Git SHA.');
  if (!TARGET.test(target ?? '')) errors.push('Expected target must be an explicit non-secret environment identifier.');
  if (!Number.isFinite(now)) errors.push('Invalid validation clock.');
  if (!object(input)) return [...errors, 'Manifest must be a JSON object.'];
  if (input.schemaVersion !== 1) errors.push('Unsupported manifest schemaVersion.');
  if (input.commit !== commit) errors.push('Manifest does not match the candidate commit.');
  if (input.target !== target) errors.push('Manifest does not match the expected release target.');
  if (!fresh(input.recordedAt, now)) errors.push('Manifest timestamp is future, invalid or older than seven days.');
  if (!TARGET.test(input.stagingEnvironment ?? '') || input.stagingEnvironment === target) errors.push('A distinct acceptance/staging environment is required.');
  if (!Array.isArray(input.checks)) return [...errors, 'Manifest checks must be an array.'];
  const seen = new Set();
  for (const check of input.checks) {
    if (!object(check) || !Object.hasOwn(RELEASE_REQUIREMENTS, check.id)) {
      errors.push('Unknown or malformed acceptance check.');
      continue;
    }
    const id = check.id;
    if (seen.has(id)) errors.push(`${id}: duplicate check.`);
    seen.add(id);
    if (check.status !== 'passed') errors.push(`${id}: real acceptance is not passed.`);
    if (check.method !== RELEASE_REQUIREMENTS[id]) errors.push(`${id}: required acceptance method is ${RELEASE_REQUIREMENTS[id]}.`);
    if (check.commit !== commit || check.environment !== input.stagingEnvironment) errors.push(`${id}: candidate/staging binding mismatch.`);
    if (!fresh(check.completedAt, now) || timestamp(check.completedAt) > timestamp(input.recordedAt)) errors.push(`${id}: invalid or stale completion time.`);
    if (!text(check.operator) || !text(check.summary)) errors.push(`${id}: operator and outcome summary are required.`);
    if (!Array.isArray(check.artifacts) || check.artifacts.length === 0) {
      errors.push(`${id}: retained evidence artifacts are required.`);
    } else if (check.artifacts.some(artifact => !object(artifact) || !text(artifact.file) || !HASH.test(artifact.sha256 ?? ''))) {
      errors.push(`${id}: artifact file and SHA-256 are required.`);
    }
  }
  for (const id of Object.keys(RELEASE_REQUIREMENTS)) if (!seen.has(id)) errors.push(`${id}: missing acceptance evidence.`);
  const approval = input.ownerApproval;
  if (!object(approval) || approval.decision !== 'approved' || !text(approval.reviewer)
    || approval.commit !== commit || approval.target !== target || !fresh(approval.approvedAt, now)
    || timestamp(approval.approvedAt) < timestamp(input.recordedAt)) {
    errors.push('Explicit current owner approval bound to this commit and target is required.');
  }
  return errors;
}

/** Artifacts are local retained files, never fetched URLs or executable commands. */
export async function checkReleaseEvidence(manifestFile, options) {
  let input;
  let root;
  try {
    root = await realpath(path.dirname(manifestFile));
    if ((await stat(manifestFile)).size > 1_000_000) return ['Manifest exceeds the one-megabyte limit.'];
    input = JSON.parse(await readFile(manifestFile, 'utf8'));
  } catch {
    return ['Manifest is missing, unreadable or invalid JSON.'];
  }
  const errors = validateReleaseEvidence(input, options);
  if (errors.length) return errors;
  for (const check of input.checks) {
    for (const artifact of check.artifacts) {
      // Reject both Windows and POSIX escapes regardless of the runner OS.
      if (artifact.file.includes('\\') || artifact.file.includes(':') || artifact.file.includes('\0')
        || artifact.file.split('/').some(part => part === '..' || part === '.' || part === '')
        || path.isAbsolute(artifact.file)) {
        errors.push(`${check.id}: artifact path must stay inside the evidence directory.`);
        continue;
      }
      try {
        const actual = await realpath(path.join(root, artifact.file));
        const relative = path.relative(root, actual);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Escape');
        const metadata = await stat(actual);
        if (!metadata.isFile() || metadata.size === 0 || metadata.size > 50_000_000) throw new Error('Invalid artifact');
        const digest = createHash('sha256').update(await readFile(actual)).digest('hex');
        if (digest !== artifact.sha256) errors.push(`${check.id}: artifact SHA-256 mismatch.`);
      } catch {
        errors.push(`${check.id}: artifact missing, unsafe, empty or too large.`);
      }
    }
  }
  return errors;
}

export async function main(args) {
  const usage = 'Usage: node scripts/release-evidence.mjs --manifest <file> --commit <full-sha> --target <environment-id>';
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    if (!['manifest', 'commit', 'target'].includes(key) || Object.hasOwn(options, key) || !args[i + 1] || !args[i].startsWith('--')) {
      console.error(usage);
      return 1;
    }
    options[key] = args[i + 1];
  }
  if (!options.manifest || !options.commit || !options.target) { console.error(usage); return 1; }
  const errors = await checkReleaseEvidence(path.resolve(options.manifest), options);
  if (errors.length) {
    console.error(`RELEASE BLOCKED: ${errors.length} evidence issue(s).`);
    for (const error of errors) console.error(`- ${error}`);
    return 1;
  }
  console.log('Evidence integrity/attestations valid. This is not independent verification or permission to enable deployment.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
