'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../domain/acceptance');
const project = D.normalizeProject({ name: 'generic', runtime: 'node', entry: 'main.js', files: { 'main.js': 'console.log(1);\n' } });
const revision = D.revisionOf(project);
const acceptanceCase = D.createCase({ id: 'one', origin: 'user', confirmed: true, expected: { target: { kind: 'json', path: 'value' }, operator: 'equals', value: '1' } }, revision);
const run = { id: 'run-one', revision, runtime: 'node', status: 'completed', output: { value: 1 }, evidence: [{ id: 'out-one' }] };
test('content revisions change with source, not property ordering', () => {
  assert.equal(D.revisionOf({ ...project, files: { 'main.js': project.files['main.js'] } }), revision);
  assert.notEqual(D.revisionOf({ ...project, files: { 'main.js': 'console.log(2)' } }), revision);
});
test('model proposed standards cannot self-confirm', () => {
  const suggested = D.createCase({ ...acceptanceCase, origin: 'agent', confirmed: true }, revision);
  assert.equal(suggested.confirmed, false);
  assert.equal(D.evaluateCase(suggested, run).state, 'needs_confirmation');
  assert.equal(D.evaluateCase(D.confirmCase(suggested), run).state, 'passed');
});
test('errors, missing evidence and old versions never become passed', () => {
  for (const status of ['cancelled', 'timeout', 'error', 'unsupported']) assert.equal(D.evaluateCase(acceptanceCase, { ...run, status }).state, status);
  assert.equal(D.evaluateCase(acceptanceCase, { ...run, output: {} }).state, 'insufficient_evidence');
  assert.equal(D.evaluateCase(acceptanceCase, { ...run, revision: 'other' }).state, 'stale');
});
test('JSON null is a real value, not absent observation', () => {
  const c = D.createCase({ id: 'null', origin: 'user', confirmed: true, expected: { target: { kind: 'json' }, operator: 'jsonEquals', value: null } }, revision);
  const result = D.evaluateCase(c, { ...run, output: null, outputParsed: true });
  assert.equal(result.state, 'passed'); assert.equal(result.actualObserved, true);
  assert.equal(D.evaluateCase(c, { ...run, output: null, outputParsed: false }).state, 'insufficient_evidence');
});
test('coverage counts registered cases, not repeat executions', () => {
  const result = D.evaluateCase(acceptanceCase, run);
  assert.deepEqual(D.summarize([acceptanceCase, acceptanceCase], [result, result], revision), { total: 1, passed: 1, failed: 0, pending: 0, unconfirmed: 0, manual: 0 });
});
test('human decisions bind a verified range without changing facts', () => {
  const check = D.evaluateCase(acceptanceCase, run);
  assert.throws(() => D.makeDecision({ status: 'accepted', revision, scopeCaseIds: ['one'] }, [acceptanceCase], []));
  const before = JSON.stringify(check);
  const decision = D.makeDecision({ status: 'accepted', revision, scopeCaseIds: ['one'] }, [acceptanceCase], [check]);
  assert.equal(decision.actor, 'human');
  assert.equal(JSON.stringify(check), before);
});
test('source references must match a real file and version', () => {
  assert.equal(D.validSourceRef(project, { revision, file: 'main.js', startLine: 1, endLine: 1 }), true);
  assert.equal(D.validSourceRef(project, { revision, file: 'missing.js', startLine: 1, endLine: 1 }), false);
  assert.equal(D.validSourceRef(project, { revision: 'old', file: 'main.js', startLine: 1, endLine: 1 }), false);
});
