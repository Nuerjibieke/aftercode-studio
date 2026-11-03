'use strict';
const acorn = require('acorn');
const { spawn } = require('node:child_process');
const path = require('node:path');
const D = require('../domain/acceptance');
function analyzeJavaScript(project) {
  let activeColumnOffset = 0;
  const revision = D.revisionOf(project), nodes = [], edges = [], features = [], gaps = [], symbols = [], dependencies = [];
  const add = (file, ast, type, label, detail, extra = {}, offset = 0) => {
    if (nodes.length >= 700) return null;
    const node = { id: `n-${nodes.length + 1}`, type, label: label.slice(0, 100), detail, sourceRef: { revision, file, startLine: ast.loc.start.line + offset, endLine: ast.loc.end.line + offset, startColumn: ast.loc.start.column + (ast.loc.start.line === 1 ? activeColumnOffset : 0), endColumn: ast.loc.end.column + (ast.loc.end.line === 1 ? activeColumnOffset : 0) }, ...extra };
    nodes.push(node); return node;
  };
  const inputs = [];
  for (const [file, source] of Object.entries(project.files).sort(([a],[b]) => a.localeCompare(b))) {
    if (/\.(?:[cm]?js|jsx|tsx?)$/i.test(file)) inputs.push({ file, source, offset: 0 });
    else if (/\.html?$/i.test(file)) for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (!/\bsrc\s*=/.test(match[1]) && match[2].trim()) { const prefix = source.slice(0, match.index + match[0].indexOf('>') + 1); inputs.push({ file, source: match[2], offset: prefix.split('\n').length - 1, columnOffset: prefix.length - prefix.lastIndexOf('\n') - 1 }); }
    }
  }
  for (const { file, source, offset, columnOffset = 0 } of inputs) {
    activeColumnOffset = columnOffset;
    if (source.length > 500_000) { gaps.push({ file, message: '文件过大，未解析此文件的逻辑' }); continue; }
    let ast; try { if (/\.(?:jsx|tsx?)$/i.test(file)) ast = require('@babel/parser').parse(source, { sourceType: 'unambiguous', plugins: ['estree', ...(/tsx?$/.test(file) ? ['typescript', 'decorators-legacy'] : []), ...(/(?:jsx|tsx)$/.test(file) ? ['jsx'] : [])] }).program; else ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true }); }
    catch (error) { gaps.push({ file, message: `无法解析：${error.message}` }); continue; }
    const text = node => source.slice(node.start, node.end);
    const conditionText = node => node?.type === 'BinaryExpression' && ({ '>':'大于', '>=':'不小于', '<':'小于', '<=':'不大于', '===':'严格等于', '!==':'不严格等于' })[node.operator] ? `${text(node.left)} ${{ '>':'大于', '>=':'不小于', '<':'小于', '<=':'不大于', '===':'严格等于', '!==':'不严格等于' }[node.operator]} ${text(node.right)}` : text(node);
    const names = new Map(), functionNodes = new Map(), variableSelectors = new Map(), frameworkBindings = new Set(), routeObjects = new Set(), objectLabels = new Map();
    for (const statement of ast.body || []) {
      if (statement.type === 'ImportDeclaration' && ['express','fastify','koa-router','@koa/router'].includes(statement.source.value)) for (const spec of statement.specifiers) frameworkBindings.add(spec.local.name);
      if (statement.type === 'VariableDeclaration') for (const declaration of statement.declarations) if (declaration.id.type === 'Identifier' && declaration.init?.type === 'CallExpression' && declaration.init.callee.name === 'require' && ['express','fastify','koa-router','@koa/router'].includes(declaration.init.arguments[0]?.value)) frameworkBindings.add(declaration.id.name);
    }
    const literal = node => node?.type === 'Literal' ? String(node.value) : null;
    const memberName = node => node?.type === 'MemberExpression' ? node.computed ? literal(node.property) : node.property?.name : null;
    const selectorOf = node => {
      if (node?.type === 'Identifier') return variableSelectors.get(node.name);
      if (node?.type === 'CallExpression' && ['querySelector', 'getElementById'].includes(memberName(node.callee))) {
        const value = literal(node.arguments[0]); return value && (memberName(node.callee) === 'getElementById' ? `#${value}` : value);
      }
      return undefined;
    };
    const walk = (node, parent, owners = [], branch = null) => {
      if (!node || typeof node.type !== 'string') return;
      let extracted;
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
        const selector = selectorOf(node.init); if (selector) variableSelectors.set(node.id.name, selector);
        if (['CallExpression','NewExpression'].includes(node.init?.type) && (frameworkBindings.has(node.init.callee.name) || node.init.callee.type === 'MemberExpression' && frameworkBindings.has(node.init.callee.object?.name) && node.init.callee.property?.name === 'Router')) routeObjects.add(node.id.name);
        if (node.init && (['BinaryExpression', 'LogicalExpression', 'ConditionalExpression'].includes(node.init.type) || node.init.type === 'CallExpression' && node.init.callee.type === 'MemberExpression' && node.init.callee.object?.name === 'Math')) extracted = add(file, node, 'calculation', `计算：${text(node.init)}`, text(node), {}, offset);
      }
      if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
        const name = node.id?.name || (parent?.type === 'VariableDeclarator' ? text(parent.id) : ['MethodDefinition','Property'].includes(parent?.type) ? parent.key?.name || '回调' : '回调');
        extracted = add(file, node, 'function', name, text(node).slice(0, 5000), {}, offset);
        if (extracted) { names.set(name, extracted); functionNodes.set(node, extracted); symbols.push({ name, sourceRef: extracted.sourceRef }); }
      }
      if (['IfStatement', 'ConditionalExpression', 'SwitchStatement'].includes(node.type)) extracted = add(file, node.test || node.discriminant || node, 'condition', `判断：${conditionText(node.test || node.discriminant || node)}`, text(node.test || node.discriminant || node), {}, offset);
      if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
        const target = node.left || node.argument;
        const eventProperty = memberName(target), selector = selectorOf(target?.object);
        if (selector && /^on[a-z]+$/.test(eventProperty || '') && ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.right?.type)) {
          const event = eventProperty.slice(2);
          extracted = add(file, node, 'trigger', `${selector} · ${event}`, text(node), { selector }, offset);
          if (extracted) features.push({ id: `f-${features.length + 1}`, title: `${selector} 的 ${event}`, description: '由代码入口提取，业务含义尚待确认', trigger: { selector, event }, nodeIds: [extracted.id], sourceRefs: [extracted.sourceRef], _start: node.start, _end: node.end, _file: file });
        } else extracted = add(file, node, 'state', `更新 ${text(target)}`, text(node), { selector }, offset);
      }
      if (node.type === 'ReturnStatement') extracted = add(file, node, 'output', '返回结果', text(node), {}, offset);
      if (node.type === 'AwaitExpression') extracted = add(file, node, 'effect', '等待异步结果', text(node).slice(0, 1000), {}, offset);
      if (node.type === 'CallExpression') {
        const method = memberName(node.callee);
        if (method === 'expose' && text(node.callee.object) === 'debug' && node.arguments[1]?.type === 'ObjectExpression') { const label = node.arguments[1].properties.find(property => (property.key?.name || property.key?.value) === 'label')?.value?.value; const selector = literal(node.arguments[0]); if (selector && typeof label === 'string') objectLabels.set(selector, label); }
        if (['get','post','put','patch','delete','head','options','use'].includes(method) && routeObjects.has(node.callee.object?.name) && literal(node.arguments[0])?.startsWith('/')) {
          const routePath = literal(node.arguments[0]);
          extracted = add(file, node, 'trigger', `${method === 'use' ? '挂载' : method.toUpperCase()} ${routePath}`, text(node).slice(0,5000), { routePath, method }, offset);
          if (extracted) features.push({ id: `f-${features.length + 1}`, title: `${method === 'use' ? '挂载' : method.toUpperCase()} ${routePath}`, description: '由框架路由注册语句提取，运行行为仍需验证', trigger: { kind: method === 'use' ? 'mount' : 'http', method: method.toUpperCase(), path: routePath }, nodeIds: [extracted.id], sourceRefs: [extracted.sourceRef], _start: node.start, _end: node.end, _file: file });
        } else if (['addEventListener', 'on', 'once'].includes(method) && literal(node.arguments[0])) {
          const selector = selectorOf(node.callee.object), event = literal(node.arguments[0]);
          extracted = add(file, node, 'trigger', `${selector || text(node.callee.object)} · ${event}`, text(node).slice(0, 5000), { selector }, offset);
          if (extracted) features.push({ id: `f-${features.length + 1}`, title: selector ? `${selector} 的 ${event}` : `${text(node.callee.object)} / ${event}`, description: '由代码入口提取，业务含义尚待确认', trigger: { selector, event }, nodeIds: [extracted.id], sourceRefs: [extracted.sourceRef], _start: node.start, _end: node.end, _file: file });
        } else if (method === 'commit' && text(node.callee.object) === 'debug') {
          const selector = literal(node.arguments[0]); extracted = add(file, node, 'effect', `更新${objectLabels.has(selector) ? '“' + objectLabels.get(selector) + '”' : selector || '状态'}`, text(node).slice(0, 5000), { selector, objectLabel: objectLabels.get(selector), evidenceType: 'commit-boundary' }, offset);
        } else if (method === 'log' && text(node.callee.object) === 'console' || node.callee.name === 'print') extracted = add(file, node, 'output', '输出结果', text(node), {}, offset);
        else if (['setItem', 'writeFile', 'writeFileSync', 'fetch', 'request', 'send'].includes(method) || node.callee.name === 'fetch') extracted = add(file, node, 'effect', `调用 ${text(node.callee)}`, text(node).slice(0, 1000), {}, offset);
        else if (node.callee.type === 'Identifier') extracted = add(file, node, 'effect', `调用 ${node.callee.name}`, text(node).slice(0, 1000), { callTarget: node.callee.name }, offset);
      }
      if (extracted) {
        for (const owner of owners) edges.push({ id: `e-${edges.length + 1}`, from: owner.id, to: extracted.id, kind: branch || 'contains', certainty: 'static' });
        extracted._start = node.start; extracted._end = node.end;
      }
      const nextOwners = extracted && ['function', 'trigger', 'condition'].includes(extracted.type) ? [extracted] : owners;
      for (const [key, value] of Object.entries(node)) {
        if (['loc', 'start', 'end'].includes(key)) continue;
        if (Array.isArray(value)) { for (const child of value) if (child?.type) walk(child, node, nextOwners, key === 'consequent' ? 'then' : key === 'alternate' ? 'else' : branch); }
        else if (value?.type) walk(value, node, nextOwners, key === 'consequent' ? 'then' : key === 'alternate' ? 'else' : branch);
      }
    };
    // Acorn child arrays and single child nodes need independent branches.
    const visit = node => {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'ImportDeclaration') { dependencies.push({ from: file, module: node.source.value, kind: '导入', sourceRef: { revision, file, startLine: node.loc.start.line + offset, endLine: node.loc.end.line + offset } }); }
      if (node.type === 'CallExpression' && node.callee?.name === 'require' && node.arguments[0]?.type === 'Literal') dependencies.push({ from: file, module: String(node.arguments[0].value), kind: '导入', sourceRef: { revision, file, startLine: node.loc.start.line + offset, endLine: node.loc.end.line + offset } });
      for (const value of Object.values(node)) { if (Array.isArray(value)) value.forEach(child => child?.type && visit(child)); else if (value?.type) visit(value); }
    };
    walk(ast, null); visit(ast);
    for (const call of nodes.filter(node => node.sourceRef.file === file && node.callTarget)) {
      const target = names.get(call.callTarget);
      if (target) edges.push({ id: `e-${edges.length + 1}`, from: call.id, to: target.id, kind: 'possible-call', certainty: 'unresolved' });
    }
    if (nodes.length >= 700) gaps.push({ file, message: '图达到节点上限，部分结构未展开' });
    for (const feature of features.filter(feature => feature._file === file)) {
      feature.nodeIds = nodes.filter(node => node.sourceRef.file === file && node._start >= feature._start && node._end <= feature._end).map(node => node.id);
    }
    for (const fn of functionNodes.values()) {
      const name = fn.label;
      if (name === '回调' || features.some(feature => feature._file === file && feature._start <= fn._start && feature._end >= fn._end)) continue;
      features.push({ id: `f-${features.length + 1}`, title: name, description: '由具名函数提取，业务含义尚待确认', nodeIds: nodes.filter(node => node.sourceRef.file === file && node._start >= fn._start && node._end <= fn._end).map(node => node.id), sourceRefs: [fn.sourceRef], _start: fn._start, _end: fn._end, _file: file });
    }
    if (!features.some(feature => feature._file === file) && file === project.entry) features.push({ id: `f-${features.length + 1}`, title: file, description: '入口文件的本地实现结构', nodeIds: nodes.filter(node => node.sourceRef.file === file).map(node => node.id), sourceRefs: nodes.filter(node => node.sourceRef.file === file).slice(0, 1).map(node => node.sourceRef) });
  }
  for (const node of nodes) { delete node._start; delete node._end; if (!node.selector) delete node.selector; }
  for (const feature of features) { delete feature._start; delete feature._end; delete feature._file; }
  return { revision, features, nodes, edges, gaps, sourceIndex: symbols, dependencies, source: 'local-ast' };
}
function pythonGraph(project) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON_EXECUTABLE || 'python3', [path.join(__dirname, 'python_ast.py')], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '', LANG: 'C.UTF-8' } });
    let stdout = '', stderr = '', done = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Python 结构解析超时')); }, 5000);
    child.stdout.on('data', data => { stdout += data; if (stdout.length > 2_000_000) child.kill('SIGKILL'); });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); done = true; reject(error); });
    child.on('close', code => { clearTimeout(timer); if (done) return; try { if (code !== 0) throw new Error(stderr.slice(0, 500) || 'Python 结构解析失败'); resolve(JSON.parse(stdout)); } catch (error) { reject(error); } });
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify({ ...project, revision: D.revisionOf(project) }));
  });
}
async function analyzeProject(input) {
  const project = D.normalizeProject(input);
  let graph;
  if (project.runtime === 'python') {
    try { graph = await pythonGraph(project); }
    catch (error) { graph = { revision: D.revisionOf(project), features: [], nodes: [], edges: [], gaps: [{ message: error.message }], source: 'local-ast' }; }
  } else graph = analyzeJavaScript(project);
  graph.architecture = require('./architecture').buildArchitecture(project, graph);
  validateGraph(project, graph);
  return graph;
}
function sliceGraph(graph, featureId) {
  const feature = graph.features.find(feature => feature.id === featureId);
  const ids = new Set(feature?.nodeIds || []);
  return { ...graph, features: feature ? [feature] : [], nodes: graph.nodes.filter(node => ids.has(node.id)), edges: graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)) };
}
function validateGraph(project, graph) {
  if (graph.revision !== D.revisionOf(project)) throw new Error('逻辑图源码版本不匹配');
  const ids = new Set();
  for (const node of graph.nodes) { if (ids.has(node.id) || !D.validSourceRef(project, node.sourceRef)) throw new Error('逻辑图包含无效源码引用'); ids.add(node.id); }
  if (graph.edges.some(edge => !ids.has(edge.from) || !ids.has(edge.to))) throw new Error('逻辑图包含不存在的节点');
  return true;
}
module.exports = { analyzeProject, sliceGraph, validateGraph };
