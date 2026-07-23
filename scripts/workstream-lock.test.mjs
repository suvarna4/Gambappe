// Unit tests for the pure merge logic behind `workstream-lock.mjs add-tasks` (SW0-T1).
// Run: node --test scripts/workstream-lock.test.mjs
// SPEC-GAP(SW0-T1): the plan said "the script already has a test pattern — follow it";
// no such tests existed, so this file starts the pattern (node:test, no deps, pure
// functions only — nothing here touches git or the registry branch).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergeSeedTasks, UsageError } from './workstream-lock.mjs';

const NOW = '2026-07-19T12:00:00.000Z';

function doneTask(overrides = {}) {
  return {
    title: 'existing',
    phase: 'P0',
    depends_on: [],
    mock_start_ok: false,
    note: null,
    status: 'done',
    owner: null,
    branch: null,
    pr: null,
    claimed_at: null,
    updated_at: '2026-07-18T09:35:00Z',
    ...overrides,
  };
}

function registry() {
  return {
    schema_version: 1,
    tasks: { 'WS0-T1': doneTask(), 'WS0-T2': doneTask({ depends_on: ['WS0-T1'] }) },
  };
}

test('adds new tasks with normalized defaults', () => {
  const data = registry();
  const { added, skipped } = mergeSeedTasks(
    data,
    { 'SW0-T2': { title: 'Tokens', phase: 'SP1', depends_on: [] } },
    NOW,
  );
  assert.deepEqual(added, ['SW0-T2']);
  assert.deepEqual(skipped, []);
  assert.deepEqual(data.tasks['SW0-T2'], {
    title: 'Tokens',
    phase: 'SP1',
    depends_on: [],
    mock_start_ok: false,
    note: null,
    status: 'available',
    owner: null,
    branch: null,
    pr: null,
    claimed_at: null,
    updated_at: NOW,
  });
});

test('never overwrites an existing id — reports it as skipped, object untouched', () => {
  const data = registry();
  const before = structuredClone(data.tasks['WS0-T1']);
  const { added, skipped } = mergeSeedTasks(
    data,
    {
      'WS0-T1': { title: 'imposter', status: 'available' },
      'SW9-T1': { title: 'new one', depends_on: [] },
    },
    NOW,
  );
  assert.deepEqual(skipped, ['WS0-T1']);
  assert.deepEqual(added, ['SW9-T1']);
  assert.deepEqual(data.tasks['WS0-T1'], before);
});

test('a seed cannot smuggle status/owner — entries are born available and unowned', () => {
  const data = registry();
  mergeSeedTasks(
    data,
    { 'SW9-T1': { title: 'sneaky', depends_on: [], status: 'done', owner: 'me' } },
    NOW,
  );
  assert.equal(data.tasks['SW9-T1'].status, 'available');
  assert.equal(data.tasks['SW9-T1'].owner, null);
});

test('seed-internal dependencies resolve; unknown dependencies reject the batch', () => {
  const ok = registry();
  const res = mergeSeedTasks(
    ok,
    {
      'SW1-T1': { title: 'a', depends_on: ['WS0-T2'] },
      'SW1-T2': { title: 'b', depends_on: ['SW1-T1'] },
    },
    NOW,
  );
  assert.deepEqual(res.added, ['SW1-T1', 'SW1-T2']);

  const bad = registry();
  assert.throws(
    () => mergeSeedTasks(bad, { 'SW1-T1': { title: 'a', depends_on: ['SW1-T9'] } }, NOW),
    (err) => err instanceof UsageError && /unknown "SW1-T9"/.test(err.message),
  );
});

test('whole-workstream tokens (WS0 / SW1) resolve when at least one member exists', () => {
  const data = registry();
  const res = mergeSeedTasks(
    data,
    {
      'SW1-T1': { title: 'a', depends_on: ['WS0'] },
      'SW2-T1': { title: 'b', depends_on: ['SW1'] },
    },
    NOW,
  );
  assert.deepEqual(res.added, ['SW1-T1', 'SW2-T1']);
  assert.throws(
    () => mergeSeedTasks(registry(), { 'SW1-T1': { title: 'a', depends_on: ['SW7'] } }, NOW),
    UsageError,
  );
});

test('rejects malformed ids, empty titles, malformed depends_on, empty seeds', () => {
  assert.throws(() => mergeSeedTasks(registry(), { 'XX1-T1': { title: 'x' } }, NOW), UsageError);
  assert.throws(() => mergeSeedTasks(registry(), { 'SW1-T1': { title: '  ' } }, NOW), UsageError);
  assert.throws(
    () => mergeSeedTasks(registry(), { 'SW1-T1': { title: 'x', depends_on: 'WS0-T1' } }, NOW),
    UsageError,
  );
  assert.throws(() => mergeSeedTasks(registry(), {}, NOW), UsageError);
});

test('mock_start_ok is carried through when the seed sets it', () => {
  const data = registry();
  mergeSeedTasks(data, { 'SW1-T2': { title: 'gesture', depends_on: [], mock_start_ok: true } }, NOW);
  assert.equal(data.tasks['SW1-T2'].mock_start_ok, true);
});

test('accepts XH- ids (xtrace hackathon plan, no digits after the prefix) but rejects XH5-style ids', () => {
  const data = registry();
  const { added } = mergeSeedTasks(
    data,
    { 'XH-T1': { title: 'Contracts', depends_on: [] }, 'XH-T2': { title: 'Client', depends_on: ['XH-T1'] } },
    NOW,
  );
  assert.deepEqual(added, ['XH-T1', 'XH-T2']);
  assert.throws(() => mergeSeedTasks(registry(), { 'XH5-T1': { title: 'x' } }, NOW), UsageError);
});
