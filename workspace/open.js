'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const D = require('../domain/acceptance');
const ignored = new Set(['node_modules','.git','.private','.tools','__pycache__','backups','exports','dist','build','coverage','.next','.venv','venv','tests']);
function secretName(name) { return /^\.env(?:\.|$)/i.test(name) || /^(?:credentials?|secrets?|id_rsa|id_ed25519)(?:\.|$)/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name); }
async function openProject(requested, { allowedRoot, denied = [] }) {
  let root, directory;
  try { root = await fs.realpath(allowedRoot); directory = await fs.realpath(String(requested || '')); } catch { throw new Error('没有找到这个项目文件夹'); }
  if (directory === root || !directory.startsWith(root + path.sep)) throw new Error('请选择你的项目目录，不要选择整个磁盘或个人资料目录');
  if (directory.split(path.sep).some(part => ignored.has(part)) || denied.some(item => directory === path.resolve(item) || directory.startsWith(path.resolve(item) + path.sep))) throw new Error('这个目录不用于打开项目源码');
  const files = {}, warnings = []; let size = 0;
  async function visit(dir) {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || ignored.has(entry.name) || secretName(entry.name)) continue;
      const absolute = path.join(dir, entry.name), relative = path.relative(directory, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) { await visit(absolute); continue; }
      if (!entry.isFile() || !/\.(?:html?|css|[cm]?js|jsx|tsx?|py|json)$/i.test(entry.name) || /(?:\.test\.[cm]?js$|investigation.*\.json$|(?:package|npm)-lock\.json$)/i.test(entry.name)) continue;
      const stat = await fs.stat(absolute);
      if (stat.size > 2000000 || size + stat.size > 8000000 || Object.keys(files).length >= 200) { warnings.push('部分大文件或超出范围的文件未载入'); continue; }
      const text = await fs.readFile(absolute, 'utf8'); if (text.includes('\0')) continue;
      files[relative] = text; size += stat.size;
    }
  }
  await visit(directory);
  let entry = files['index.html'] != null ? 'index.html' : null;
  if (!entry && files['package.json']) { try { const pkg = JSON.parse(files['package.json']); if (typeof pkg.main === 'string' && Object.hasOwn(files, pkg.main)) entry = pkg.main; } catch {} }
  entry = entry || Object.keys(files).find(file => /(?:^|\/)(?:main|app|index|server)\.(?:[cm]?js|ts|py)$/.test(file)) || Object.keys(files).find(file => /\.(?:[cm]?js|jsx|tsx?|py|html?)$/.test(file));
  if (!entry) throw new Error('没有找到可以分析的实现文件');
  const project = D.normalizeProject({ name: path.basename(directory), entry, files, analysisOnly: true, sourceLocation: { kind: 'server', path: directory } });
  return { project, warnings: [...new Set(warnings)], scope: '只读取源文件；常见密钥、依赖、构建结果和测试产物不会载入。运行前仍需选择和确认适配的执行方式。' };
}
module.exports = { openProject };
