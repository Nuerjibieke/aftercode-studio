'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createServer } = require('../server');
let server, browser, url;
before(async () => {
  server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => { if (browser) await browser.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
async function open() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await page.goto(url); await ready(page);
  return { context, page };
}
async function ready(page) { await page.waitForFunction(() => window.AcceptanceApp && !AcceptanceApp.state.loading && AcceptanceApp.state.environmentId); }
async function finished(page) { await page.waitForFunction(() => !AcceptanceApp.state.busy && AcceptanceApp.state.currentRound?.status === 'completed'); }
async function analyze(page, action) {
  await page.evaluate(action => { const a = AcceptanceApp; a.state.modelStatus = { configured: true, label: '测试模型' }; if (action === 'diagnose') a.actions['ask-case']({ dataset: { id: a.state.cases[0].id } }); else { a.state.agentQuestion = ''; a.actions['agent-analyze'](); } }, action);
  await page.locator('#ac-share-approved').check();
  const before = await page.evaluate(() => AcceptanceApp.state.agentAnalyses.length);
  await page.locator('.dialog [data-acceptance-action="start-agent"]').click();
  await page.waitForFunction(n => !AcceptanceApp.state.busy && AcceptanceApp.state.agentAnalyses.length > n, before);
}
function result(cases, revision) { return { source: 'model', revision, analyzedAt: new Date().toISOString(), summary: '原因：实现每次增加二，和增加一的标准不一致。', features: [], cases, nodeAnnotations: [], questions: [] }; }
test('legacy duplicates migrate safely; each recheck displays only its own real results and survives refresh', { timeout: 60000 }, async () => {
  const { context, page } = await open();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.evaluate(() => {
      const s = AcceptanceApp.state; Aftercode.saveWorkspace();
      const copies = s.cases.slice(0, 2).map((c, i) => ({ ...c, id: 'legacy-copy-' + i }));
      const oldRun = { id: 'old-run', caseId: copies[0].id, runtime: 'web', revision: s.revision, environmentId: s.environmentId, status: 'completed', startedAt: '2020-01-01T00:00:00Z', observations: [], trace: [] };
      const oldCheck = { id: 'old-check', runId: oldRun.id, caseId: copies[0].id, revision: s.revision, environmentId: s.environmentId, ruleRevision: copies[0].ruleRevision, state: 'failed', actual: '99', actualObserved: true, expected: copies[0].expected };
      localStorage.setItem('aftercode:acceptance:' + s.projectId, JSON.stringify({ view: 'overview', revision: s.revision, sources: s.sources, delivery: s.delivery, requirementDraft: s.delivery.goal, cases: [...s.cases, ...copies], checks: [oldCheck], runs: [oldRun], decisions: [], agentAnalyses: [] }));
    });
    await page.reload(); await ready(page);
    const migrated = await page.evaluate(() => ({ cases: AcceptanceApp.state.cases.length, archived: AcceptanceApp.state.archivedCases.length, checks: AcceptanceApp.state.checks.length, draft: AcceptanceApp.state.requirementDraft }));
    assert.equal(migrated.cases, 3); assert.equal(migrated.archived, 2); assert.equal(migrated.checks, 1);
    assert.equal(await page.locator('.ac-case-select').count(), 2);
    assert.equal(await page.locator('.ac-state-failed').count(), 0);
    assert.equal((await page.locator('.st-actual').allTextContents()).join('').includes('99'), false);
    await page.locator('#ac-workbench [data-acceptance-action="run-all"]').click(); await finished(page);
    const first = await page.evaluate(() => { const s = AcceptanceApp.state; return { id: s.currentRound.id, checks: AcceptanceDomain.forRound(s.checks, s.currentRound, s.revision) }; });
    assert.equal(first.checks.length, 3); assert.deepEqual(first.checks.map(c => c.actual), ['2', '4', '0']);
    let release; const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/jobs', async route => { if (route.request().method() === 'POST') await gate; await route.continue(); });
    try {
      await page.locator('#ac-workbench [data-acceptance-action="run-all"]').click();
      await page.waitForFunction(() => AcceptanceApp.state.busy && AcceptanceApp.state.currentRound?.status === 'queued');
      assert.equal(await page.evaluate(() => { const s = AcceptanceApp.state; return AcceptanceDomain.forRound(s.checks, s.currentRound, s.revision).length; }), 0);
      assert.equal(await page.locator('.ac-state-failed').count(), 0);
      assert.equal((await page.locator('.st-actual').allTextContents()).join(''), '');
      await page.evaluate(() => AcceptanceApp.actions.evidence({ dataset: { id: AcceptanceApp.state.cases[0].id } }));
      assert.ok((await page.locator('.dialog-body').innerText()).includes('没有可用的运行依据'));
      await page.locator('.dialog [data-acceptance-action="close-dialog"]').first().click();
    } finally { release(); }
    await finished(page);
    const second = await page.evaluate(() => { const s = AcceptanceApp.state; return { id: s.currentRound.id, checks: AcceptanceDomain.forRound(s.checks, s.currentRound, s.revision), total: s.checks.length, old: s.checks.find(c => c.id === 'old-check').actual, draft: s.requirementDraft, cases: s.cases.length }; });
    assert.notEqual(second.id, first.id); assert.equal(second.cases, 3); assert.equal(second.checks.length, 3); assert.equal(second.total, 7); assert.equal(second.old, '99');
    assert.deepEqual(second.checks.map(c => c.state), ['failed', 'failed', 'passed']);
    assert.ok(second.checks.every(c => !first.checks.some(p => p.id === c.id)));
    assert.equal(second.draft, migrated.draft);
    await page.reload(); await ready(page);
    assert.equal(await page.evaluate(() => AcceptanceApp.state.currentRound.id), second.id);
    assert.equal(await page.locator('.ac-case-select').count(), 2);
    assert.equal(await page.locator('.fx-round[data-round-status="completed"]').count(), 1);
    assert.equal(await page.evaluate(() => AcceptanceApp.state.archivedCases.length), 2);
    await page.locator('.fx-round [data-acceptance-action="history"]').click();
    assert.equal(await page.locator('.history-list article').count(), 7);
    await page.locator('.history-list [data-id="old-run"]').click();
    assert.ok((await page.locator('.dialog-body').innerText()).includes('99'));
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
test('diagnosing twice never appends cases; adopting a new suggestion requires confirmation', { timeout: 60000 }, async () => {
  const { context, page } = await open(); const purposes = [];
  try {
    const base = await page.evaluate(() => JSON.parse(JSON.stringify(AcceptanceApp.state.cases[0])));
    const proposed = [{ ...base, id: 'duplicate' }, { ...base, id: 'new-three', title: '连续三次，累计三', actions: Array.from({ length: 3 }, () => ({ type: 'click', selector: '#complete' })), expected: { ...base.expected, value: '3' }, origin: 'user', confirmed: true }];
    await page.route('**/api/agent/analyze', async route => { const body = route.request().postDataJSON(); purposes.push(body.purpose); const revision = await page.evaluate(() => AcceptanceApp.state.revision); await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', data: result(proposed, revision) }) + '\n' }); });
    await analyze(page, 'diagnose'); await analyze(page, 'diagnose');
    assert.deepEqual(purposes, ['diagnose', 'diagnose']);
    assert.equal(await page.evaluate(() => AcceptanceApp.state.cases.length), 3);
    assert.equal(await page.evaluate(() => AcceptanceApp.state.agentAnalyses.length), 2);
    await page.evaluate(() => AcceptanceApp.switchMode('logic'));
    await page.locator('[data-acceptance-action="adopt-suggestions"]').click();
    const adopted = await page.evaluate(() => { const s = AcceptanceApp.state; return { count: s.cases.length, added: s.cases.find(c => c.title === '连续三次，累计三'), round: s.currentRound }; });
    assert.equal(adopted.count, 4); assert.equal(adopted.added.confirmed, false); assert.equal(adopted.added.origin, 'agent'); assert.equal(adopted.round, null);
    assert.equal(await page.locator('input[name="ac-plan-case"]').count(), 1);
    assert.equal(await page.evaluate(() => AcceptanceApp.state.runs.length), 0);
  } finally { await context.close(); }
});
test('regenerating the same plan does not duplicate or re-approve standards after a goal change', { timeout: 60000 }, async () => {
  const { context, page } = await open();
  try {
    const base = await page.evaluate(() => JSON.parse(JSON.stringify(AcceptanceApp.state.cases[0])));
    await page.route('**/api/agent/analyze', async route => { const revision = await page.evaluate(() => AcceptanceApp.state.revision); await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', data: result([{ ...base, id: 'repeat', origin: 'user', confirmed: true }], revision) }) + '\n' }); });
    await analyze(page, 'plan'); await analyze(page, 'plan');
    assert.equal(await page.evaluate(() => AcceptanceApp.state.cases.length), 3);
    assert.equal(await page.evaluate(() => AcceptanceApp.state.cases[0].id), base.id);
    await page.evaluate(() => AcceptanceApp.actions['edit-goal']());
    await page.locator('#ac-goal').fill('更新后的标准，需要重新确认。');
    await page.locator('[data-acceptance-action="save-goal"]').click();
    await analyze(page, 'plan');
    const state = await page.evaluate(() => ({ count: AcceptanceApp.state.cases.length, confirmed: AcceptanceApp.state.cases.some(c => c.confirmed), round: AcceptanceApp.state.currentRound }));
    assert.equal(state.count, 3); assert.equal(state.confirmed, false); assert.equal(state.round, null);
  } finally { await context.close(); }
});
