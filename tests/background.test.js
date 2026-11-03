'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createJobQueue } = require('../acceptance/jobs');
const { analyzeProject } = require('../analysis');
async function finish(queue, id) { for (let i = 0; i < 500; i++) { const job = queue.get(id); if (!['running', 'queued'].includes(job.status)) return job; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('background timeout'); }
test('server-side Web acceptance collects real DOM evidence and persists findings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aftercode-job-test-')); const queue = createJobQueue({ directory: dir, analyze: analyzeProject });
  try {
    const project = { name: 'unknown-web', runtime: 'web', entry: 'index.html', files: { 'index.html': '<html><body><output id="number">0</output><button id="go">Go</button><script src="main.js"></script></body></html>', 'main.js': `debug.expose('#number'); document.querySelector('#go').onclick=async()=>{ await debug.commit('#number',2,()=>document.querySelector('#number').textContent='2'); };` } };
    const job = queue.create({ project, approved: true, cases: [{ id: 'once', title: '一次增加一', origin: 'user', confirmed: true, actions: [{ type: 'click', selector: '#go' }], expected: { target: { kind: 'dom', selector: '#number' }, operator: 'equals', value: '1' } }] });
    const result = await finish(queue, job.id); assert.equal(result.status, 'completed'); assert.equal(result.checks[0].state, 'failed'); assert.equal(result.checks[0].actual, '2');
    assert.equal(result.runs[0].roundId, job.id); assert.equal(result.checks[0].roundId, job.id); assert.equal(result.findings[0].roundId, job.id);
    assert.equal(result.findings[0].kind, 'difference'); assert.ok(result.runs[0].trace[0].sourceRef);
    const restored = createJobQueue({ directory: dir }); assert.equal(restored.get(job.id).runs[0].id, result.runs[0].id); restored.close();
  } finally { queue.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('suggested standards remain unconfirmed after background execution and cancellation is explicit', async () => {
  const queue = createJobQueue();
  try {
    const project = { name: 'arbitrary', runtime: 'node', entry: 'main.js', files: { 'main.js': 'console.log(2)' } };
    const job = queue.create({ project, approved: true, cases: [{ id: 'proposal', origin: 'agent', confirmed: true, expected: { target: { kind: 'stdout' }, operator: 'equals', value: '1' } }] });
    const result = await finish(queue, job.id); assert.equal(result.checks[0].state, 'needs_confirmation'); assert.equal(result.findings.length, 0);
    const slow = queue.create({ project: { ...project, files: { 'main.js': 'setInterval(()=>{},1000)' } }, approved: true, cases: [{ id: 'slow', origin: 'user', confirmed: true }] });
    queue.cancel(slow.id); assert.equal((await finish(queue, slow.id)).status, 'cancelled');
  } finally { queue.close(); }
});
