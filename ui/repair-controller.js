(() => {
  'use strict';
  const A = window.AcceptanceApp, D = window.AcceptanceDomain, P = window.RepairDomain, legacy = window.Aftercode;
  if (!A || !P) return;
  const s = A.state, $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const readable = text => { let result=String(text||''); for(const c of s.cases)if(c.id.length>=10)for(const q of ["'",'"','`'])result=result.split(q+c.id+q).join(c.title); return result; };
  const recordFor = id => s.repairs.find(item => item.id === (id || s.selectedRepairId));
  const journalKey = () => 'aftercode:repair-journal:' + s.projectId;
  const diagnosis = id => s.agentAnalyses.filter(item => (!id || item.id === id) && item.source === 'model' && item.revision === s.revision && item.goal === s.delivery.goal && (item.question || ['diagnose','explain'].includes(item.purpose)) && item.roundId === (s.currentRound?.id || null)).at(-1);
  function ensureCurrent(record, applied = false) {
    if (!record || record.projectId !== s.projectId) throw new Error('这个方案不属于当前项目');
    if (record.goal !== s.delivery.goal || record.criteriaKey !== P.criteriaKey(s.cases)) throw new Error('验收需求或标准已经改变，请重新生成方案');
    if (D.revisionOf(A.currentProject()) !== (applied ? record.transaction?.appliedRevision : record.baseRevision)) throw new Error('代码已变化，旧方案不会覆盖你的修改，请重新生成');
  }
  async function generate(id, approved = false) {
    if (s.busy || s.repairApplying) return;
    const analysis = diagnosis(id);
    if (!analysis) { legacy.toast('先分析当前问题，再生成对应的修改方案。'); return; }
    if (!analysis.shareApproved && !approved) {
      A.dialog('生成修改方案', '<p>会把当前项目与这次分析交给已连接的模型，生成可审阅的代码修改。</p><label class="ac-share-confirm"><input id="rp-share" type="checkbox">这些内容可以分享给该模型</label><div id="rp-error" role="alert"></div>', `<button class="button primary" data-acceptance-action="repair-share" data-id="${esc(analysis.id)}">生成方案</button>`); return;
    }
    A.closeDialog();
    const project = A.currentProject(), projectId = s.projectId, revision = s.revision, goal = s.delivery.goal, criteria = P.criteriaKey(s.cases);
    const controller = new AbortController(), jobId = D.id('repair-job');
    s.busy = true; s.error = ''; s.repairGenerating = true; s.job = { controller, ids: [jobId] }; s.execution = { title: '正在生成修改方案' }; A.render();
    try {
      const response = await fetch('/api/agent/analyze', { method: 'POST', headers: { 'Content-Type':'application/json' }, signal: controller.signal, body: JSON.stringify({ project, purpose: 'repair', language: window.AftercodeI18n?.locale || 'zh-CN', goal, shareApproved: true, jobId, diagnosis: { revision, summary: analysis.summary }, focus: { nodeIds: (s.focusedLogicFeature || s.features.find(f => f.id === s.selectedFeatureId))?.nodeIds || [] }, currentCases: s.cases.map(c => ({ id:c.id, title:c.title, confirmed:c.confirmed, ruleRevision:c.ruleRevision, input:c.input, actions:c.actions, expected:c.expected })), evidence: D.forRound(s.runs,s.currentRound,revision).map(run => ({ id:run.id, revision:run.revision, caseId:run.caseId, actions:run.actions, status:run.status, output:run.output, stdout:run.stdout, observations:run.observations, trace:run.trace, checks:s.checks.filter(c=>c.runId===run.id) })) }) });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || '修改方案生成失败'); }
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', result;
      const consume = line => { if (!line.trim()) return; const event = JSON.parse(line); if (event.type === 'error') throw new Error(event.data.message); if (event.type === 'result') result = event.data; if (event.type === 'progress') { s.execution = { title:event.data.message }; A.render(); } };
      for (;;) { const part = await reader.read(); if (part.done) break; buffer += decoder.decode(part.value,{stream:true}); const lines = buffer.split('\n'); buffer=lines.pop(); for (const line of lines) consume(line); }
      buffer += decoder.decode(); if (buffer.trim()) consume(buffer);
      if (projectId !== s.projectId || revision !== D.revisionOf(A.currentProject()) || goal !== s.delivery.goal || criteria !== P.criteriaKey(s.cases)) throw new Error('代码或验收标准已变化，请针对新版本重新生成');
      if (!result) throw new Error('没有收到完整的修改方案');
      const validated = P.createPlan(project, { title: result.title, summary: result.summary, edits: result.edits, questions: result.questions, baseRevision: result.baseRevision });
      const record = { ...validated, analysisSummary:analysis.summary, source:'model', model:result.model, toolCalls:result.toolCalls || [], analysisId:analysis.id, projectId, goal, criteriaKey:criteria, verificationCaseIds:s.cases.filter(c=>c.confirmed).map(c=>c.id) };
      s.repairs.push(record); s.selectedRepairId = record.id; A.save();
    } catch (error) { if (projectId === s.projectId) s.error = controller.signal.aborted ? '已停止生成，代码没有改动' : error.message; }
    finally { if (projectId === s.projectId) { s.busy=false; s.repairGenerating=false; s.job=null; s.execution=null; A.save(); A.render(); if (s.selectedRepairId) $('.rp-workflow')?.scrollIntoView({block:'start'}); } }
  }
  function review(id) {
    const record = recordFor(id);
    try {
      ensureCurrent(record); P.applyPlan(A.currentProject(),record);
      const destination = A.currentProject().sourceLocation ? '<p class="dialog-note">应用到当前工作区副本，不写回服务器原目录。</p>' : '';
      const diffs = record.edits.map((edit,i) => `<details class="rp-diff" ${i===0?'open':''}><summary>${esc(edit.file)} · 第 ${edit.sourceRef.startLine} 行</summary><p>${esc(edit.reason)}</p><div class="rp-diff-grid"><div><span>修改前</span><pre class="rp-before">${esc(edit.oldText)}</pre></div><div><span>修改后</span><pre class="rp-after">${esc(edit.newText)}</pre></div></div></details>`).join('');
      const trust = A.currentProject().runtime !== 'web' ? '<label class="rp-trust"><input id="rp-trust" type="checkbox">允许在服务器执行修改后的项目并重新验收</label>' : '';
      A.dialog('查看并应用修改方案', `<div class="rp-review"><h3>${esc(record.title)}</h3><p>${esc(readable(record.summary))}</p>${destination}${diffs}<p class="rp-standard">保留原验收标准，重验 ${record.verificationCaseIds.length} 个已确认的情况。</p>${trust}<div id="rp-error" role="alert"></div></div>`, `<button class="button quiet" data-acceptance-action="repair-apply-only" data-id="${esc(record.id)}">仅应用修改</button><button class="button primary" data-acceptance-action="repair-confirm" data-id="${esc(record.id)}">应用并重新验收</button>`);
    } catch(error) { s.error=error.message; A.render(); }
  }
  async function apply(id, recheck) {
    if (s.busy || s.repairApplying) return;
    const record=recordFor(id), projectId=s.projectId; let committed=false, previousJournal=null, journalWritten=false;
    try {
      ensureCurrent(record);
      if (recheck && !record.verificationCaseIds.length) throw new Error('先确认验收标准，或选择仅应用修改');
      if (recheck && A.currentProject().runtime !== 'web' && !$('#rp-trust')?.checked) { $('#rp-error').textContent='先确认修改后的项目可以在服务器执行'; return; }
      const result=P.applyPlan(A.currentProject(),record);
      previousJournal=localStorage.getItem(journalKey());
      const nextRecord={ ...record, transaction:result.transaction, appliedRevision:result.transaction.appliedRevision, status:'applied' };
      localStorage.setItem(journalKey(),JSON.stringify({ schemaVersion:1, projectId, record:nextRecord })); journalWritten=true;
      legacy.replaceProject(result.project); committed=true; Object.assign(record,nextRecord);
      s.repairApplying=true; A.closeDialog(); await A.sourceChanged();
      if (projectId !== s.projectId) return;
      s.selectedRepairId=record.id; A.save(); A.render();
      if (recheck) {
        ensureCurrent(record,true); s.approvedRevision=s.revision; A.switchMode('overview');
        await A.execute(s.cases.filter(c=>record.verificationCaseIds.includes(c.id)),{repairId:record.id});
      }
    } catch(error) {
      if (journalWritten && !committed && projectId===s.projectId) { try { if (previousJournal===null) localStorage.removeItem(journalKey()); else localStorage.setItem(journalKey(),previousJournal); } catch {} }
      if (projectId===s.projectId) s.error=error.name==='QuotaExceededError' ? '修改尚未应用：请先导出项目或释放浏览器存储空间' : error.message;
    } finally { if(projectId===s.projectId){s.repairApplying=false;A.save();A.render();} }
  }
  async function recheck(id) {
    const record=recordFor(id); if(s.busy||s.repairApplying)return;
    try {
      ensureCurrent(record,true);
      const items=s.cases.filter(c=>c.confirmed&&record.verificationCaseIds.includes(c.id));
      if(!items.length)throw new Error('先确认需要重验的标准');
      await A.execute(items,{repairId:record.id});
    } catch(error){s.error=error.message;A.render();}
  }
  async function undo(id) {
    if(s.busy||s.repairApplying)return;
    const record=recordFor(id),projectId=s.projectId;
    try {
      if(!record?.transaction)throw new Error('没有可撤销的修改');
      const restored=P.undo(A.currentProject(),record.transaction);
      const nextRecord={...record,status:'undone',undoneAt:new Date().toISOString()};
      localStorage.setItem(journalKey(),JSON.stringify({schemaVersion:1,projectId,record:nextRecord}));
      legacy.replaceProject(restored); Object.assign(record,nextRecord); s.repairApplying=true; await A.sourceChanged();
    }catch(error){if(projectId===s.projectId)s.error=error.message;}
    finally{if(projectId===s.projectId){s.repairApplying=false;A.save();A.render();}}
  }
  function matchVerification(items) {
    const ids=new Set(items.map(c=>c.id));
    return s.repairs.slice().reverse().find(r=>r.transaction?.appliedRevision===s.revision&&r.goal===s.delivery.goal&&r.criteriaKey===P.criteriaKey(s.cases)&&r.status!=='undone'&&r.verificationCaseIds.length&&r.verificationCaseIds.every(id=>ids.has(id)))?.id || null;
  }
  function reconcile() {
    const round=s.currentRound,record=s.repairs.find(r=>r.id===round?.repairId);
    if(!s.environmentId||!record||record.status==='undone'||record.transaction?.appliedRevision!==s.revision||record.goal!==s.delivery.goal||record.criteriaKey!==P.criteriaKey(s.cases))return false;
    const previous=JSON.stringify([record.status,record.verificationRoundId,record.verification]);
    if(record.verificationRoundId!==round.id){
      if(record.verification?.results?.length)(record.verificationHistory ||= []).push({roundId:record.verificationRoundId,...record.verification});
      record.verificationRoundId=round.id;record.verification=null;
    }
    if(['queued','running'].includes(round.status))record.status='verifying';
    else if(round.status==='completed'){
      const results=record.verificationCaseIds.map(id=>{const item=s.cases.find(c=>c.id===id);return A.currentChecks().filter(c=>c.caseId===id&&c.ruleRevision===item?.ruleRevision).at(-1);}).filter(Boolean);
      if(results.length!==record.verificationCaseIds.length)return false;
      const passed=results.filter(c=>c.state==='passed'&&c.standardConfirmed).length;
      record.status=passed===results.length?'verified':results.some(c=>!['passed','needs_manual','needs_confirmation'].includes(c.state))?'needs_changes':'needs_review';
      record.verification={passed,total:record.verificationCaseIds.length,results:results.map(c=>({checkId:c.id,caseId:c.caseId,state:c.state,expected:c.expected,actual:c.actual})),at:results.map(c=>c.at).filter(Boolean).sort().at(-1)||record.verification?.at||new Date().toISOString()};
      if(results.length&&legacy.state.dirty){legacy.state.dirty=false;legacy.saveWorkspace();$('#dirty-mark').textContent='';}
    }else{record.status='applied';record.verification={passed:0,total:record.verificationCaseIds.length,results:[],incomplete:true};}
    return previous!==JSON.stringify([record.status,record.verificationRoundId,record.verification]);
  }
  function recover() {
    try {
      const saved=JSON.parse(localStorage.getItem(journalKey()));if(saved?.projectId!==s.projectId||!saved.record?.transaction)return;
      const record=saved.record,revision=D.revisionOf(A.currentProject()),existing=recordFor(record.id);
      if(revision===record.transaction.appliedRevision&&(!existing?.transaction||existing.status==='proposed')||revision===record.transaction.baseRevision&&record.status==='undone'&&existing?.status!=='undone'){
        if(existing)Object.assign(existing,record);else s.repairs.push(record);s.selectedRepairId=record.id;A.save();
      }
    }catch{}
  }
  Object.assign(A.actions,{
    'repair-generate':el=>generate(el.dataset.id),
    'repair-share'(el){if(!$('#rp-share')?.checked){$('#rp-error').textContent='先确认这些内容可以发送给该模型';return;}generate(el.dataset.id,true);},
    'repair-review':el=>review(el.dataset.id),
    'repair-confirm':el=>apply(el.dataset.id,true),
    'repair-apply-only':el=>apply(el.dataset.id,false),
    'repair-recheck':el=>recheck(el.dataset.id),
    'repair-undo':el=>undo(el.dataset.id),
    'repair-analyze'(){const item=s.cases.find(c=>c.id===s.selectedCaseId)||s.cases[0];if(item)A.actions['ask-case']({dataset:{id:item.id}});}
  });
  function layout() {
    const root=$('#ac-workbench'),panel=root?.querySelector('.rp-workflow');
    if(!panel||recordFor())return;
    const answer=root.querySelector('.st-search-answer')||root.querySelector('.st-plan-summary');
    if(answer)answer.insertAdjacentElement('afterend',panel);
  }
  window.AftercodeRepair={generate,review,apply,undo,recheck,reconcile,matchVerification,diagnosis,layout};
  recover();A.render();
})();
