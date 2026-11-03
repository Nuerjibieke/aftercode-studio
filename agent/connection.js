'use strict';
const { configFrom, requestHeaders, serviceError } = require('./gateway');
async function checkConnection(input) {
  const config = configFrom(input);
  if (!config.endpoint || !config.model) return { ok: false, message: '请先填写服务地址和模型名称' };
  try {
    const response = await fetch(config.endpoint, { method: 'POST', headers: requestHeaders(config), body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 12, temperature: 0 }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) { await response.body?.cancel(); return { ok: false, message: serviceError(config, response.status) }; }
    const reader = response.body.getReader(); let text = '';
    for (;;) { const { value, done } = await reader.read(); if (done) break; text += Buffer.from(value).toString('utf8'); if (text.length > 65536) { await reader.cancel(); return { ok: false, message: '服务返回内容不符合连接检查要求' }; } }
    let result; try { result = JSON.parse(text); } catch { return { ok: false, message: '服务没有返回兼容的响应' }; }
    return result.choices?.[0]?.message ? { ok: true, message: '已连接，可以开始分析与验收' } : { ok: false, message: '请确认服务地址和模型名称是否匹配' };
  } catch { return { ok: false, message: '暂时连接不上，请检查服务地址或稍后再试' }; }
}
module.exports = { checkConnection };
