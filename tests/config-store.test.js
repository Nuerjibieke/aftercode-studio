'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createConfigStore } = require('../agent/config-store');
const { createServer } = require('../server');
const fakeKey = 'test-only-not-a-real-provider-key';
test('key stays in an owner-only server file and is never returned by safe metadata', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aftercode-key-test-'));
  try {
    const store = createConfigStore(dir); store.save({ baseUrl: 'https://example.com/v1', model: 'sample', apiKey: fakeKey });
    assert.equal((await fs.stat(path.join(dir, 'model.json'))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
    assert.equal(JSON.stringify(store.safe()).includes(fakeKey), false);
    assert.equal(store.gatewayConfig().apiKey, fakeKey);
    store.save({ baseUrl: 'https://another.example/v1', model: 'sample', apiKey: '' });
    assert.equal(store.gatewayConfig().apiKey, '');
    store.save({ clear: true }); assert.deepEqual(store.gatewayConfig(), { baseUrl: '', model: '', apiKey: '' });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('connection form tests only a tiny request; HTTP responses do not contain the saved key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aftercode-config-api-'));
  const provider = http.createServer(async (req, res) => { let text = ''; for await (const chunk of req) text += chunk; const body = JSON.parse(text); assert.equal(body.messages[0].content, 'Reply with OK.'); assert.equal(req.headers.authorization, 'Bearer ' + fakeKey); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })); });
  const server = createServer({ privateDir: dir });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + '/api/model/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, model: 'fixture', apiKey: fakeKey, testConnection: true }) });
    const text = await response.text(); assert.equal(text.includes(fakeKey), false); const data = JSON.parse(text); assert.equal(data.connection.ok, true); assert.ok(data.verifiedAt);
    const metadata = await (await fetch(base + '/api/model/config')).text(); assert.equal(metadata.includes(fakeKey), false);
    assert.equal((await fetch(base + '/.private/model.json')).status, 404);
  } finally { provider.closeAllConnections(); server.closeAllConnections(); await Promise.all([new Promise(resolve => provider.close(resolve)), new Promise(resolve => server.close(resolve))]); await fs.rm(dir, { recursive: true, force: true }); }
});
