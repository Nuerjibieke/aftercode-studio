'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../domain/acceptance');
const V = require('../ui/acceptance-view');
function model() { const project = D.normalizeProject({ name: '<script>untrusted</script>', entry: 'index.html', files: { 'index.html': '<b>Hello</b>' } }); return { project, revision: project.revision, delivery: { title: project.name, goal: 'output should be correct' }, features: [], selectedFeatureId: '', selectedCaseId: '', cases: [], checks: [], runs: [], decisions: [], graph: { nodes: [], edges: [], gaps: [] }, executedNodeIds: [], modelStatus: { configured: false }, analysisStatus: 'local', agentAnalyses: [] }; }
test('view escapes project/model content and does not invent counts or confidence', () => {
  const data = model(); const html = V.renderOverview(data);
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>untrusted'));
  assert.ok(html.includes('0 个登记情况')); assert.ok(!html.includes('100%'));
});
test('unconfirmed or old evidence cannot enable an accept action', () => {
  const data = model(); const item = D.createCase({ id: 'a', origin: 'agent', expected: { target: { kind: 'dom', selector: '#x' }, value: '1' } }, data.revision);
  data.cases = [item]; data.checks = [{ caseId: 'a', revision: data.revision, ruleRevision: item.ruleRevision, state: 'passed' }];
  assert.ok(!V.renderInspector(data).includes('data-acceptance-action="decision-accept"'));
  data.cases = [D.confirmCase(item)]; data.checks[0].ruleRevision = data.cases[0].ruleRevision; data.checks[0].revision = 'old';
  assert.ok(!V.renderInspector(data).includes('data-acceptance-action="decision-accept"'));
});
