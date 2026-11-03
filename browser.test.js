'use strict';
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
let browser, context, page;
const url = pathToFileURL(path.join(__dirname, 'index.html')).href + '?view=workspace';
const frame = () => page.frameLocator('#preview-frame');
const state = expression => page.evaluate(expression);
async function ready() { await page.waitForFunction(() => window.Aftercode?.state.rt?.ready); }
async function select(selector) {
  await page.locator('#selection-button').click();
  await frame().locator(selector).click();
  await page.waitForFunction(selector => Aftercode.state.selected?.selector === selector, selector);
}
async function saveRule(expected, operator = 'equals') {
  await page.locator('#inspector [data-action="rule"]').first().click();
  await page.locator('#rule-operator').selectOption(operator);
  await page.locator('#rule-expected').fill(expected);
  await page.locator('[data-action="save-rule"]').click();
}
before(async () => {
  let executablePath = process.env.CHROME_PATH;
  if (!executablePath && process.platform === 'darwin') {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    try { await fs.access(chrome); executablePath = chrome; } catch {}
  }
  browser = await chromium.launch({ executablePath, headless: true });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  page = await context.newPage();
  await page.goto(url); await ready();
});
afterEach(async () => { await context.close(); });

test('any DOM object is selected without invoking its application action', async () => {
  await select('#complete');
  assert.equal(await frame().locator('#count').textContent(), '0');
  assert.equal(await state(() => Aftercode.state.rt.actions.length), 0);
  assert.equal(await state(() => Aftercode.state.selected.selector), '#complete');
  assert.equal(await page.locator('[data-action="breakpoint"]').isDisabled(), true);
});

test('real pointer selection, expected value, precommit pause and one-step commit', async () => {
  await select('#count');
  await saveRule('1');
  await page.locator('[data-action="breakpoint"]').click();
  await frame().locator('#complete').click();
  await page.waitForFunction(() => !!Aftercode.state.rt.pending);
  assert.equal(await frame().locator('#count').textContent(), '0');
  assert.equal(await state(() => Aftercode.state.rt.pending.proposal.value), 2);
  assert.equal(await state(() => Aftercode.state.rt.revision), 0);
  await page.locator('[data-action="step"]').click();
  await page.waitForFunction(() => Aftercode.state.rt.revision === 1);
  assert.equal(await frame().locator('#count').textContent(), '2');
  assert.equal(await frame().locator('#complete').isDisabled(), false);
  assert.equal(await state(() => Aftercode.state.rt.checks.at(-1).passed), false);
  assert.equal(await state(() => Aftercode.state.rt.events.filter(e => e.type === 'commit').length), 1);
  await state(() => Aftercode.state.rt.step());
  assert.equal(await state(() => Aftercode.state.rt.revision), 1);
});

test('new run cancels pending old callbacks and permits', async () => {
  await select('#count');
  await page.locator('[data-action="breakpoint"]').click();
  await frame().locator('#complete').click();
  await page.waitForFunction(() => !!Aftercode.state.rt.pending);
  const old = await state(() => Aftercode.state.rt.id);
  await page.locator('#run-button').click();
  await page.waitForFunction(old => Aftercode.state.rt.id !== old && Aftercode.state.rt.ready, old);
  assert.equal(await frame().locator('#count').textContent(), '0');
  assert.equal(await state(() => Aftercode.state.rt.pending), null);
  assert.equal(await state(() => Aftercode.state.history.at(-1).status), 'cancelled');
});

test('edit arbitrary project code, fork, replay actions, and compare real outputs', async () => {
  await select('#count'); await saveRule('1');
  await frame().locator('#complete').click();
  await page.waitForFunction(() => Aftercode.state.rt.revision === 1);
  const baseline = await state(() => Aftercode.state.rt.id);
  await page.locator('[data-action="open-file"][data-file="app.js"]').click();
  const code = await page.locator('#code-editor').inputValue();
  await page.locator('#code-editor').fill(code.replace('count + 2', 'count + 1'));
  assert.equal(await frame().locator('#count').textContent(), '2');
  await page.locator('.header-actions [data-action="experiment"]').click();
  await page.locator('.prediction-details summary').click();
  await page.locator('#exp-selector').fill('#count');
  await page.locator('#exp-prediction').fill('1');
  await page.locator('#exp-hypothesis').fill('一次操作只应增加 1');
  await page.locator('[data-action="create-experiment"]').click();
  await page.waitForFunction(() => Aftercode.state.rt.predictions[0]?.result === 'consistent' && Aftercode.state.rt.events.some(e => e.label.startsWith('重放完成')));
  assert.equal(await frame().locator('#count').textContent(), '1');
  const data = await state(() => Aftercode.exportData());
  const current = data.runs.find(run => run.id === data.activeRunId);
  assert.equal(current.parent, baseline);
  assert.equal(current.checks.at(-1).passed, true);
  assert.equal(data.runs.find(run => run.id === baseline).observations.at(-1).value, '2');
  assert.ok(current.predictions[0].frozenAt <= current.startedAt);
  await page.locator('[data-action="compare"]').click();
  assert.match(await page.locator('.compare-table').textContent(), /#count/);
  assert.match(await page.locator('.compare-table').textContent(), /2/);
  assert.match(await page.locator('.compare-table').textContent(), /1/);
  await fs.writeFile(path.join(__dirname, 'investigation.json'), JSON.stringify({ ...data, provenance: { kind: 'automated-browser-test', humanStudy: false, realModelVerified: false } }, null, 2));
});

test('uninstrumented application remains observable but cannot fake precommit pause', async () => {
  await page.locator('[data-action="project"]').first().click();
  await page.locator('[data-action="load-sample"][data-project="calculator"]').click();
  await page.waitForFunction(() => Aftercode.state.rt.projectName === 'calculator' && Aftercode.state.rt.ready);
  await select('#result');
  assert.equal(await page.locator('[data-action="breakpoint"]').isDisabled(), true);
  await frame().locator('#amount').fill('137.50');
  await frame().locator('#rate').fill('15');
  await frame().locator('#calculate').click();
  await page.waitForFunction(() => Aftercode.state.selected.value === '20.63');
  assert.equal(await frame().locator('#result').textContent(), '20.63');
  assert.equal(await state(() => Aftercode.state.rt.pending), null);
});

test('a previously unseen imported project uses the same editor, picker and checker', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'aftercode-project-'));
  try {
    await fs.writeFile(path.join(folder, 'index.html'), '<!doctype html><html><body><h1>任意库存</h1><output id="inventory">7</output><button id="add">补货</button><script src="stock.js"></script></body></html>');
    await fs.writeFile(path.join(folder, 'stock.js'), 'document.querySelector("#add").onclick = () => { document.querySelector("#inventory").textContent = "11"; console.log("restocked"); };');
    await page.locator('#folder-input').setInputFiles(folder);
    await page.waitForFunction(() => !!Aftercode.state.project.files['stock.js'] && Aftercode.state.rt.ready);
    await select('#inventory'); await saveRule('11');
    await frame().locator('#add').click();
    await page.waitForFunction(() => Aftercode.state.rt.checks.at(-1)?.actual === '11');
    assert.equal(await state(() => Aftercode.state.rt.checks.at(-1).passed), true);
    assert.equal(await state(() => Aftercode.state.rt.capabilities.length), 0);
    assert.equal(await state(() => Aftercode.state.rt.console.at(-1).args[0]), 'restocked');
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test('history review preserves evidence and keyboard Escape closes panels', async () => {
  await select('#count'); await frame().locator('#complete').click();
  await page.waitForFunction(() => Aftercode.state.rt.revision === 1);
  const before = await state(() => JSON.stringify(Aftercode.snapshot(Aftercode.state.rt)));
  await page.locator('[data-action="history"]').first().click();
  await page.locator('[data-action="view-run"]').click();
  assert.equal(await state(() => JSON.stringify(Aftercode.snapshot(Aftercode.state.rt))), before);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[role="dialog"]').count(), 0);
});

test('asynchronous action replay preserves relative ordering and waits for registered tasks', async () => {
  await page.locator('[data-action="project"]').first().click();
  await page.locator('[data-action="load-sample"][data-project="search"]').click();
  await page.waitForFunction(() => Aftercode.state.rt.projectName === 'search' && Aftercode.state.rt.ready);
  await select('#results');
  await frame().locator('#query').fill('设计'); await frame().locator('#search').click();
  await frame().locator('#query').fill('工程'); await frame().locator('#search').click();
  await page.waitForFunction(() => Aftercode.state.rt.revision === 2);
  assert.match(await frame().locator('#results').textContent(), /设计/);
  await page.locator('.header-actions [data-action="experiment"]').click();
  await page.locator('[data-action="create-experiment"]').click();
  await page.waitForFunction(() => Aftercode.state.rt.replayDone && Aftercode.state.rt.revision === 2);
  assert.match(await frame().locator('#results').textContent(), /设计/);
  assert.equal(await state(() => Aftercode.state.rt.actions.length), 4);
});

test('edited workspace survives reload without silently replaying previous actions', async () => {
  await page.locator('[data-action="open-file"][data-file="app.js"]').click();
  const code = await page.locator('#code-editor').inputValue();
  await page.locator('#code-editor').fill(code.replace('count + 2', 'count + 3'));
  await page.reload(); await ready();
  assert.match(await state(() => Aftercode.state.project.files['app.js']), /count \+ 3/);
  assert.equal(await frame().locator('#count').textContent(), '0');
  await frame().locator('#complete').click();
  await page.waitForFunction(() => Aftercode.state.rt.revision === 1);
  assert.equal(await frame().locator('#count').textContent(), '3');
});

test('new instrumented project can pause two separate commits with the same generic core', async () => {
  const project = { name: 'arbitrary-score', entry: 'index.html', files: {
    'index.html': '<!doctype html><html><body><output id="score">7</output><button id="raise">继续</button><script src="score.js"></script></body></html>',
    'score.js': `const el = document.querySelector('#score'); debug.expose('#score', { beforeCommit: true }); document.querySelector('#raise').onclick = async () => { await debug.commit('#score', 13, () => el.textContent = '13'); await debug.commit('#score', 17, () => el.textContent = '17'); };`
  }};
  await page.locator('#package-input').setInputFiles({ name: 'score.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.waitForFunction(() => Aftercode.state.rt.projectName === 'arbitrary-score' && Aftercode.state.rt.ready);
  await select('#score'); await page.locator('[data-action="breakpoint"]').click();
  await frame().locator('#raise').click(); await page.waitForFunction(() => !!Aftercode.state.rt.pending);
  assert.equal(await frame().locator('#score').textContent(), '7');
  await page.locator('[data-action="step"]').click();
  await page.waitForFunction(() => Aftercode.state.rt.pending?.proposal.value === 17);
  assert.equal(await frame().locator('#score').textContent(), '13');
  assert.equal(await state(() => Aftercode.state.rt.revision), 1);
  await page.locator('[data-action="step"]').click();
  await page.waitForFunction(() => Aftercode.state.rt.revision === 2);
  assert.equal(await frame().locator('#score').textContent(), '17');
});

test('unsupported project import preserves the existing usable workspace', async () => {
  const oldId = await state(() => Aftercode.state.rt.id);
  const project = { name: 'needs-build', entry: 'index.html', files: { 'index.html': '<script type="module" src="app.js"></script>', 'app.js': 'import x from "./missing.js";' } };
  await page.locator('#package-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('运行适配器'));
  assert.equal(await state(() => Aftercode.state.rt.id), oldId);
  assert.equal(await state(() => Aftercode.state.project.name), 'focus');
});

test('exported evidence references resolve to facts in their original run', async () => {
  await select('#count'); await saveRule('2');
  await frame().locator('#complete').click();
  await page.waitForFunction(() => Aftercode.state.rt.revision === 1);
  const data = await state(() => Aftercode.exportData());
  for (const run of data.runs) {
    const observations = new Map(run.observations.map(obs => [obs.id, obs]));
    for (const check of run.checks) for (const ref of check.evidence) {
      assert.ok(observations.has(ref));
      assert.equal(observations.get(ref).runId, run.id);
    }
    for (const prediction of run.predictions) {
      assert.ok(prediction.frozenAt <= run.startedAt);
      if (prediction.evidence) assert.ok(observations.has(prediction.evidence));
    }
  }
});

test('390px mobile preview and object inspector remain usable without horizontal overflow', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await select('#count');
  assert.equal(await page.locator('#inspector').isVisible(), true);
  assert.equal(await state(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('[data-action="rule"]').click();
  await page.locator('#rule-expected').fill('1');
  await page.locator('[data-action="save-rule"]').click();
  await page.locator('[data-action="mobile-preview"]').click();
  await frame().locator('#complete').click();
  await page.waitForFunction(() => Aftercode.state.rt.revision === 1);
  assert.equal(await frame().locator('#count').textContent(), '2');
});
