(() => {
  'use strict';
  const V = window.AcceptanceView;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const overview = V.renderOverview;
  V.renderOverview = model => {
    const round = model.currentRound;
    const status = { queued: '准备验收', running: '正在验收', completed: '已完成', cancelled: '已停止', error: '未完成', interrupted: '未完成' }[round?.status] || (model.runs.length ? '等待重新验收' : '尚未开始');
    const time = round?.createdAt ? new Date(round.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    const header = `<div class="fx-round" data-round-status="${esc(round?.status || 'not_started')}"><div><b>本轮验收</b><span>${esc([time, status].filter(Boolean).join(' · '))}</span></div><button class="st-button is-quiet" data-acceptance-action="history">历史记录</button></div>`;
    return overview(model).replace('<div class="st-stat-row">', header + '<div class="st-stat-row">');
  };
  const logic = V.renderLogic;
  V.renderLogic = model => {
    const analysis = model.agentAnalyses.at(-1);
    const suggestions = analysis?.question && !analysis.suggestionsAdopted && analysis.caseSuggestions?.length;
    return logic(model) + (suggestions ? `<div class="fx-suggestions"><span>分析中提出了 ${suggestions} 个验证建议</span><button class="st-button is-secondary" data-acceptance-action="adopt-suggestions" data-id="${esc(analysis.id)}">加入验收方案</button></div>` : '');
  };
})();
