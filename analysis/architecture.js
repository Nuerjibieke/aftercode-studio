'use strict';
const path = require('node:path').posix;
const D = require('../domain/acceptance');
function buildArchitecture(project, graph) {
  const revision = D.revisionOf(project);
  const files = Object.keys(project.files).filter(file => /\.(html?|css|[cm]?js|jsx|tsx?|py|json)$/i.test(file) && !/(?:^|\/)(?:package-lock|yarn\.lock|pnpm-lock)/.test(file));
  const modules = files.map(file => ({ id: 'file:' + file, file, title: path.basename(file), group: path.dirname(file) === '.' ? '' : path.dirname(file), kind: graph.features.some(feature => feature.trigger?.kind === 'http' && feature.sourceRefs?.some(ref => ref.file === file)) ? '接口路由' : /\.html?$/i.test(file) ? '界面' : /\.css$/i.test(file) ? '样式' : /\.json$/i.test(file) ? '配置与数据' : '实现逻辑', entry: file === project.entry, nodeIds: graph.nodes.filter(node => node.sourceRef?.file === file).map(node => node.id), featureIds: graph.features.filter(feature => feature.sourceRefs?.some(ref => ref.file === file)).map(feature => feature.id), sourceRef: { revision, file, startLine: 1, endLine: project.files[file].split('\n').length } }));
  const dependencies = [...(graph.dependencies || [])];
  for (const file of files.filter(file => /\.html?$/i.test(file))) {
    const source = project.files[file];
    for (const match of source.matchAll(/<(script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)) dependencies.push({ from: file, module: match[2], kind: match[1].toLowerCase() === 'script' ? '加载脚本' : '加载资源', sourceRef: { revision, file, startLine: source.slice(0, match.index).split('\n').length, endLine: source.slice(0, match.index + match[0].length).split('\n').length } });
  }
  const relations = [], external = new Map();
  const resolve = dependency => {
    let name = dependency.module;
    if (!name || /^(?:https?:|data:|\/\/)/.test(name)) return null;
    name = name.split(/[?#]/)[0];
    const python = dependency.from.endsWith('.py');
    const modulePath = python ? name.replace(/\./g, '/') : name;
    const candidates = [];
    if (python && !dependency.level) candidates.push(modulePath);
    const parent = path.dirname(dependency.from);
    let relative = modulePath;
    if (python && dependency.level > 1) relative = '../'.repeat(dependency.level - 1) + modulePath;
    if (python || name.startsWith('.') || dependency.kind?.startsWith('加载')) candidates.push(path.normalize(path.join(parent, relative)));
    if (name.startsWith('/')) candidates.push(name.slice(1));
    for (const candidate of candidates) {
      if (candidate.startsWith('../') || candidate.startsWith('/')) continue;
      for (const file of [candidate, candidate + '.js', candidate + '.mjs', candidate + '.cjs', candidate + '.ts', candidate + '.tsx', candidate + '.jsx', candidate + '.py', candidate + '/index.js', candidate + '/__init__.py']) if (Object.hasOwn(project.files, file)) return file;
    }
    return null;
  };
  for (const dependency of dependencies) {
    const file = resolve(dependency);
    let target;
    if (file) target = 'file:' + file;
    else {
      let label = String(dependency.module || '动态依赖');
      try { if (/^(?:https?:|\/\/)/.test(label)) { const url = new URL(label.startsWith('//') ? 'https:' + label : label); label = url.host + url.pathname; } } catch {}
      label = label.split(/[?#]/)[0].slice(0, 100);
      target = 'external:' + label;
      external.set(target, { id: target, title: label, kind: '导入范围外', external: true });
    }
    if (modules.some(module => module.id === 'file:' + dependency.from)) relations.push({ id: 'dependency-' + relations.length, from: 'file:' + dependency.from, to: target, label: dependency.kind || '导入', sourceRef: dependency.sourceRef, certainty: file ? 'static' : 'unresolved' });
  }
  const groups = [...new Set(modules.map(module => module.group))].map(group => ({ id: 'folder:' + group, title: group || '项目根目录', path: group, moduleIds: modules.filter(module => module.group === group).map(module => module.id) }));
  return { revision, modules, external: [...external.values()], relations, groups, source: 'selected-file-structure', scope: '当前导入文件的静态结构；外部依赖与动态分派不保证完整解析' };
}
module.exports = { buildArchitecture };
