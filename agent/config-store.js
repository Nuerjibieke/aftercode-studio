'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function createConfigStore(directory) {
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  const file = path.join(root, 'model.json');
  function read() {
    try {
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('invalid');
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { disabled: value.disabled === true, baseUrl: String(value.baseUrl || ''), model: String(value.model || ''), apiKey: String(value.apiKey || ''), updatedAt: value.updatedAt || null, verifiedAt: value.verifiedAt || null, connectionMessage: value.connectionMessage || '' };
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new Error('模型连接配置无法读取，请重新保存');
    }
  }
  function atomic(value) {
    const temporary = path.join(root, `model-${crypto.randomUUID()}.tmp`);
    try { fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); fs.chmodSync(file, 0o600); }
    finally { try { fs.unlinkSync(temporary); } catch {} }
  }
  function safe() {
    const value = read();
    return { baseUrl: value.baseUrl || '', model: value.model || '', keySaved: Boolean(value.apiKey), configured: Boolean(value.baseUrl && value.model), verifiedAt: value.verifiedAt || null, updatedAt: value.updatedAt || null, connectionMessage: value.connectionMessage || '' };
  }
  function save(input) {
    if (input.clear === true) { atomic({ disabled: true, baseUrl: '', model: '', apiKey: '', updatedAt: new Date().toISOString(), verifiedAt: null }); return safe(); }
    let url;
    try { url = new URL(String(input.baseUrl || '').trim()); } catch { throw new Error('请填写正确的服务地址'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('服务地址不能包含密钥、账号或查询参数');
    if (['ust.hk','www.ust.hk','hkust.edu.hk','www.hkust.edu.hk','itso.hkust.edu.hk','itsc.hkust.edu.hk'].includes(url.hostname.toLowerCase())) throw new Error('这是学校官网，不是模型接口。请选择香港科技大学 HKUST，即可自动填写服务地址。');
    const baseUrl = url.href.replace(/\/$/, '');
    const model = String(input.model || '').trim();
    if (!model || model.length > 180 || /[\r\n]/.test(model)) throw new Error('请填写模型名称');
    if (input.apiKey != null && (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey))) throw new Error('密钥格式不正确');
    const previous = read();
    const apiKey = input.apiKey || (previous.baseUrl === baseUrl ? previous.apiKey || '' : '');
    atomic({ baseUrl, model, apiKey, updatedAt: new Date().toISOString(), verifiedAt: null, connectionMessage: '' });
    return safe();
  }
  function verification(ok, message) { const previous = read(); atomic({ ...previous, verifiedAt: ok ? new Date().toISOString() : null, connectionMessage: String(message).slice(0, 250) }); return safe(); }
  function gatewayConfig() { const value = read(); if (value.disabled) return { baseUrl: '', model: '', apiKey: '' }; return value.baseUrl && value.model ? { baseUrl: value.baseUrl, model: value.model, apiKey: value.apiKey || '' } : {}; }
  return { safe, save, verification, gatewayConfig };
}
module.exports = { createConfigStore };
