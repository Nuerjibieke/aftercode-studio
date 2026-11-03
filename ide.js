(() => {
  'use strict';
  const C = IntentCore;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const icons = {
    files: '<path d="M8 3h8l4 4v14H8Z"/><path d="M16 3v5h5M4 7v14"/>',
    run: '<path d="m8 5 11 7-11 7Z"/>', pause: '<path d="M8 5v14M16 5v14"/>', step: '<path d="m4 5 10 7-10 7ZM19 5v14"/>',
    select: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5M8 12h8m-4-4v8"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m0-5c8 0 12-1 12-5"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 5v6h6m3-4v6l4 2"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16"/>',
    compare: '<path d="M8 3v18m8-18v18M3 7l5-4 5 4m-2 10 5 4 5-4"/>',
    arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    check: '<path d="m5 12 4 4L19 6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    folder: '<path d="M3 6h7l2 2h9v12H3Z"/>', split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    preview: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 8h20"/>', spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>'
  };
  const icon = name => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.info}</svg>`;
  const button = (action, label, glyph, cls = '', extra = '') => `<button class="button ${cls}" data-action="${action}" ${extra}>${glyph ? icon(glyph) : ''}${label}</button>`;
  const state = {
    project: C.clone(AftercodeProjects.focus), projectId: C.uid('project'), file: 'app.js', mode: 'preview', mobile: 'preview',
    rt: null, history: [], selected: null, rules: [], watches: new Set(), pauseTargets: new Set(), selecting: false,
    dirty: false, panel: false, panelTab: 'events', modal: null, branch: 0, parent: null, ack: new Map(), ready: null,
    handoffs: [], research: false, openedAt: new Date().toISOString(), importError: '', focusReturn: null
  };
  const short = id => id?.slice(-6).toUpperCase() || '—';
  const rt = () => state.rt;
  const snapshot = run => ({ ...run.snapshot(), projectId: run.projectId, projectName: run.projectName, entry: run.entry, files: C.clone(run.files), actions: C.clone(run.actions), capabilities: C.clone(run.capabilities), console: C.clone(run.console), branch: run.branch, ready: run.ready });
  const runs = () => [...state.history, ...(rt() ? [snapshot(rt())] : [])];
  const currentRules = () => state.rules.filter(rule => rule.projectId === state.projectId);
  const post = (kind, data = {}) => $('#preview-frame')?.contentWindow?.postMessage({ channel: 'aftercode-control', runId: rt().id, kind, data }, '*');
  let toastTimer;
  function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3000); }
  const workspaceKey = 'aftercode:workspace:v2';
  function validProject(project) {
    return project && typeof project.name === 'string' && typeof project.entry === 'string' && project.files && !Array.isArray(project.files) && typeof project.files === 'object' && typeof project.files[project.entry] === 'string' && Object.values(project.files).every(text => typeof text === 'string') && JSON.stringify(project).length <= 8_000_000;
  }
  function persist() {
    try {
      localStorage.setItem(workspaceKey, JSON.stringify({ schemaVersion: 2, project: state.project, projectId: state.projectId, rules: state.rules, watches: [...state.watches] }));
      return true;
    } catch { toast('浏览器存储已满，请导出源码包以保留修改。'); return false; }
  }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(workspaceKey));
      if (saved?.schemaVersion !== 2 || !validProject(saved.project)) return;
      state.project = saved.project; state.projectId = saved.projectId; state.file = Object.keys(saved.project.files).find(name => name.endsWith('.js')) || saved.project.entry;
      state.rules = Array.isArray(saved.rules) ? saved.rules : [];
      state.watches = new Set(Array.isArray(saved.watches) ? saved.watches : []);
    } catch { /* Invalid saved workspaces never replace the usable default project. */ }
  }
  function shell() {
    $('#root').innerHTML = `<div class="ide"><nav class="activity" aria-label="工具"><button class="mark" data-action="home" title="Aftercode">a</button><button class="activity-button active" data-action="files" title="文件">${icon('files')}</button><button class="activity-button" data-action="history" title="运行历史">${icon('history')}</button><button class="activity-button" data-action="compare" title="比较运行">${icon('compare')}</button><div class="flex"></div><button class="activity-button" data-action="research" title="设计研究">${icon('spark')}</button><button class="activity-button" data-action="about" title="接入与边界">${icon('info')}</button></nav><aside class="explorer"><div class="explorer-heading"><span>工作区</span><button class="icon-button" data-action="project" aria-label="打开项目">${icon('folder')}</button></div><button class="project-name" data-action="project">${icon('folder')}<span id="project-name"></span><span class="chevron">⌄</span></button><div id="file-tree"></div><button class="new-file" data-action="new-file">${icon('plus')}新建文件</button><div class="explorer-foot"><span class="small-dot"></span>本地运行</div></aside><div class="workarea"><header class="ide-header"><div class="project-crumb"><button id="header-name" data-action="project" title="打开或切换项目"></button><span class="slash">/</span><button id="branch-name" data-action="history">主线</button><span id="dirty-mark"></span></div><div class="header-actions">${button('experiment', '新建实验', 'branch', 'quiet')}${button('run', '运行', 'run', 'primary', 'id="run-button"')}</div></header><div class="mobile-tabs"><button data-action="mobile-files">代码</button><button data-action="mobile-preview" class="active">预览</button><button data-action="mobile-inspector">检查</button></div><div class="workbody"><main class="stage"><div class="stage-toolbar"><div class="view-tabs"><button data-action="mode-preview" title="预览">${icon('preview')}预览</button><button data-action="mode-code" title="代码">${icon('code')}代码</button><button data-action="mode-split" title="分屏">${icon('split')}分屏</button></div><div class="stage-tools"><button id="selection-button" data-action="select" title="选择页面元素">${icon('select')}选择</button><button data-action="pause" title="请求在下一个已接入边界暂停">${icon('pause')}</button><button data-action="export" title="导出调查包">${icon('download')}</button></div></div><div id="pause-slot"></div><div id="stage-content" class="stage-content"><section class="editor-pane"><div class="file-tab"><span class="file-dot"></span><button id="active-file" data-action="file-list" title="切换文件"></button><span id="file-language"></span></div><div class="editor-surface"><div class="line-numbers" aria-hidden="true"></div><textarea id="code-editor" aria-label="源代码编辑器" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea></div><div class="editor-status"><span id="editor-position">UTF-8</span><button data-action="download-source">下载项目</button></div></section><section class="preview-pane"><div class="preview-chrome"><span><i></i><i></i><i></i></span><span id="preview-address"></span><button data-action="run" title="重新运行">↻</button></div><div id="frame-host"></div></section></div><section id="bottom-panel" class="bottom-panel"><div class="panel-heading"><div class="panel-tabs"><button data-action="panel-events">运行记录 <span id="event-count">0</span></button><button data-action="panel-console">控制台 <span id="console-count">0</span></button></div><button class="panel-toggle" data-action="panel-toggle" aria-label="展开或收起记录">⌃</button></div><div id="panel-content"></div></section></main><aside id="inspector" class="inspect" aria-label="对象检查器"></aside></div><footer class="ide-status"><span id="run-status"><i class="small-dot"></i>准备中</span><span id="status-meta">Aftercode / 本地原型</span></footer></div></div><input id="folder-input" type="file" webkitdirectory multiple hidden><input id="package-input" type="file" accept=".json,application/json" hidden>`;
    const editor = $('#code-editor');
    editor.addEventListener('input', () => { state.project.files[state.file] = editor.value; state.dirty = true; persist(); updateFileNumbers(); updateChrome(); });
    editor.addEventListener('scroll', () => { $('.line-numbers').scrollTop = editor.scrollTop; });
    editor.addEventListener('keydown', event => {
      if (event.key === 'Tab') { event.preventDefault(); const start = editor.selectionStart; editor.setRangeText('  ', start, editor.selectionEnd, 'end'); editor.dispatchEvent(new Event('input')); }
    });
    $('#folder-input').addEventListener('change', importFolder);
    $('#package-input').addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 8_000_000) { toast('源码包不能超过 8MB。'); return; }
      try { const data = JSON.parse(await file.text()); const project = data.project || data; if (!validProject(project)) throw new Error('源码包格式无效。'); await loadProject(project); }
      catch (error) { toast(error.message); }
      event.target.value = '';
    });
    updateFiles(); updateChrome(); updateInspector();
  }
  function updateFileNumbers() { $('.line-numbers').textContent = state.project.files[state.file].split('\n').map((_, i) => i + 1).join('\n'); }
  function updateFiles() {
    $('#file-tree').innerHTML = Object.keys(state.project.files).map(name => `<button class="file-item ${state.file === name ? 'active' : ''}" data-action="open-file" data-file="${esc(name)}"><span class="file-type ${name.endsWith('.js') ? 'js' : name.endsWith('.css') ? 'css' : 'html'}">${name.endsWith('.js') ? 'JS' : name.endsWith('.css') ? '#' : '‹›'}</span><span>${esc(name)}</span></button>`).join('');
    $('#active-file').textContent = state.file;
    $('#file-language').textContent = state.file.split('.').at(-1).toUpperCase();
    $('#code-editor').value = state.project.files[state.file]; updateFileNumbers();
  }
  function updateChrome() {
    if (!$('#project-name')) return;
    $('#project-name').textContent = state.project.name; $('#header-name').textContent = state.project.name;
    $('#branch-name').textContent = state.branch ? `实验 ${state.branch}` : '主线';
    $('#dirty-mark').textContent = state.dirty ? '未运行的修改' : '';
    $('#preview-address').textContent = `${state.project.name} / ${state.project.entry}`;
    $('#stage-content').className = `stage-content mode-${state.mode}`;
    $('.ide').dataset.mobile = state.mobile;
    document.querySelectorAll('.view-tabs button').forEach(el => el.classList.toggle('active', el.dataset.action === `mode-${state.mode}`));
    document.querySelectorAll('.mobile-tabs button').forEach(el => el.classList.toggle('active', el.dataset.action === `mobile-${state.mobile}`));
    $('#selection-button').classList.toggle('active', state.selecting);
    $('#run-button').title = state.dirty ? '运行已编辑的项目' : '创建新的独立运行';
    if (rt()) {
      $('#run-status').innerHTML = `<i class="small-dot ${rt().pending ? 'amber' : ''}"></i>${rt().pending ? '已暂停' : rt().control === 'requested' || rt().control === 'stepping' ? '等待下一控制点' : rt().ready ? '预览就绪' : '正在启动'}`;
      $('#status-meta').textContent = `run ${short(rt().id)}${state.dirty ? ' · 页面仍为上一次运行' : ''}`;
    }
  }
  function updatePause() {
    const run = rt(); if (!run) return;
    const pending = run.pending;
    $('#pause-slot').innerHTML = pending ? `<div class="pause-bar"><div><span class="pause-dot"></span><b>更新 ${esc(pending.proposal.selector)} 之前</b><span>待提交 <strong>${esc(JSON.stringify(pending.proposal.value))}</strong></span></div><div>${button('step', '这一步', 'step', 'small')}${button('continue', '继续', 'run', 'small primary')}</div></div>` : ['requested', 'stepping'].includes(run.control) ? `<div class="pause-bar waiting"><span>下一次已接入的更新前暂停</span><button data-action="continue">取消等待</button></div>` : '';
  }
  function updatePanel() {
    if (!rt()) return;
    $('#bottom-panel').classList.toggle('expanded', state.panel);
    $('#event-count').textContent = rt().events.length;
    $('#console-count').textContent = rt().console.length;
    document.querySelectorAll('.panel-tabs button').forEach(el => el.classList.toggle('active', el.dataset.action === `panel-${state.panelTab}`));
    const content = state.panelTab === 'console' ? rt().console.map(item => `<div class="log ${item.level === 'error' ? 'error' : ''}"><span>${esc(item.level)}</span><code>${esc(item.args.join(' '))}</code></div>`).join('') || '<div class="panel-empty">暂无控制台输出</div>' : rt().events.slice().reverse().map(event => `<button class="event-row" data-action="event" data-id="${event.id}"><time>${new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })}</time><span class="event-dot ${event.type}"></span><span>${esc(event.label)}</span><code>${esc(event.detail.selector || '')}</code></button>`).join('');
    $('#panel-content').innerHTML = content;
  }
  function observationsFor(selector, run = rt()) { return run.observations.filter(obs => obs.object === selector); }
  function evaluateRule(rule, observation, run = rt()) {
    if (!observation) return null;
    const actual = observation.value;
    const passed = C.compareValues(actual, rule.expected, rule.operator);
    if (passed == null) return null;
    return { id: C.uid('check'), runId: run.id, rule: C.clone(rule), expected: rule.expected, actual, passed, evidence: [observation.id], at: new Date().toISOString() };
  }
  function recordObservation(data) {
    const run = rt();
    const obs = run.observe(data.selector, data.value, data.source);
    if (state.selected?.selector === data.selector) state.selected = { ...state.selected, ...data };
    for (const rule of run.rule.rules.filter(rule => rule.selector === data.selector)) {
      const check = evaluateRule(rule, obs); if (check) run.checks.push(check);
    }
    if ((!run.replayingPlan && run.actions.length > 0 || run.replayDone) && run.predictions.some(prediction => prediction.selector === data.selector)) {
      run.predictions = run.predictions.map(prediction => prediction.selector === data.selector ? { ...prediction, observed: data.value, evidence: obs.id, result: data.value === prediction.value ? 'consistent' : 'conflict' } : prediction);
    }
    updateInspector(); updatePanel();
  }
  function updateInspector() {
    if (!$('#inspector')) return;
    const selected = state.selected;
    if (!selected || !rt()) {
      $('#inspector').innerHTML = `<div class="inspect-title">检查</div><div class="inspect-empty"><div class="selection-illustration">${icon('select')}</div><h2>哪里不太对？</h2><p>选中页面上的任何元素。</p>${button('select', '选择元素', 'select', 'primary')}</div><div class="inspect-empty-foot">${button('rule', '添加预期', 'plus', 'quiet small')}${button('watches', '观察列表', 'eye', 'quiet small')}</div>`;
      return;
    }
    const selector = selected.selector;
    const capability = rt().capabilities.find(cap => cap.selector === selector);
    const observations = observationsFor(selector);
    const previous = observations.length > 1 ? observations.at(-2).value : null;
    const rules = currentRules().filter(rule => rule.selector === selector);
    const check = rt().checks.filter(check => check.rule.selector === selector).at(-1);
    const prediction = rt().predictions.find(p => p.selector === selector);
    $('#inspector').innerHTML = `<div class="inspect-title"><span>检查</span><button class="icon-button" data-action="select" title="重新选择">${icon('select')}</button></div><div class="object-label"><span class="element-tag">${esc(selected.tag || 'DOM')}</span><h2>${esc(capability?.label || selector)}</h2></div><button class="object-selector" data-action="object-detail">${esc(selector)} ↗</button><div class="observed-value"><span>当前值</span><strong>${esc(selected.value === '' ? '空' : selected.value)}</strong>${previous != null && previous !== selected.value ? `<small>上一次 ${esc(previous)}</small>` : ''}</div>${rules.length ? rules.map(rule => { const result = rt().checks.filter(item => item.rule.id === rule.id).at(-1); return `<div class="rule-result ${result?.passed ? 'passed' : result ? 'failed' : ''}"><div><span>${result ? result.passed ? '符合预期' : '与预期不同' : '尚未验证'}</span><button data-action="rule" data-rule="${rule.id}">修改</button></div><p>${{ equals: '等于', contains: '包含', greater: '大于', less: '小于' }[rule.operator]} <b>${esc(rule.expected)}</b></p></div>`; }).join('') : button('rule', '这个值应该是…', 'plus', 'expect-button')}<div class="object-actions">${button('watch', state.watches.has(selector) ? '已加入观察' : '持续观察', 'eye', state.watches.has(selector) ? 'active' : '')}${button('breakpoint', state.pauseTargets.has(selector) ? '取消暂停点' : '更新前停住', 'pause', state.pauseTargets.has(selector) ? 'active' : '', capability?.beforeCommit ? '' : 'disabled title="此对象未接入提交前钩子，仅能观察已发生的变化"')}</div>${!capability?.beforeCommit ? '<p class="capability-note">此对象仅支持观察</p>' : ''}${prediction ? `<div class="prediction-summary"><span>实验预测</span><b>${esc(prediction.value)}</b><small>${prediction.result === 'consistent' ? '与本次观察一致' : prediction.result === 'conflict' ? '与本次观察冲突' : '等待观察'}</small></div>` : ''}<div class="inspect-divider"></div><button class="inspect-link" data-action="object-history">${icon('history')}这个值怎样变化的<span>↗</span></button><button class="inspect-link" data-action="source">${icon('code')}查看相关代码<span>↗</span></button>${check?.passed === false ? `<button class="inspect-link agent-link" data-action="agent-task">${icon('spark')}交给 Agent 修正<span>↗</span></button>` : ''}<div class="inspect-flex"></div>${button('experiment', '在副本里试一下', 'branch', 'experiment-button')}${check?.passed ? '<p class="case-scope">只验证了当前值</p>' : ''}<button class="inspect-evidence" data-action="object-detail">${observations.length} 条观察 · 查看依据</button>`;
  }
  function refresh() { updateChrome(); updatePause(); updatePanel(); updateInspector(); window.dispatchEvent(new CustomEvent('aftercode:runtime-update')); }
  function escapeScript(text) { return text.replace(/<\/script/gi, '<\\/script'); }
  function resolveFile(from, target) {
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(target)) throw new Error(`不加载外部资源：${target}`);
    const parts = (target.startsWith('/') ? target.slice(1) : `${from.split('/').slice(0, -1).join('/')}/${target}`).split('/');
    const resolved = [];
    for (const part of parts) { if (!part || part === '.') continue; if (part === '..') resolved.pop(); else resolved.push(part); }
    return resolved.join('/');
  }
  function compile(project, runId) {
    const html = project.files[project.entry]; if (html == null) throw new Error(`入口不存在：${project.entry}`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const csp = doc.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
    csp.content = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
    doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"],base').forEach(el => el.remove());
    for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
      const file = resolveFile(project.entry, link.getAttribute('href'));
      if (project.files[file] == null) throw new Error(`样式文件不存在：${file}`);
      const style = doc.createElement('style'); style.textContent = project.files[file]; link.replaceWith(style);
    }
    for (const script of doc.querySelectorAll('script[src]')) {
      const file = resolveFile(project.entry, script.getAttribute('src'));
      if (project.files[file] == null) throw new Error(`脚本文件不存在：${file}`);
      if (script.type === 'module' || /(^|\n)\s*(import |export )/m.test(project.files[file])) throw new Error('当前本地预览支持普通 HTML/CSS/JS；ES modules 与构建工具需要运行适配器。');
      script.removeAttribute('src'); script.removeAttribute('defer'); script.removeAttribute('async'); script.textContent = escapeScript(project.files[file]);
    }
    const bridge = doc.createElement('script'); bridge.textContent = `(${AftercodeBridge.toString()})(${JSON.stringify(runId)});`;
    doc.head.prepend(bridge); doc.head.prepend(csp);
    return '<!doctype html>\n' + doc.documentElement.outerHTML;
  }
  function archive() {
    if (!rt()) return;
    const old = rt(); old.onChange = () => {};
    if (old.pending) old.cancel();
    state.history.push(snapshot(old)); old.cancel();
    for (const entry of state.ack.values()) entry.reject(new C.Cancelled());
    state.ack.clear();
  }
  async function runProject({ predictions = [], replay = false, actions, parent = state.parent, pause = false } = {}) {
    if (state.project.runtime && state.project.runtime !== 'web') { window.dispatchEvent(new CustomEvent('aftercode:run-request')); return null; }
    let compiled;
    const run = new C.Runtime({ app: 'web', version: 'workspace', input: { entry: state.project.entry }, rule: { rules: C.clone(currentRules()) }, parent, onChange: refresh });
    run.files = C.clone(state.project.files); run.projectId = state.projectId; run.projectName = state.project.name; run.entry = state.project.entry;
    run.actions = []; run.capabilities = []; run.console = []; run.branch = state.branch; run.ready = false; run.predictions = C.clone(predictions); run.replayingPlan = !!(replay && actions?.length); run.replayDone = false;
    try { compiled = compile(state.project, run.id); }
    catch (error) { toast(error.message); state.importError = error.message; return null; }
    if (state.ready && state.rt && !state.rt.ready) state.ready.reject(new C.Cancelled());
    archive(); state.rt = run; state.dirty = false; state.selecting = false;
    if (pause) run.requestPause();
    run.event('start', parent ? '启动实验副本' : '启动应用', { entry: run.entry, fileNames: Object.keys(run.files), branch: run.branch });
    const ready = new Promise((resolve, reject) => { state.ready = { resolve, reject, runId: run.id }; });
    const frame = document.createElement('iframe'); frame.id = 'preview-frame'; frame.title = '应用预览'; frame.setAttribute('sandbox', 'allow-scripts');
    frame.srcdoc = compiled; $('#frame-host').replaceChildren(frame);
    refresh();
    const timer = setTimeout(() => { if (!run.ready && !run.cancelled) { toast('应用未就绪，请查看控制台。'); state.ready?.reject(new Error('应用启动超时')); } }, 6000);
    try {
      await ready; clearTimeout(timer);
      for (const selector of state.watches) post('observe', { selector });
      for (const rule of run.rule.rules) post('observe', { selector: rule.selector });
      if (state.selected?.selector) post('inspect', { selector: state.selected.selector });
      if (replay && actions?.length) { run.actions = C.clone(actions); run.event('replay', `重放 ${actions.length} 个操作`, { actions }); post('replay', { actions }); }
      return run;
    } catch (error) { clearTimeout(timer); if (!(error instanceof C.Cancelled)) { run.console.push({ level: 'error', args: [error.message] }); refresh(); } return null; }
  }
  window.addEventListener('message', async event => {
    const message = event.data;
    if (!rt() || event.source !== $('#preview-frame')?.contentWindow || message?.channel !== 'aftercode' || message.runId !== rt().id) return;
    const { kind, data } = message; const run = rt();
    if (kind === 'ready') { run.ready = true; run.status = 'idle'; run.event('ready', '页面就绪'); state.ready?.resolve(run); }
    if (kind === 'capability') { run.capabilities.push(data); updateInspector(); }
    if (kind === 'selected') {
      const previous = state.selected?.selector;
      if (previous && previous !== data.selector && !state.watches.has(previous) && !currentRules().some(rule => rule.selector === previous)) post('unwatch', { selector: previous });
      state.selected = data; state.selecting = false; if (innerWidth < 700) state.mobile = 'inspector'; refresh();
    }
    if (kind === 'observation') recordObservation(data);
    if (kind === 'action') { run.actions.push(data); run.event('action', data.type === 'click' ? `点击 ${data.selector}` : `输入 ${data.selector}`, data); }
    if (kind === 'console') { run.console.push({ ...data, at: new Date().toISOString() }); if (data.level === 'error') state.panel = true; updatePanel(); }
    if (kind === 'missing') { if (state.selected?.selector === data.selector) { state.selected = null; updateInspector(); } run.event('missing', `对象不存在 ${data.selector}`, data); }
    if (kind === 'replayed') {
      run.replayDone = true;
      run.predictions = run.predictions.map(prediction => {
        const obs = observationsFor(prediction.selector).at(-1);
        return obs ? { ...prediction, observed: obs.value, evidence: obs.id, result: obs.value === prediction.value ? 'consistent' : 'conflict' } : prediction;
      });
      run.event('replay', `重放完成 · ${data.count} 个操作`); toast('操作已在副本中重新执行。');
    }
    if (kind === 'replay-error') { run.replayError = data.message; run.event('error', data.message); toast(data.message); }
    if (kind === 'committed' || kind === 'commit-error') {
      const ack = state.ack.get(data.id); if (!ack) return;
      state.ack.delete(data.id);
      if (kind === 'commit-error') ack.reject(new Error(data.message)); else ack.resolve(data.observation);
    }
    if (kind === 'boundary') {
      const targetBreakpoint = state.pauseTargets.has(data.selector);
      if (targetBreakpoint) run.requestPause();
      try {
        let observation;
        await run.boundary(data.label, data, async () => {
          const complete = new Promise((resolve, reject) => state.ack.set(data.id, { resolve, reject }));
          post('permit', { id: data.id }); observation = await complete;
        });
        if (!run.cancelled && observation) recordObservation(observation);
      } catch (error) {
        if (!(error instanceof C.Cancelled) && !run.cancelled) { run.console.push({ level: 'error', args: [error.message] }); state.panel = true; refresh(); }
      }
    }
  });
  function modal(title, body, footer = '', wide = false) {
    $('#modal-root').innerHTML = `<div class="dialog-shade"><section class="dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header><h2 id="dialog-title">${title}</h2><button data-action="close" class="icon-button" aria-label="关闭">${icon('close')}</button></header><div class="dialog-body">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</section></div>`;
    requestAnimationFrame(() => $('.dialog [data-action="close"]')?.focus());
  }
  function open(name, data = {}) { state.focusReturn = document.activeElement; state.modal = { name, ...data }; drawModal(); }
  function close() { state.modal = null; $('#modal-root').innerHTML = ''; if (state.focusReturn?.isConnected) state.focusReturn.focus(); else $('#run-button').focus(); }
  function errorInForm(error) { $('#form-error').textContent = error.message || String(error); }
  function drawModal() {
    const selection = state.selected; const name = state.modal.name;
    if (name === 'files') {
      modal('文件', `<div class="sample-list">${Object.keys(state.project.files).map(file => `<button data-action="source-file" data-file="${esc(file)}">${icon('code')}<span>${esc(file)}</span>↗</button>`).join('')}</div>`);
    }
    if (name === 'project') {
      modal('打开项目', `${button('import', '选择本地文件夹', 'folder', 'full')}${button('import-package', '导入源码包', 'code', 'full quiet')}<p class="dialog-note">本地静态 HTML / CSS / JS。文件只在浏览器中处理。</p><div class="dialog-divider"></div><div class="section-label">或从一个示例开始</div><div class="sample-list">${Object.entries(AftercodeProjects).map(([id, project]) => `<button data-action="load-sample" data-project="${id}">${icon('folder')}<span>${project.name}</span><small>${esc(project.description || (project.runtime === 'python' ? 'Python' : project.runtime === 'node' ? 'Node.js' : 'Web 项目'))}</small>↗</button>`).join('')}</div>`, '<span class="dialog-note">有构建步骤的工程需另接运行适配器</span>');
    }
    if (name === 'new-file') modal('新建文件', '<label class="field">文件路径<input id="new-file-path" placeholder="utils.js"></label><div id="form-error" role="alert"></div>', button('create-file', '创建', 'plus', 'primary'));
    if (name === 'rule') {
      const rule = state.rules.find(rule => rule.id === state.modal.rule);
      modal('这个值应该怎样？', `<label class="field">页面元素<input id="rule-selector" value="${esc(rule?.selector || selection?.selector || '')}" placeholder="#result"></label><div class="form-row"><label class="field">判断方式<select id="rule-operator">${[['equals', '等于'], ['contains', '包含'], ['greater', '大于（数字）'], ['less', '小于（数字）']].map(([value, label]) => `<option value="${value}" ${rule?.operator === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field flex">预期值<input id="rule-expected" value="${esc(rule?.expected || '')}" placeholder="例如：1"></label></div><div id="form-error" role="alert"></div><p class="dialog-note">保存判断标准，不会改变程序。旧运行保留原规则。</p>`, `<div>${rule ? button('delete-rule', '删除', '', 'quiet', `data-rule="${rule.id}"`) : ''}</div>${button('save-rule', '保存并检查当前值', 'check', 'primary')}`);
    }
    if (name === 'experiment') {
      const actions = rt()?.actions || [];
      modal('在副本里试一下', `<div class="branch-diagram"><span>当前运行</span>${icon('branch')}<b>实验 ${state.branch + 1}</b></div><p class="dialog-note">复制当前文件，新页面独立运行。可以改代码，也可以改变操作。</p><div class="experiment-options"><label><input type="checkbox" id="replay-actions" ${actions.length ? 'checked' : ''} ${actions.length ? '' : 'disabled'}>重放刚才的 ${actions.length} 个操作</label><label><input type="checkbox" id="pause-first">第一次更新前暂停</label></div><details class="prediction-details"><summary>记下你的解释与预测（可选）</summary><label class="field">你认为原因是什么？<textarea id="exp-hypothesis" placeholder="一个可以验证的解释"></textarea></label><label class="field">观察对象<input id="exp-selector" value="${esc(selection?.selector || '')}" placeholder="#result"></label><label class="field">重放后，你预测它是<input id="exp-prediction" placeholder="填写一个实际可比较的值"></label></details><div id="form-error" role="alert"></div>`, `<span class="dialog-note">不改写原运行</span>${button('create-experiment', '创建副本', 'branch', 'primary')}`);
    }
    if (name === 'history') {
      modal('运行历史', `<div class="history-list">${runs().slice().reverse().map(run => `<article><div><b>${esc(run.projectName)} <small>${run.branch ? `实验 ${run.branch}` : '主线'}</small></b><p>${short(run.id)} · ${run.observations.length} 条观察 · ${run.actions.length} 个操作</p></div><div>${button('view-run', '查看', '', 'small', `data-run="${run.id}"`)}${button('restore-run', '载入副本', '', 'small', `data-run="${run.id}"`)}</div></article>`).join('')}</div>`, button('compare', '比较运行', 'compare', 'primary'));
    }
    if (name === 'view-run') {
      const run = runs().find(run => run.id === state.modal.run);
      modal(`运行 ${short(run.id)}`, `<div class="dialog-note">历史 · 只读</div><div class="observation-list">${run.observations.map(obs => `<article><code>${esc(obs.object)}</code><b>${esc(obs.value)}</b><small>${esc(obs.source)} · ${new Date(obs.at).toLocaleTimeString('zh-CN')}</small></article>`).join('') || '<p class="dialog-note">这次运行没有记录对象观察。</p>'}</div>`, button('export', '导出完整记录', 'download', 'quiet'));
    }
    if (name === 'compare') { drawCompare(); }
    if (name === 'object-detail' || name === 'object-history') {
      const selector = selection?.selector;
      const obs = selector ? observationsFor(selector) : [];
      modal(name === 'object-history' ? '这个值怎样变化的' : '观察依据', `<code class="selector-pill">${esc(selector)}</code><div class="observation-list">${obs.map(item => `<article><div><span class="small-dot"></span><b>${esc(item.value)}</b></div><small>${new Date(item.at).toLocaleTimeString('zh-CN', { hour12: false })} · revision ${item.revision} · ${esc(item.source)}</small><code>${item.id}</code></article>`).join('') || '<p class="dialog-note">尚无观察</p>'}</div>${selection?.attributes ? `<details><summary>元素属性</summary><pre>${esc(JSON.stringify(selection.attributes, null, 2))}</pre></details>` : ''}`, button('watch', '持续观察', 'eye', 'quiet'));
    }
    if (name === 'event') {
      const event = rt().events.find(event => event.id === state.modal.id);
      modal(event.label, `<p class="dialog-note">${event.type} · ${new Date(event.at).toLocaleString('zh-CN')}</p><pre class="json-view">${esc(JSON.stringify(event.detail, null, 2))}</pre>`);
    }
    if (name === 'watches') {
      modal('观察列表', `<div class="watch-list">${[...state.watches].map(selector => `<article><code>${esc(selector)}</code><span>${esc(observationsFor(selector).at(-1)?.value ?? '未观察到')}</span><button class="icon-button" data-action="remove-watch" data-selector="${esc(selector)}" aria-label="移除 ${esc(selector)}">${icon('close')}</button></article>`).join('') || '<p class="dialog-note">选择页面元素后，可以把它加入这里。</p>'}</div>`);
    }
    if (name === 'source') {
      const selector = selection?.selector || '';
      const names = Object.entries(state.project.files).filter(([, text]) => text.includes(selector) || selector.startsWith('#') && text.includes(selector.slice(1)));
      modal('可能相关的代码', `<div class="dialog-note">按选择器检索，不代表已确认因果关系。</div><div class="sample-list">${names.map(([file]) => `<button data-action="source-file" data-file="${esc(file)}">${icon('code')}<span>${esc(file)}</span>↗</button>`).join('') || '<p class="dialog-note">没有找到直接引用，可以在文件树中继续查看。</p>'}</div>`);
    }
    if (name === 'agent-task') {
      const check = rt().checks.filter(check => check.rule.selector === selection?.selector).at(-1);
      const task = `修正项目 ${state.project.name} 的行为偏差。\n\n运行：${rt().id}\n对象：${selection?.selector}\n实际观察：${selection?.value}\n预期：${check ? `${check.rule.operator} ${check.expected}` : '请补充'}\n\n请先复现，不要仅改判断标准。给出修改及影响范围，并用同一组操作重验。保留本次输入与证据，不把一个案例通过当作整体正确。\n\n原始证据、源文件、已记录操作与规则版本见随附调查包。`;
      modal('修复任务', `<label class="field">给 Agent 的任务<textarea id="agent-task" style="min-height:230px">${esc(task)}</textarea></label><p class="dialog-note">尚未连接模型。复制到你的 coding agent，并附上调查包。</p>`, `${button('export', '导出调查包', 'download', 'quiet')}${button('copy-task', '复制任务', 'code', 'primary')}`);
    }
    if (name === 'about') {
      modal('接入与边界', `<div class="about-grid"><section><h3>不需要接入</h3><p>任意页面元素的选择、DOM 观察、预期检查、控制台、文件编辑、独立运行与对比。</p></section><section><h3>需要一个钩子</h3><p>真正的提交前暂停、单步与异步操作重放。</p><pre class="code-example">debug.expose('#result', { beforeCommit: true });
await debug.commit('#result', next, () => {
  result.textContent = next;
});</pre></section><section><h3>当前运行范围</h3><p>静态 HTML / CSS / 普通 JavaScript。支持导入目录；无远端模型或自动修复。Node、Python、原生应用、ES modules、npm 构建工程需要另接运行适配器，当前未实现。</p></section><section><h3>隔离方式</h3><p>预览运行在独立 sandbox iframe，不开放父页面或网络访问。不是通用恶意代码执行平台；只运行可信本地项目。</p></section></div>`, button('research', '设计依据', 'spark', 'quiet'), true);
    }
    if (name === 'research') drawResearch();
  }
  function drawCompare() {
    const compatible = runs().filter(run => run.projectId === state.projectId);
    const left = compatible.find(run => run.id === state.modal.left) || compatible.at(-2) || compatible[0];
    const right = compatible.find(run => run.id === state.modal.right) || compatible.at(-1);
    const selectors = [...new Set([...left.observations, ...right.observations].map(obs => obs.object))];
    const option = selected => compatible.map(run => `<option value="${run.id}" ${run.id === selected.id ? 'selected' : ''}>${run.branch ? `实验 ${run.branch}` : '主线'} / ${short(run.id)}</option>`).join('');
    const changed = [...new Set([...Object.keys(left.files), ...Object.keys(right.files)])].filter(file => left.files[file] !== right.files[file]);
    modal('比较两次运行', `${compatible.length < 2 ? '<p class="dialog-note notice">先运行一次实验，才会有不同的记录。</p>' : ''}<div class="form-row"><label class="field flex">基线<select id="compare-left">${option(left)}</select></label><label class="field flex">对照<select id="compare-right">${option(right)}</select></label></div><table class="compare-table"><thead><tr><th>对象</th><th>基线</th><th>对照</th></tr></thead><tbody>${selectors.map(selector => { const a = left.observations.filter(o => o.object === selector).at(-1)?.value; const b = right.observations.filter(o => o.object === selector).at(-1)?.value; return `<tr class="${a !== b ? 'changed' : ''}"><td><code>${esc(selector)}</code></td><td>${esc(a ?? '未观察')}</td><td>${esc(b ?? '未观察')}</td></tr>`; }).join('')}</tbody></table><div class="compare-meta"><p>变更文件 <b>${esc(changed.join(', ') || '无')}</b></p><p>操作数 <b>${left.actions.length} / ${right.actions.length}</b></p><p>规则检查 <b>${left.checks.filter(c => c.passed).length}/${left.checks.length} / ${right.checks.filter(c => c.passed).length}/${right.checks.length}</b></p></div><p class="dialog-note">这是两次运行的差异，不是对所有输入的正确性证明。</p>`, button('export', '导出依据', 'download', 'quiet'), true);
  }
  function drawResearch() {
    modal('从编辑代码，到校准行为', `<div class="research-lead">IDE 不会只是少一个编辑器。<br>它需要让人更容易判断：<em>做出来的，是不是我想要的？</em></div><div class="research-principles"><article><span>01</span><h3>入口是问题，不是变量名</h3><p>先使用程序，直接指出异常。需要时再下钻到对象、观察与代码。</p></article><article><span>02</span><h3>自然语言之外，需要证据</h3><p>意图变成独立规则；解释先写预测，再用新的运行检验。</p></article><article><span>03</span><h3>控制应真实，而非像在控制</h3><p>没有提交前接入，就只承诺观察。执行、规则结果和人的认可不能混为一谈。</p></article></div><div class="section-label">设计依据 · 不是对本产品的效果背书</div><div class="research-sources">${[
      ['Microsoft Research · CHI 2019', 'Guidelines for Human-AI Interaction', 'https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/', '通用指导：能力边界、纠错与人的控制。'],
      ['Google PAIR', 'People + AI Guidebook', 'https://pair.withgoogle.com/guidebook/', '设计指南：心智模型、反馈与控制。'],
      ['Ben Shneiderman · 1983', 'Direct Manipulation', 'https://www.cs.umd.edu/~ben/papers/Shneiderman1983Direct.pdf', '理论基础：可见对象、增量反馈与可逆操作。'],
      ['Bret Victor · 2012', 'Learnable Programming', 'https://worrydream.com/LearnableProgramming/', '设计论述：看见状态与执行，而不只是语法。'],
      ['METR · 2025 / 2026', 'Developer productivity research', 'https://metr.org/blog/2026-02-24-uplift-update/', '2025 年特定样本下用时增加 19%；2026 后续承认选择偏差，不能作为当前普遍效果结论。'],
      ['Microsoft · VS Code', 'Reviewing and controlling agent changes', 'https://code.visualstudio.com/learn/foundations/reviewing-and-controlling-agent-changes', '现有产品机制：审查、撤销和检查点。'],
      ['Anthropic', 'Best practices for Claude Code', 'https://code.claude.com/docs/en/best-practices', '厂商实践：用可执行检查和确定性机制约束代理。']
    ].map(([org, title, url, detail]) => `<article><small>${org}</small><a href="${url}" target="_blank" rel="noreferrer">${title} ↗</a><p>${detail}</p></article>`).join('')}</div><p class="dialog-note notice">这里验证的是交互是否真实可用，不是用户效率已提升。真人试用尚未开展。</p>`, button('close', '回到工作区', 'arrow', 'primary'), true);
  }
  async function importFolder(event) {
    const files = [...event.target.files]; if (!files.length) return;
    const textFiles = files.filter(file => /\.(html?|css|[cm]?js|py|json|txt|md)$/i.test(file.name));
    if (!textFiles.length) { toast('未找到 HTML / CSS / JS 文件。'); return; }
    if (textFiles.some(file => file.size > 2_000_000) || textFiles.reduce((n, f) => n + f.size, 0) > 8_000_000) { toast('当前预览限制：单文件 2MB，文本总量 8MB。'); return; }
    const project = { name: files[0].webkitRelativePath.split('/')[0], entry: '', files: {} };
    for (const file of textFiles) project.files[file.webkitRelativePath.split('/').slice(1).join('/')] = await file.text();
    project.entry = project.files['index.html'] != null ? 'index.html' : Object.keys(project.files).find(name => /\.html?$/i.test(name)) || Object.keys(project.files).find(name => /(?:main|app|index)\.(?:py|[cm]?js)$/i.test(name));
    if (!project.entry) { toast('需要 HTML、main.js 或 main.py 入口。'); return; }
    await loadProject(project);
  }
  async function loadProject(project) {
    try {
      if (window.AcceptanceDomain) project = AcceptanceDomain.normalizeProject(project);
      if ((!project.runtime || project.runtime === 'web') && !project.analysisOnly) compile(project, 'validation');
    } catch (error) { toast(error.message); return; }
    if (project.analysisOnly || project.runtime && project.runtime !== 'web') { archive(); state.rt = null; $('#frame-host').replaceChildren(); }
    close(); state.project = C.clone(project); state.projectId = C.uid('project'); state.file = Object.keys(project.files).find(name => /\.(?:js|py)$/.test(name)) || project.entry;
    state.selected = null; state.watches.clear(); state.pauseTargets.clear(); state.parent = null; state.branch = 0; state.mode = 'preview'; state.dirty = false;
    persist(); updateFiles(); updateChrome();
    if ((!project.runtime || project.runtime === 'web') && !project.analysisOnly) await runProject();
    window.dispatchEvent(new CustomEvent('aftercode:project-change'));
  }
  function download(content, name, type = 'application/json') {
    const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([content], { type })); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const exportData = () => ({ schemaVersion: 2, product: 'Aftercode generic web IDE prototype', exportedAt: new Date().toISOString(), activeRunId: rt().id, project: C.clone(state.project), projectId: state.projectId, rules: C.clone(state.rules), agentTasks: C.clone(state.handoffs), watches: [...state.watches], breakpoints: [...state.pauseTargets], runs: runs(), scope: { runtime: 'sandboxed static HTML/CSS/JavaScript', modelConnected: false, arbitraryBackendDebugging: false } });
  const actions = {
    home() { state.mobile = 'preview'; state.mode = 'preview'; updateChrome(); },
    files() { state.mode = state.mode === 'code' ? 'preview' : 'code'; state.mobile = 'files'; updateChrome(); },
    project: () => open('project'), import() { $('#folder-input').value = ''; $('#folder-input').click(); },
    'file-list': () => open('files'), 'import-package'() { $('#package-input').click(); },
    'load-sample': el => loadProject(AftercodeProjects[el.dataset.project]),
    'new-file': () => open('new-file'),
    'create-file'() {
      const path = $('#new-file-path').value.trim();
      if (!/^[\w\u4e00-\u9fff./-]+$/.test(path) || path.includes('..') || path.startsWith('/') || state.project.files[path] != null) return errorInForm('请输入新的相对文件路径。');
      state.project.files[path] = ''; state.file = path; state.mode = 'split'; state.dirty = true; persist(); close(); updateFiles(); updateChrome();
    },
    'open-file'(el) { state.file = el.dataset.file; if (state.mode === 'preview') state.mode = 'split'; state.mobile = 'files'; updateFiles(); updateChrome(); },
    'source-file'(el) { close(); actions['open-file'](el); },
    'mode-preview'() { state.mode = 'preview'; updateChrome(); }, 'mode-code'() { state.mode = 'code'; updateChrome(); }, 'mode-split'() { state.mode = 'split'; updateChrome(); },
    'mobile-files'() { state.mobile = 'files'; state.mode = 'code'; updateChrome(); }, 'mobile-preview'() { state.mobile = 'preview'; state.mode = 'preview'; updateChrome(); }, 'mobile-inspector'() { state.mobile = 'inspector'; updateChrome(); },
    run: () => runProject(),
    select() { state.selecting = !state.selecting; state.mode = state.mode === 'code' ? 'split' : state.mode; state.mobile = 'preview'; post('select-mode', { enabled: state.selecting }); updateChrome(); },
    pause() { rt().requestPause(); refresh(); }, step() { rt().step(); }, continue() { rt().continue(); },
    rule: el => open('rule', { rule: el.dataset.rule }),
    'save-rule'() {
      const selector = $('#rule-selector').value.trim(), expected = $('#rule-expected').value, operator = $('#rule-operator').value;
      if (!selector) return errorInForm('请选择或填写页面元素。');
      try { document.createDocumentFragment().querySelector(selector); } catch { return errorInForm('请输入有效的 CSS 选择器。'); }
      if (['greater', 'less'].includes(operator) && (!expected.trim() || !Number.isFinite(Number(expected)))) return errorInForm('数字比较需要有限数值。');
      const previous = state.rules.find(rule => rule.id === state.modal.rule);
      const rule = { id: C.uid('rule'), projectId: state.projectId, selector, expected, operator, revision: (previous?.revision || 0) + 1, at: new Date().toISOString() };
      if (previous) state.rules = state.rules.filter(rule => rule.id !== previous.id);
      state.rules.push(rule); persist();
      rt().rule.rules = C.clone(currentRules());
      const obs = observationsFor(selector).at(-1); const check = evaluateRule(rule, obs); if (check) rt().checks.push(check);
      post('observe', { selector }); close(); updateInspector();
    },
    'delete-rule'(el) { state.rules = state.rules.filter(rule => rule.id !== el.dataset.rule); rt().rule.rules = C.clone(currentRules()); persist(); close(); updateInspector(); },
    watch() { if (!state.selected) return; const selector = state.selected.selector; state.watches.add(selector); persist(); post('observe', { selector }); updateInspector(); toast('已持续观察'); },
    breakpoint() { const selector = state.selected?.selector; if (!selector) return; if (state.pauseTargets.has(selector)) state.pauseTargets.delete(selector); else state.pauseTargets.add(selector); updateInspector(); },
    watches: () => open('watches'), 'remove-watch'(el) { state.watches.delete(el.dataset.selector); persist(); post('unwatch', { selector: el.dataset.selector }); drawModal(); },
    'object-detail': () => open('object-detail'), 'object-history': () => open('object-history'), source: () => open('source'),
    experiment: () => open('experiment'),
    async 'create-experiment'() {
      const baseline = snapshot(rt());
      const replay = $('#replay-actions').checked, pause = $('#pause-first').checked;
      const selector = $('#exp-selector').value.trim(), value = $('#exp-prediction').value, hypothesis = $('#exp-hypothesis').value;
      const predictions = value !== '' && selector ? [{ id: C.uid('prediction'), selector, value, hypothesis, frozenAt: new Date().toISOString(), result: 'unobserved' }] : [];
      state.parent = baseline.id; state.branch++; close(); state.mode = 'split';
      await runProject({ parent: baseline.id, predictions, replay, actions: baseline.actions, pause });
    },
    history: () => open('history'), 'view-run': el => open('view-run', { run: el.dataset.run }),
    async 'restore-run'(el) {
      const baseline = runs().find(run => run.id === el.dataset.run); close(); state.project = { name: baseline.projectName, files: C.clone(baseline.files), entry: baseline.entry }; state.projectId = baseline.projectId; state.parent = baseline.id; state.branch++; state.selected = null; state.watches.clear(); state.pauseTargets.clear(); state.file = Object.keys(baseline.files)[0]; persist(); updateFiles(); await runProject({ parent: baseline.id });
    },
    compare: () => open('compare'),
    event: el => open('event', { id: el.dataset.id }),
    'panel-toggle'() { state.panel = !state.panel; updatePanel(); },
    'panel-events'() { state.panel = true; state.panelTab = 'events'; updatePanel(); },
    'panel-console'() { state.panel = true; state.panelTab = 'console'; updatePanel(); },
    export() { download(JSON.stringify(exportData(), null, 2), 'aftercode-investigation.json'); toast('调查包已导出'); },
    'download-source'() { download(JSON.stringify(state.project, null, 2), `${state.project.name}-source.json`); },
    'agent-task': () => open('agent-task'),
    async 'copy-task'() {
      const text = $('#agent-task').value;
      const task = { id: C.uid('task'), runId: rt().id, selector: state.selected?.selector, text, createdAt: new Date().toISOString() };
      state.handoffs.push(task);
      try { await navigator.clipboard.writeText(text); toast('任务已复制，请附上调查包。'); }
      catch { $('#agent-task').focus(); $('#agent-task').select(); toast('任务已选中，可按复制快捷键。'); }
    },
    research: () => open('research'), about: () => open('about'), close
  };
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
    const result = actions[el.dataset.action]?.(el); if (result?.catch) result.catch(error => { console.error(error); toast(error.message); });
  });
  document.addEventListener('change', event => {
    if (['compare-left', 'compare-right'].includes(event.target.id)) { state.modal.left = $('#compare-left').value; state.modal.right = $('#compare-right').value; drawCompare(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { if (state.modal) close(); else if (state.selecting) { state.selecting = false; post('select-mode', { enabled: false }); updateChrome(); } }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); runProject(); }
    if (state.modal && event.key === 'Tab') {
      const nodes = [...document.querySelectorAll('.dialog button:not(:disabled), .dialog input:not(:disabled), .dialog textarea, .dialog select, .dialog a, .dialog summary')];
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    }
  });
  function replaceProject(project) {
    if (!validProject(project)) throw new Error('修改后的项目结构无效');
    const previous = state.project;
    state.project = C.clone(project);
    if (!persist()) { state.project = previous; throw new Error('修改尚未应用：请先导出项目或释放浏览器存储空间'); }
    archive(); state.rt = null; state.selected = null; state.dirty = true;
    $('#frame-host').replaceChildren();
    if (!Object.hasOwn(state.project.files, state.file)) state.file = state.project.entry;
    updateFiles(); refresh();
  }
  window.Aftercode = { state, runProject, exportData, compile, snapshot, actions, post, evaluateRule, loadProject, refresh, toast, saveWorkspace: persist, replaceProject };
  restore(); shell(); runProject();
})();
