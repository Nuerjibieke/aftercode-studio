'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { chromium } = require('playwright');
const D = require('../domain/acceptance');
const { makeRun } = require('./contract');
async function runWebProject({ project: input, case: acceptanceCase, approved, signal, timeoutMs = 12000 }) {
  if (approved !== true) throw new Error('请先确认执行当前项目');
  const project = D.normalizeProject(input), run = makeRun(project, acceptanceCase);
  run.capabilities = { interactive: false, beforeCommit: false, sourceTrace: 'observed-boundaries-only', execution: 'server-browser-copy' };
  const base = process.env.AFTERCODE_RUN_DIR || os.tmpdir();
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const temporary = await fs.mkdtemp(path.join(base, 'aftercode-web-'));
  let browser, reason = '', timer, consoleSize = 0;
  const watchers = new Set(), logs = [], errors = [];
  const observe = data => {
    if (!data || typeof data.selector !== 'string' || typeof data.value !== 'string') return;
    const value = String(data.value ?? '');
    if (value.length > 100000) { reason = 'output_limit'; return; }
    run.observations.push({ id: D.id('obs'), runId: run.id, object: data.selector, value, source: '服务器验收副本 DOM', at: new Date().toISOString(), revision: run.revision });
  };
  const abort = () => { reason = 'cancelled'; browser?.close().catch(() => {}); };
  try {
    if (project.runtime !== 'web') return { ...run, status: 'unsupported' };
    if (/<script\b[^>]*type\s*=\s*["']module/i.test(project.files[project.entry])) return { ...run, status: 'unsupported', error: '当前静态 Web 验收不包含模块构建流程' };
    for (const [file, content] of Object.entries(project.files)) { const target = path.join(temporary, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); }
    if (signal?.aborted) return { ...run, status: 'cancelled' };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { reason = 'timeout'; browser?.close().catch(() => {}); }, timeoutMs);
    browser = await chromium.launch({ headless: true, timeout: timeoutMs, executablePath: process.env.CHROME_PATH || undefined, env: { PATH: process.env.PATH || '', HOME: temporary, TMPDIR: temporary, LANG: 'C.UTF-8' }, args: ['--disable-gpu', '--disable-dev-shm-usage'] });
    if (reason) throw new Error('验收已停止');
    const context = await browser.newContext();
    const prefix = pathToFileURL(temporary + path.sep).href;
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(prefix) || url.startsWith('data:') || url.startsWith('blob:')) route.continue(); else route.abort();
    });
    const page = await context.newPage();
    page.on('console', message => { const text = message.text(); consoleSize += text.length; if (consoleSize < 200000) logs.push(text); else reason = 'output_limit'; });
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeBinding('__aftercodeCapture', ({ frame }, data) => {
      if (frame !== page.mainFrame() || !data || run.trace.length > 1000) return;
      if (data.kind === 'expose') watchers.add(String(data.selector));
      if (data.kind === 'commit') {
        const item = { selector: String(data.selector), kind: 'commit', source: 'runtime', at: new Date().toISOString() };
        const match = String(data.stack || '').match(/(file:\/\/[^\s)]+):(\d+):(\d+)/);
        if (match) { try { const absolute = fileURLToPath(match[1]); const relative = path.relative(temporary, absolute).split(path.sep).join('/'); if (!relative.startsWith('../') && Object.hasOwn(project.files, relative)) { item.file = relative; item.line = Number(match[2]); item.column = Number(match[3]) - 1; item.sourceRef = { revision: run.revision, file: relative, startLine: item.line, endLine: item.line }; } } catch {} }
        run.trace.push(item); observe(data);
      }
      if (data.kind === 'observe') observe(data);
    });
    await page.addInitScript(() => {
      let active = 0;
      Object.defineProperty(window, '__aftercodePending', { get: () => active });
      const value = selector => { const el = document.querySelector(selector); return el ? ('value' in el ? String(el.value) : el.textContent.trim()) : undefined; };
      window.debug = Object.freeze({
        expose(selector) { window.__aftercodeCapture({ kind: 'expose', selector }); },
        async commit(selector, next, apply) { const stack = new Error().stack; active++; try { await apply(); await window.__aftercodeCapture({ kind: 'commit', selector, value: value(selector), stack }); } finally { active--; } },
        async task(work) { active++; try { return await work(); } finally { active--; } },
        observe(selector) { window.__aftercodeCapture({ kind: 'observe', selector, value: value(selector) }); }
      });
    });
    await page.goto(pathToFileURL(path.join(temporary, project.entry)).href, { waitUntil: 'load', timeout: timeoutMs });
    const inspect = async selector => {
      try { const locator = page.locator(selector).first(); if (await locator.count()) observe({ selector, value: await locator.evaluate(el => 'value' in el ? String(el.value) : el.textContent.trim()) }); }
      catch { run.error = '观察对象不存在或选择方式不正确'; }
    };
    const target = acceptanceCase.expected?.target;
    if (target?.kind === 'dom') watchers.add(target.selector);
    for (const selector of watchers) await inspect(selector);
    let previous = acceptanceCase.actions?.[0]?.atMs;
    for (const action of acceptanceCase.actions || []) {
      if (reason || signal?.aborted) throw new Error('验收已停止');
      const delay = Math.max(0, (action.atMs || 0) - (previous || 0)); previous = action.atMs;
      if (delay) await page.waitForTimeout(delay);
      const locator = page.locator(action.selector).first();
      if (action.type === 'click') await locator.click({ timeout: Math.min(timeoutMs, 3000) });
      else if (['input', 'change'].includes(action.type)) { await locator.fill(String(action.value ?? ''), { timeout: 3000 }); await locator.dispatchEvent('change'); }
      else throw new Error('此验收动作尚不支持');
      await page.waitForFunction(() => window.__aftercodePending === 0, null, { timeout: Math.min(timeoutMs, 5000) });
    }
    await page.waitForFunction(() => window.__aftercodePending === 0, null, { timeout: Math.min(timeoutMs, 5000) });
    await page.waitForTimeout(30);
    for (const selector of watchers) await inspect(selector);
    run.stdout = logs.join('\n'); run.stderr = errors.join('\n');
    run.status = reason === 'cancelled' ? 'cancelled' : reason === 'timeout' ? 'timeout' : reason || errors.length ? 'error' : 'completed';
    if (reason === 'output_limit') { run.truncated = true; run.error = '输出过大，证据不完整'; }
    run.scope = '服务器独立浏览器；仅包含已登记的异步任务与实际 DOM 观察，不承诺未登记活动已结束';
    run.evidence = run.observations.map(obs => ({ id: obs.id, runId: run.id, source: obs.source }));
  } catch (error) {
    run.status = reason === 'cancelled' || signal?.aborted ? 'cancelled' : reason === 'timeout' ? 'timeout' : 'error';
    run.stderr = errors.join('\n'); run.error = reason === 'timeout' ? '验收执行超时' : reason === 'cancelled' ? '验收已取消' : String(error.message).slice(0, 1000);
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (browser) await browser.close().catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
    run.endedAt = new Date().toISOString();
  }
  return run;
}
module.exports = { runWebProject };
