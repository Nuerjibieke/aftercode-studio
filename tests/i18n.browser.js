'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{createServer}=require('../server'),D=require('../domain/acceptance');
let server,browser,url;
before(async()=>{server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});});
after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
async function ready(page){await page.waitForFunction(()=>window.AftercodeI18n&&window.AcceptanceApp&&!AcceptanceApp.state.loading&&AcceptanceApp.state.environmentId);await page.evaluate(()=>AftercodeI18n.localize());}
async function open({locale='zh-CN',width=1440}={}){const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();await page.goto(url+'/?lang='+locale);await ready(page);return{context,page};}
async function overview(page){await page.locator('.view-tabs [data-acceptance-action="overview"]').click();}
async function finish(page){await page.waitForFunction(()=>!AcceptanceApp.state.busy&&AcceptanceApp.state.currentRound?.status==='completed');}
test('language switching preserves user requirements, identifiers, code, assertion literals and real observations', {timeout:60000},async()=>{
 const {context,page}=await open();try{
  await page.evaluate(async()=>{await Aftercode.loadProject({name:'开始验收',runtime:'web',entry:'index.html',files:{'index.html':'<html><body><output id="answer">符合</output><button id="go">Go</button><script>document.querySelector("#go").onclick=()=>document.querySelector("#answer").textContent="符合";</script></body></html>'},delivery:{title:'开始验收',source:'user',goal:'开始验收。这是用户需求，不应该被翻译。',features:[{id:'f',title:'验收',selector:'#go'}],cases:[{id:'custom',title:'开始验收',featureId:'f',origin:'user',confirmed:true,actions:[{type:'click',selector:'#go'}],expected:{target:{kind:'dom',selector:'#answer'},operator:'equals',value:'符合'}}]}});});await page.waitForFunction(()=>AcceptanceApp.state.delivery.source==='user'&&!AcceptanceApp.state.loading);await overview(page);
  await page.locator('#ac-workbench [data-acceptance-action="run-all"]').click();await finish(page);
  const before=await page.evaluate(()=>JSON.stringify({project:Aftercode.state.project,cases:AcceptanceApp.state.cases,checks:AcceptanceApp.state.checks,draft:AcceptanceApp.state.requirementDraft}));
  await page.locator('#ac-language-toggle').click();assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.equal(await page.locator('#ac-workbench [data-acceptance-action="run-all"]').innerText(),'Run checks');assert.equal(await page.locator('.st-case-main>b,.ac-case-main>b').first().innerText(),'开始验收');
  assert.equal(await page.locator('#ac-requirement-input').inputValue(),'开始验收。这是用户需求，不应该被翻译。');
  assert.deepEqual(await page.locator('.st-case-values strong').allTextContents(),['符合','符合']);assert.equal(await page.locator('#header-name').innerText(),'开始验收');
  assert.equal(await page.evaluate(()=>JSON.stringify({project:Aftercode.state.project,cases:AcceptanceApp.state.cases,checks:AcceptanceApp.state.checks,draft:AcceptanceApp.state.requirementDraft})),before);
  await page.locator('#ac-language-toggle').click();assert.equal(await page.locator('#ac-workbench [data-acceptance-action="run-all"]').innerText(),'开始验收');assert.equal(await page.evaluate(()=>JSON.stringify({project:Aftercode.state.project,cases:AcceptanceApp.state.cases,checks:AcceptanceApp.state.checks,draft:AcceptanceApp.state.requirementDraft})),before);
 }finally{await context.close();}
});
test('English covers navigation, project maps and dialogs, and the selected language survives reload', {timeout:60000},async()=>{
 const {context,page}=await open({locale:'en'});try{
  assert.equal(await page.locator('.view-tabs [data-acceptance-action="overview"]').innerText(),'Acceptance');assert.equal(await page.locator('.fm-heading>div>span').innerText(),'Feature map');
  assert.deepEqual(await page.evaluate(()=>AftercodeI18n.untranslated()),[]);
  await overview(page);for(const action of ['model-settings','edit-goal','add-case','history','about','research']){await page.evaluate(async action=>{await AcceptanceApp.actions[action]();},action);await page.evaluate(()=>AftercodeI18n.localize());assert.deepEqual(await page.evaluate(()=>AftercodeI18n.untranslated()),[],action);await page.locator('.dialog [data-acceptance-action="close-dialog"]').first().click();}
  await page.locator('#ac-language-toggle').click();await page.reload();await ready(page);assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');assert.equal(await page.locator('.view-tabs [data-acceptance-action="overview"]').innerText(),'验收');
  await page.locator('#ac-language-toggle').click();await page.reload();await ready(page);assert.equal(await page.locator('html').getAttribute('lang'),'en');
 }finally{await context.close();}
});
test('the complete English repair flow sends the chosen response language and keeps the original criteria', {timeout:60000},async()=>{
 const {context,page}=await open({locale:'en'}),languages=[];try{
  await page.route('**/api/agent/analyze',async route=>{const body=route.request().postDataJSON();languages.push(body.language);const revision=D.revisionOf(body.project),data=body.purpose==='repair'?{title:'Correct the increment',summary:'Increase by one and keep reset behavior.',baseRevision:revision,source:'model',edits:[{file:'app.js',oldText:'const next = count + 2;',newText:'const next = count + 1;',reason:'Meet the original requirement'}],questions:[]}:{revision,source:'model',purpose:'diagnose',summary:'The code adds two rather than one.',features:[],cases:[],questions:[],nodeAnnotations:[]};await route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'result',data})+'\n'});});
  await overview(page);await page.locator('#ac-workbench [data-acceptance-action="run-all"]').click();await finish(page);const criteria=await page.evaluate(()=>RepairDomain.criteriaKey(AcceptanceApp.state.cases));
  await page.evaluate(()=>{AcceptanceApp.state.modelStatus={configured:true};AcceptanceApp.actions['ask-case']({dataset:{id:AcceptanceApp.state.cases[0].id}});});await page.locator('#ac-share-approved').check();assert.equal(await page.locator('.dialog [data-acceptance-action="start-agent"]').innerText(),'Start analysis');await page.locator('.dialog [data-acceptance-action="start-agent"]').click();await page.waitForFunction(()=>!AcceptanceApp.state.busy&&AcceptanceApp.state.agentAnalyses.length>0);
  await page.locator('[data-acceptance-action="repair-generate"]').click();await page.waitForFunction(()=>!AcceptanceApp.state.busy&&AcceptanceApp.state.repairs.length>0);await page.locator('[data-acceptance-action="repair-review"]').click();assert.equal(await page.locator('.dialog [data-acceptance-action="repair-confirm"]').innerText(),'Apply & recheck');await page.locator('.dialog [data-acceptance-action="repair-confirm"]').click();await page.waitForFunction(()=>!AcceptanceApp.state.repairApplying&&AcceptanceApp.state.repairs.at(-1)?.status==='verified');
  assert.deepEqual(languages,['en','en']);assert.equal(await page.evaluate(()=>RepairDomain.criteriaKey(AcceptanceApp.state.cases)),criteria);assert.equal(await page.locator('.rp-status').innerText(),'Recheck passed');assert.match(await page.locator('.rp-verification').innerText(),/3 passed/);
 }finally{await context.close();}
});
test('the language switch and English acceptance view remain usable on mobile', {timeout:60000},async()=>{
 const {context,page}=await open({locale:'en',width:390});try{assert.equal(await page.locator('#ac-language-toggle').isVisible(),true);await overview(page);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('#ac-language-toggle').click();assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}finally{await context.close();}
});
