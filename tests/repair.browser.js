'use strict';
const {test,before,after}=require('node:test'), assert=require('node:assert/strict');
const {chromium}=require('playwright'),{createServer}=require('../server'),D=require('../domain/acceptance');
let server,browser,url;
before(async()=>{server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});});
after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
async function ready(page){await page.waitForFunction(()=>window.AftercodeRepair&&AcceptanceApp.state.environmentId&&!AcceptanceApp.state.loading);}
async function open({wrong=false,node=false}={}){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/agent/analyze',async route=>{
  const body=route.request().postDataJSON(),revision=D.revisionOf(body.project);
  const data=body.purpose==='repair'?{baseRevision:revision,title:'修正增加规则',summary:'将每次增加二改为增加一，保留归零行为，并按原标准重验。',edits:[{file:node?'main.js':'app.js',oldText:node?'input.n+2':'const next = count + 2;',newText:node?'input.n+1':`const next = count + ${wrong?3:1};`,reason:'修正实现，而不是改变预期'}],questions:[],source:'model',model:'protocol-fixture'}:{revision,summary:'原因：实现使用增加二。依据：当前源码与实际计数一致。下一步：把增量改为一，再验证连续操作和归零。',purpose:'diagnose',source:'model',features:[],cases:[],nodeAnnotations:[],questions:[]};
  await route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'result',data})+'\n'});
 });
 await page.goto(url);await ready(page);
 if(node){
  await page.evaluate(async()=>{await Aftercode.loadProject({name:'node-repair',runtime:'node',entry:'main.js',files:{'main.js':'const input=JSON.parse(require("node:fs").readFileSync(0,"utf8"));console.log(JSON.stringify({n:input.n+2}));'},delivery:{title:'独立计算',goal:'每次增加一',source:'user',features:[{id:'calc',title:'计算'}],cases:[0,1].map(n=>({id:'n-'+n,title:'从'+n+'增加一',featureId:'calc',origin:'user',confirmed:true,input:{n},actions:[],expected:{target:{kind:'json',path:'n'},operator:'jsonEquals',value:n+1}}))}});});await page.waitForFunction(()=>AcceptanceApp.state.delivery.title==='独立计算'&&!AcceptanceApp.state.loading);
 }
 await page.evaluate(()=>AcceptanceApp.switchMode('overview'));
 await page.locator('#ac-workbench [data-acceptance-action="run-all"]').click();
 if(node)await page.locator('.dialog [data-acceptance-action="approve-run"]').click();
 await page.waitForFunction(()=>!AcceptanceApp.state.busy&&AcceptanceApp.state.currentRound?.status==='completed');
 return {context,page,errors};
}
async function diagnoseAndPlan(page){
 await page.evaluate(()=>{AcceptanceApp.state.modelStatus={configured:true,label:'测试模型'};AcceptanceApp.actions['ask-case']({dataset:{id:AcceptanceApp.state.cases[0].id}});});
 await page.locator('#ac-share-approved').check();await page.locator('.dialog [data-acceptance-action="start-agent"]').click();
 await page.waitForFunction(()=>!AcceptanceApp.state.busy&&AcceptanceApp.state.agentAnalyses.some(a=>a.question));
 await page.locator('[data-acceptance-action="repair-generate"]').click();
 await page.waitForFunction(()=>!AcceptanceApp.state.busy&&AcceptanceApp.state.repairs.at(-1)?.status==='proposed');
}
async function apply(page,trust=false){
 await page.locator('[data-acceptance-action="repair-review"]').click();
 if(trust)await page.locator('#rp-trust').check();
 await page.locator('.dialog [data-acceptance-action="repair-confirm"]').click();
 await page.waitForFunction(()=>!AcceptanceApp.state.busy&&!AcceptanceApp.state.repairApplying&&['verified','needs_changes'].includes(AcceptanceApp.state.repairs.at(-1)?.status));
}
const standards=()=>AcceptanceApp.state.cases.map(({revision,...c})=>c);
test('analysis → proposal → preview → apply → actual recheck → refresh → undo keeps standards and history', {timeout:60000},async()=>{
 const {context,page,errors}=await open();
 try{
  const original=await page.evaluate(()=>({standards:AcceptanceApp.state.cases.map(({revision,...c})=>c),projectId:AcceptanceApp.state.projectId,draft:AcceptanceApp.state.requirementDraft,checks:AcceptanceApp.state.checks.map(c=>c.id),revision:AcceptanceApp.state.revision}));
  await diagnoseAndPlan(page);assert.equal(await page.evaluate(()=>Aftercode.state.project.files['app.js'].includes('count + 2')),true);
  await apply(page);
  const fixed=await page.evaluate(()=>{const s=AcceptanceApp.state,r=s.repairs.at(-1);return {status:r.status,round:s.currentRound.repairId===r.id,passed:r.verification.passed,total:r.verification.total,actual:AcceptanceDomain.forRound(s.checks,s.currentRound,s.revision).map(c=>c.actual),oldChecks:s.checks.map(c=>c.id),projectId:s.projectId,draft:s.requirementDraft,revision:s.revision,standards:s.cases.map(({revision,...c})=>c)};});
  assert.equal(fixed.status,'verified');assert.equal(fixed.round,true);assert.equal(fixed.passed,3);assert.equal(fixed.total,3);assert.deepEqual(fixed.actual,['1','2','0']);assert.ok(original.checks.every(id=>fixed.oldChecks.includes(id)));assert.deepEqual(fixed.standards,original.standards);assert.equal(fixed.projectId,original.projectId);assert.equal(fixed.draft,original.draft);assert.notEqual(fixed.revision,original.revision);
  await page.locator('[data-action="mode-preview"]').first().click();
  await page.waitForFunction(()=>Aftercode.state.rt?.ready);
  await page.frameLocator('#preview-frame').locator('#complete').click();
  await page.frameLocator('#preview-frame').locator('#count').filter({hasText:/^1$/}).waitFor();
  assert.equal(await page.frameLocator('#preview-frame').locator('#count').innerText(),'1');
  await page.locator('.view-tabs [data-acceptance-action="overview"]').click();
  await page.reload();await ready(page);assert.equal(await page.locator('.rp-workflow[data-repair-status="verified"]').count(),1);
  await page.locator('[data-acceptance-action="repair-undo"]').click();await page.waitForFunction(()=>!AcceptanceApp.state.repairApplying&&AcceptanceApp.state.repairs.at(-1)?.status==='undone');
  assert.equal(await page.evaluate(()=>Aftercode.state.project.files['app.js'].includes('count + 2')),true);assert.deepEqual(await page.evaluate(standards),original.standards);assert.equal(await page.evaluate(()=>AcceptanceApp.state.checks.length),6);assert.equal(await page.evaluate(()=>AcceptanceApp.state.currentRound),null);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('an ineffective proposed change stays failed after real recheck; the tool never rewrites expected values', {timeout:60000},async()=>{
 const {context,page}=await open({wrong:true});try{const before=await page.evaluate(standards);await diagnoseAndPlan(page);await apply(page);assert.equal(await page.evaluate(()=>AcceptanceApp.state.repairs.at(-1).status),'needs_changes');assert.equal(await page.evaluate(()=>AcceptanceApp.state.repairs.at(-1).verification.passed),1);assert.deepEqual(await page.evaluate(standards),before);assert.equal(await page.locator('.rp-verification.is-pass').count(),0);}finally{await context.close();}
});
test('a stale proposal and an undo after manual editing both preserve the user changes', {timeout:60000},async()=>{
 const {context,page}=await open();try{
  await diagnoseAndPlan(page);const id=await page.evaluate(()=>AcceptanceApp.state.repairs.at(-1).id);
  await page.evaluate(async()=>{Aftercode.state.project.files['app.js']+='\n// user owns this edit\n';await AcceptanceApp.sourceChanged();});
  await page.evaluate(id=>AcceptanceApp.actions['repair-review']({dataset:{id}}),id);assert.equal(await page.locator('.dialog').count(),0);assert.equal(await page.evaluate(()=>Aftercode.state.project.files['app.js'].includes('// user owns this edit')),true);
  await page.evaluate(()=>{const s=AcceptanceApp.state;const r=s.repairs.at(-1);r.transaction={appliedRevision:'different',baseRevision:'old',beforeFiles:{'app.js':'overwrite'}};});
  await page.evaluate(id=>AftercodeRepair.undo(id),id);assert.equal(await page.evaluate(()=>Aftercode.state.project.files['app.js'].includes('// user owns this edit')),true);assert.ok((await page.evaluate(()=>AcceptanceApp.state.error)).includes('新的修改'));
 }finally{await context.close();}
});
test('Node repair requires fresh approval for the modified code, then rechecks the original JSON cases', {timeout:60000},async()=>{
 const {context,page,errors}=await open({node:true});try{
  await diagnoseAndPlan(page);await page.locator('[data-acceptance-action="repair-review"]').click();await page.locator('.dialog [data-acceptance-action="repair-confirm"]').click();assert.ok((await page.locator('#rp-error').innerText()).includes('先确认'));assert.equal(await page.evaluate(()=>Aftercode.state.project.files['main.js'].includes('input.n+2')),true);
  await page.locator('#rp-trust').check();await page.locator('.dialog [data-acceptance-action="repair-confirm"]').click();await page.waitForFunction(()=>!AcceptanceApp.state.repairApplying&&AcceptanceApp.state.repairs.at(-1)?.status==='verified');assert.equal(await page.evaluate(()=>AcceptanceApp.state.repairs.at(-1).verification.passed),2);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('the write-ahead journal recovers applied code and undo metadata after an interrupted save', {timeout:60000},async()=>{
 const {context,page}=await open();try{
  await diagnoseAndPlan(page);await page.locator('[data-acceptance-action="repair-review"]').click();await page.locator('.dialog [data-acceptance-action="repair-apply-only"]').click();await page.waitForFunction(()=>!AcceptanceApp.state.repairApplying&&AcceptanceApp.state.repairs.at(-1)?.status==='applied');
  await page.evaluate(()=>{const s=AcceptanceApp.state,key='aftercode:acceptance:'+s.projectId,data=JSON.parse(localStorage.getItem(key));for(const r of data.repairs){r.status='proposed';delete r.transaction;delete r.appliedRevision;}localStorage.setItem(key,JSON.stringify(data));});
  await page.reload();await ready(page);assert.equal(await page.evaluate(()=>AcceptanceApp.state.repairs.at(-1).status),'applied');assert.ok(await page.evaluate(()=>AcceptanceApp.state.repairs.at(-1).transaction.beforeFiles['app.js'].includes('count + 2')));assert.equal(await page.evaluate(()=>Aftercode.state.project.files['app.js'].includes('count + 1')),true);
 }finally{await context.close();}
});
test('a cached successful repair is not shown as verified in a different execution environment', {timeout:60000},async()=>{
 const {context,page}=await open();try{await diagnoseAndPlan(page);await apply(page);await page.evaluate(()=>{AcceptanceApp.state.environmentId='another-server';AcceptanceApp.render();});assert.equal(await page.locator('.rp-workflow[data-repair-status="verified"]').count(),0);assert.equal(await page.locator('.rp-verification.is-pass').count(),0);assert.equal(await page.evaluate(()=>AcceptanceApp.state.repairs.at(-1).verification.passed),3);}finally{await context.close();}
});

test('manual judgment stays pending after code repair rather than becoming automatic success or a fabricated failure', {timeout:60000},async()=>{
 const {context,page}=await open();try{
  await page.evaluate(()=>{const s=AcceptanceApp.state;s.cases.push(AcceptanceDomain.createCase({id:'visual-review',title:'人工查看显示是否清楚',featureId:'complete',origin:'user',confirmed:true,expected:null,actions:[]},s.revision));});
  await diagnoseAndPlan(page);await page.locator('[data-acceptance-action="repair-review"]').click();await page.locator('.dialog [data-acceptance-action="repair-confirm"]').click();
  await page.waitForFunction(()=>!AcceptanceApp.state.repairApplying&&AcceptanceApp.state.repairs.at(-1)?.status==='needs_review');assert.equal(await page.locator('.rp-workflow[data-repair-status="verified"]').count(),0);assert.equal(await page.evaluate(()=>AcceptanceApp.state.repairs.at(-1).verification.passed),3);
 }finally{await context.close();}
});

test('more than thirty historical runs remain present after repair-state persistence and refresh', {timeout:60000},async()=>{
 const {context,page}=await open();try{
  await page.evaluate(()=>{const s=AcceptanceApp.state;for(let i=0;i<35;i++){s.runs.push({id:'historical-'+i,caseId:'old-case',revision:'old-source',status:'completed'});s.checks.push({id:'historical-check-'+i,runId:'historical-'+i,revision:'old-source',caseId:'old-case',state:'failed'});}AcceptanceApp.save();});
  await page.reload();await ready(page);assert.equal(await page.evaluate(()=>AcceptanceApp.state.runs.filter(r=>r.id.startsWith('historical-')).length),35);assert.equal(await page.evaluate(()=>AcceptanceApp.state.checks.filter(r=>r.id.startsWith('historical-check-')).length),35);
 }finally{await context.close();}
});

test('a new diagnosis after an applied repair can start the next modification cycle', {timeout:60000},async()=>{
 const {context,page}=await open();try{
  await diagnoseAndPlan(page);await apply(page);
  const previous=await page.evaluate(()=>AcceptanceApp.state.agentAnalyses.length);
  await page.evaluate(()=>{AcceptanceApp.state.modelStatus={configured:true};AcceptanceApp.actions['ask-case']({dataset:{id:AcceptanceApp.state.cases[0].id}});});
  await page.locator('#ac-share-approved').check();await page.locator('.dialog [data-acceptance-action="start-agent"]').click();await page.waitForFunction(n=>!AcceptanceApp.state.busy&&AcceptanceApp.state.agentAnalyses.length>n,previous);
  assert.equal(await page.locator('[data-acceptance-action="repair-generate"]').count(),1);assert.equal(await page.locator('.rp-workflow[data-repair-status="diagnosed"]').count(),1);assert.equal(await page.evaluate(()=>AcceptanceApp.state.repairs.length),1);
 }finally{await context.close();}
});
