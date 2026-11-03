'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function createDraftStore(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
  function fileFor(key) { if (typeof key !== 'string' || !key || key.length > 1200) throw new Error('项目标识不正确'); return path.join(directory, crypto.createHash('sha256').update(key).digest('hex') + '.json'); }
  function read(key) { try { return JSON.parse(fs.readFileSync(fileFor(key), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('暂时无法读取草稿'); } }
  function save({ projectKey, text, expectedVersion }) {
    if (typeof text !== 'string' || text.length > 8000) throw new Error('请先聚焦这次需要验收的部分，内容最多八千字');
    const previous = read(projectKey);
    if (previous && expectedVersion != null && previous.version !== expectedVersion && previous.text !== text) return { conflict: true, version: previous.version, savedAt: previous.savedAt };
    if (previous?.text === text) return { saved: true, version: previous.version, savedAt: previous.savedAt };
    const history = previous ? [...(previous.history || []), { text: previous.text, version: previous.version, savedAt: previous.savedAt }].slice(-20) : [];
    const value = { version: (previous?.version || 0) + 1, text, savedAt: new Date().toISOString(), history };
    const file = fileFor(projectKey), temporary = file + '.' + crypto.randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); fs.chmodSync(file, 0o600); }
    finally { try { fs.unlinkSync(temporary); } catch {} }
    return { saved: true, version: value.version, savedAt: value.savedAt };
  }
  function get(key, history = false) { const value = read(key); return value ? { text: value.text, version: value.version, savedAt: value.savedAt, ...(history ? { history: value.history || [] } : {}) } : null; }
  return { save, get };
}
module.exports = { createDraftStore };
