'use strict';
const fs = require('node:fs');
const path = require('node:path');
const D = require('../domain/acceptance');
function createJobQueue({ directory = null, analyze = null, environmentId = 'unidentified' } = {}) {
  const jobs = new Map(), controllers = new Map();
  let active = 0, closed = false;
  if (directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
    for (const name of fs.readdirSync(directory)) {
      if (!/^job-[a-z0-9-]+\.json$/.test(name)) continue;
      try { const job = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')); if (!job.id || !Array.isArray(job.runs)) continue; if (['queued', 'running'].includes(job.status)) { job.status = 'interrupted'; job.message = '服务重新启动，请重新执行未完成的情况'; } jobs.set(job.id, job); } catch {}
    }
  }
  function persist(job) {
    job.updatedAt = new Date().toISOString();
    if (!directory) return;
    const file = path.join(directory, job.id + '.json'), temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(job), { mode: 0o600 }); fs.renameSync(temporary, file); fs.chmodSync(file, 0o600);
  }
  function finding(job, acceptanceCase, run, check, graph) {
    if (!['failed', 'error', 'timeout', 'insufficient_evidence'].includes(check.state)) return;
    const related = (graph?.nodes || []).filter(node => (run.trace || []).some(trace => {
      if (trace.selector) return node.evidenceType === 'commit-boundary' && node.selector === trace.selector && (!trace.sourceRef || node.sourceRef.file === trace.sourceRef.file && node.sourceRef.startLine === trace.sourceRef.startLine);
      const ref = node.sourceRef, line = trace.line || trace.startLine;
      return ref && ref.file === trace.file && line >= ref.startLine && line <= ref.endLine;
    })).slice(0, 8);
    job.findings.push({ id: D.id('finding'), roundId: job.id, caseId: acceptanceCase.id, featureId: acceptanceCase.featureId, ruleRevision: acceptanceCase.ruleRevision, runId: run.id, revision: job.revision, environmentId, kind: check.state === 'failed' ? 'difference' : 'execution_issue', title: acceptanceCase.title, expected: check.expected?.value, actual: check.actual, message: run.error || (check.state === 'failed' ? '实际结果与已确认标准不同' : '这次验收没有取得完整结果'), relatedNodeIds: related.map(node => node.id), sourceRefs: related.map(node => node.sourceRef), attribution: '相关执行片段，不是已证明的唯一根因' });
  }
  async function execute(job) {
    active++; job.status = 'running'; const controller = new AbortController(); controllers.set(job.id, controller); persist(job);
    let graph;
    try { if (analyze) graph = await analyze(job.project); }
    catch { job.warnings.push('本次无法关联源码图，但会保留实际运行结果'); }
    try {
      for (const acceptanceCase of job.cases) {
        if (controller.signal.aborted || closed) break;
        job.currentCaseId = acceptanceCase.id; persist(job);
        let run;
        try {
          const runner = job.project.runtime === 'web' ? require('../runtime/web-runner').runWebProject : require('../runtime/runner').runProject;
          run = await runner({ project: job.project, case: acceptanceCase, approved: true, signal: controller.signal, maxOutputBytes: 200000 });
        } catch (error) { run = { id: D.id('run'), caseId: acceptanceCase.id, revision: job.revision, runtime: job.project.runtime, status: controller.signal.aborted ? 'cancelled' : 'error', error: String(error.message).slice(0, 1000), observations: [], evidence: [], trace: [], input: acceptanceCase.input, actions: acceptanceCase.actions }; }
        const check = D.evaluateCase(acceptanceCase, run); check.environmentId = environmentId; run.environmentId = environmentId;
        run.roundId = job.id; run.caseTitle = acceptanceCase.title; check.roundId = job.id;
        job.runs.push(run); job.checks.push(check); finding(job, acceptanceCase, run, check, graph); persist(job);
      }
      job.status = controller.signal.aborted || closed ? 'cancelled' : 'completed'; job.currentCaseId = null;
    } catch { job.status = 'error'; job.message = '验收暂时中断，已经取得的结果仍保留'; }
    finally { controllers.delete(job.id); active--; persist(job); pump(); }
  }
  function pump() {
    if (closed) return;
    for (const job of jobs.values()) { if (active >= 2) break; if (job.status === 'queued') execute(job); }
  }
  function create({ project: input, cases, approved, clientProjectId = '', goal = '' }) {
    if (approved !== true) throw new Error('请先确认验收标准与项目运行范围');
    if (!Array.isArray(cases) || !cases.length || cases.length > 30) throw new Error('请选择一到三十个验收情况');
    if ([...jobs.values()].filter(job => ['queued', 'running'].includes(job.status)).length >= 6) throw new Error('已有较多验收任务，请稍后再试');
    const project = D.normalizeProject(input), revision = D.revisionOf(project);
    if (project.analysisOnly) throw new Error('这份项目当前仅载入源码；请先确认可运行的入口和验收环境。结构分析与搜索可以直接使用。');
    const normalized = cases.map(item => D.createCase(item, revision));
    if (new Set(normalized.map(item => item.id)).size !== normalized.length) throw new Error('验收情况编号重复');
    const job = { id: D.id('job'), environmentId, clientProjectId: String(clientProjectId).slice(0, 100), revision, project, title: project.delivery?.title || project.name, goal: String(goal).slice(0, 8000), cases: normalized, status: 'queued', runs: [], checks: [], findings: [], warnings: [], createdAt: new Date().toISOString(), currentCaseId: null };
    jobs.set(job.id, job); persist(job);
    const completed = [...jobs.values()].filter(item => !['running', 'queued'].includes(item.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    while (jobs.size > 50 && completed.length) { const old = completed.shift(); jobs.delete(old.id); if (directory) { try { fs.unlinkSync(path.join(directory, old.id + '.json')); } catch {} } }
    queueMicrotask(pump);
    return D.copy(job);
  }
  function get(id) { const job = jobs.get(id); return job ? D.copy(job) : null; }
  function list(clientProjectId) { return [...jobs.values()].filter(job => !clientProjectId || job.clientProjectId === clientProjectId).map(({ id, clientProjectId, revision, status, title, createdAt, runs, cases, findings }) => ({ id, clientProjectId, revision, status, title, createdAt, completed: runs.length, total: cases.length, findings: findings.length })).slice(-20).reverse(); }
  function cancel(id) { const job = jobs.get(id); if (!job) return false; if (job.status === 'queued') { job.status = 'cancelled'; persist(job); } controllers.get(id)?.abort(); return true; }
  function close() { closed = true; for (const controller of controllers.values()) controller.abort(); }
  return { create, get, list, cancel, close };
}
module.exports = { createJobQueue };
