'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const D = require('../domain/acceptance');
const { runProject } = require('../runtime/runner');
function project(runtime, source) { const entry = runtime === 'python' ? 'main.py' : 'main.js'; return D.normalizeProject({ name: 'unknown', runtime, entry, files: { [entry]: source } }); }
test('Node executes real JSON input/output in an isolated temporary directory', async () => {
  const source = `let data=''; process.stdin.on('data',c=>data+=c); process.stdin.on('end',()=>console.log(JSON.stringify({value:JSON.parse(data).x*3,cwd:process.cwd(),key:process.env.MODEL_API_KEY||null})));`;
  const old = process.env.MODEL_API_KEY; process.env.MODEL_API_KEY = 'test-only-private';
  try {
    const run = await runProject({ project: project('node', source), case: { id: 'three', input: { x: 7 } }, approved: true });
    assert.equal(run.status, 'completed'); assert.equal(run.output.value, 21); assert.equal(run.output.key, null);
    assert.ok(run.trace.some(trace => trace.file === 'main.js'));
    await assert.rejects(fs.access(run.output.cwd));
    assert.ok(run.evidence.every(e => e.runId === run.id));
  } finally { if (old == null) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = old; }
});
test('Python emits actual JSON and only real executed line evidence', async () => {
  const source = `import json,sys\ndata=json.load(sys.stdin)\nif data['age'] > 18:\n    result=True\nelse:\n    result=False\nprint(json.dumps({'eligible':result}))\n`;
  const run = await runProject({ project: project('python', source), case: { id: 'boundary', input: { age: 18 } }, approved: true });
  assert.equal(run.status, 'completed'); assert.equal(run.output.eligible, false);
  assert.ok(run.trace.some(t => t.line === 6)); assert.ok(!run.trace.some(t => t.line === 4));
});
test('approval, timeout, cancellation and truncated output never pretend completion', async () => {
  const p = project('node', 'setInterval(()=>{},1000);');
  await assert.rejects(runProject({ project: p, case: {}, approved: false }));
  const timeout = await runProject({ project: p, case: {}, approved: true, timeoutMs: 100 });
  assert.equal(timeout.status, 'timeout');
  const controller = new AbortController(); setTimeout(() => controller.abort(), 100);
  const cancelled = await runProject({ project: p, case: {}, approved: true, signal: controller.signal });
  assert.equal(cancelled.status, 'cancelled');
  const large = await runProject({ project: project('node', `console.log('x'.repeat(10000))`), case: {}, approved: true, maxOutputBytes: 1000 });
  assert.equal(large.status, 'error'); assert.equal(large.truncated, true);
});
test('nonzero exit is observable for negative cases rather than rewritten to success', async () => {
  const p = project('node', 'console.error("invalid input"); process.exit(3);');
  const run = await runProject({ project: p, case: { id: 'bad' }, approved: true });
  assert.equal(run.exitCode, 3); assert.match(run.stderr, /invalid input/);
  const c = D.createCase({ id: 'bad', origin: 'user', confirmed: true, expected: { target: { kind: 'exitCode' }, operator: 'equals', value: 3 } }, p.revision);
  assert.equal(D.evaluateCase(c, run).state, 'passed');
});
