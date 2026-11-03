(function (root) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const id = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  function revisionOf(project) {
    const content = JSON.stringify([project.runtime || 'web', project.entry, Object.keys(project.files).sort().map(file => [file, project.files[file]])]);
    let hash = 2166136261;
    for (let i = 0; i < content.length; i++) { hash ^= content.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return `rev-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }
  function normalizeProject(input) {
    if (!input || typeof input !== 'object' || !input.files || Array.isArray(input.files)) throw new Error('项目需要文本文件集合');
    const files = Object.create(null);
    for (const [file, content] of Object.entries(input.files)) {
      if (!file || file.startsWith('/') || file.includes('\\') || file.split('/').some(part => ['..', '', '__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('项目文件必须使用安全的相对路径');
      if (typeof content !== 'string' || content.length > 2_000_000) throw new Error('只支持每个不超过 2MB 的文本文件');
      files[file] = content;
    }
    if (Object.keys(files).length > 200 || JSON.stringify(files).length > 8_000_000) throw new Error('项目最多 200 个文件、8MB 文本');
    const entry = input.entry || (files['index.html'] != null ? 'index.html' : Object.keys(files).find(file => /(?:main|app|index)\.(?:js|cjs|mjs|py)$/.test(file)) || Object.keys(files)[0]);
    if (!entry || typeof files[entry] !== 'string') throw new Error('找不到运行入口');
    const runtime = input.runtime || (/\.py$/i.test(entry) ? 'python' : /\.html?$/i.test(entry) ? 'web' : 'node');
    if (!['web', 'node', 'python'].includes(runtime)) throw new Error('不支持此运行时');
    const project = { name: String(input.name || 'workspace').slice(0, 100), entry, runtime, files };
    if (input.analysisOnly === true) project.analysisOnly = true;
    if (input.sourceLocation?.kind === 'server') project.sourceLocation = { kind: 'server', path: String(input.sourceLocation.path || '').slice(0,1000) };
    if (input.delivery) project.delivery = copy(input.delivery);
    if (input.baseline) project.baseline = copy(input.baseline);
    project.revision = revisionOf(project);
    return project;
  }
  function validSourceRef(project, ref) {
    if (!ref || ref.revision !== revisionOf(project) || typeof project.files[ref.file] !== 'string') return false;
    const lines = project.files[ref.file].split('\n').length;
    return Number.isInteger(ref.startLine) && Number.isInteger(ref.endLine) && ref.startLine > 0 && ref.endLine >= ref.startLine && ref.endLine <= lines;
  }
  const operators = new Set(['equals', 'contains', 'greater', 'less', 'jsonEquals']);
  function compare(actual, expected, operator = 'equals') {
    if (!operators.has(operator)) return null;
    if (operator === 'jsonEquals') return stable(actual) === stable(expected);
    if (operator === 'equals') return String(actual) === String(expected);
    if (operator === 'contains') return String(actual).includes(String(expected));
    const a = Number(actual), b = Number(expected);
    if (String(actual).trim() === '' || String(expected).trim() === '' || !Number.isFinite(a) || !Number.isFinite(b)) return null;
    return operator === 'greater' ? a > b : a < b;
  }
  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  function atPath(value, path) {
    if (!path || path === '$') return value;
    const keys = String(path).replace(/^\$\.?/, '').split('.');
    for (const key of keys) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || value == null || !Object.hasOwn(Object(value), key)) return undefined;
      value = value[key];
    }
    return value;
  }
  function createCase(input, revision) {
    const expected = input.expected ? copy(input.expected) : null;
    if (expected && !operators.has(expected.operator || 'equals')) throw new Error('不支持此判断方式');
    const origin = ['user', 'sample-task', 'agent', 'imported'].includes(input.origin) ? input.origin : 'agent';
    return {
      id: String(input.id || id('case')), title: String(input.title || '新情况').slice(0, 180), featureId: String(input.featureId || 'feature-main'),
      description: String(input.description || ''), input: copy(input.input ?? {}), actions: copy(input.actions || []), expected,
      confirmed: input.confirmed === true && origin !== 'agent', origin, requirementIds: copy(input.requirementIds || []), revision,
      ruleRevision: Number.isInteger(input.ruleRevision) ? input.ruleRevision : 1, kind: input.kind || 'normal'
    };
  }
  function caseKey(acceptanceCase) {
    const expected = acceptanceCase.expected;
    if (!expected || !Object.hasOwn(expected, 'value') || !['dom', 'json', 'stdout', 'exitCode'].includes(expected.target?.kind) || expected.target.kind === 'dom' && !expected.target.selector || !operators.has(expected.operator || 'equals')) return 'manual:' + acceptanceCase.id;
    const operator = expected.operator || 'equals';
    let value = expected.value;
    if (operator === 'equals' || operator === 'contains') value = String(value);
    else if (operator === 'greater' || operator === 'less') {
      if (String(value).trim() === '' || !Number.isFinite(Number(value))) return 'manual:' + acceptanceCase.id;
      value = Number(value);
    }
    return stable({ featureId: acceptanceCase.featureId, input: acceptanceCase.input ?? {}, actions: acceptanceCase.actions || [], expected: { ...expected, operator, value }, requirementIds: [...(acceptanceCase.requirementIds || [])].sort() });
  }
  function mergeCases(existing, additions = []) {
    const groups = new Map();
    for (const item of [...existing, ...additions]) {
      const key = caseKey(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const cases = [], duplicates = [], aliases = Object.create(null);
    for (const group of groups.values()) {
      const primary = group.find(item => item.confirmed === true && item.origin !== 'agent') || group[0];
      cases.push(primary);
      for (const item of group) if (item !== primary) {
        duplicates.push(copy(item));
        if (item.id !== primary.id) aliases[item.id] = primary.id;
      }
    }
    return { cases, duplicates, aliases };
  }
  function forRound(records, round, revision) {
    if (!round || round.revision !== revision) return [];
    return records.filter(item => item.roundId === round.id && item.revision === revision);
  }
  function confirmCase(acceptanceCase) { return { ...copy(acceptanceCase), confirmed: true, origin: 'user', ruleRevision: acceptanceCase.ruleRevision + 1 }; }
  function evaluateCase(acceptanceCase, run) {
    const result = { id: id('check'), caseId: acceptanceCase.id, featureId: acceptanceCase.featureId, revision: run.revision, ruleRevision: acceptanceCase.ruleRevision, standardSource: acceptanceCase.origin, standardConfirmed: acceptanceCase.confirmed, runId: run.id, expected: copy(acceptanceCase.expected), actual: null, actualObserved: false, evidenceIds: [], at: new Date().toISOString(), state: 'not_run' };
    if (run.revision !== acceptanceCase.revision) return { ...result, state: 'stale' };
    if (['cancelled', 'timeout', 'error', 'unsupported'].includes(run.status)) return { ...result, state: run.status };
    if (run.status !== 'completed') return result;
    if (!acceptanceCase.expected) return { ...result, state: 'needs_manual' };
    const expectation = acceptanceCase.expected;
    let actual;
    const target = expectation.target || { kind: run.runtime === 'web' ? 'dom' : 'stdout' };
    if (target.kind === 'exitCode') actual = run.exitCode;
    else if (target.kind === 'stdout') actual = String(run.stdout ?? '').trim();
    else if (target.kind === 'json') actual = run.outputParsed === false ? undefined : atPath(run.output, target.path);
    else if (target.kind === 'dom') {
      const obs = (run.observations || []).filter(obs => (obs.object || obs.selector) === target.selector).at(-1);
      if (obs) { actual = obs.value; result.evidenceIds.push(obs.id); }
    }
    if (actual === undefined || actual === null && !(target.kind === 'json' && (run.outputParsed === true || run.output != null))) return { ...result, state: 'insufficient_evidence' };
    result.actual = copy(actual); result.actualObserved = true;
    result.evidenceIds.push(...(run.evidence || []).map(e => e.id).filter(Boolean));
    if (!acceptanceCase.confirmed) return { ...result, state: 'needs_confirmation' };
    const matched = compare(actual, expectation.value, expectation.operator);
    return { ...result, state: matched == null ? 'needs_manual' : matched ? 'passed' : 'failed' };
  }
  function summarize(cases, checks, revision) {
    const unique = [...new Map(cases.map(item => [item.id, item])).values()];
    const result = { total: unique.length, passed: 0, failed: 0, pending: 0, unconfirmed: 0, manual: 0 };
    for (const item of unique) {
      const check = checks.filter(c => c.caseId === item.id && c.revision === revision && c.ruleRevision === item.ruleRevision).at(-1);
      if (!item.confirmed) result.unconfirmed++;
      else if (check?.state === 'passed') result.passed++;
      else if (check?.state === 'failed') result.failed++;
      else if (check?.state === 'needs_manual') result.manual++;
      else result.pending++;
    }
    return result;
  }
  function makeDecision({ status, scopeCaseIds, note = '', revision }, cases, checks) {
    if (!['accepted', 'returned', 'needs_clarification'].includes(status)) throw new Error('无效验收决定');
    const scope = [...new Set(scopeCaseIds || [])];
    if (!scope.length) throw new Error('请选择本次决定的范围');
    const selected = scope.map(caseId => cases.find(item => item.id === caseId));
    if (selected.some(item => !item || item.revision !== revision)) throw new Error('验收范围不存在或已过期');
    if (status === 'accepted' && selected.some(item => !item.confirmed || checks.filter(c => c.caseId === item.id && c.revision === revision && c.ruleRevision === item.ruleRevision).at(-1)?.state !== 'passed')) throw new Error('只能接受当前版本中已确认且有通过依据的范围');
    return { id: id('decision'), actor: 'human', status, scopeCaseIds: scope, ruleRevisions: selected.map(item => [item.id, item.ruleRevision]), revision, note: String(note).slice(0, 4000), at: new Date().toISOString() };
  }
  const api = { id, copy, revisionOf, normalizeProject, validSourceRef, compare, atPath, createCase, caseKey, mergeCases, forRound, confirmCase, evaluateCase, summarize, makeDecision };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AcceptanceDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
