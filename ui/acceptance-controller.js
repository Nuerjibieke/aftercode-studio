(() => {
  'use strict';
  const D = window.AcceptanceDomain;
  const legacy = window.Aftercode;
  if (!D || !legacy || !window.AcceptanceView) return;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const ui = {
    mode: new URLSearchParams(location.search).get('view') === 'workspace' ? 'workspace' : 'logic',
    draftServerVersion: null, draftSaveStatus: '', draftGeneration: 0, detailContext: null, environmentId: location.protocol.startsWith('http') ? null : 'browser-local', logicLevel: 'project', logicFile: '', logicFolder: '', focusedLogicFeature: null, logicQuery: '', logicSearch: null, logicSearching: false, searchAnswer: null, requirementDraft: null, activeJob: null, currentRound: null, archivedCases: [], caseAliases: {}, repairs: [], selectedRepairId: '', repairApplying: false, findings: [],
    projectId: null, revision: '', sources: {}, delivery: {}, features: [], graph: { nodes: [], edges: [], gaps: [] }, cases: [], checks: [], runs: [], decisions: [], agentAnalyses: [], issues: [],
    selectedFeatureId: '', selectedCaseId: '', modelStatus: { configured: false, label: 'Agent 未连接' }, analysisStatus: 'idle', execution: null,
    busy: false, error: '', loading: false, modal: null, objectMode: false, viewSource: false, approvedRevision: null, job: null, analysisController: null, sourceTimer: null
  };
  const persistKey = () => `aftercode:acceptance:${ui.projectId}`;
  const currentProject = () => D.normalizeProject(legacy.state.project);
  const currentCase = () => ui.cases.find(item => item.id === ui.selectedCaseId) || ui.cases.find(item => item.featureId === ui.selectedFeatureId);
  const compatibleEvidence = item => isBackend() ? Boolean(ui.environmentId && item.environmentId === ui.environmentId) : !item.environmentId || item.environmentId === 'browser-local';
  const currentChecks = () => D.forRound(ui.checks, ui.currentRound, ui.revision).filter(compatibleEvidence);
  const isBackend = () => location.protocol === 'http:' || location.protocol === 'https:';
  const icon = name => ({ arrow: '↗', close: '×', check: '✓', branch: '⑂' }[name] || name);
  function normalizeCases(additions = []) {
    const merged = D.mergeCases(ui.cases, additions);
    ui.cases = merged.cases;
    for (const duplicate of merged.duplicates) if (!ui.archivedCases.some(item => item.id === duplicate.id)) ui.archivedCases.push(duplicate);
    Object.assign(ui.caseAliases, merged.aliases);
    ui.selectedCaseId = resolveCaseId(ui.selectedCaseId);
    return merged;
  }
  function resolveCaseId(id) {
    const seen = new Set();
    while (Object.hasOwn(ui.caseAliases, id) && typeof ui.caseAliases[id] === 'string' && !seen.has(id)) { seen.add(id); id = ui.caseAliases[id]; }
    return id;
  }
  function beginRound(items, repairId = null) {
    ui.currentRound = { id: D.id('round'), revision: ui.revision, caseIds: items.map(item => item.id), repairId: repairId || window.AftercodeRepair?.matchVerification(items) || null, createdAt: new Date().toISOString(), status: 'queued' };
    ui.searchAnswer = null;
    save();
  }
  function save() {
    legacy.saveWorkspace?.();
    try {
      const data = { view: ui.mode, repairs: ui.repairs, selectedRepairId: ui.selectedRepairId, currentRound: ui.currentRound, archivedCases: ui.archivedCases, caseAliases: ui.caseAliases, activeJob: ui.activeJob, findings: ui.findings, requirementDraft: ui.requirementDraft, revision: ui.revision, sources: ui.sources, delivery: ui.delivery, cases: ui.cases, checks: ui.checks, runs: ui.runs, decisions: ui.decisions, agentAnalyses: ui.agentAnalyses, issues: ui.issues };
      localStorage.setItem(persistKey(), JSON.stringify(data));
    } catch { legacy.toast('验收记录超出浏览器存储额度，请导出调查包。'); }
  }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(persistKey()));
      if (!saved) return false;
      ui.sources = { ...(saved.sources || {}), ...ui.sources };
      if (['overview','logic','preview','code'].includes(saved.view)) { ui.mode = saved.view; ui.restoredView = true; }
      ui.delivery = saved.delivery || {}; ui.activeJob = saved.activeJob || null; ui.findings = saved.findings || []; ui.requirementDraft = saved.requirementDraft ?? ui.delivery.goal ?? '';
      ui.cases = (saved.cases || []).map(item => ({ ...item, revision: ui.revision }));
      ui.checks = saved.checks || []; ui.runs = saved.runs || []; ui.decisions = saved.decisions || [];
      ui.agentAnalyses = saved.agentAnalyses || []; ui.issues = saved.issues || [];
      ui.repairs = saved.repairs || []; ui.selectedRepairId = saved.selectedRepairId || '';
      ui.currentRound = saved.currentRound?.revision === ui.revision ? saved.currentRound : null;
      ui.archivedCases = saved.archivedCases || []; ui.caseAliases = saved.caseAliases || {}; normalizeCases();
      return true;
    } catch { return false; }
  }
  function model() {
    return { ...ui, checks: currentChecks(), decisions: D.forRound(ui.decisions, ui.currentRound, ui.revision).filter(compatibleEvidence), findings: D.forRound(ui.findings, ui.currentRound, ui.revision).filter(compatibleEvidence), agentAnalyses: ui.agentAnalyses.filter(item => item.revision === ui.revision && item.goal === ui.delivery.goal && (!item.question || item.roundId === (ui.currentRound?.id || null))), project: currentProject(), selectedCase: currentCase(), executedNodeIds: executedNodes(), summary: D.summarize(ui.cases, currentChecks(), ui.revision) };
  }
  function executedNodes() {
    const run = D.forRound(ui.runs, ui.currentRound, ui.revision).filter(run => run.caseId === currentCase()?.id && compatibleEvidence(run)).at(-1);
    if (!run) return [];
    return ui.graph.nodes.filter(node => {
      const ref = node.sourceRef;
      if (!ref || !D.validSourceRef(currentProject(), ref)) return false;
      return (run.trace || []).some(trace => {
        if (trace.selector) {
          if (trace.selector !== node.selector || node.evidenceType !== 'commit-boundary') return false;
          if (!trace.sourceRef) return true;
          const candidates = ui.graph.nodes.filter(item => item.evidenceType === 'commit-boundary' && item.selector === trace.selector && item.sourceRef.file === trace.sourceRef.file && item.sourceRef.startLine === trace.sourceRef.startLine && (item.sourceRef.startColumn == null || item.sourceRef.startColumn <= trace.column)).sort((a,b) => (b.sourceRef.startColumn || 0) - (a.sourceRef.startColumn || 0));
          return candidates[0]?.id === node.id;
        }
        if (trace.file !== ref.file) return false;
        const start = trace.line ?? trace.startLine, end = trace.line ?? trace.endLine;
        if (node.type === 'function') return trace.kind === 'call' && start === ref.startLine && trace.count > 0;
        return trace.kind !== 'call' && Number.isInteger(start) && Number.isInteger(end) && start <= ref.endLine && end >= ref.startLine && (trace.count == null || trace.count > 0);
      });
    }).map(node => node.id);
  }
  function installChrome() {
    const tabs = $('.view-tabs');
    tabs.insertAdjacentHTML('afterbegin', '<button data-acceptance-action="overview" class="ac-entry-tab">验收</button><button data-acceptance-action="logic" class="ac-entry-tab">逻辑</button>');
    const previewButton = $('[data-action="mode-preview"]');
    previewButton.lastChild.textContent = '试用';
    const explorer = $('.explorer');
    explorer.insertAdjacentHTML('afterbegin', '<div class="ac-explorer-tabs"><button data-acceptance-action="features">功能</button><button data-action="files">文件</button></div>');
    $('#file-tree').insertAdjacentHTML('beforebegin', '<div id="ac-feature-nav"></div>');
    $('#stage-content').insertAdjacentHTML('beforebegin', '<div id="ac-workbench"></div>');
    $('.header-actions').insertAdjacentHTML('afterbegin', '<button class="ac-model-button" data-acceptance-action="model-settings" id="ac-model-status">Agent 未连接</button><button class="ac-cancel-button" data-acceptance-action="cancel" hidden>取消</button>');
    $('.mobile-tabs').insertAdjacentHTML('afterbegin', '<button data-acceptance-action="overview">验收</button><button data-acceptance-action="logic">逻辑</button>');
    $('[data-action="mobile-files"]').textContent = '代码';
  }
  function render() {
    if (window.AftercodeRepair?.reconcile()) save();
    const active = document.activeElement; const focus = active && $('#ac-workbench')?.contains(active) && ['TEXTAREA','INPUT'].includes(active.tagName) ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
    const scroll = $('#ac-workbench')?.scrollTop || 0; const graphScroll = document.querySelector('.ac-graph-scroll,.st-architecture-canvas'); const graphPosition = graphScroll ? { x: graphScroll.scrollLeft, y: graphScroll.scrollTop } : null;
    const root = $('.ide'); if (!root) return;
    const acceptance = ['overview', 'logic'].includes(ui.mode);
    root.classList.toggle('ac-shell', ui.mode !== 'workspace');
    root.classList.toggle('ac-dashboard', acceptance);
    root.classList.toggle('st-details-open', ui.mode !== 'workspace' && Boolean(ui.detailContext));
    root.classList.toggle('ac-code-mode', ui.mode === 'code' || ui.mode === 'workspace');
    root.classList.toggle('ac-cli-project', currentProject().runtime !== 'web');
    $('#ac-workbench').hidden = !acceptance;
    $('#ac-feature-nav').hidden = ui.mode === 'workspace' || ui.mode === 'code';
    $('#ac-feature-nav').innerHTML = AcceptanceView.renderFeatureNav(model());
    if (acceptance) $('#ac-workbench').innerHTML = ui.mode === 'logic' ? AcceptanceView.renderLogic(model()) : AcceptanceView.renderOverview(model());
    document.querySelectorAll('.ac-entry-tab').forEach(el => el.classList.toggle('active', el.dataset.acceptanceAction === ui.mode));
    if (acceptance) document.querySelectorAll('.view-tabs [data-action]').forEach(el => el.classList.remove('active'));
    if (ui.mode !== 'workspace' && !ui.objectMode) $('#inspector').innerHTML = AcceptanceView.renderInspector(model());
    $('#ac-model-status').textContent = ui.modelStatus.configured ? ui.modelStatus.verifiedAt ? '模型已连接' : '连接已保存' : '连接模型';
    $('.ac-cancel-button').hidden = !ui.busy;
    $('#code-editor').readOnly = ui.busy || ui.repairApplying;
    if (currentProject().runtime !== 'web') { $('#run-status').textContent = ui.busy ? '正在处理当前任务' : ui.runs.length ? `已记录 ${ui.runs.length} 次运行` : '尚未执行'; $('#status-meta').textContent = `${currentProject().runtime} / ${ui.revision}`; }
    if (ui.mode !== 'workspace') { $('#branch-name').textContent = '验收记录'; $('#header-name').textContent = ui.delivery.title || currentProject().name; }
    if ($('#ac-workbench')) $('#ac-workbench').scrollTop = scroll;
    const newGraph = document.querySelector('.ac-graph-scroll,.st-architecture-canvas'); if (graphPosition && newGraph) { newGraph.scrollLeft = graphPosition.x; newGraph.scrollTop = graphPosition.y; }
    if (focus && document.getElementById(focus.id)) { const input = document.getElementById(focus.id); input.focus({ preventScroll: true }); if (focus.start != null) input.setSelectionRange(focus.start, focus.end); }
    if (ui.objectMode && legacy.state.selected && !$('#ac-object-issue')) $('#inspector').insertAdjacentHTML('afterbegin', '<button id="ac-object-issue" class="ac-object-issue" data-acceptance-action="analyze-selection">这里不符合预期</button>');
    window.AftercodeRepair?.layout();
  }
  function switchMode(mode) {
    if (mode === 'preview' && currentProject().analysisOnly) { dialog('当前先浏览实现逻辑', '<p class="dialog-note">这份项目刚从服务器载入，还没有启动试用。可以先查看结构，或让模型梳理需要怎样运行和验收。</p>', '<button class="button quiet" data-acceptance-action="architecture">查看项目结构</button><button class="button primary" data-acceptance-action="analyze-run-plan">分析运行方式</button>'); return; }
    ui.mode = mode; ui.objectMode = false;
    if (mode === 'preview' && currentProject().runtime !== 'web') { editCase(currentCase()?.id); return; }
    if (mode === 'preview') { legacy.state.mode = 'preview'; legacy.state.mobile = 'preview'; if (!legacy.state.rt) legacy.runProject(); }
    if (mode === 'code') { legacy.state.mode = 'code'; legacy.state.mobile = 'files'; }
    if (['overview', 'logic'].includes(mode)) legacy.state.mobile = 'preview';
    legacy.refresh(); render(); save();
  }
  async function api(path, body, signal) {
    if (!isBackend()) throw new Error('请用 npm start 打开本地服务，以使用代码分析、Agent 和多运行时验收。');
    const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || `请求失败 ${response.status}`);
    return data;
  }
  async function refreshStatus() {
    try { const status = await api('/api/status'); ui.serverInfo = status.server || {}; ui.environmentId = status.server?.environmentId || ui.environmentId; ui.modelStatus = { ...status.model, label: status.model.configured ? 'Agent 已配置' : 'Agent 未连接' }; }
    catch { ui.modelStatus = { configured: false, label: 'Agent 未连接', offline: !isBackend() }; }
    try { const recovery = await api('/api/recovery/info'); ui.recoveryAvailable = recovery.hasDraft === true; } catch {}
    render();
  }
  function mapFeatures(graph) {
    const declared = ui.delivery.features || [];
    if (!declared.length) {
      const features = graph.features?.length ? [...graph.features] : [];
      for (const item of ui.cases) if (!features.some(feature => feature.id === item.featureId)) features.unshift({ id: item.featureId, title: ui.delivery.title || '验收范围', description: '按已提供标准验收', nodeIds: graph.nodes.map(node => node.id), sourceRefs: graph.nodes.slice(0,1).map(node => node.sourceRef), source: 'acceptance-scope' });
      return features.length ? features : [{ id: 'feature-main', title: currentProject().name, description: '尚未提供功能预期', nodeIds: [], sourceRefs: [] }];
    }
    return declared.map(feature => {
      const related = (graph.features || []).find(candidate => feature.selector && (candidate.trigger?.selector === feature.selector || candidate.selector === feature.selector));
      return { ...feature, nodeIds: related?.nodeIds || graph.nodes.filter(node => !feature.selector || node.selector === feature.selector).map(node => node.id), sourceRefs: related?.sourceRefs || [], description: feature.description || '' };
    });
  }
  async function analyzeLocal() {
    const revision = ui.revision;
    ui.analysisController?.abort(); const controller = new AbortController(); ui.analysisController = controller;
    ui.analysisStatus = 'local-analyzing'; ui.loading = true; render();
    try {
      const graph = await api('/api/analyze', { project: currentProject() }, controller.signal);
      if (revision !== ui.revision) return;
      ui.graph = graph; ui.features = mapFeatures(graph); ui.analysisStatus = 'local';
      if (!ui.features.some(feature => feature.id === ui.selectedFeatureId)) ui.selectedFeatureId = ui.features[0]?.id || '';
    } catch (error) {
      if (error.name === 'AbortError') return;
      ui.graph = { nodes: [], edges: [], gaps: [error.message] }; ui.analysisStatus = 'unavailable';
      ui.features = mapFeatures(ui.graph);
    } finally { if (revision === ui.revision) { ui.loading = false; render(); } }
  }
  async function projectChanged() {
    cancel(); ui.busy = false; ui.execution = null; ui.projectId = legacy.state.projectId; ui.revision = D.revisionOf(currentProject()); ui.sources = { [ui.revision]: D.copy(currentProject()) };
    ui.checks = []; ui.runs = []; ui.decisions = []; ui.agentAnalyses = []; ui.issues = []; ui.findings = []; ui.activeJob = null; ui.currentRound = null; ui.archivedCases = []; ui.caseAliases = {}; ui.repairs = []; ui.selectedRepairId = ''; ui.repairApplying = false; ui.requirementDraft = null; ui.detailContext = null; ui.error = ''; ui.graph = { nodes: [], edges: [], gaps: [] }; ui.approvedRevision = null;
    ui.delivery = D.copy(currentProject().delivery || { title: currentProject().name, goal: '', source: 'missing' });
    ui.cases = (ui.delivery.cases || []).map(item => D.createCase(item, ui.revision));
    ui.restoredView = false; const hasSaved = restore(); normalizeCases(); ui.features = mapFeatures(ui.graph); ui.selectedFeatureId = ui.cases[0]?.featureId || ui.features[0]?.id || 'feature-main'; ui.selectedCaseId = ui.cases[0]?.id || '';
    if (ui.mode !== 'workspace' && !ui.restoredView) ui.mode = hasSaved && (ui.delivery.source === 'user' || ui.requirementDraft && ui.requirementDraft !== ui.delivery.goal) ? 'overview' : 'logic';
    ui.logicLevel = 'project'; ui.logicFile = ''; ui.focusedLogicFeature = null; ui.logicSearch = null; ui.searchAnswer = null; ui.requirementDraft = ui.requirementDraft ?? ui.delivery.goal ?? '';
    render(); await Promise.all([analyzeLocal(), refreshStatus(), loadServerDraft()]);
    if (ui.activeJob && ui.activeJob.projectId === ui.projectId && ui.activeJob.revision === ui.revision) resumeJob(ui.activeJob);
  }
  async function sourceChanged() {
    const revision = D.revisionOf(currentProject()); if (revision === ui.revision) return;
    cancel(); ui.busy = false; ui.execution = null; ui.analysisController?.abort(); ui.currentRound = null; ui.revision = revision; ui.sources[revision] = D.copy(currentProject()); ui.approvedRevision = null;
    ui.cases = ui.cases.map(item => ({ ...item, revision }));
    ui.graph = { nodes: [], edges: [], gaps: [] }; ui.analysisStatus = 'stale'; ui.focusedLogicFeature = null; ui.logicSearch = null; ui.searchAnswer = null; ui.searchController?.abort();
    save(); render(); await analyzeLocal();
  }
  function dialog(title, body, footer = '') {
    ui.modal = { focus: document.activeElement };
    $('#modal-root').innerHTML = `<div class="dialog-shade"><section class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="ac-dialog-title"><header><h2 id="ac-dialog-title">${title}</h2><button data-acceptance-action="close-dialog" class="icon-button" aria-label="关闭">×</button></header><div class="dialog-body">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</section></div>`;
    queueMicrotask(() => $('.dialog [data-acceptance-action="close-dialog"]')?.focus());
  }
  function closeDialog() { const focus = ui.modal?.focus; ui.modal = null; $('#modal-root').innerHTML = ''; if (focus?.isConnected) focus.focus(); }
  function formError(error) { const el = $('#ac-form-error'); if (el) el.textContent = error.message || error; else legacy.toast(error.message || error); }
  function openProjectDialog() {
    dialog('打开项目', `<label class="field">服务器上的项目目录<input id="st-server-path" value="${esc(currentProject().sourceLocation?.path || ui.serverInfo?.projectPath || '')}" placeholder="服务器上的项目文件夹"></label><p class="dialog-note">读取实现文件，跳过常见密钥、依赖和构建产物。不会因为打开项目就执行代码。</p><div id="ac-form-error" role="alert"></div><div class="st-project-open-actions"><button class="button primary" data-acceptance-action="open-server-project">打开服务器项目</button><button class="button quiet" data-action="import-package">导入项目包</button></div><div class="dialog-divider"></div><div class="section-label">或体验一个示例</div><div class="sample-list">${Object.entries(window.AftercodeProjects).map(([id, project]) => `<button data-action="load-sample" data-project="${esc(id)}"><span>${esc(project.delivery?.title || project.name)}</span><small>${esc(project.description || project.runtime || 'Web')}</small></button>`).join('')}</div>`, '<span class="dialog-note">代码与验收均在服务器处理</span>');
  }
  async function openServerProject() {
    const button = document.querySelector('[data-acceptance-action="open-server-project"]'); button.disabled = true; button.textContent = '正在读取';
    try { const result = await api('/api/projects/open', { path: $('#st-server-path').value }); closeDialog(); await legacy.loadProject(result.project); ui.logicLevel = 'project'; switchMode('logic'); if (result.warnings.length) legacy.toast(result.warnings[0]); }
    catch (error) { formError(error); button.disabled = false; button.textContent = '打开服务器项目'; }
  }
  function editGoal() {
    dialog('这次交付应该做到什么？', `<label class="field">关键规则与必须保留的行为<textarea id="ac-goal">${esc(ui.delivery.goal || '')}</textarea></label><p class="dialog-note">你确认的是目标，不是让现有代码替你定义目标。</p>`, '<span></span><button class="button primary" data-acceptance-action="save-goal">保存目标</button>');
  }
  function editCase(caseId) {
    const item = ui.cases.find(item => item.id === caseId);
    const template = item || currentCase();
    const target = template?.expected?.target || { kind: currentProject().runtime === 'web' ? 'dom' : 'json', selector: legacy.state.selected?.selector || '', path: '' };
    dialog(item ? '确认这个情况' : '再试一个情况', `<label class="field">这个情况是什么？<input id="ac-case-title" value="${esc(item?.title || '')}" placeholder="用你的话描述"></label><div class="form-row"><label class="field flex">观察对象<select id="ac-target-kind">${['dom', 'json', 'stdout', 'exitCode'].map(kind => `<option value="${kind}" ${kind === target.kind ? 'selected' : ''}>${{ dom: '页面元素', json: 'JSON 字段', stdout: '标准输出', exitCode: '退出码' }[kind]}</option>`).join('')}</select></label><label class="field flex">选择器 / JSON 路径<input id="ac-case-target" value="${esc(target.selector || target.path || '')}" placeholder="#result 或 total"></label></div><div class="form-row"><label class="field flex">判断<select id="ac-case-operator">${['equals', 'contains', 'jsonEquals', 'greater', 'less'].map(operator => `<option value="${operator}" ${operator === (item?.expected?.operator || 'equals') ? 'selected' : ''}>${{ equals: '等于文本', contains: '包含', jsonEquals: '等于 JSON 值', greater: '大于', less: '小于' }[operator]}</option>`).join('')}</select></label><label class="field flex">预期值<input id="ac-case-value" value="${esc(item?.expected?.operator === 'jsonEquals' ? JSON.stringify(item.expected.value) : item?.expected?.value ?? '')}"></label></div><details><summary>输入与操作${!item && template ? '（沿用当前情况）' : ''}</summary><label class="field">输入 JSON / stdin<textarea id="ac-case-input">${esc(JSON.stringify(template?.input || {}, null, 2))}</textarea></label><label class="field">页面动作（JSON）<textarea id="ac-case-actions">${esc(JSON.stringify(template?.actions || [], null, 2))}</textarea></label></details><div id="ac-form-error" role="alert"></div>`, `<span class="dialog-note">${item?.origin === 'agent' ? 'Agent 建议，等待你的判断' : '由你定义的预期'}</span><button class="button primary" data-acceptance-action="save-case" data-id="${esc(item?.id || '')}">确认并保存</button>`);
  }
  function saveCase(caseId) {
    try {
      const previous = ui.cases.find(item => item.id === caseId);
      const kind = $('#ac-target-kind').value, operator = $('#ac-case-operator').value;
      const path = $('#ac-case-target').value.trim();
      const target = { kind, ...(kind === 'dom' ? { selector: path } : kind === 'json' ? { path } : {}) };
      if (kind === 'dom' && !path) throw new Error('请填写页面选择器');
      if (kind === 'dom') { try { document.createDocumentFragment().querySelector(path); } catch { throw new Error('请输入有效的页面选择器'); } }
      const value = operator === 'jsonEquals' ? JSON.parse($('#ac-case-value').value) : $('#ac-case-value').value;
      const item = D.createCase({ id: caseId || D.id('case'), title: $('#ac-case-title').value.trim() || '新的情况', featureId: ui.selectedFeatureId || 'feature-main', input: JSON.parse($('#ac-case-input').value), actions: JSON.parse($('#ac-case-actions').value), expected: { target, operator, value }, confirmed: true, origin: 'user', ruleRevision: (previous?.ruleRevision || 0) + 1 }, ui.revision);
      if (!Array.isArray(item.actions) || item.actions.some(action => !['click', 'change', 'input'].includes(action.type) || typeof action.selector !== 'string')) throw new Error('动作只支持带 selector 的 click/change');
      ui.cases = previous ? ui.cases.map(value => value.id === caseId ? item : value) : [...ui.cases, item];
      ui.currentRound = null; normalizeCases(); ui.selectedCaseId = resolveCaseId(item.id); closeDialog(); save(); render();
    } catch (error) { formError(error); }
  }
  function waitUntil(predicate, signal, timeout = 12000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (signal?.aborted) return reject(Object.assign(new Error('已取消'), { name: 'AbortError' }));
        let value; try { value = predicate(); } catch (error) { return reject(error); }
        if (value) return resolve(value);
        if (Date.now() - started > timeout) return reject(new Error('等待应用观察超时'));
        setTimeout(check, 25);
      }; check();
    });
  }
  async function runWebCase(project, item, signal) {
    const targets = legacy.state.pauseTargets; legacy.state.pauseTargets = new Set();
    try {
      const actions = (item.actions || []).map(action => ({ ...action, type: action.type === 'input' ? 'change' : action.type }));
      const runtime = await legacy.runProject({ replay: actions.length > 0, actions });
      if (!runtime) throw new Error('页面无法运行，请查看实现');
      const selector = item.expected?.target?.selector;
      if (selector) legacy.post('observe', { selector });
      if (actions.length) await waitUntil(() => { if (runtime.replayError) throw new Error(runtime.replayError); if (runtime.cancelled) throw Object.assign(new Error('运行已取消'), { name: 'AbortError' }); return runtime.replayDone; }, signal);
      if (selector) await waitUntil(() => runtime.observations.some(obs => obs.object === selector) || runtime.events.some(event => event.type === 'missing' && event.detail.selector === selector), signal);
      await new Promise(resolve => setTimeout(resolve, 30));
      if (signal?.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' });
      const errors = runtime.console.filter(item => item.level === 'error');
      return { id: runtime.id, revision: D.revisionOf(project), runtime: 'web', caseId: item.id, caseTitle: item.title, input: D.copy(item.input), actions: D.copy(item.actions), status: errors.length ? 'error' : 'completed', startedAt: runtime.startedAt, endedAt: new Date().toISOString(), observations: D.copy(runtime.observations), stdout: '', stderr: errors.map(item => item.args.join(' ')).join('\n'), output: null, exitCode: null, evidence: runtime.observations.map(obs => ({ id: obs.id, source: obs.source })), trace: runtime.events.filter(event => event.type === 'commit' && event.detail.proposal?.selector).map(event => ({ selector: event.detail.proposal.selector, kind: 'commit', source: 'runtime', eventId: event.id })), events: D.copy(runtime.events), scope: '已重放的动作、登记任务和此后 DOM 观察；不包含未登记的外部异步活动' };
    } finally { legacy.state.pauseTargets = targets; }
  }
  async function executeLocal(items, { repairId = null } = {}) {
    if (ui.busy) return;
    if (D.revisionOf(currentProject()) !== ui.revision) { await sourceChanged(); items = items.map(item => ui.cases.find(current => current.id === item.id)).filter(Boolean); }
    if (ui.busy) return;
    if (!items.length) { editCase(); return; }
    const project = currentProject(), projectId = ui.projectId, executionRevision = ui.revision;
    if (project.runtime !== 'web' && ui.approvedRevision !== ui.revision) {
      dialog('在本机执行这份项目？', `<div class="ac-run-plan"><b>${esc(project.name)}</b><code>${esc(project.runtime)} · ${esc(project.entry)}</code><p>${items.length} 个独立输入，各自使用临时运行目录。</p><p class="dialog-note notice">这不是操作系统沙箱。项目可能读写文件或访问网络；仅运行你信任的代码。不会自动安装依赖，也不会传入模型凭据。</p></div>`, `<button class="button quiet" data-acceptance-action="close-dialog">取消</button><button class="button primary" data-acceptance-action="approve-run" data-id="${esc(items.map(item => item.id).join(','))}">这是可信项目，执行</button>`);
      return;
    }
    normalizeCases(); items = [...new Set(items.map(item => resolveCaseId(item.id)))].map(id => ui.cases.find(item => item.id === id)).filter(Boolean);
    beginRound(items, repairId); ui.currentRound.status = 'running';
    const controller = new AbortController(); ui.job = { controller, ids: [] }; ui.busy = true; ui.error = ''; render();
    try {
      for (const item of items) {
        if (controller.signal.aborted || projectId !== ui.projectId) break;
        ui.selectedCaseId = item.id; ui.execution = { caseId: item.id, title: item.title, state: 'running' }; render();
        let run;
        try {
          if (project.runtime === 'web') run = await runWebCase(project, item, controller.signal);
          else {
            const jobId = D.id('job'); ui.job.ids.push(jobId);
            const result = await api('/api/run', { project, case: item, approved: true, jobId }, controller.signal); run = result.run;
          }
        } catch (error) {
          run = { id: D.id('run'), caseId: item.id, runtime: project.runtime, revision: D.revisionOf(project), status: controller.signal.aborted || error.name === 'AbortError' ? 'cancelled' : 'error', stderr: error.message, observations: [], evidence: [], trace: [], startedAt: new Date().toISOString(), endedAt: new Date().toISOString() };
        }
        if (projectId !== ui.projectId) break;
        run.roundId = ui.currentRound.id; ui.runs.push(run); ui.checks.push({ ...D.evaluateCase(item, run), roundId: ui.currentRound.id });
        save(); render();
        if (controller.signal.aborted) break;
      }
    } finally {
      if (projectId !== ui.projectId || executionRevision !== ui.revision) return;
      const focus = items.find(item => ui.checks.filter(check => check.caseId === item.id && check.revision === ui.revision).at(-1)?.state === 'failed') || items[0];
      if (focus) { ui.selectedCaseId = focus.id; ui.selectedFeatureId = focus.featureId; }
      ui.currentRound.status = controller.signal.aborted ? 'cancelled' : 'completed';
      ui.busy = false; ui.execution = null; ui.job = null; save(); render();
    }
  }
  async function execute(items, { repairId = null } = {}) {
    if (!isBackend()) return executeLocal(items, { repairId });
    if (ui.busy) return;
    if (D.revisionOf(currentProject()) !== ui.revision) { await sourceChanged(); items = items.map(item => ui.cases.find(c => c.id === item.id)).filter(Boolean); }
    if (!items.length) { prepareAgent(); return; }
    const project = currentProject();
    if (project.runtime !== 'web' && ui.approvedRevision !== ui.revision) {
      dialog('允许在服务器运行这些情况？', `<div class="ac-run-plan"><b>${esc(project.name)}</b><p>会执行 ${items.length} 个独立的验收情况，并保存实际结果。关闭页面后也不会丢失。</p><details><summary>运行范围</summary><p class="dialog-note">只运行你信任的项目；程序可能访问文件或网络。不会自动安装依赖，模型密钥不会传入执行进程。</p></details></div>`, `<button class="button quiet" data-acceptance-action="close-dialog">取消</button><button class="button primary" data-acceptance-action="approve-run" data-id="${esc(items.map(c => c.id).join(','))}">确认运行</button>`); return;
    }
    normalizeCases(); items = [...new Set(items.map(item => resolveCaseId(item.id)))].map(id => ui.cases.find(item => item.id === id)).filter(Boolean);
    beginRound(items, repairId); ui.busy = true; ui.error = ''; ui.execution = { title: '正在提交后台验收' }; render();
    const controller = new AbortController(), projectId = ui.projectId;
    ui.job = { controller, ids: [], background: true };
    try {
      const created = await api('/api/jobs', { project, cases: items, approved: true, clientProjectId: projectId, goal: ui.delivery.goal || '' }, controller.signal);
      if (projectId !== ui.projectId) return;
      const meta = { id: created.id, projectId, revision: created.revision, caseIds: items.map(item => item.id), createdAt: ui.currentRound.createdAt, repairId: ui.currentRound.repairId };
      ui.currentRound = { ...ui.currentRound, id: created.id, status: created.status };
      ui.activeJob = meta; ui.job.ids = [created.id]; save();
      await pollJob(meta, controller);
    } catch (error) { if (projectId === ui.projectId) { ui.error = controller.signal.aborted ? '已停止验收，已取得的证据仍保留' : error.message; if (!ui.activeJob && ui.currentRound) ui.currentRound.status = controller.signal.aborted ? 'cancelled' : 'error'; } }
    finally { if (projectId === ui.projectId) { ui.busy = false; ui.job = null; ui.execution = null; save(); render(); } }
  }
  async function pollJob(meta, controller) {
    while (!controller.signal.aborted && meta.projectId === ui.projectId) {
      const job = await api('/api/jobs/' + meta.id, null, controller.signal);
      if (meta.projectId !== ui.projectId) return;
      if (meta.revision === ui.revision) ui.currentRound = { id: job.id, revision: job.revision, caseIds: job.cases.map(item => resolveCaseId(item.id)), repairId: meta.repairId || null, createdAt: job.createdAt, status: job.status };
      for (const run of job.runs || []) if (!ui.runs.some(item => item.id === run.id)) ui.runs.push({ ...run, roundId: job.id });
      for (const check of job.checks || []) if (!ui.checks.some(item => item.id === check.id)) ui.checks.push({ ...check, roundId: job.id });
      for (const finding of job.findings || []) if (!ui.findings.some(item => item.id === finding.id)) ui.findings.push({ ...finding, roundId: job.id });
      const current = job.cases.find(item => item.id === job.currentCaseId);
      ui.execution = { caseId: job.currentCaseId, title: current ? `后台验收 ${job.runs.length + 1} / ${job.cases.length}：${current.title}` : '正在整理验收结果', state: job.status };
      save(); render();
      if (!['queued','running'].includes(job.status)) {
        ui.activeJob = null;
        const focus = job.checks.find(check => check.state === 'failed') || job.checks.find(check => ['error','timeout','insufficient_evidence'].includes(check.state)) || job.checks[0];
        if (focus && ui.cases.some(item => item.id === focus.caseId)) { ui.selectedCaseId = focus.caseId; ui.selectedFeatureId = ui.cases.find(item => item.id === focus.caseId).featureId; }
        if (['interrupted','error'].includes(job.status)) ui.error = job.message || '这次验收未完成，已有结果仍保留';
        save(); return;
      }
      await new Promise(resolve => setTimeout(resolve, 450));
    }
  }
  async function resumeJob(meta) {
    if (ui.busy) return;
    ui.busy = true; const controller = new AbortController(); ui.job = { controller, ids: [meta.id], background: true }; render();
    try { await pollJob(meta, controller); }
    catch (error) { if (!controller.signal.aborted) ui.error = '暂时无法读取后台任务，刷新后可以继续查看'; }
    finally { if (meta.projectId === ui.projectId) { ui.busy = false; ui.job = null; ui.execution = null; save(); render(); } }
  }
  function cancel() {
    if (!ui.job) return;
    ui.job.controller.abort();
    for (const jobId of ui.job.ids) fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    if (legacy.state.rt) legacy.state.rt.cancel();
    ui.job = null;
  }
  function openArchitecture() { ui.detailContext = null; ui.logicLevel = 'project'; ui.logicFile = ''; ui.focusedLogicFeature = null; switchMode('logic'); }
  function openFeatureLogic(feature) {
    if (!feature) { openArchitecture(); return; }
    ui.logicLevel = 'feature'; ui.focusedLogicFeature = feature; ui.logicFile = feature.sourceRefs?.[0]?.file || ui.graph.nodes.find(node => feature.nodeIds?.includes(node.id))?.sourceRef.file || '';
    ui.selectedFeatureId = feature.id;
    if (!ui.cases.some(item => item.id === ui.selectedCaseId && item.featureId === feature.id)) ui.selectedCaseId = ui.cases.find(item => item.featureId === feature.id)?.id || '';
    switchMode('logic');
  }
  function openCaseLogic(caseId) {
    const item = ui.cases.find(item => item.id === caseId) || currentCase();
    if (!item) { openArchitecture(); return; }
    ui.selectedCaseId = item.id; ui.selectedFeatureId = item.featureId;
    const feature = ui.features.find(feature => feature.id === item.featureId) || ui.graph.features.find(feature => feature.id === item.featureId);
    openFeatureLogic(feature);
  }
  async function searchLogic() {
    const query = ($('#ac-logic-query')?.value || ui.logicQuery || '').trim();
    ui.logicQuery = query; ui.searchController?.abort(); const controller = new AbortController(); ui.searchController = controller;
    if (!query) { ui.logicSearch = null; ui.searchAnswer = null; render(); return; }
    const revision = ui.revision; ui.logicSearching = true; render();
    try { const result = await api('/api/search', { project: currentProject(), query, cases: ui.cases, goal: ui.delivery.goal || '' }, controller.signal); if (revision === ui.revision && query === ui.logicQuery) ui.logicSearch = result; }
    catch (error) { if (error.name !== 'AbortError') legacy.toast(error.message); }
    finally { if (query === ui.logicQuery) { ui.logicSearching = false; render(); } }
  }
  const draftProjectKey = () => currentProject().sourceLocation?.kind === 'server' ? 'server:' + currentProject().sourceLocation.path : ui.projectId;
  async function loadServerDraft() {
    if (!isBackend()) return;
    const key = draftProjectKey(), generation = ui.draftGeneration;
    try {
      const result = await api('/api/drafts?projectKey=' + encodeURIComponent(key));
      if (key !== draftProjectKey()) return;
      ui.draftServerVersion = result.draft?.version || 0;
      if (result.draft && generation === ui.draftGeneration) {
        if (!ui.requirementDraft || ui.requirementDraft === ui.delivery.goal || ui.requirementDraft === result.draft.text) { ui.requirementDraft = result.draft.text; ui.draftSaveStatus = 'saved'; save(); }
        else ui.draftSaveStatus = 'another-version';
      }
    } catch { ui.draftSaveStatus = 'local'; }
    render();
  }
  async function saveServerDraft() {
    if (!isBackend()) return;
    const key = draftProjectKey(), text = ui.requirementDraft || '', generation = ui.draftGeneration;
    if (ui.draftSaving) { ui.draftSaveAgain = true; return; }
    ui.draftSaving = true; ui.draftSaveStatus = 'saving'; render();
    try {
      const result = await api('/api/drafts', { projectKey: key, text, expectedVersion: ui.draftServerVersion });
      if (key === draftProjectKey()) { ui.draftServerVersion = result.version; ui.draftSaveStatus = generation === ui.draftGeneration ? 'saved' : 'saving'; }
    } catch (error) { if (key === draftProjectKey()) ui.draftSaveStatus = /另一|冲突/.test(error.message) ? 'another-version' : 'local'; }
    finally { ui.draftSaving = false; if (key === draftProjectKey()) { render(); if (ui.draftSaveAgain) { ui.draftSaveAgain = false; saveServerDraft(); } } }
  }
  function submitRequirements() {
    if (ui.busy) return;
    const draft = ($('#ac-requirement-input')?.value ?? ui.requirementDraft ?? ui.delivery.goal ?? '').trim();
    if (!draft) { legacy.toast('先写下你希望验收的行为。'); $('#ac-requirement-input')?.focus(); return; }
    const changed = draft !== ui.delivery.goal;
    if (changed) { ui.currentRound = null; ui.searchAnswer = null; ui.delivery.goal = draft; ui.delivery.source = 'user'; ui.cases = ui.cases.map(item => ({ ...item, confirmed: false, ruleRevision: item.ruleRevision + 1 })); ui.analysisStatus = 'needs-reconfirmation'; }
    ui.requirementDraft = draft; ui.agentQuestion = ''; save(); saveServerDraft(); render();
    if (changed || !ui.cases.length || currentProject().analysisOnly) { prepareAgent(); return; }
    const confirmed = ui.cases.filter(item => item.confirmed);
    if (confirmed.length) execute(confirmed); else if (ui.cases.some(item => item.origin === 'agent')) reviewPlan(); else prepareAgent();
  }
  function reviewPlan() {
    const pending = ui.cases.filter(item => !item.confirmed);
    if (!pending.length) { legacy.toast('目前没有需要确认的新建议，可以直接执行已确认的情况。'); return; }
    const hasAgent = pending.some(item => item.origin === 'agent');
    dialog('确认这份验收方案', `<p class="dialog-note">先看这些情况下是否应该得到这个结果。你确认标准，服务器再执行。</p><div class="st-plan-list">${pending.map(item => `<label class="st-plan-case"><input type="checkbox" name="ac-plan-case" value="${esc(item.id)}" ${item.origin === 'agent' || !hasAgent ? 'checked' : ''}><span><b>${esc(item.title)}</b><small>应该得到：${esc(typeof item.expected?.value === 'string' ? item.expected.value : JSON.stringify(item.expected?.value))}</small><small>${item.origin === 'agent' ? '模型建议，尚未验证' : '之前的情况，需要重新确认'}</small></span></label>`).join('')}</div>${currentProject().runtime !== 'web' && ui.approvedRevision !== ui.revision ? '<label class="st-plan-trust"><input id="ac-plan-trust" type="checkbox">允许在服务器执行这份可信项目。不会自动安装依赖。</label>' : ''}<div id="ac-form-error" role="alert"></div>`, '<button class="button quiet" data-acceptance-action="close-dialog">再看看</button><button class="button primary" data-acceptance-action="approve-plan">确认标准并验收</button>');
  }
  function approvePlan() {
    const ids = [...document.querySelectorAll('input[name="ac-plan-case"]:checked')].map(input => input.value);
    if (!ids.length) { formError('至少选择一个需要执行的情况。'); return; }
    if ($('#ac-plan-trust') && !$('#ac-plan-trust').checked) { formError('先确认这份项目可以在服务器运行。'); return; }
    ui.cases = ui.cases.map(item => ids.includes(item.id) ? D.confirmCase(item) : item);
    if ($('#ac-plan-trust')) ui.approvedRevision = ui.revision;
    closeDialog(); save(); execute(ui.cases.filter(item => ids.includes(item.id)));
  }
  function prepareAgent() {
    if (ui.busy) { legacy.toast('后台仍在验收，可以先查看相关逻辑与已有证据。'); return; }
    if (!ui.modelStatus.configured) { modelSettings(); return; }
    dialog(ui.agentQuestion ? '分析这个疑问' : '生成验收方案', `<label class="field">${ui.agentQuestion ? '问题与上下文' : '当前验收需求'}<textarea id="ac-agent-goal">${esc((ui.delivery.goal || '') + (ui.agentQuestion ? '\n需要分析的问题：' + ui.agentQuestion : ''))}</textarea></label><p class="dialog-note">将发送当前项目的文本、局部逻辑和已有验收证据。不会发送模型凭据或机器上的其他文件。</p><label class="ac-share-confirm"><input id="ac-share-approved" type="checkbox">这是可分享的非敏感内容</label><p class="dialog-note">私有项目请使用自管模型端点。</p><div id="ac-form-error" role="alert"></div>`, '<span></span><button class="button primary" data-acceptance-action="start-agent">开始梳理</button>');
  }
  async function startAgent() {
    if (!$('#ac-share-approved').checked) { formError('先确认内容可以发送给已配置的模型。'); return; }
    const goal = $('#ac-agent-goal').value, baseGoal = ui.delivery.goal, askedQuestion = ui.agentQuestion || '', project = currentProject(), revision = ui.revision, projectId = ui.projectId;
    const registerCases = !askedQuestion || ui.agentCaseRequest === true; ui.agentCaseRequest = false; const roundId = ui.currentRound?.id || null;
    closeDialog(); ui.error = ''; ui.analysisStatus = 'agent-analyzing';
    const controller = new AbortController(); const jobId = D.id('agent-job'); ui.job = { controller, ids: [jobId] }; ui.busy = true; render();
    try {
      const response = await fetch('/api/agent/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, goal, purpose: registerCases ? 'plan' : 'diagnose', language: window.AftercodeI18n?.locale || 'zh-CN', shareApproved: true, jobId, focus: { nodeIds: (ui.focusedLogicFeature || ui.features.find(feature => feature.id === ui.selectedFeatureId))?.nodeIds || [] }, currentCases: ui.cases.map(item => ({ id: item.id, title: item.title, ruleRevision: item.ruleRevision, confirmed: item.confirmed, expected: item.expected })), humanDecisions: ui.decisions.filter(item => item.revision === revision).slice(-10), evidence: D.forRound(ui.runs, ui.currentRound, revision).filter(compatibleEvidence).map(run => ({ id: run.id, revision: run.revision, caseId: run.caseId, actions: run.actions, status: run.status, stdout: run.stdout, output: run.output, observations: run.observations, trace: run.trace, checks: ui.checks.filter(check => check.runId === run.id) })) }), signal: controller.signal });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || '模型调用失败'); }
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', result;
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'error') throw new Error(event.data.message);
          if (event.type === 'result') result = event.data;
          if (event.type === 'progress') { ui.execution = { title: event.data.message || event.data.label || '正在梳理相关实现', state: 'analyzing' }; render(); }
        }
      }
      if (!result || revision !== ui.revision || projectId !== ui.projectId) throw new Error('分析结果缺失或源文件已改变，需要重验');
      const analysis = { ...result, id: result.id || D.id('analysis'), revision, roundId, shareApproved: true, goal: askedQuestion ? baseGoal : goal, question: askedQuestion };
      ui.agentAnalyses.push(analysis);
      if (askedQuestion) ui.searchAnswer = { ...analysis };
      ui.graph.nodes = ui.graph.nodes.map(node => { const interpretation = result.nodeAnnotations?.find(item => item.nodeId === node.id); return interpretation ? { ...node, interpretation } : node; });
      const featureMap = new Map();
      for (const feature of result.features || []) {
        const existing = ui.features.find(item => item.id === feature.id) || ui.features.find(item => feature.nodeIds?.some(id => item.nodeIds?.includes(id)));
        if (existing) {
          featureMap.set(feature.id, existing.id);
          const declared = ui.delivery.features?.some(item => item.id === existing.id);
          Object.assign(existing, feature, { id: existing.id, title: declared ? existing.title : feature.title });
        } else { ui.features.push(feature); featureMap.set(feature.id, feature.id); }
      }
      const suggestions = (result.cases || []).map(proposal => D.createCase({ ...proposal, featureId: featureMap.get(proposal.featureId) || proposal.featureId || ui.selectedFeatureId, id: D.id('agent-case'), origin: 'agent', confirmed: false }, revision));
      if (registerCases) { const before = ui.cases.map(D.caseKey).sort().join('\n'); normalizeCases(suggestions); if (before !== ui.cases.map(D.caseKey).sort().join('\n')) ui.currentRound = null; }
      else analysis.caseSuggestions = suggestions;
      ui.analysisStatus = 'model'; if (!askedQuestion) { ui.delivery.goal = goal; ui.requirementDraft = goal; } ui.agentQuestion = '';
      if (!ui.features.some(feature => feature.id === ui.selectedFeatureId)) ui.selectedFeatureId = ui.features[0]?.id || '';
      save();
    } catch (error) { if (revision === ui.revision && projectId === ui.projectId) { ui.error = controller.signal.aborted ? '分析已取消，未产生验收结论' : error.message; ui.analysisStatus = 'error'; } }
    finally { if (revision === ui.revision && projectId === ui.projectId) { ui.busy = false; ui.job = null; ui.execution = null; render(); } }
  }
  async function modelSettings() {
    let settings = {};
    try { settings = await api('/api/model/config'); } catch { settings = { configured: false, unavailable: true }; }
    ui.safeModelSettings = settings;
    dialog('连接模型', `<div class="st-connection"><div class="st-private-note"><span>◇</span><div><b>密钥不用发到聊天里</b><p>只保存在服务器的私有目录，不写进浏览器存储、日志或导出文件。</p></div></div><label class="field">服务提供方<select id="ac-model-provider"><option value="custom">自定义 / 兼容服务</option><option value="hkust" ${String(settings.baseUrl || '').includes('/hkust-genai/') ? 'selected' : ''}>香港科技大学 GenAI</option><option value="hkust-legacy" ${String(settings.baseUrl || '').endsWith('/openai') ? 'selected' : ''}>香港科技大学（旧版接口）</option><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="self">本地或自管模型</option></select></label><label class="field">服务地址<input id="ac-model-base" type="url" value="${esc(settings.baseUrl || '')}" placeholder="例如 https://api.example.com/v1" autocomplete="off"></label><label class="field">模型名称<input id="ac-model-name" value="${esc(settings.model || '')}" placeholder="服务提供的模型名称" autocomplete="off"></label><label class="field">密钥<input id="ac-model-key" type="password" autocomplete="off" placeholder="${settings.keySaved ? '已保存在服务器，留空即可保持' : '在这里粘贴，不用发给聊天助手'}"></label><div class="st-connection-state">${settings.verifiedAt ? '已检查连接' : settings.configured ? '连接已保存，可以再检查一次' : '尚未配置模型'}</div><p class="dialog-note">${esc(settings.connectionMessage || '保存时会发送一条很短的连接检查，不会发送项目代码。')}</p>${settings.unavailable ? '<p class="dialog-note notice">请先打开服务器工作台，再保存连接。</p>' : ''}<div id="ac-form-error" role="alert"></div></div>`, `<button class="button quiet" data-acceptance-action="clear-model" ${settings.configured || settings.keySaved ? '' : 'disabled'}>清除连接</button><button class="button primary" data-acceptance-action="save-model" ${settings.unavailable ? 'disabled' : ''}>保存并检查连接</button>`);
  }
  async function saveModel() {
    const button = document.querySelector('[data-acceptance-action="save-model"]');
    button.disabled = true; button.textContent = '正在检查';
    try {
      const result = await api('/api/model/config', { baseUrl: $('#ac-model-base').value, model: $('#ac-model-name').value, apiKey: $('#ac-model-key').value, testConnection: true });
      $('#ac-model-key').value = '';
      ui.modelStatus = result; closeDialog(); render();
      legacy.toast(result.connection?.message || '连接已保存');
    } catch (error) { if ($('#ac-model-key')) $('#ac-model-key').value = ''; formError(error); button.disabled = false; button.textContent = '保存并检查连接'; }
  }
  function clearModel() {
    dialog('清除这份连接？', '<p class="dialog-note">服务器保存的密钥会从当前连接配置中移除。需要彻底停用时，也可在服务提供方撤销这把密钥。</p>', '<button class="button quiet" data-acceptance-action="close-dialog">取消</button><button class="button primary" data-acceptance-action="confirm-clear-model">清除连接</button>');
  }
  function about() {
    dialog('接入与边界', '<div class="about-grid"><section><h3>验收，而不是替你盖章</h3><p>工具执行已确认的情况；模型建议、实际结果和你的决定分别保留。一个案例通过不代表所有需求都正确。</p></section><section><h3>三种运行方式</h3><p>Web 使用页面与 DOM；Node.js / Python 使用已批准的命令行输入输出。后两者没有伪造 Web 断点能力。</p></section><section><h3>逻辑图来自哪里</h3><p>本地 AST 提取源码结构；模型可为真实节点提供标注的释义。只有真实执行证据才点亮相应片段。</p></section><section><h3>只运行可信项目</h3><p>CLI 临时目录不是系统沙箱。模型凭据留在后端；私有源码使用自管端点，分享前需确认数据范围。</p></section></div>', '<button class="button quiet" data-acceptance-action="model-settings">模型配置状态</button><button class="button primary" data-acceptance-action="close-dialog">返回</button>');
  }
  function research() {
    dialog('为什么从验收开始', '<div class="research-lead">生成变容易之后，<br>判断“有没有做好”可能成为新的负担。</div><p class="dialog-note">这是一项待验证的产品假设，不是已证实的效率提升。交付验收连接任务、标准、真实结果和人的决定；局部逻辑帮助人判断，而不是代替证据。</p><div class="research-sources"><article><a href="https://survey.stackoverflow.co/2025/ai" target="_blank" rel="noreferrer">Stack Overflow 2025 调查 ↗</a><p>相关回答中，66% 提到方案差一点才正确，45% 提到调试 AI 代码更费时。属于自报告调查，不代表所有人。</p></article><article><a href="https://dora.dev/research/2025/dora-report/" target="_blank" rel="noreferrer">DORA 2025 ↗</a><p>官方概要强调 AI 放大原有系统的优势与弱点；不能只靠更强工具替代交付与验证机制。</p></article></div><p class="dialog-note notice">真人试用尚未开展。自动化测试证明功能真实性，不证明市场吸引力或用户效率。</p>', '<a href="RESEARCH.md" target="_blank">完整研究依据 ↗</a><button class="button primary" data-acceptance-action="close-dialog">回到验收</button>');
  }
  function evidence(caseId) {
    const specificRun = ui.runs.find(run => run.id === caseId);
    const item = [...ui.cases, ...ui.archivedCases].find(item => item.id === (specificRun?.caseId || caseId)) || currentCase();
    const run = specificRun || D.forRound(ui.runs, ui.currentRound, ui.revision).filter(run => run.caseId === item?.id && compatibleEvidence(run)).at(-1);
    const check = run ? ui.checks.filter(check => check.runId === run.id).at(-1) : null;
    dialog('本次验收依据', `${run ? `<div class="ac-evidence-top"><b>${esc(run.caseTitle || item?.title)}</b><code>${esc(run.id)} · ${esc(run.revision)}</code></div><div class="form-row"><div class="field flex"><span>预期</span><b>${esc(JSON.stringify(check?.expected?.value))}</b></div><div class="field flex"><span>实际</span><b>${esc(JSON.stringify(check?.actual))}</b></div></div><details><summary>原始观察 / 输出</summary><pre class="json-view">${esc(JSON.stringify({ status: run.status, exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr, observations: run.observations, evidence: run.evidence }, null, 2))}</pre></details><details><summary>实际路径片段</summary><pre class="json-view">${esc(JSON.stringify(run.trace, null, 2))}</pre></details>` : '<p class="dialog-note">这个情况还没有执行，没有可用的运行依据。</p>'}`, '<button class="button quiet" data-acceptance-action="export">导出完整调查包</button><button class="button primary" data-acceptance-action="close-dialog">返回</button>');
  }
  function history() {
    dialog('验收运行历史', `<div class="history-list">${ui.runs.slice().reverse().map(run => { const check = ui.checks.find(check => check.runId === run.id); return `<article><div><b>${esc(run.caseTitle || [...ui.cases, ...ui.archivedCases].find(item => item.id === run.caseId)?.title || run.caseId)}</b><p>${esc(run.roundId === ui.currentRound?.id ? '本轮' : '历史')} · ${esc(run.startedAt ? new Date(run.startedAt).toLocaleString('zh-CN') : '早先记录')} · ${esc(({ passed: '符合预期', failed: '不符合', needs_confirmation: '标准待确认', error: '执行出错', timeout: '超时', cancelled: '已停止' })[check?.state || run.status] || '待核对')}</p></div><button class="button small" data-acceptance-action="evidence" data-id="${esc(run.id)}">查看当时依据</button></article>`; }).join('') || '<p class="dialog-note">还没有执行记录。</p>'}</div>`, '<button class="button quiet" data-acceptance-action="compare-runs">对比两次运行</button><button class="button primary" data-acceptance-action="close-dialog">返回</button>');
  }
  function compareRuns(leftId, rightId) {
    if (!ui.runs.length) { legacy.toast('先执行一个情况，再比较真实运行。'); return; }
    const related = ui.runs.filter(run => run.caseId === currentCase()?.id);
    const preferred = related.length ? related : ui.runs;
    const left = ui.runs.find(run => run.id === leftId) || preferred.at(-2) || preferred[0];
    const right = ui.runs.find(run => run.id === rightId) || preferred.at(-1);
    const checkForRun = run => ui.checks.filter(check => check.runId === run.id).at(-1);
    const a = checkForRun(left), b = checkForRun(right);
    const options = selected => ui.runs.map(run => `<option value="${esc(run.id)}" ${run.id === selected.id ? 'selected' : ''}>${esc(run.caseTitle || run.caseId)} · ${esc(run.revision)}</option>`).join('');
    const rows = [['源码版本', left.revision, right.revision], ['输入', JSON.stringify(left.input || {}), JSON.stringify(right.input || {})], ['动作', JSON.stringify(left.actions || []), JSON.stringify(right.actions || [])], ['预期标准', JSON.stringify(a?.expected?.value), JSON.stringify(b?.expected?.value)], ['标准修订', a?.ruleRevision, b?.ruleRevision], ['实际结果', JSON.stringify(a?.actual), JSON.stringify(b?.actual)], ['检查结果', a?.state || left.status, b?.state || right.status], ['运行身份', left.id, right.id]];
    dialog('哪里改变了', `<div class="form-row"><label class="field flex">基线<select id="ac-run-left">${options(left)}</select></label><label class="field flex">对照<select id="ac-run-right">${options(right)}</select></label></div><table class="compare-table ac-comparison"><thead><tr><th>对照项</th><th>基线</th><th>对照</th></tr></thead><tbody>${rows.map(([label, a, b]) => `<tr class="${a !== b ? 'changed' : ''}"><td>${label}</td><td>${esc(a ?? '未观察')}</td><td>${esc(b ?? '未观察')}</td></tr>`).join('')}</tbody></table><p class="dialog-note">输入或标准改变时，不能仅凭结果通过就说代码已修复。这里只展示两次运行对照。</p>`, '<button class="button quiet" data-acceptance-action="export">导出完整依据</button><button class="button primary" data-acceptance-action="close-dialog">返回</button>');
  }
  function decision(status) {
    const featureCases = ui.cases.filter(item => !ui.selectedFeatureId || item.featureId === ui.selectedFeatureId);
    const scope = status === 'accepted' ? featureCases.filter(item => currentChecks().filter(check => check.caseId === item.id && check.ruleRevision === item.ruleRevision).at(-1)?.state === 'passed').map(item => item.id) : featureCases.map(item => item.id);
    if (!scope.length) { legacy.toast(status === 'accepted' ? '当前没有可接受的已验证范围。' : '先添加或选择一个验收情况。'); return; }
    dialog(status === 'accepted' ? '接受这些已验证的情况？' : '退回这部分功能？', `<ul class="ac-decision-scope">${scope.map(id => `<li>${esc(ui.cases.find(item => item.id === id).title)}</li>`).join('')}</ul><label class="field">补充说明<textarea id="ac-decision-note" placeholder="留给 Agent 或协作者的反馈"></textarea></label><div id="ac-form-error" role="alert"></div>`, `<button class="button quiet" data-acceptance-action="close-dialog">取消</button><button class="button primary" data-acceptance-action="save-decision" data-id="${status}" data-scope="${esc(JSON.stringify(scope))}">确认</button>`);
  }
  function exportData() { return { schemaVersion: 3, product: 'Aftercode delivery acceptance', repairs: D.copy(ui.repairs), environmentId: ui.environmentId, exportedAt: new Date().toISOString(), project: currentProject(), revision: ui.revision, sourceRevisions: D.copy(ui.sources), currentRound: D.copy(ui.currentRound), archivedCases: D.copy(ui.archivedCases), caseAliases: D.copy(ui.caseAliases), delivery: D.copy(ui.delivery), graph: D.copy(ui.graph), cases: D.copy(ui.cases), checks: D.copy(ui.checks), runs: D.copy(ui.runs), decisions: D.copy(ui.decisions), agentAnalyses: D.copy(ui.agentAnalyses), issues: D.copy(ui.issues), findings: D.copy(ui.findings), backgroundJob: D.copy(ui.activeJob), modelConfigured: ui.modelStatus.configured === true, lastSuccessfulAnalysisAt: ui.agentAnalyses.filter(item => item.source === 'model').at(-1)?.analyzedAt || null }; }
  function exportPackage() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'aftercode-acceptance.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const actions = {
    overview: () => switchMode('overview'), features: () => switchMode('overview'), logic: () => { const item = currentCase(); if (item && currentChecks().some(check => check.caseId === item.id)) openCaseLogic(item.id); else openArchitecture(); }, try: () => switchMode('preview'),
    feature(el) { ui.selectedFeatureId = el.dataset.id; ui.selectedCaseId = ui.cases.find(item => item.featureId === ui.selectedFeatureId)?.id || ''; render(); },
    case(el) { ui.detailContext = { kind: 'case', caseId: el.dataset.id }; ui.selectedCaseId = el.dataset.id; ui.selectedFeatureId = currentCase()?.featureId || ui.selectedFeatureId; if (innerWidth < 700) { legacy.state.mobile = 'inspector'; legacy.refresh(); } render(); },
    'edit-goal': editGoal, 'add-case': () => editCase(), 'edit-case': el => editCase(el.dataset.id || currentCase()?.id), 'confirm-case': el => editCase(el.dataset.id || currentCase()?.id),
    'save-goal'() {
      const goal = $('#ac-goal').value.trim();
      if (goal !== ui.delivery.goal) { ui.currentRound = null; ui.searchAnswer = null; ui.cases = ui.cases.map(item => ({ ...item, confirmed: false, ruleRevision: item.ruleRevision + 1 })); ui.analysisStatus = 'needs-reconfirmation'; }
      ui.delivery.goal = goal; ui.requirementDraft = goal; ui.delivery.source = 'user'; closeDialog(); save(); render();
    },
    'save-case': el => saveCase(el.dataset.id),
    'adopt-suggestions'(el) { const analysis = ui.agentAnalyses.find(item => item.id === el.dataset.id); if (!analysis || analysis.revision !== ui.revision || analysis.goal !== ui.delivery.goal) return; const before = ui.cases.length; normalizeCases(analysis.caseSuggestions || []); analysis.suggestionsAdopted = true; if (ui.cases.length !== before) ui.currentRound = null; save(); render(); reviewPlan(); },
    'open-server-project': openServerProject,
    async 'restore-input'() { let result = await api('/api/drafts?projectKey=' + encodeURIComponent(draftProjectKey())); if (!result.draft?.text) result = await api('/api/recovery/latest'); if (!result.draft?.text) { legacy.toast('没有找到可恢复的草稿。'); return; } ui.requirementDraft = result.draft.text; if (result.draft.version) { ui.draftServerVersion = result.draft.version; ui.draftSaveStatus = 'saved'; } switchMode('overview'); save(); legacy.toast('已恢复最近草稿。'); },
    'close-details'() { ui.detailContext = null; legacy.state.mobile = 'preview'; legacy.refresh(); render(); },
    'ask-case'(el) { const item = ui.cases.find(item => item.id === el.dataset.id); const check = currentChecks().filter(check => check.caseId === item?.id).at(-1); ui.agentQuestion = `请分析这个情况：${item?.title || ''}。预期 ${JSON.stringify((check?.expected || item?.expected)?.value)}；${check ? '这次实际 ' + JSON.stringify(check.actual) : '本轮尚无运行结果，先根据源码分析'}。区分已知事实与可能原因，给出可以验证或推翻解释的下一步。`; prepareAgent(); },
    'validate-node'(el) { const node = ui.graph.nodes.find(node => node.id === el.dataset.id); if (!node) return; ui.agentCaseRequest = true; ui.agentQuestion = `围绕这处逻辑提出验证：${node.label}。源码位置 ${node.sourceRef.file}:${node.sourceRef.startLine}。请根据验收需求给出案例，预期不明确时指出需要确认的问题。`; prepareAgent(); },
    'record-conclusion'() { dialog('记录这次验收的结论', '<p class="dialog-note">只针对明确列出的情况，不把未覆盖部分一并接受。</p><div class="fx-record-choices"><button class="st-button is-secondary" data-acceptance-action="decision-return">退回需要修改的部分</button><button class="st-button is-primary" data-acceptance-action="decision-accept">接受已验证的范围</button></div>'); },
    'analyze-run-plan'() { closeDialog(); ui.agentQuestion = '请根据已导入的实现，说明如何运行和验收这个项目；哪些目前还不能执行？只给可审阅的方案，不声称已运行。'; prepareAgent(); },
    architecture: openArchitecture,
    'logic-map-functions'() { ui.logicMapMode = 'functions'; render(); },
    'logic-map-files'() { ui.logicMapMode = 'files'; render(); },
    'analyze-architecture'() { ui.agentQuestion = '请根据当前项目结构与相关源码，梳理核心功能、共享状态、接口与实现之间的脉络，指出需要进一步展开的部分。不要只复述文件列表。'; prepareAgent(); },
    'drill-folder'(el) { ui.logicLevel = 'folder'; ui.logicFolder = el.dataset.file || ''; ui.focusedLogicFeature = null; switchMode('logic'); },
    'drill-module'(el) { ui.detailContext = null; ui.logicLevel = 'module'; ui.logicFile = el.dataset.file; ui.focusedLogicFeature = null; switchMode('logic'); },
    'drill-node'(el) {
      const node = ui.graph.nodes.find(item => item.id === el.dataset.id); if (!node) return;
      const ids = new Set(), queue = [node.id];
      while (queue.length && ids.size < 100) { const next = queue.shift(); for (const edge of ui.graph.edges.filter(edge => edge.from === next && ['contains','then','else'].includes(edge.kind))) if (!ids.has(edge.to) && edge.to !== node.id) { ids.add(edge.to); queue.push(edge.to); } }
      if (!ids.size) { actions['logic-expand'](el); return; }
      ui.focusedLogicFeature = { id: 'node:' + node.id, title: node.interpretation?.label || node.label, nodeIds: [...ids], sourceRefs: [node.sourceRef] }; ui.logicLevel = 'feature'; ui.logicFile = node.sourceRef.file; switchMode('logic');
    },
    'drill-feature'(el) { openFeatureLogic(ui.features.find(feature => feature.id === el.dataset.id) || ui.graph.features.find(feature => feature.id === el.dataset.id)); },
    'investigate-case'(el) { ui.detailContext = { kind: 'case', caseId: el.dataset.id }; openCaseLogic(el.dataset.id); },
    'investigate-finding'(el) { const finding = ui.findings.find(item => item.id === el.dataset.id); if (finding) { ui.detailContext = { kind: 'case', caseId: finding.caseId }; openCaseLogic(finding.caseId); } },
    'focus-search'() { requestAnimationFrame(() => $('#ac-logic-query')?.focus()); },
    'search-logic': searchLogic,
    'ask-logic'() { ui.agentQuestion = ($('#ac-logic-query')?.value || ui.logicQuery || '').trim(); if (!ui.agentQuestion) { legacy.toast('写下你想弄清的问题。'); $('#ac-logic-query')?.focus(); return; } prepareAgent(); },
    'review-plan': reviewPlan, 'approve-plan': approvePlan,
    'open-search-result'(el) {
      if (el.dataset.kind === 'module') { actions['drill-module']({ dataset: { file: el.dataset.id } }); return; }
      if (el.dataset.kind === 'case') { openCaseLogic(el.dataset.id); return; }
      if (el.dataset.kind === 'requirement') { editGoal(); return; }
      const node = ui.graph.nodes.find(node => node.id === el.dataset.id);
      if (node) { const feature = ui.features.find(feature => feature.nodeIds?.includes(node.id)) || ui.graph.features.find(feature => feature.nodeIds?.includes(node.id)) || { id: 'node:' + node.id, title: node.label, nodeIds: [node.id], sourceRefs: [node.sourceRef] }; openFeatureLogic(feature); }
    },
    'run-case': el => execute(ui.cases.filter(item => item.id === (el.dataset.id || currentCase()?.id))),
    'run-all': submitRequirements,
    'approve-run'(el) { ui.approvedRevision = ui.revision; const items = ui.cases.filter(item => el.dataset.id.split(',').includes(item.id)); closeDialog(); execute(items); },
    'decision-accept': () => decision('accepted'), 'decision-return': () => decision('returned'),
    'save-decision'(el) { try { const record = D.makeDecision({ status: el.dataset.id, scopeCaseIds: JSON.parse(el.dataset.scope), note: $('#ac-decision-note').value, revision: ui.revision }, ui.cases, currentChecks()); record.environmentId = ui.environmentId; record.roundId = ui.currentRound?.id || null; ui.decisions.push(record); closeDialog(); save(); render(); } catch (error) { formError(error); } },
    evidence: el => evidence(el.dataset.id), history, about, research, 'save-model': saveModel, 'clear-model': clearModel, async 'confirm-clear-model'() { await api('/api/model/config', { clear: true }); closeDialog(); await refreshStatus(); legacy.toast('连接已清除'); }, 'compare-runs': () => compareRuns(),
    source(el) {
      const node = ui.graph.nodes.find(node => node.id === el.dataset.id); const ref = node?.sourceRef || (el.dataset.file ? { file: el.dataset.file, startLine: Number(el.dataset.line || 1), revision: ui.revision, endLine: Number(el.dataset.line || 1) } : ui.features.find(feature => feature.id === ui.selectedFeatureId)?.sourceRefs?.[0]);
      if (!ref || !D.validSourceRef(currentProject(), ref)) { legacy.toast('这个位置没有当前版本的有效源码引用。'); return; }
      closeDialog(); ui.mode = 'code'; legacy.actions['open-file']({ dataset: { file: ref.file } }); legacy.state.mode = 'code'; legacy.refresh(); render();
      const editor = $('#code-editor'), lines = editor.value.split('\n'); const start = lines.slice(0, ref.startLine - 1).join('\n').length + (ref.startLine > 1 ? 1 : 0); editor.focus(); editor.setSelectionRange(start, start + lines[ref.startLine - 1].length); editor.scrollTop = Math.max(0, (ref.startLine - 4) * 21);
    },
    'logic-expand'(el) { if (!ui.graph.nodes.some(node => node.id === el.dataset.id)) return; ui.detailContext = { kind: 'node', id: el.dataset.id }; if (innerWidth < 700) legacy.state.mobile = 'inspector'; legacy.refresh(); render(); },
    'agent-analyze': () => { ui.agentQuestion = ''; prepareAgent(); }, 'start-agent': startAgent, 'model-settings': modelSettings,
    async 'refresh-status'() { closeDialog(); await refreshStatus(); modelSettings(); },
    'analyze-selection'() { const selected = legacy.state.selected; if (!selected) return; ui.issues.push({ id: D.id('issue'), revision: ui.revision, runId: legacy.state.rt?.id, observation: D.copy(selected), at: new Date().toISOString() }); ui.objectMode = false; ui.mode = 'overview'; save(); editCase(); render(); },
    export: exportPackage, cancel, 'close-dialog': closeDialog
  };
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-acceptance-action]');
    if (el && !el.disabled) { event.preventDefault(); const result = actions[el.dataset.acceptanceAction]?.(el); if (result?.catch) result.catch(error => { ui.error = error.message; render(); }); return; }
  });
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
    const action = el.dataset.action;
    if (ui.mode === 'workspace') return;
    if (action === 'project') { event.preventDefault(); event.stopImmediatePropagation(); openProjectDialog(); return; }
    if (action === 'about' || action === 'research') { event.preventDefault(); event.stopImmediatePropagation(); if (action === 'about') about(); else research(); return; }
    if (action === 'history' || action === 'compare') { event.preventDefault(); event.stopImmediatePropagation(); if (action === 'history') history(); else compareRuns(); return; }
    if (action === 'export' && ui.mode !== 'workspace') { event.preventDefault(); event.stopImmediatePropagation(); exportPackage(); return; }
    if (action === 'run' && (ui.mode === 'overview' || ui.mode === 'logic' || currentProject().runtime !== 'web')) { event.preventDefault(); event.stopImmediatePropagation(); actions['run-all'](); return; }
    if (['mode-preview', 'mobile-preview'].includes(action) && currentProject().analysisOnly) { event.preventDefault(); event.stopImmediatePropagation(); switchMode('preview'); return; }
    if (['mode-preview', 'mobile-preview'].includes(action) && currentProject().runtime !== 'web') { event.preventDefault(); event.stopImmediatePropagation(); editCase(currentCase()?.id); return; }
    if (['mode-preview', 'mobile-preview'].includes(action)) { event.preventDefault(); event.stopImmediatePropagation(); switchMode('preview'); return; }
    if (['mode-code', 'mode-split', 'files', 'mobile-files', 'open-file', 'source-file', 'new-file'].includes(action)) { ui.mode = 'code'; ui.objectMode = false; }
    if (action === 'mobile-inspector') ui.detailContext = { kind: 'case', caseId: currentCase()?.id };
    if (action === 'select') { ui.mode = 'preview'; ui.objectMode = true; }
    if (action === 'load-sample' || action === 'create-experiment' || action === 'restore-run') { ui.objectMode = false; ui.modal = null; }
    queueMicrotask(render);
  }, true);
  document.addEventListener('change', event => { if (event.target.id === 'ac-model-provider') { const base = { 'hkust-legacy': 'https://hkust.azure-api.net/openai', hkust: 'https://hkust.azure-api.net/hkust-genai/v1', openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com/v1', self: 'http://127.0.0.1:8000/v1' }[event.target.value]; if (base) { $('#ac-model-base').value = base; $('#ac-model-key').value = ''; } } if (['ac-run-left', 'ac-run-right'].includes(event.target.id)) { const focus = event.target.id; compareRuns($('#ac-run-left').value, $('#ac-run-right').value); queueMicrotask(() => $(`#${focus}`)?.focus()); } });
  document.addEventListener('input', event => { if (event.target.id === 'ac-requirement-input') { ui.requirementDraft = event.target.value; ui.draftGeneration++; ui.draftSaveStatus = 'saving'; save(); clearTimeout(ui.draftTimer); ui.draftTimer = setTimeout(saveServerDraft, 600); } if (event.target.id === 'ac-logic-query') { ui.logicQuery = event.target.value; ui.searchAnswer = null; clearTimeout(ui.searchTimer); ui.searchTimer = setTimeout(searchLogic, 280); } if (event.target.id === 'code-editor') { clearTimeout(ui.sourceTimer); ui.sourceTimer = setTimeout(sourceChanged, 300); } });
  document.addEventListener('keydown', event => {
    if (event.target.id === 'ac-logic-query' && event.key === 'Enter') { event.preventDefault(); clearTimeout(ui.searchTimer); searchLogic(); }
    if (ui.modal && event.key === 'Escape') closeDialog();
    if (ui.modal && event.key === 'Tab') {
      const nodes = [...document.querySelectorAll('.dialog button:not(:disabled),.dialog input,.dialog textarea,.dialog select,.dialog summary')];
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    }
  });
  window.addEventListener('aftercode:project-change', projectChanged);
  window.addEventListener('aftercode:runtime-update', () => { if (ui.mode !== 'workspace') render(); });
  window.addEventListener('aftercode:run-request', () => actions['run-all']());
  window.AcceptanceApp = { state: ui, exportData, execute, analyzeLocal, refreshStatus, projectChanged, sourceChanged, switchMode, actions, cancel, render, save, dialog, closeDialog, currentProject, currentChecks };
  installChrome(); projectChanged();
})();
