'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../domain/acceptance');
const sample = (overrides = {}) => D.createCase({ id: 'once', title: '完成一次', featureId: 'complete', origin: 'user', confirmed: true, actions: [{ type: 'click', selector: '#complete' }], expected: { target: { kind: 'dom', selector: '#count' }, operator: 'equals', value: '1' }, ...overrides }, 'rev-current');
test('identical proposals reuse the human standard without changing its identity or confirmation', () => {
  const original = sample();
  const proposal = sample({ id: 'model-copy', origin: 'agent', confirmed: true, title: '另一种措辞', expected: { target: { kind: 'dom', selector: '#count' }, operator: 'equals', value: 1 } });
  const before = JSON.stringify([original, proposal]);
  const merged = D.mergeCases([original], [proposal]);
  assert.equal(merged.cases.length, 1); assert.equal(merged.cases[0].id, original.id); assert.equal(merged.cases[0].confirmed, true);
  assert.equal(merged.aliases['model-copy'], original.id); assert.equal(merged.duplicates[0].confirmed, false);
  assert.equal(JSON.stringify([original, proposal]), before);
  assert.equal(D.mergeCases(merged.cases, [proposal]).cases.length, 1);
});
test('same titles with different inputs, actions, timing, expectations or requirements stay separate', () => {
  const cases = [sample(), sample({ id: 'input', input: { count: 1 } }), sample({ id: 'twice', actions: [{ type: 'click', selector: '#complete' }, { type: 'click', selector: '#complete' }] }), sample({ id: 'delay', actions: [{ type: 'click', selector: '#complete', atMs: 100 }] }), sample({ id: 'expected', expected: { target: { kind: 'dom', selector: '#count' }, operator: 'equals', value: 2 } }), sample({ id: 'requirement', requirementIds: ['another-rule'] })];
  assert.equal(D.mergeCases(cases).cases.length, cases.length);
});
test('manual judgments and typed JSON expectations are not collapsed', () => {
  const a = sample({ id: 'manual-a', expected: null }), b = sample({ id: 'manual-b', expected: null });
  const c = sample({ id: 'json-number', expected: { target: { kind: 'json', path: 'value' }, operator: 'jsonEquals', value: 1 } });
  const d = sample({ id: 'json-string', expected: { target: { kind: 'json', path: 'value' }, operator: 'jsonEquals', value: '1' } });
  assert.equal(D.mergeCases([a,b,c,d]).cases.length, 4);
  const unsupported = id => sample({ id, expected: { target: { kind: 'unknown' }, value: 1 } });
  assert.equal(D.mergeCases([unsupported('unknown-a'), unsupported('unknown-b')]).cases.length, 2);
});
test('deduplication never approves an unconfirmed or changed standard', () => {
  const original = sample({ confirmed: false, ruleRevision: 5 });
  const proposal = sample({ id: 'model', origin: 'agent', confirmed: true });
  const merged = D.mergeCases([original], [proposal]);
  assert.equal(merged.cases[0].confirmed, false); assert.equal(merged.cases[0].ruleRevision, 5);
});
test('only current-round evidence is displayed, even when source and case IDs are unchanged', () => {
  const records = [{ id: 'legacy', revision: 'rev-current' }, { id: 'old', roundId: 'first', revision: 'rev-current' }, { id: 'new', roundId: 'second', revision: 'rev-current' }, { id: 'other-source', roundId: 'second', revision: 'rev-old' }];
  const before = JSON.stringify(records);
  assert.deepEqual(D.forRound(records, null, 'rev-current'), []);
  assert.deepEqual(D.forRound(records, { id: 'third', revision: 'rev-current' }, 'rev-current'), []);
  assert.deepEqual(D.forRound(records, { id: 'second', revision: 'rev-current' }, 'rev-current').map(x => x.id), ['new']);
  assert.deepEqual(D.forRound(records, { id: 'second', revision: 'rev-old' }, 'rev-current'), []);
  assert.equal(JSON.stringify(records), before);
});
