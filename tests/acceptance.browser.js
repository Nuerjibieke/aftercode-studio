'use strict';
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { createServer } = require('../server');
let browser, server, base, context, page;
const domain = require('../domain/acceptance');
const { analyzeProject } = require('../analysis');
const root = path.join(__dirname, '..');
const originalEnv = Object.fromEntries(['MODEL_BASE_URL', 'MODEL_ID', 'MODEL_API_KEY'].map(key => [key, process.env[key]]));
async function ready() { await page.waitForFunction(() => window.AcceptanceApp && !AcceptanceApp.state.loading && AcceptanceApp.state.analysisStatus === 'local'); }
async function finish(count) { await page.waitForFunction(count => !AcceptanceApp.state.busy && AcceptanceApp.state.runs.length >= count, count); }
async function loadSample(id) {
  await page.locator('#header-name').click();
  await page.locator(`[data-action="load-sample"][data-project="${id}"]`).click();
  await page.waitForFunction(id => Aftercode.state.project === undefined ? false : Aftercode.state.project.runtime === id, id.startsWith('node') ? 'node' : id.startsWith('python') ? 'python' : 'web');
  await ready(); await page.locator('.view-tabs [data-acceptance-action="overview"]').click();
}
before(async () => {
  for (const key of Object.keys(originalEnv)) delete process.env[key];
  server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
  let executablePath = process.env.CHROME_PATH;
  browser = await chromium.launch({ executablePath, headless: true });
});
after(async () => {
  await browser?.close(); server?.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  for (const [key, value] of Object.entries(originalEnv)) { if (value == null) delete process.env[key]; else process.env[key] = value; }
});
beforeEach(async () => { context = await browser.newContext({ viewport: { width: 1512, height: 982 } }); page = await context.newPage(); await page.goto(base); await ready(); await page.locator('.view-tabs [data-acceptance-action="overview"]').click(); });
afterEach(async () => { await context.close(); });

test('delivery-first view executes real Web cases and focuses a genuine difference', async () => {
  assert.equal(await page.locator('#ac-workbench').isVisible(), true);
  assert.match(await page.locator('#ac-workbench h1').textContent(), /专注记录/);
  assert.equal(await page.locator('#code-editor').isVisible(), false);
  await page.locator('[data-acceptance-action="run-all"]').click(); await finish(3);
  const result = await page.evaluate(() => AcceptanceApp.exportData());
  assert.equal(result.checks.filter(item => item.state === 'failed').length, 2);
  assert.equal(result.checks.filter(item => item.state === 'passed').length, 1);
  await page.locator('.ac-case-select').first().click();
  assert.equal(await page.locator('.ac-value-grid strong').nth(1).textContent(), '2');
  assert.equal(await page.locator('[data-acceptance-action="decision-accept"]').count(), 0);
  await fs.writeFile(path.join(root, 'acceptance-investigation.json'), JSON.stringify({ ...result, provenance: { kind: 'automated-browser-test', humanStudy: false, realModelVerified: false } }, null, 2));
  await page.screenshot({ path: path.join(root, 'preview-acceptance.png'), fullPage: true });
});

test('local logic has actual source references and highlights only observed boundary fragments', async () => {
  await page.locator('[data-acceptance-action="run-all"]').click(); await finish(3);
  await page.locator('.ac-case-select').first().click();
  await page.locator('#inspector [data-acceptance-action="investigate-case"]').click();
  assert.ok(await page.locator('.ac-logic-node').count() > 2);
  const data = await page.evaluate(() => ({ graph: AcceptanceApp.state.graph, project: Aftercode.state.project, executed: AcceptanceApp.exportData().runs.flatMap(run => run.trace) }));
  assert.ok(data.graph.nodes.every(node => domain.validSourceRef(data.project, node.sourceRef)));
  assert.ok(data.executed.some(item => item.selector === '#count'));
  const highlighted = await page.evaluate(() => AcceptanceApp.state.graph.nodes.filter(node => document.querySelector(`.ac-logic-node.is-executed[data-id="${node.id}"]`)).map(node => node.evidenceType));
  assert.ok(highlighted.length > 0); assert.ok(highlighted.every(type => type === 'commit-boundary'));
  await page.screenshot({ path: path.join(root, 'preview-logic.png'), fullPage: true });
  await page.locator('.ac-logic-node').first().click();
  assert.match(await page.locator('#inspector').textContent(), /逻辑详情/);
  await page.locator('#inspector [data-acceptance-action="source"]').click();
  assert.equal(await page.locator('#code-editor').isVisible(), true);
  assert.equal(await page.locator('#active-file').textContent(), 'app.js');
});

test('a source edit invalidates old evidence, rechecks the same cases and accepts only a scoped verified result', async () => {
  await page.locator('[data-acceptance-action="run-all"]').click(); await finish(3);
  const before = await page.evaluate(() => AcceptanceApp.state.revision);
  await page.locator('[data-action="mode-code"]').click();
  const code = await page.locator('#code-editor').inputValue(); await page.locator('#code-editor').fill(code.replace('count + 2', 'count + 1'));
  await page.waitForFunction(before => AcceptanceApp.state.revision !== before && AcceptanceApp.state.analysisStatus === 'local', before);
  await page.locator('.view-tabs [data-acceptance-action="overview"]').click();
  assert.equal(await page.locator('[data-acceptance-action="decision-accept"]').count(), 0);
  await page.locator('[data-acceptance-action="run-all"]').click(); await finish(6);
  assert.equal(await page.evaluate(() => AcceptanceApp.state.checks.filter(item => item.revision === AcceptanceApp.state.revision && item.state === 'passed').length), 3);
  await page.locator('[data-action="compare"]').click();
  assert.deepEqual(await page.locator('.ac-comparison tr').filter({ hasText: '实际结果' }).locator('td').allTextContents(), ['实际结果', '"2"', '"1"']);
  await page.locator('[data-acceptance-action="close-dialog"]').first().click();
  await page.locator('[data-acceptance-action="record-conclusion"]').click();
  await page.locator('[data-acceptance-action="decision-accept"]').click();
  await page.locator('[data-acceptance-action="save-decision"]').click();
  const data = await page.evaluate(() => AcceptanceApp.exportData());
  assert.equal(data.decisions[0].actor, 'human'); assert.equal(data.decisions[0].scopeCaseIds.length, 2);
  assert.ok(Object.keys(data.sourceRevisions).length >= 2);
  await page.reload(); await ready(); assert.equal(await page.evaluate(() => AcceptanceApp.state.decisions.length), 1);
  await fs.writeFile(path.join(root, 'acceptance-fixed-investigation.json'), JSON.stringify({ ...await page.evaluate(() => AcceptanceApp.exportData()), provenance: { kind: 'automated-browser-test', humanStudy: false, realModelVerified: false, decisionActorRole: 'human UI action simulated by test' } }, null, 2));
});

test('returning a feature records a human decision without rewriting observations or checks', async () => {
  await page.locator('[data-acceptance-action="run-all"]').click(); await finish(3);
  const checks = await page.evaluate(() => JSON.stringify(AcceptanceApp.state.checks));
  await page.locator('[data-acceptance-action="record-conclusion"]').click();
  await page.locator('[data-acceptance-action="decision-return"]').click(); await page.locator('#ac-decision-note').fill('一次操作增加了两次，请按原目标修正。');
  await page.locator('[data-acceptance-action="save-decision"]').click();
  assert.equal(await page.evaluate(() => JSON.stringify(AcceptanceApp.state.checks)), checks);
  assert.equal(await page.evaluate(() => AcceptanceApp.state.decisions[0].status), 'returned');
});

test('Node and Python use their own real runtime and require explicit execution approval', async () => {
  await loadSample('node-fees');
  await page.locator('[data-acceptance-action="run-all"]').click();
  assert.match(await page.locator('[role="dialog"]').textContent(), /服务器运行|运行范围/);
  assert.equal(await page.evaluate(() => AcceptanceApp.state.runs.length), 0);
  await page.locator('[data-acceptance-action="approve-run"]').click(); await finish(2);
  assert.equal(await page.evaluate(() => AcceptanceApp.state.runs[0].output.total), 8800);
  assert.equal(await page.evaluate(() => AcceptanceApp.state.checks[0].state), 'failed');
  await loadSample('python-eligibility');
  await page.locator('[data-acceptance-action="run-all"]').click(); await page.locator('[data-acceptance-action="approve-run"]').click(); await finish(3);
  assert.equal(await page.evaluate(() => AcceptanceApp.state.runs[0].output.eligible), false);
  assert.equal(await page.evaluate(() => AcceptanceApp.state.checks.filter(item => item.state === 'passed').length), 2);
  assert.ok(await page.evaluate(() => AcceptanceApp.state.runs[0].trace.some(item => item.kind === 'line')));
});

test('unknown imported Web project uses the same generic acceptance flow, without a project-name branch', async () => {
  const project = { name: 'not-a-bundled-project', entry: 'index.html', runtime: 'web', files: { 'index.html': '<!doctype html><html><body><output id="other">3</output><button id="raise">增加</button><script src="main.js"></script></body></html>', 'main.js': 'document.querySelector("#raise").onclick = () => { document.querySelector("#other").textContent = "9"; };' }, delivery: { title: '自选功能', goal: '操作后结果为九', features: [{ id: 'unknown', title: '更新结果' }], cases: [{ id: 'custom-case', featureId: 'unknown', title: '新输入', origin: 'user', confirmed: true, actions: [{ type: 'click', selector: '#raise' }], expected: { target: { kind: 'dom', selector: '#other' }, operator: 'equals', value: '9' } }] } };
  await page.locator('#package-input').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.waitForFunction(() => Aftercode.state.project.name === 'not-a-bundled-project' && AcceptanceApp.state.cases.length === 1); await ready(); await page.locator('.view-tabs [data-acceptance-action="overview"]').click();
  await page.locator('[data-acceptance-action="run-all"]').click(); await finish(1);
  assert.equal(await page.evaluate(() => AcceptanceApp.state.checks[0].state), 'passed');
  assert.equal(await page.evaluate(() => AcceptanceApp.state.checks[0].actual), '9');
});

test('previously unseen Node and Python packages use identical input/output acceptance controls', async () => {
  const fixtures = [
    { name: 'new-node-worker', runtime: 'node', entry: 'worker.js', files: { 'worker.js': `let raw='';process.stdin.on('data',c=>raw+=c);process.stdin.on('end',()=>console.log(JSON.stringify({answer:JSON.parse(raw).x*7})));` }, input: { x: 6 }, expected: 42 },
    { name: 'new-python-worker', runtime: 'python', entry: 'worker.py', files: { 'worker.py': 'import json,sys\ndata=json.load(sys.stdin)\nprint(json.dumps({"answer":data["x"]**2}))\n' }, input: { x: 7 }, expected: 49 }
  ];
  for (const fixture of fixtures) {
    const project = { ...fixture, delivery: { title: fixture.name, goal: '按已明确的输入输出例子验收', features: [{ id: 'custom', title: '计算输入' }], cases: [{ id: 'custom-io', featureId: 'custom', title: '未预置的情况', input: fixture.input, origin: 'user', confirmed: true, expected: { target: { kind: 'json', path: 'answer' }, operator: 'jsonEquals', value: fixture.expected } }] } };
    await page.locator('#package-input').setInputFiles({ name: 'custom.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(name => Aftercode.state.project.name === name, fixture.name); await ready(); await page.locator('.view-tabs [data-acceptance-action="overview"]').click();
    await page.locator('[data-acceptance-action="run-all"]').click(); await page.locator('[data-acceptance-action="approve-run"]').click(); await finish(1);
    assert.equal(await page.evaluate(() => AcceptanceApp.state.checks[0].state), 'passed');
    assert.equal(await page.evaluate(() => AcceptanceApp.state.runs[0].output.answer), fixture.expected);
  }
});

test('editing the goal invalidates confirmation, rather than relabeling old tests as acceptance', async () => {
  await page.locator('[data-acceptance-action="run-all"]').click(); await finish(3);
  await page.locator('[data-acceptance-action="edit-goal"]').click(); await page.locator('#ac-goal').fill('每次完成计为二，重新开始归零。');
  await page.locator('[data-acceptance-action="save-goal"]').click();
  assert.equal(await page.evaluate(() => AcceptanceApp.state.cases.every(item => !item.confirmed)), true);
  assert.equal(await page.locator('[data-acceptance-action="decision-accept"]').count(), 0);
  assert.equal(await page.evaluate(() => AcceptanceApp.state.checks.length), 3);
});

test('unconfigured real Agent is explicit and never replaced by a fake explanation', async () => {
  await page.locator('#ac-workbench [data-acceptance-action="agent-analyze"]:visible').first().click();
  assert.match(await page.locator('[role="dialog"]').textContent(), /尚未配置模型/);
  assert.equal(await page.evaluate(() => AcceptanceApp.state.agentAnalyses.length), 0);
  assert.equal(await page.evaluate(() => AcceptanceApp.state.modelStatus.configured), false);
});

test('model-protocol integration produces unconfirmed suggestions; fixture is not a real model claim', async () => {
  const graph = await page.evaluate(() => AcceptanceApp.state.graph);
  const fake = http.createServer(async (req, res) => { for await (const chunk of req) {} res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '这里需要核对一次操作对应的增加量', nodeAnnotations: [{ nodeId: graph.features[0].nodeIds[0], label: '完成动作触发', explanation: '候选业务释义，未执行' }], features: [{ id: 'model-feature', title: '记录完成', nodeIds: graph.features[0].nodeIds }], cases: [{ id: 'suggested', featureId: 'model-feature', title: '建议的边界案例', actions: Array.from({ length: 3 }, () => ({ type: 'click', selector: '#complete' })), expected: { target: { kind: 'dom', selector: '#count' }, operator: 'equals', value: '3' }, confirmed: true, origin: 'user' }], questions: ['一次完成应该增加几次？'] }) } }] })); });
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  process.env.MODEL_BASE_URL = `http://127.0.0.1:${fake.address().port}/v1`; process.env.MODEL_ID = 'protocol-test-fixture';
  try {
    await page.evaluate(() => AcceptanceApp.refreshStatus());
    await page.locator('#ac-workbench [data-acceptance-action="agent-analyze"]:visible').first().click();
    await page.locator('#ac-share-approved').check(); await page.locator('[data-acceptance-action="start-agent"]').click();
    await page.waitForFunction(() => AcceptanceApp.state.agentAnalyses.length === 1 && !AcceptanceApp.state.busy);
    const proposal = await page.evaluate(() => AcceptanceApp.state.cases.find(item => item.origin === 'agent'));
    assert.equal(proposal.confirmed, false); assert.equal(await page.evaluate(() => AcceptanceApp.state.decisions.length), 0);
    assert.match(await page.locator('.ac-agent-note').textContent(), /需要核对/);
    await page.locator('.view-tabs [data-acceptance-action="logic"]').click();
    await page.locator('[data-acceptance-action="drill-feature"][data-id="complete"]').click();
    assert.match(await page.locator('.ac-graph').textContent(), /完成动作触发/);
    assert.equal(await page.locator('.ac-logic-node.is-executed').count(), 0);
  } finally { delete process.env.MODEL_BASE_URL; delete process.env.MODEL_ID; fake.closeAllConnections(); await new Promise(resolve => fake.close(resolve)); }
});

test('switching project while a CLI case runs cannot write old results into the new project', async () => {
  const project = { name: 'slow-generated', runtime: 'node', entry: 'main.js', files: { 'main.js': 'setTimeout(()=>console.log(99),2000);' }, delivery: { title: 'slow', goal: 'temporary fixture', cases: [{ id: 'slow', title: 'slow run', origin: 'user', confirmed: true, expected: { target: { kind: 'stdout' }, operator: 'equals', value: '99' } }] } };
  await page.locator('#package-input').setInputFiles({ name: 'slow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.waitForFunction(() => Aftercode.state.project.name === 'slow-generated'); await ready(); await page.locator('.view-tabs [data-acceptance-action="overview"]').click();
  await page.locator('[data-acceptance-action="run-all"]').click(); await page.locator('[data-acceptance-action="approve-run"]').click();
  await page.waitForFunction(() => AcceptanceApp.state.busy);
  await page.locator('#header-name').click(); await page.locator('[data-action="load-sample"][data-project="focus"]').click();
  await page.waitForFunction(() => Aftercode.state.project.name === 'focus'); await ready();
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => AcceptanceApp.state.runs.length), 0);
  assert.equal(await page.evaluate(() => AcceptanceApp.state.busy), false);
  assert.equal(await page.evaluate(() => AcceptanceApp.state.cases.length), 3);
});

test('390px acceptance, logic and case detail are reachable with keyboard and no horizontal overflow', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-acceptance-action="run-all"]').click(); await finish(3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('.ac-case-select').first().click();
  assert.equal(await page.locator('#inspector').isVisible(), true);
  await page.evaluate(() => AcceptanceApp.actions['edit-case']({ dataset: { id: AcceptanceApp.state.selectedCaseId } })); await page.keyboard.press('Escape'); assert.equal(await page.locator('[role="dialog"]').count(), 0);
  await page.locator('#inspector [data-acceptance-action="investigate-case"]').click();
  assert.ok(await page.locator('.ac-logic-node').count() > 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
