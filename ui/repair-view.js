(() => {
  'use strict';
  const V=window.AcceptanceView,P=window.RepairDomain;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button=(action,label,id,primary=false,disabled=false)=>`<button class="st-button ${primary?'is-primary':'is-secondary'}" data-acceptance-action="${action}" data-id="${esc(id||'')}" ${disabled?'disabled':''}>${label}</button>`;
  function readable(text,cases){let result=String(text||'');for(const c of cases)if(c.id.length>=10)for(const q of ["'",'"','`'])result=result.split(q+c.id+q).join(c.title);return result;}
  function workflow(m,body){
    const analysis=m.agentAnalyses.filter(a=>a.source==='model'&&(a.question||['diagnose','explain'].includes(a.purpose))).at(-1);
    const record=m.repairs.find(r=>r.id===m.selectedRepairId);
    const busy=m.busy||m.repairApplying;
    const newCycle=Boolean(analysis&&record?.transaction&&record.status!=='undone'&&analysis.id!==record.analysisId&&analysis.revision===record.transaction.appliedRevision);
    if(!analysis&&!record&&!m.repairGenerating)return '';
    const stale=record&&(record.goal!==m.delivery.goal||record.criteriaKey!==P.criteriaKey(m.cases)||(record.transaction?record.transaction.appliedRevision:record.baseRevision)!==m.revision);
    const isUndone=record?.status==='undone'&&record.transaction?.baseRevision===m.revision;
    const currentVerification=record?.verificationRoundId===m.currentRound?.id&&Boolean(record?.verification?.results?.length)&&record.verification.results.every(r=>m.checks.some(c=>c.id===r.checkId));
    let status=m.repairGenerating?'generating':newCycle?'diagnosed':isUndone?'undone':stale?'stale':record?.status||'diagnosed';
    if(['verified','needs_changes','needs_review'].includes(status)&&!currentVerification)status='applied';
    const text={diagnosed:'原因已分析',generating:'正在生成修改方案',proposed:'修改方案待应用',needs_info:'还需要一条信息',applied:'修改已应用',verifying:'正在重新验收',verified:currentVerification?'重验符合预期':'修改已应用',needs_changes:currentVerification?'重验后仍有问题':'修改已应用',needs_review:'还有情况需人工核对',undone:'已恢复修改前的代码',stale:'代码或标准已变化'}[status]||'修改方案';
    const phase={diagnosed:0,generating:1,proposed:1,needs_info:1,applied:2,verifying:3,verified:3,needs_changes:3,needs_review:3,undone:1,stale:1}[status];
    const steps=['原因分析','修改方案','应用修改','重新验收'].map((label,i)=>`<span class="${i<phase?'is-done':i===phase?'is-current':''}"><i>${i+1}</i>${label}</span>`).join('');
    const cause=analysis&&(!record||newCycle)?`<p class="rp-diagnosis">${esc(analysis.summary)}</p>`:'';
    const summary=record&&!newCycle?`<h3>${esc(record.title)}</h3><p class="rp-summary">${esc(readable(record.summary,m.cases))}</p>`:'';
    const validation=record?.verification&&currentVerification&&['verified','needs_changes','needs_review'].includes(status)?`<div class="rp-verification ${status==='verified'?'is-pass':'is-issue'}">已按原标准重验 ${record.verification.total} 项，${record.verification.passed} 项符合预期</div>`:'';
    const questions=status==='needs_info'?`<ul>${record.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul>`:'';
    let actions='';
    if(status==='diagnosed')actions=button('repair-generate','生成修改方案',analysis.id,true,busy)+(analysis.caseSuggestions?.length&&!analysis.suggestionsAdopted?button('adopt-suggestions','加入验收方案',analysis.id,false,busy):'');
    if(status==='proposed')actions=button('repair-review','查看修改并应用',record.id,true,busy);
    if(['applied','verified','needs_changes','needs_review'].includes(status))actions=button('repair-recheck','重新验收',record.id,status!=='verified',busy)+button('repair-undo','撤销这次修改',record.id,false,busy);
    if(['stale','undone','needs_changes','needs_info'].includes(status))actions+=analysis?button('repair-generate','生成下一步修改方案',analysis.id,true,busy):button('repair-analyze','分析当前问题','',true,busy);
    return `<section class="rp-workflow" data-repair-status="${status}"><div class="rp-steps">${steps}</div><header><span class="rp-status ${status==='verified'&&currentVerification?'is-pass':''}">${esc(text)}</span>${record?.edits.length&&!newCycle?`<span class="rp-change-count">${new Set(record.edits.map(e=>e.file)).size} 个文件 · ${record.edits.length} 处修改</span>`:''}</header>${cause}${summary}${questions}${validation}<div class="rp-actions">${actions}</div></section>`;
  }
  for(const name of ['renderLogic','renderOverview']){
    const previous=V[name];V[name]=m=>{const hasDiagnosis=m.agentAnalyses.some(a=>a.source==='model'&&(a.question||['diagnose','explain'].includes(a.purpose)));const visible=hasDiagnosis?{...m,agentAnalyses:[],searchAnswer:null}:m;const body=previous(visible);return workflow(m,body)+body;};
  }
})();
