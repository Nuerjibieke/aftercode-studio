'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { spawn } = require('node:child_process');
const D = require('../domain/acceptance');
const { makeRun, normalizeInput } = require('./contract');
async function nodeTrace(directory, workspace, project) {
  workspace = await fs.realpath(workspace);
  const trace = [];
  for (const name of await fs.readdir(directory).catch(() => [])) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(directory, name); if ((await fs.stat(file)).size > 5_000_000) continue;
    let coverage; try { coverage = JSON.parse(await fs.readFile(file, 'utf8')); } catch { continue; }
    for (const script of coverage.result || []) {
      if (!script.url.startsWith('file:')) continue;
      let absolute; try { absolute = fileURLToPath(script.url); } catch { continue; }
      if (!absolute.startsWith(workspace + path.sep)) continue;
      const relative = path.relative(workspace, absolute).split(path.sep).join('/'), source = project.files[relative];
      if (typeof source !== 'string') continue;
      const ranges = script.functions.flatMap(fn => fn.ranges);
      const lines = source.split('\n'), offsets = []; let offset = 0;
      for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
      for (let i = 0; i < offsets.length; i++) {
        const line = lines[i]; if (!line.trim()) continue;
        const position = offsets[i] + line.search(/\S/);
        const relevant = ranges.filter(range => range.startOffset <= position && position < range.endOffset).sort((a, b) => a.endOffset - a.startOffset - (b.endOffset - b.startOffset))[0];
        if (relevant?.count > 0) trace.push({ file: relative, line: i + 1, count: relevant.count, kind: 'line', source: 'runtime' });
      }
      for (const fn of script.functions) {
        const range = fn.ranges[0]; if (!range || range.count <= 0 || !fn.functionName) continue;
        const line = source.slice(0, range.startOffset).split('\n').length;
        trace.push({ file: relative, line, kind: 'call', count: range.count, source: 'runtime' });
      }
    }
  }
  return trace.slice(0, 20000);
}
async function runProject({ project: inputProject, case: acceptanceCase = {}, approved, signal, timeoutMs = 8000, maxOutputBytes = 1_000_000, onEvent = () => {} }) {
  if (approved !== true) throw new Error('运行前需要确认可信项目与执行计划');
  const project = D.normalizeProject(inputProject), run = makeRun(project, acceptanceCase);
  if (!['node', 'python'].includes(project.runtime)) return { ...run, status: 'unsupported', error: '此适配器仅运行 Node.js / Python' };
  if (signal?.aborted) return { ...run, status: 'cancelled', endedAt: new Date().toISOString() };
  const input = normalizeInput(acceptanceCase.input);
  const runRoot = process.env.AFTERCODE_RUN_DIR || os.tmpdir();
  await fs.mkdir(runRoot, { recursive: true, mode: 0o700 });
  const temp = await fs.mkdtemp(path.join(runRoot, 'aftercode-run-'));
  const workspace = path.join(temp, 'workspace'), coverageDir = path.join(temp, 'coverage'), traceFile = path.join(temp, 'trace.json');
  const stdout = [], stderr = []; let total = 0, reason = '', child, grace, watchdog;
  const limit = Math.min(2_000_000, Math.max(1000, maxOutputBytes));
  const kill = () => {
    if (!child?.pid) return;
    try { if (process.platform === 'win32') child.kill('SIGTERM'); else process.kill(-child.pid, 'SIGTERM'); } catch {}
    grace = setTimeout(() => { try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch {} }, 300);
  };
  const abort = () => { if (!reason) reason = 'cancelled'; kill(); };
  try {
    await fs.mkdir(workspace, { recursive: true }); await fs.mkdir(coverageDir);
    for (const [file, content] of Object.entries(project.files)) {
      const destination = path.join(workspace, file); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, content);
    }
    if (signal?.aborted) return { ...run, status: 'cancelled', endedAt: new Date().toISOString() };
    const env = { PATH: process.env.PATH || '', LANG: 'C.UTF-8', HOME: temp, TMPDIR: temp, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' };
    if (project.runtime === 'node') env.NODE_V8_COVERAGE = coverageDir;
    const executable = project.runtime === 'node' ? process.execPath : process.env.PYTHON_EXECUTABLE || 'python3';
    const args = project.runtime === 'node' ? [project.entry, ...input.args] : [path.join(__dirname, 'python_trace.py'), project.entry, traceFile, ...input.args];
    run.status = 'running'; onEvent({ type: 'start', runId: run.id, runtime: run.runtime });
    child = spawn(executable, args, { cwd: workspace, env, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    const capture = (target, chunk) => {
      if (total >= limit) { if (!reason) { reason = 'output_limit'; kill(); } return; }
      const remaining = limit - total; target.push(chunk.subarray(0, remaining)); total += chunk.length;
      if (total > limit && !reason) { reason = 'output_limit'; kill(); }
    };
    child.stdout.on('data', data => capture(stdout, data)); child.stderr.on('data', data => capture(stderr, data));
    child.stdin.on('error', () => {}); child.stdin.end(input.stdin);
    signal?.addEventListener('abort', abort, { once: true });
    watchdog = setTimeout(() => { if (!reason) reason = 'timeout'; kill(); }, Math.min(60000, Math.max(100, timeoutMs)));
    await new Promise(resolve => {
      child.once('error', error => { reason = 'spawn_error'; run.error = error.message; resolve(); });
      child.once('close', (code, exitSignal) => { run.exitCode = code; run.signal = exitSignal; resolve(); });
    });
    clearTimeout(watchdog); clearTimeout(grace); signal?.removeEventListener('abort', abort);
    run.stdout = Buffer.concat(stdout).toString('utf8'); run.stderr = Buffer.concat(stderr).toString('utf8');
    run.status = reason === 'cancelled' ? 'cancelled' : reason === 'timeout' ? 'timeout' : reason ? 'error' : 'completed';
    if (reason === 'output_limit') { run.truncated = true; run.error = '输出超过上限，证据不完整'; }
    if (!reason) { try { run.output = JSON.parse(run.stdout.trim()); run.outputParsed = true; } catch { run.output = null; run.outputParsed = false; } }
    if (project.runtime === 'node') run.trace = await nodeTrace(coverageDir, workspace, project).catch(() => []);
    else { try { run.trace = JSON.parse(await fs.readFile(traceFile, 'utf8')); } catch { run.trace = []; } }
    run.evidence = [{ id: D.id('evidence'), runId: run.id, revision: run.revision, source: 'process.stdout', value: run.stdout }, { id: D.id('evidence'), runId: run.id, revision: run.revision, source: 'process.stderr', value: run.stderr }];
    run.endedAt = new Date().toISOString();
    onEvent({ type: 'finished', runId: run.id, status: run.status });
    return run;
  } catch (error) {
    if (child?.pid) kill();
    return { ...run, status: signal?.aborted ? 'cancelled' : 'error', error: error.message, endedAt: new Date().toISOString() };
  } finally {
    clearTimeout(watchdog); clearTimeout(grace); signal?.removeEventListener('abort', abort);
    if (child?.pid && process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    await fs.rm(temp, { recursive: true, force: true });
  }
}
module.exports = { runProject };
