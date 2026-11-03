'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const D = require('./domain/acceptance');
const { capabilities } = require('./runtime/contract');
const root = __dirname;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.png': 'image/png' };
const publicTop = new Set(['index.html', 'ide.css', 'ide.js', 'projects.js', 'bridge.js', 'core.js', 'README.md', 'README.zh-CN.md', 'RESEARCH.md', 'ACCEPTANCE.md', 'investigation.json', 'acceptance-investigation.json', 'acceptance-fixed-investigation.json', 'preview-acceptance.png', 'preview-logic.png']);
function json(response, status, data) {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}
async function readBody(request) {
  if (!String(request.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('需要 JSON 请求'), { status: 415 });
  let body = '', size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 10_000_000) throw Object.assign(new Error('请求超过大小限制'), { status: 413 });
    body += chunk;
  }
  try { return JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('JSON 格式无效'), { status: 400 }); }
}
function allowedOrigin(request) {
  try {
    const host = new URL(`http://${request.headers.host}`);
    if (!['127.0.0.1', 'localhost'].includes(host.hostname)) return false;
    return !request.headers.origin || request.headers.origin === host.origin;
  } catch { return false; }
}
function createServer(options = {}) {
  const environmentId = [require('node:os').hostname(), process.platform, process.version, 'validation-v3'].join(':');
  const modelStore = options.privateDir ? require('./agent/config-store').createConfigStore(options.privateDir) : null;
  const modelConfig = () => modelStore ? modelStore.gatewayConfig() : {};
  const modelSettings = () => { const value = require('./agent/gateway').configFrom(modelConfig()); const safe = modelStore ? modelStore.safe() : {}; return { ...require('./agent/gateway').getModelStatus(modelConfig()), baseUrl: value.baseUrl || '', keySaved: Boolean(value.apiKey), verifiedAt: safe.verifiedAt || null, connectionMessage: safe.connectionMessage || '' }; };
  const draftStore = options.privateDir ? require('./workspace/drafts').createDraftStore(path.join(options.privateDir, 'drafts')) : null;
  const jobs = new Map();
  const acceptanceJobs = require('./acceptance/jobs').createJobQueue({ environmentId, directory: options.privateDir ? path.join(options.privateDir, 'jobs') : null, analyze: analysis });
  const analysisCache = new Map();
  async function analysis(project) {
    const revision = D.revisionOf(project);
    if (!analysisCache.has(revision)) {
      const graph = await require('./analysis').analyzeProject(project);
      if (analysisCache.size >= 20) analysisCache.delete(analysisCache.keys().next().value);
      analysisCache.set(revision, graph);
    }
    return analysisCache.get(revision);
  }
  const server = http.createServer(async (request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { json(response, 400, { error: '地址无效' }); return; }
    if (!allowedOrigin(request)) { json(response, 403, { error: '仅允许本地同源访问' }); return; }
    if (pathname.startsWith('/api/')) {
      try {
        if (request.method === 'GET' && (pathname === '/api/recovery/info' || pathname === '/api/recovery/latest')) {
          let draft = null;
          if (options.privateDir) {
            const folder = path.join(options.privateDir, 'recovery');
            const names = await fs.readdir(folder).catch(() => []);
            const records = await Promise.all(names.filter(name => /^browser-[a-z0-9-]+\.json$/.test(name)).map(async name => ({ name, time: (await fs.stat(path.join(folder, name))).mtimeMs })));
            records.sort((a,b) => b.time-a.time);
            for (const record of records.slice(0,5)) { try { const saved = JSON.parse(await fs.readFile(path.join(folder,record.name),'utf8')); const raw = saved.items?.find(item => item[0] === 'aftercode:recovery-live-drafts')?.[1]; const fields = raw ? JSON.parse(raw) : []; const found = fields.find(field => field.id === 'ac-requirement-input' && typeof field.value === 'string' && field.value.trim()) || fields.find(field => ['ac-goal','ac-agent-goal'].includes(field.id) && typeof field.value === 'string' && field.value.trim()); if(found) { draft = { text: found.value, at: saved.at }; break; } } catch {} }
          }
          json(response, 200, pathname.endsWith('/latest') ? { draft } : { available: Boolean(options.privateDir), hasDraft: Boolean(draft) }); return;
        }
        if (request.method === 'GET' && pathname === '/api/status') {
          let model;
          try { model = modelSettings(); } catch { model = { configured: false, label: '模型尚未配置' }; }
          json(response, 200, { version: '0.3.0', capabilities, model, server: { host: require('node:os').hostname(), projectPath: root, environmentId }, runtime: { node: process.version, python: 'python3' } }); return;
        }
        if (request.method === 'GET' && pathname === '/api/drafts') { const query = new URL(request.url, 'http://localhost').searchParams; json(response, 200, { draft: draftStore ? draftStore.get(query.get('projectKey'), query.get('history') === '1') : null, available: Boolean(draftStore) }); return; }
        if (request.method === 'GET' && pathname === '/api/jobs') { json(response, 200, { jobs: acceptanceJobs.list(new URL(request.url, 'http://localhost').searchParams.get('projectId') || '') }); return; }
        if (request.method === 'GET' && /^\/api\/jobs\/job-[a-z0-9-]+$/.test(pathname)) { const job = acceptanceJobs.get(pathname.slice('/api/jobs/'.length)); if (!job) { json(response, 404, { error: '没有找到这次验收' }); return; } if (new URL(request.url, 'http://localhost').searchParams.get('full') !== '1') delete job.project; json(response, 200, job); return; }
        if (request.method === 'GET' && pathname === '/api/model/config') { json(response, 200, modelSettings()); return; }
        if (request.method !== 'POST') { json(response, 405, { error: '不支持此操作' }); return; }
        const body = await readBody(request);
        if (pathname === '/api/drafts') { if (!draftStore) { json(response, 503, { error: '草稿暂时只保留在当前浏览器' }); return; } const result = draftStore.save(body); json(response, result.conflict ? 409 : 200, result.conflict ? { ...result, error: '服务器另有一份更新草稿，当前输入没有被覆盖' } : result); return; }
        if (pathname === '/api/recovery/browser') { if (!options.privateDir || !Array.isArray(body.items)) { json(response, 400, { error: '无法备份当前记录' }); return; } const items = body.items.filter(item => Array.isArray(item) && typeof item[0] === 'string' && item[0].startsWith('aftercode:') && typeof item[1] === 'string'); const folder = path.join(options.privateDir, 'recovery'); await fs.mkdir(folder, { recursive: true, mode: 0o700 }); await fs.writeFile(path.join(folder, D.id('browser') + '.json'), JSON.stringify({ items, at: new Date().toISOString() }), { mode: 0o600 }); json(response, 200, { saved: true, count: items.length }); return; }
        if (pathname === '/api/projects/open') { const loaded = await require('./workspace/open').openProject(body.path, { allowedRoot: options.projectRoot || root, denied: options.privateDir ? [options.privateDir] : [] }); json(response, 200, loaded); return; }
        if (pathname === '/api/model/config') {
          if (!modelStore) { json(response, 503, { error: '请通过服务器私有配置启动服务' }); return; }
          const activeConfig = require('./agent/gateway').configFrom(modelConfig());
          if (!body.clear && !body.apiKey && String(body.baseUrl || '').trim().replace(/\/$/, '') === String(activeConfig.baseUrl || '').replace(/\/$/, '') && activeConfig.apiKey) body.apiKey = activeConfig.apiKey;
          modelStore.save(body);
          let connection;
          if (body.testConnection === true && body.clear !== true) { connection = await require('./agent/connection').checkConnection(modelStore.gatewayConfig()); modelStore.verification(connection.ok, connection.message); }
          json(response, 200, { ...modelSettings(), connection }); return;
        }
        if (pathname.startsWith('/api/jobs/') && pathname.endsWith('/cancel')) {
          const jobId = pathname.slice('/api/jobs/'.length, -'/cancel'.length);
          const accepted = acceptanceJobs.cancel(jobId); jobs.get(jobId)?.abort(); json(response, 200, { cancelled: accepted || jobs.has(jobId) }); return;
        }
        const project = D.normalizeProject(body.project);
        if (pathname === '/api/jobs') { const job = acceptanceJobs.create({ project, cases: body.cases, approved: body.approved, clientProjectId: body.clientProjectId, goal: body.goal }); json(response, 202, { id: job.id, status: job.status, revision: job.revision }); return; }
        if (pathname === '/api/search') { const graph = await analysis(project); json(response, 200, require('./analysis/search').searchLogic({ project, graph, cases: Array.isArray(body.cases) ? body.cases : [], goal: String(body.goal || '') }, body.query)); return; }
        if (pathname === '/api/analyze') { json(response, 200, await analysis(project)); return; }
        if (!['/api/run', '/api/agent/analyze'].includes(pathname)) { json(response, 404, { error: '接口不存在' }); return; }
        const jobId = typeof body.jobId === 'string' && /^[\w-]{1,100}$/.test(body.jobId) ? body.jobId : D.id('job');
        if (jobs.has(jobId)) { json(response, 409, { error: '此任务已在运行' }); return; }
        if (jobs.size >= 4) { json(response, 429, { error: '正在运行的任务过多，请先完成或取消' }); return; }
        if (pathname === '/api/agent/analyze' && body.shareApproved !== true) { json(response, 403, { error: '先确认发送的是可分享的非敏感项目内容' }); return; }
        if (pathname === '/api/run' && body.approved !== true) { json(response, 403, { error: '需要先确认可信项目的执行计划' }); return; }
        const controller = new AbortController(); jobs.set(jobId, controller);
        response.on('close', () => { if (!response.writableEnded) controller.abort(); });
        try {
          if (pathname === '/api/run') {
            const acceptanceCase = D.createCase(body.case || {}, D.revisionOf(project));
            const run = await require('./runtime/runner').runProject({ project, case: acceptanceCase, approved: true, signal: controller.signal });
            const check = D.evaluateCase(acceptanceCase, run); check.environmentId = environmentId; run.environmentId = environmentId;
            json(response, 200, { jobId, run, check });
          } else {
            const gateway = require('./agent/gateway');
            if (!gateway.getModelStatus(modelConfig()).configured) { json(response, 503, { code: 'model_not_configured', error: '真实模型未配置；本地分析和验收仍可使用' }); return; }
            response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            const send = (type, data) => { if (!response.destroyed) response.write(JSON.stringify({ type, data }) + '\n'); };
            send('progress', { message: '正在读取相关实现' });
            try {
              const graph = await analysis(project);
              const result = await gateway.analyzeWithModel({ config: modelConfig(), project, graph, purpose: ['diagnose','explain','plan','repair'].includes(body.purpose) ? body.purpose : /需要分析的问题|为什么|为何|请分析这个情况/.test(String(body.goal || '')) ? 'diagnose' : 'plan', goal: String(body.goal || project.delivery?.goal || ''), evidence: body.evidence || [], focus: body.focus || null, diagnosis: body.diagnosis || null, language: body.language === 'en' ? 'en' : 'zh-CN', currentCases: Array.isArray(body.currentCases) ? body.currentCases.slice(0,30) : [], humanDecisions: Array.isArray(body.humanDecisions) ? body.humanDecisions.slice(-10) : [], signal: controller.signal, onEvent: event => send('progress', event) });
              send('result', result);
            } catch (error) { send('error', { code: error.code || 'analysis_failed', message: error.message }); }
            response.end();
          }
        } finally { jobs.delete(jobId); }
      } catch (error) { json(response, error.status || 400, { error: error.message || '请求失败' }); }
      return;
    }
    if (pathname === '/recover' && request.method === 'GET') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end('<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>恢复工作台</title><body style="font:15px sans-serif;color:#50627e;padding:48px">正在恢复工作台连接。已保存的内容不会被清空。</body></html>'); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { json(response, 405, { error: '不支持此操作' }); return; }
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const isPublic = publicTop.has(relative) || /^(?:ui|fixtures)\/[\w./-]+\.(?:js|css|json)$/.test(relative) || ['domain/acceptance.js', 'domain/repairs.js'].includes(relative);
    if (!isPublic || relative.split('/').includes('..') || relative.includes('\\')) { json(response, 404, { error: '文件不存在' }); return; }
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) { json(response, 403, { error: '禁止访问' }); return; }
    try {
      const content = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { json(response, 404, { error: '文件不存在' }); }
  });
  server.on('close', () => { acceptanceJobs.close(); for (const controller of jobs.values()) controller.abort(); });
  return server;
}
module.exports = { createServer };
if (require.main === module) {
  (async () => {
    const privateDir = process.env.AFTERCODE_PRIVATE_DIR || path.join(root, '.private');
    const server = createServer({ privateDir, projectRoot: process.env.AFTERCODE_PROJECT_ROOT || path.dirname(root) });
    const socket = process.env.AFTERCODE_SOCKET;
    if (socket) {
      const resolved = path.resolve(socket);
      if (resolved !== path.join(path.resolve(privateDir), 'app.sock')) throw new Error('服务连接路径不正确');
      try { const stat = await fs.lstat(resolved); if (!stat.isSocket() || stat.uid !== process.getuid()) throw new Error('无法替换现有连接'); await fs.unlink(resolved); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      server.listen(resolved, async () => { await fs.chmod(resolved, 0o600); console.log('Aftercode remote workspace ready'); });
    } else server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Aftercode: http://127.0.0.1:${server.address().port}`));
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => process.exit(0)); server.closeAllConnections(); setTimeout(() => process.exit(0), 4000).unref(); });
  })().catch(() => { console.error('Aftercode 启动失败，请检查服务器连接配置'); process.exitCode = 1; });
}
