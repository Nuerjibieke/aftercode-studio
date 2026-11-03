'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
async function serve(work) { const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); try { await work(`http://127.0.0.1:${server.address().port}`); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
const project = { name: 'public-test', runtime: 'node', entry: 'main.js', files: { 'main.js': 'console.log(JSON.stringify({ answer: 42 }));' } };
const post = (url, data, extra = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(data) });
test('local HTTP API analyzes real sources and executes only approved plans', async () => {
  await serve(async base => {
    const graph = await (await post(base + '/api/analyze', { project })).json();
    assert.ok(graph.nodes.length); assert.equal(graph.nodes[0].sourceRef.file, 'main.js');
    assert.equal((await post(base + '/api/run', { project })).status, 403);
    const response = await post(base + '/api/run', { project, approved: true, case: { id: 'answer', origin: 'user', confirmed: true, expected: { target: { kind: 'json', path: 'answer' }, operator: 'jsonEquals', value: 42 } } });
    const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.run.output.answer, 42); assert.equal(result.check.state, 'passed');
  });
});
test('model API refuses unapproved sharing and never serves local secret/config files', async () => {
  await serve(async base => {
    assert.equal((await post(base + '/api/agent/analyze', { project })).status, 403);
    for (const file of ['.env', 'agent/gateway.js', 'runtime/runner.js', 'node_modules/acorn/package.json']) assert.equal((await fetch(base + '/' + file)).status, 404);
    assert.equal((await post(base + '/api/analyze', { project }, { Origin: 'https://untrusted.example' })).status, 403);
  });
});
