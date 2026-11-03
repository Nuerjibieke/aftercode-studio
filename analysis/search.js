'use strict';
const D = require('../domain/acceptance');
function searchLogic({ project, graph, cases = [], goal = '' }, query) {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) return { query: '', revision: D.revisionOf(project), mode: 'text-index', results: [] };
  const words = q.toLowerCase().match(/[a-z_$][\w.$-]*|[\u3400-\u9fff]{2,}/g) || [q.toLowerCase()];
  const terms = new Set(words);
  for (const word of words) if (/[\u3400-\u9fff]/.test(word) && word.length > 2) for (let i = 0; i < word.length - 1; i++) terms.add(word.slice(i, i + 2));
  const entries = [
    ...(goal ? [{ kind: 'requirement', id: 'goal', title: '当前验收需求', text: goal }] : []),
    ...cases.map(item => ({ kind: 'case', id: item.id, featureId: item.featureId, title: item.title, text: `${item.description || ''} ${JSON.stringify(item.input)} ${JSON.stringify(item.expected)}`, verified: item.confirmed })),
    ...(graph.architecture?.modules || []).map(module => ({ kind: 'module', id: module.file, title: module.title, text: `${module.file} ${module.kind}`, sourceRef: module.sourceRef })),
    ...graph.nodes.map(node => ({ kind: 'node', id: node.id, title: node.interpretation?.label || node.label, text: `${node.label} ${node.detail || ''} ${node.sourceRef.file}`, sourceRef: node.sourceRef }))
  ];
  const results = entries.map(entry => {
    const title = entry.title.toLowerCase(), text = String(entry.text).toLowerCase();
    let score = 0; for (const term of terms) { if (title.includes(term)) score += term.length > 2 ? 8 : 3; if (text.includes(term)) score += term.length > 2 ? 3 : 1; }
    if (title.includes(q.toLowerCase())) score += 15;
    return { ...entry, score, excerpt: String(entry.text).replace(/\s+/g, ' ').slice(0, 180) };
  }).filter(entry => entry.score > 0 && (!entry.sourceRef || D.validSourceRef(project, entry.sourceRef))).sort((a, b) => b.score - a.score).slice(0, 24).map(({ text, ...entry }) => entry);
  return { query: q, revision: D.revisionOf(project), mode: 'text-index', results, scope: '文字与已有结构检索，不将命中位置当作已证实的答案' };
}
module.exports = { searchLogic };
