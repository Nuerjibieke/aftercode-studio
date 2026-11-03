(() => {
  'use strict';
  const V = window.AcceptanceView;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const display = value => { const text = typeof value === 'string' ? value : JSON.stringify(value); return text == null ? '尚无结果' : text.length > 150 ? text.slice(0,148) + '…' : text; };
  const button = (action, text, id = '', primary = false) => `<button class="st-button ${primary ? 'is-primary' : 'is-secondary'}" data-acceptance-action="${action}" ${id ? `data-id="${esc(id)}"` : ''}>${text}</button>`;
  V.renderInspector = m => {
    const context = m.detailContext;
    if (!context) return '';
    const header = title => `<header class="fx-detail-heading"><span>${title}</span><button class="st-icon-button" data-acceptance-action="close-details" aria-label="关闭详情">×</button></header>`;
    if (context.kind === 'node') {
      const node = m.graph.nodes.find(node => node.id === context.id);
      if (!node) return '';
      const titles = { condition:'判断条件', calculation:'计算规则', state:'状态变化', effect:'产生的变化', output:'输出结果', function:'这部分实现', trigger:'触发方式' };
      const children = m.graph.edges.filter(edge => edge.from === node.id && ['contains','then','else'].includes(edge.kind));
      const observed = m.executedNodeIds.includes(node.id);
      return `<div class="fx-details">${header('逻辑详情')}<span class="fx-detail-kind">${esc(titles[node.type] || '实现逻辑')}</span><h2>${esc(node.interpretation?.label || node.label)}</h2>${node.interpretation ? `<div class="fx-interpretation"><span>模型解读</span><p>${esc(node.interpretation.explanation || '')}</p></div>` : ''}${['condition','calculation','state','output'].includes(node.type) ? `<div class="fx-rule-expression"><span>源码中的规则</span><code>${esc(String(node.detail || '').slice(0,240))}</code></div>` : `<p class="fx-detail-description">${children.length ? `包含 ${children.length} 个可展开的步骤。` : '这是当前选中的实现位置，可查看来源或为它提出验证。'}</p>`}<div class="fx-observed ${observed ? 'is-observed' : ''}">${observed ? '本次有运行记录' : '暂无运行记录'}</div><div class="fx-detail-actions">${children.length ? button('drill-node','展开下一层',node.id,true) : button('validate-node','验证这一步',node.id,true)}${button('validate-node','围绕这里提出验证',node.id)}<button class="fx-source-button" data-acceptance-action="source" data-id="${esc(node.id)}">${esc(node.sourceRef.file)} · 第 ${node.sourceRef.startLine} 行</button></div></div>`;
    }
    const item = m.cases.find(item => item.id === (context.caseId || m.selectedCaseId));
    if (!item) return `<div class="fx-details">${header('详情')}<p class="fx-detail-description">选择一个具体验收结果或逻辑节点，再看相关信息。</p></div>`;
    const check = m.checks.filter(check => check.caseId === item.id && check.revision === m.revision && check.ruleRevision === item.ruleRevision).at(-1);
    const hasActual = check && (check.actualObserved || check.actual != null), failed = check?.state === 'failed';
    const state = !item.confirmed ? '还需确认预期' : check ? ({ passed:'这次符合标准', failed:'这次与标准不同', error:'运行没有完成', timeout:'等待超时', insufficient_evidence:'还缺少运行依据', cancelled:'这次已停止' }[check.state] || '尚无明确结论') : '这个情况还没有验收';
    return `<div class="fx-details">${header(failed ? '这个问题' : '结果详情')}<span class="fx-detail-kind">${item.kind === 'boundary' ? '边界情况' : item.kind === 'regression' ? '需要保留的行为' : '验收情况'}</span><h2>${esc(item.title)}</h2><div class="ac-value-grid fx-values"><div><label>应该得到</label><strong>${esc(display(item.expected?.value))}</strong></div><div class="${failed ? 'ac-actual-failed' : ''}"><label>这次实际</label><strong>${hasActual ? esc(display(check.actual)) : '—'}</strong></div></div><div class="fx-result-state ${failed ? 'has-difference' : check?.state === 'passed' ? 'has-pass' : ''}">${state}</div><div class="fx-detail-actions">${check ? button('investigate-case','在逻辑中定位',item.id,true) : button('run-case','验证这个情况',item.id,true)}${check ? button('ask-case','分析这个问题',item.id) : button('confirm-case','确认预期',item.id)}${check ? button('evidence','查看验证过程',item.id) : ''}</div></div>`;
  };
})();
