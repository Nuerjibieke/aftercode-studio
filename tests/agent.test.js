'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const D = require('../domain/acceptance');
const { analyzeProject } = require('../analysis');
const G = require('../agent/gateway');
const project = D.normalizeProject({ name: 'non-sensitive-generated-fixture', entry: 'main.js', files: { 'main.js': 'console.log(2);' } });
async function endpoint(handler, work) {
  const server = http.createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await work(`http://127.0.0.1:${server.address().port}/v1`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const response = (res, message) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message }] })); };
test('model configuration exposes no credential and preserves endpoint paths', () => {
  const config = { baseUrl: 'http://127.0.0.1:1234/v1', model: 'fixture', apiKey: 'synthetic-private-token' };
  assert.equal(G.configFrom(config).endpoint, config.baseUrl + '/chat/completions');
  assert.equal(G.configFrom({ ...config, baseUrl: config.baseUrl + '/chat/completions' }).endpoint, config.baseUrl + '/chat/completions');
  assert.equal(JSON.stringify(G.getModelStatus(config)).includes(config.apiKey), false);
});
test('HKUST legacy configuration uses the official deployment route and api-key header', () => {
  const cfg=G.configFrom({baseUrl:'https://hkust.azure-api.net/openai',model:'gpt-4o',apiKey:'synthetic-test-key'});
  assert.equal(cfg.endpoint,'https://hkust.azure-api.net/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21');
  const headers=G.requestHeaders(cfg);assert.equal(headers['api-key'],'synthetic-test-key');assert.equal(headers.Authorization,undefined);
});
test('real HTTP protocol and read-only tool loop return unconfirmed proposals, not fabricated checks', async () => {
  const graph = await analyzeProject(project); let calls = 0;
  await endpoint(async (req, res) => {
    let text = ''; for await (const part of req) text += part;
    const body = JSON.parse(text); calls++;
    if (calls === 1) response(res, { role: 'assistant', content: null, tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'read_source', arguments: JSON.stringify({ file: 'main.js', startLine: 1, endLine: 1 }) } }] });
    else {
      assert.match(body.messages.at(-1).content, /console.log/);
      response(res, { role: 'assistant', content: JSON.stringify({ summary: '输出值需要确认', features: [{ id: 'feature-main', title: '输出结果', nodeIds: [graph.nodes[0].id] }], cases: [{ title: '核对输出', origin: 'user', confirmed: true, expected: { target: { kind: 'stdout' }, operator: 'equals', value: '2' } }], questions: ['这里应该输出什么？'] }) });
    }
  }, async baseUrl => {
    const result = await G.analyzeWithModel({ project, graph, goal: '核对结果', config: { baseUrl, model: 'fixture', apiKey: 'synthetic-private-token' } });
    assert.equal(result.source, 'model'); assert.equal(result.toolCalls.length, 1); assert.equal(calls, 2);
    assert.equal(result.cases[0].origin, 'agent'); assert.equal(result.cases[0].confirmed, false);
    assert.equal(JSON.stringify(result).includes('synthetic-private-token'), false);
    assert.equal(result.checks, undefined);
  });
});
test('model cannot invent source references or pass/fail evidence', async () => {
  const graph = await analyzeProject(project);
  assert.throws(() => G.validateResult(project, graph, { features: [{ nodeIds: ['made-up'] }] }));
  assert.throws(() => G.validateResult(project, graph, { features: [{ nodeIds: [graph.nodes[0].id], sourceRefs: [{ revision: project.revision, file: 'not-real', startLine: 1, endLine: 1 }] }] }));
  assert.throws(() => G.validateResult(project, graph, { checks: [{ passed: true }] }));
  assert.throws(() => G.validateResult(project, graph, { nodeAnnotations: [{ nodeId: 'made-up', label: 'invented' }] }));
  const result = G.validateResult(project, graph, { nodeAnnotations: [{ nodeId: graph.nodes[0].id, label: '输出结果', explanation: '候选业务释义' }] });
  assert.equal(result.nodeAnnotations[0].source, 'model-interpretation');
});
test('service errors and invalid JSON do not leak response bodies or silently produce analysis', async () => {
  const graph = await analyzeProject(project);
  await endpoint((req, res) => { res.writeHead(401); res.end('synthetic-private-token'); }, async baseUrl => {
    await assert.rejects(G.analyzeWithModel({ project, graph, config: { baseUrl, model: 'fixture' } }), error => error.message.includes('401') && !error.message.includes('synthetic-private-token'));
  });
  await endpoint((req, res) => response(res, { content: 'not JSON' }), async baseUrl => {
    await assert.rejects(G.analyzeWithModel({ project, graph, config: { baseUrl, model: 'fixture' } }), /可显示|JSON/);
  });
});
test('cancellation stops the pending model request', async () => {
  const graph = await analyzeProject(project);
  await endpoint(() => {}, async baseUrl => {
    const controller = new AbortController(); setTimeout(() => controller.abort(), 40);
    await assert.rejects(G.analyzeWithModel({ project, graph, signal: controller.signal, config: { baseUrl, model: 'fixture' } }), /取消/);
  });
});

test('English explanations preserve the original language of requirements and assertion literals', async () => {
  const graph = await analyzeProject(project);
  const criteria = [{ id: 'literal', expected: { target: { kind: 'stdout' }, operator: 'equals', value: '符合' } }];
  await endpoint(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), context = JSON.parse(body.messages[1].content);
    assert.ok(body.messages[0].content.includes('clear English'));
    assert.equal(context.goal, '必须保留中文输出');
    assert.equal(context.currentCases[0].expected.value, '符合');
    response(res, { content: JSON.stringify({ summary: 'Keep the existing output contract.', features: [], cases: [], questions: [], nodeAnnotations: [] }) });
  }, async baseUrl => {
    const result = await G.analyzeWithModel({ project, graph, goal: '必须保留中文输出', currentCases: criteria, language: 'en', config: { baseUrl, model: 'fixture' } });
    assert.equal(result.language, 'en'); assert.equal(criteria[0].expected.value, '符合');
  });
});
