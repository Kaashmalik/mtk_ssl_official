import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, symlink, readFile, truncate } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { RELEASE_REQUIREMENTS, validateReleaseEvidence, checkReleaseEvidence, isCandidateAcceptanceRun } from './release-evidence.mjs';

const commit = 'a'.repeat(40);
const target = 'cricket-production';
const now = Date.parse('2026-10-16T12:00:00Z');
const options = { commit, target, now };
const repository = 'fixture/cricket';
const sourceRun = () => ({ head_sha: commit, head_repository: { full_name: repository }, event: 'workflow_dispatch', head_branch: 'main', status: 'completed', conclusion: 'success' });
test('accepts successful manually dispatched same-candidate main acceptance run', () => {
  assert.equal(isCandidateAcceptanceRun(sourceRun(), { commit, repository }), true);
});
for (const [field, value] of [['head_sha', 'b'.repeat(40)], ['head_repository', { full_name: 'fork/cricket' }],
  ['event', 'pull_request'], ['event', 'push'], ['head_branch', 'feature'], ['status', 'in_progress'], ['conclusion', 'failure'], ['conclusion', 'skipped']]) {
  test(`rejects evidence source run with ${field}=${JSON.stringify(value)}`, () => {
    assert.equal(isCandidateAcceptanceRun({ ...sourceRun(), [field]: value }, { commit, repository }), false);
  });
}
test('rejects missing run metadata or expected identity', () => {
  assert.equal(isCandidateAcceptanceRun(null, { commit, repository }), false);
  assert.equal(isCandidateAcceptanceRun(sourceRun(), {}), false);
});
const report = 'Synthetic fixture only, not real release acceptance.\n';
const digest = createHash('sha256').update(report).digest('hex');
function fixture() {
  return { schemaVersion: 1, commit, target, stagingEnvironment: 'cricket-disposable-staging', recordedAt: '2026-10-16T11:00:00Z',
    checks: Object.entries(RELEASE_REQUIREMENTS).map(([id, method]) => ({ id, method, status: 'passed', commit,
      environment: 'cricket-disposable-staging', completedAt: '2026-10-16T10:00:00Z', operator: 'test-operator',
      summary: 'Synthetic acceptance declaration', artifacts: [{ file: 'report.txt', sha256: digest }] })),
    ownerApproval: { decision: 'approved', reviewer: 'test-owner', commit, target, approvedAt: '2026-10-16T11:30:00Z' } };
}

test('accepts a structurally complete synthetic attestation', () => assert.deepEqual(validateReleaseEvidence(fixture(), options), []));
for (const id of Object.keys(RELEASE_REQUIREMENTS)) {
  test(`requires ${id} rather than only a summary checkmark`, () => {
    const input = fixture();
    input.checks = input.checks.filter(check => check.id !== id);
    assert.ok(validateReleaseEvidence(input, options).some(error => error.startsWith(id)));
  });
}
for (const status of ['blocked', 'skipped', 'waived', 'pending', true, null]) {
  test(`does not accept status ${status}`, () => {
    const input = fixture(); input.checks[0].status = status;
    assert.notEqual(validateReleaseEvidence(input, options).length, 0);
  });
}
const mutations = {
  'mocked unit tests': input => { input.checks[0].method = 'unit-tests'; },
  'stale candidate': input => { input.commit = 'b'.repeat(40); },
  'wrong target': input => { input.target = 'unrelated-production'; },
  'different check candidate': input => { input.checks[0].commit = 'b'.repeat(40); },
  'different check environment': input => { input.checks[0].environment = 'unrelated-staging'; },
  'unknown check': input => { input.checks.push({ ...input.checks[0], id: 'OTHER' }); },
  'duplicate check': input => { input.checks.push(input.checks[0]); },
  'old manifest': input => { input.recordedAt = '2026-10-01T11:00:00Z'; },
  'future manifest': input => { input.recordedAt = '2026-10-17T11:00:00Z'; },
  'invalid calendar date': input => { input.recordedAt = '2026-02-30T11:00:00Z'; },
  'old check': input => { input.checks[0].completedAt = '2026-10-01T10:00:00Z'; },
  'future check': input => { input.checks[0].completedAt = '2026-10-17T10:00:00Z'; },
  'check after manifest': input => { input.checks[0].completedAt = '2026-10-16T11:15:00Z'; },
  'missing approval': input => { delete input.ownerApproval; },
  'unapproved decision': input => { input.ownerApproval.decision = 'pending'; },
  'wrong approval candidate': input => { input.ownerApproval.commit = 'b'.repeat(40); },
  'wrong approval target': input => { input.ownerApproval.target = 'unrelated'; },
  'approval before evidence': input => { input.ownerApproval.approvedAt = '2026-10-16T10:00:00Z'; },
  'future approval': input => { input.ownerApproval.approvedAt = '2026-10-17T10:00:00Z'; },
  'missing artifacts': input => { input.checks[0].artifacts = []; },
  'invalid hash': input => { input.checks[0].artifacts[0].sha256 = 'todo'; },
  'missing operator': input => { input.checks[0].operator = ''; },
  'same staging and production': input => { input.stagingEnvironment = target; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`blocks ${name}`, () => { const input = fixture(); mutate(input); assert.ok(validateReleaseEvidence(input, options).length); });
}
for (const input of [null, [], true, 'not a manifest', {}, { schemaVersion: 2 }, { checks: [null, {}] }]) {
  test(`fails closed on malformed input ${JSON.stringify(input)}`, () => assert.ok(validateReleaseEvidence(input, options).length));
}
test('requires explicit candidate and target even if the manifest declares them', () => {
  assert.ok(validateReleaseEvidence(fixture(), { now }).length);
  assert.ok(validateReleaseEvidence(fixture(), { ...options, now: NaN }).length);
});

async function withEvidence(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cricket-release-test-'));
  const file = path.join(directory, 'manifest.json');
  try {
    await writeFile(path.join(directory, 'report.txt'), report);
    await writeFile(file, JSON.stringify(fixture()));
    await run(directory, file);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
test('verifies retained evidence file hashes', () => withEvidence(async (_, file) => {
  assert.deepEqual(await checkReleaseEvidence(file, options), []);
}));
test('rejects oversized manifests without parsing them', () => withEvidence(async (_, file) => {
  await truncate(file, 1_000_001);
  assert.deepEqual(await checkReleaseEvidence(file, options), ['Manifest exceeds the one-megabyte limit.']);
}));
test('rejects oversized reports without hashing them', () => withEvidence(async (directory, file) => {
  await truncate(path.join(directory, 'report.txt'), 50_000_001);
  assert.ok((await checkReleaseEvidence(file, options)).some(error => error.includes('too large')));
}));
test('rejects invalid JSON without printing its potentially sensitive content', () => withEvidence(async (_, file) => {
  await writeFile(file, 'not-json: confidential-value');
  const errors = await checkReleaseEvidence(file, options);
  assert.ok(errors.length);
  assert.ok(!JSON.stringify(errors).includes('confidential-value'));
}));
test('the checked-in example is blocked and enumerates every required acceptance check', async () => {
  const input = JSON.parse(await readFile('docs/release-evidence.example.json', 'utf8'));
  assert.deepEqual(input.checks.map(check => check.id), Object.keys(RELEASE_REQUIREMENTS));
  assert.ok(input.checks.every(check => check.status === 'blocked' && check.artifacts.length === 0));
  assert.ok(validateReleaseEvidence(input, options).length);
});
for (const name of ['missing', 'changed', 'empty']) {
  test(`blocks ${name} evidence files`, () => withEvidence(async (directory, file) => {
    const artifact = path.join(directory, 'report.txt');
    if (name === 'missing') await rm(artifact); else await writeFile(artifact, name === 'empty' ? '' : 'tampered');
    assert.ok((await checkReleaseEvidence(file, options)).length);
  }));
}
for (const unsafe of ['../outside.txt', '/outside.txt', 'C:/outside.txt', '..\\outside.txt', 'folder/../../outside.txt', 'https://example.com/report', './report.txt']) {
  test(`rejects unsafe artifact path ${unsafe}`, () => withEvidence(async (_, file) => {
    const input = fixture(); input.checks[0].artifacts[0].file = unsafe;
    await writeFile(file, JSON.stringify(input));
    assert.ok((await checkReleaseEvidence(file, options)).length);
  }));
}
test('rejects symlink escapes', async context => withEvidence(async (directory, file) => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'cricket-release-outside-'));
  try {
    await writeFile(path.join(outside, 'report.txt'), report);
    try { await symlink(outside, path.join(directory, 'escape'), 'junction'); }
    catch (error) { if (error.code === 'EPERM') { context.skip('Symlink permission unavailable'); return; } throw error; }
    const input = fixture(); input.checks[0].artifacts[0].file = 'escape/report.txt';
    await writeFile(file, JSON.stringify(input));
    assert.ok((await checkReleaseEvidence(file, options)).some(error => error.includes('unsafe')));
  } finally { await rm(outside, { recursive: true, force: true }); }
}));
test('CLI exits nonzero on missing manifest and never echoes secret arguments', () => {
  const result = spawnSync(process.execPath, ['scripts/release-evidence.mjs', '--manifest', 'does-not-exist.json', '--commit', commit, '--target', target], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RELEASE BLOCKED/);
  const badArgs = spawnSync(process.execPath, ['scripts/release-evidence.mjs', '--unknown', 'secret-value'], { encoding: 'utf8' });
  assert.equal(badArgs.status, 1);
  assert.ok(!badArgs.stderr.includes('secret-value'));
});
test('CLI returns success only for complete current synthetic evidence files', () => withEvidence(async (_, file) => {
  const input = fixture();
  input.recordedAt = new Date(Date.now() - 2000).toISOString();
  input.ownerApproval.approvedAt = new Date(Date.now() - 1000).toISOString();
  for (const check of input.checks) check.completedAt = new Date(Date.now() - 3000).toISOString();
  await writeFile(file, JSON.stringify(input));
  const result = spawnSync(process.execPath, ['scripts/release-evidence.mjs', '--manifest', file, '--commit', commit, '--target', target], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /not independent verification/);
}));

test('VPS release gate stays default-off and checks evidence before configuring SSH', async () => {
  const workflow = await readFile('.github/workflows/ci-cd.yaml', 'utf8');
  const deploy = workflow.split('  deploy-vps:')[1].split('  e2e:')[0];
  assert.ok(deploy.includes("if: github.ref == 'refs/heads/main' && vars.LEAGUE_MEMBERSHIP_CONTROLS_READY == 'true'"));
  assert.ok(deploy.indexOf('node scripts/release-evidence.mjs') < deploy.indexOf('- name: Configure SSH'));
  assert.ok(deploy.includes('isCandidateAcceptanceRun(run, { commit: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY })'));
  assert.ok(deploy.includes('run-id: ${{ vars.RELEASE_EVIDENCE_RUN_ID }}'));
  assert.ok(deploy.includes('--target "$RELEASE_TARGET"'));
  assert.ok(deploy.includes('git checkout --detach "$2"'));
  assert.ok(deploy.includes('test -z "$(git status --porcelain)"'));
  assert.ok(!deploy.includes('git reset --hard'));
  assert.ok(deploy.includes('group: production-vps'));
  assert.ok(deploy.includes('cancel-in-progress: false'));
});
test('manual production deployment also requires retained candidate evidence before Docker access', async () => {
  const script = await readFile('deploy-vps.sh', 'utf8');
  assert.ok(script.includes('${LEAGUE_MEMBERSHIP_CONTROLS_READY:-false}'));
  assert.ok(script.includes('--manifest "$RELEASE_EVIDENCE_MANIFEST" --commit "$RELEASE_COMMIT" --target "$RELEASE_TARGET"'));
  assert.ok(script.indexOf('node "$PROJECT_DIR/scripts/release-evidence.mjs"') < script.indexOf('command -v docker'));
});
test('production does not run an unrelated migration journal or log DB credentials', async () => {
  const script = await readFile('deploy-vps.sh', 'utf8');
  assert.ok(!script.includes('pnpm --filter @mtk/database migrate'));
  assert.ok(!script.includes('Migrations complete'));
  assert.ok(script.includes('no schema changes run by this script'));
  assert.ok(!script.includes('${DB_URL%%@*}'));
});
