'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('./core');
const tick = () => new Promise(resolve => setImmediate(resolve));
const runtime = () => new C.Runtime({ app: 'counter', version: 'v1', input: { count: 0 }, rule: { revision: 1 } });

test('run identity and rule snapshots remain independent from caller edits', () => {
  const rule = { selector: '#result', expected: '1', revision: 1 };
  const a = new C.Runtime({ app: 'web', version: 'v1', input: {}, rule });
  const b = new C.Runtime({ app: 'web', version: 'v1', input: {}, rule });
  rule.expected = '99';
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.instanceId, b.instanceId);
  assert.equal(a.rule.expected, '1');
});
test('generic comparisons distinguish text, numbers and insufficient evidence', () => {
  assert.equal(C.compareValues('12', '12', 'equals'), true);
  assert.equal(C.compareValues('12', '012', 'equals'), false);
  assert.equal(C.compareValues('中文多行\n内容', '内容', 'contains'), true);
  assert.equal(C.compareValues('17.5', '10', 'greater'), true);
  assert.equal(C.compareValues('-2', '1', 'less'), true);
  assert.equal(C.compareValues('¥10', '5', 'greater'), null);
  assert.equal(C.compareValues('', '5', 'less'), null);
  assert.equal(C.compareValues('NaN', '5', 'greater'), null);
  assert.equal(C.compareValues('10', '5', 'unknown'), null);
});
test('semantic breakpoint pauses before a commit; one permit commits exactly once', async () => {
  const rt = runtime(); rt.state.count = 0; rt.requestPause();
  const result = rt.boundary('increment', { value: 1 }, () => { rt.state.count++; });
  await tick();
  assert.equal(rt.state.count, 0);
  assert.equal(rt.revision, 0);
  assert.equal(rt.events.filter(e => e.type === 'commit').length, 0);
  assert.equal(rt.pending.proposal.value, 1);
  assert.equal(rt.step(), true);
  assert.equal(rt.step(), false);
  await result;
  assert.equal(rt.state.count, 1);
  assert.equal(rt.revision, 1);
});
test('two queued commits consume separate permits', async () => {
  const rt = runtime(); let value = 0; rt.requestPause();
  const a = rt.boundary('first', 1, () => { value++; });
  const b = rt.boundary('second', 2, () => { value++; });
  await tick(); rt.step(); await a; await tick();
  assert.equal(value, 1);
  assert.equal(rt.pending.name, 'second');
  rt.continue(); await b;
  assert.equal(value, 2);
  assert.equal(rt.revision, 2);
});
test('reset cancellation invalidates old permits and callbacks', async () => {
  const rt = runtime(); let value = 0; rt.requestPause();
  const pending = rt.boundary('stale', 1, () => { value++; });
  await tick(); rt.cancel();
  await assert.rejects(pending, C.Cancelled);
  assert.equal(rt.step(), false);
  assert.equal(value, 0);
  const facts = rt.events.length;
  rt.event('late', 'late callback');
  assert.equal(rt.events.length, facts);
});
test('guards read latest context after permission, not at proposal time', async () => {
  const rt = runtime(); let latest = 1, value = 0; rt.requestPause();
  const response = rt.boundary('response', { intent: 1 }, () => { value++; }, () => latest === 1);
  await tick(); latest = 2; rt.step();
  assert.equal(await response, false);
  assert.equal(value, 0);
  assert.equal(rt.revision, 0);
  assert.equal(rt.events.at(-1).type, 'ignored');
});
test('history snapshots are detached and read-only operations add no facts', () => {
  const rt = runtime(); rt.observe('counter', 1, 'fixture');
  const snapshot = rt.snapshot(); const old = JSON.stringify(snapshot);
  rt.observe('counter', 2, 'fixture');
  assert.equal(JSON.stringify(snapshot), old);
  snapshot.input.count = 99;
  assert.equal(rt.input.count, 0);
});
test('fourth counter adapter uses the same control core', async () => {
  const rt = runtime(); rt.state.count = 7; rt.breakpoint = true;
  const action = rt.boundary('counter.increment', { value: 8 }, () => { rt.state.count++; });
  await tick(); assert.equal(rt.state.count, 7); rt.step(); await action;
  const obs = rt.observe('counter.value', rt.state.count, 'fourth-adapter fixture');
  assert.equal(rt.check(8, obs.value, 'one increment', [obs.id]).passed, true);
});
