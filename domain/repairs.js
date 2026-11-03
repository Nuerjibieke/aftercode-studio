(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./acceptance') : root.AcceptanceDomain);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RepairDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';
  function ranges(project, edits) {
    if (!Array.isArray(edits) || edits.length > 8) throw new Error('修改方案最多包含 8 处精确修改');
    const files = new Map(); let total = 0;
    for (const edit of edits) {
      if (!edit || typeof edit.file !== 'string' || !Object.hasOwn(project.files, edit.file)) throw new Error('修改只能指向当前项目中已有的文件');
      if (/(^|\/)(?:tests?|__tests__|specs?)(\/|$)|\.(?:test|spec)\.[^/]+$|(^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|uv\.lock|requirements[^/]*\.txt|pyproject\.toml|\.env[^/]*)$/i.test(edit.file)) throw new Error('请只调整实现，不修改测试、依赖配置或密钥文件');
      if (typeof edit.oldText !== 'string' || !edit.oldText.length || typeof edit.newText !== 'string' || edit.oldText.length > 16000 || edit.newText.length > 24000) throw new Error('每处修改需要提供明确、有限的修改前后片段');
      if (edit.oldText === edit.newText) throw new Error('方案没有实际修改内容');
      total += edit.oldText.length + edit.newText.length;
      if (total > 64000) throw new Error('这次修改范围较大，请缩小到一个问题');
      const text = project.files[edit.file], start = text.indexOf(edit.oldText);
      if (start < 0) throw new Error('修改前的片段与当前源码不一致，请重新生成方案');
      if (text.indexOf(edit.oldText, start + 1) >= 0) throw new Error('修改片段在文件中不唯一，需要包含更多上下文');
      const found = { ...edit, start, end: start + edit.oldText.length };
      if (!files.has(edit.file)) files.set(edit.file, []);
      files.get(edit.file).push(found);
    }
    if (files.size > 4) throw new Error('一次修改最多涉及 4 个文件');
    for (const edits of files.values()) {
      edits.sort((a,b) => a.start - b.start);
      for (let i = 1; i < edits.length; i++) if (edits[i].start < edits[i-1].end) throw new Error('方案中的修改互相重叠，需要重新生成');
    }
    return files;
  }
  function createPlan(input, data) {
    const project = D.normalizeProject(input), revision = D.revisionOf(project);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('修改方案的格式无效');
    if (['runs', 'checks', 'decisions', 'cases', 'status', 'passed', 'verification'].some(key => Object.hasOwn(data, key))) throw new Error('修改建议不能改变验收标准或生成通过结论');
    if (data.baseRevision != null && data.baseRevision !== revision) throw new Error('方案引用的代码版本已经变化');
    const questions = (Array.isArray(data.questions) ? data.questions : []).filter(x => typeof x === 'string' && x.trim()).slice(0, 3).map(x => x.slice(0,1000));
    if (!Array.isArray(data.edits) || !data.edits.length && !questions.length) throw new Error('需要提供精确修改，或说明真正缺少的信息');
    const groups = ranges(project, data.edits);
    const edits = [...groups.values()].flat().map(edit => {
      const startLine = project.files[edit.file].slice(0, edit.start).split('\n').length;
      return { file: edit.file, oldText: edit.oldText, newText: edit.newText, reason: String(edit.reason || '').slice(0,2000), sourceRef: { revision, file: edit.file, startLine, endLine: startLine + edit.oldText.split('\n').length - 1 } };
    });
    return { id: D.id('repair'), baseRevision: revision, title: String(data.title || '修正这处实现').slice(0,180), summary: String(data.summary || '').slice(0,4000), edits, questions, status: edits.length && !questions.length ? 'proposed' : 'needs_info', createdAt: new Date().toISOString() };
  }
  function applyPlan(input, plan) {
    const project = D.normalizeProject(input);
    if (D.revisionOf(project) !== plan.baseRevision) throw new Error('代码已变化，旧方案不会覆盖你的修改，请重新生成');
    if (plan.questions?.length) throw new Error('先补充会影响修改方向的信息，再应用方案');
    if (!plan.edits?.length) throw new Error('这份方案还没有可应用的修改');
    const groups = ranges(project, plan.edits), files = { ...project.files }, beforeFiles = {};
    for (const [file, edits] of groups) {
      beforeFiles[file] = project.files[file];
      for (const edit of edits.slice().reverse()) files[file] = files[file].slice(0,edit.start) + edit.newText + files[file].slice(edit.end);
    }
    const next = D.normalizeProject({ ...project, files });
    return { project: next, transaction: { baseRevision: plan.baseRevision, appliedRevision: D.revisionOf(next), beforeFiles, appliedAt: new Date().toISOString() } };
  }
  function undo(input, transaction) {
    const project = D.normalizeProject(input);
    if (D.revisionOf(project) !== transaction.appliedRevision) throw new Error('应用后又有新的修改，不能直接撤销覆盖，请先检查差异');
    const restored = D.normalizeProject({ ...project, files: { ...project.files, ...transaction.beforeFiles } });
    if (D.revisionOf(restored) !== transaction.baseRevision) throw new Error('原始版本不完整，无法自动撤销');
    return restored;
  }
  function criteriaKey(cases) {
    return JSON.stringify(cases.map(item => ({ id: item.id, ruleRevision: item.ruleRevision, confirmed: item.confirmed, key: D.caseKey(item) })).sort((a,b) => a.id.localeCompare(b.id)));
  }
  return { createPlan, applyPlan, undo, criteriaKey };
});
