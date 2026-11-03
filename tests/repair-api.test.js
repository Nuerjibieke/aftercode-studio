'use strict';
const { test }=require('node:test'), assert=require('node:assert/strict'), http=require('node:http'), fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const D=require('../domain/acceptance'), P=require('../domain/repairs'),G=require('../agent/gateway'),{analyzeProject}=require('../analysis'),{createServer}=require('../server');
const project={name:'public-repair-fixture',runtime:'node',entry:'main.js',files:{'main.js':'const input=JSON.parse(require("node:fs").readFileSync(0,"utf8"));\nconsole.log(JSON.stringify({count:input.count+2}));\n'}};
const proposal={title:'修正单次增量',summary:'把增量改为一；按原标准重验。',edits:[{file:'main.js',oldText:'input.count+2',newText:'input.count+1',reason:'实现与预期不同'}],questions:[]};
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
async function close(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
function reply(res,data){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(data)}}]}));}
test('repair uses the real HTTP model protocol, grounded snippets and no fabricated checks',async()=>{
 let calls=0;const model=http.createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;const body=JSON.parse(text);calls++;assert.ok(body.messages[0].content.includes('修改建议'));assert.ok(body.messages[1].content.includes('input.count+2'));reply(res,proposal);});const base=await listen(model);
 try{const graph=await analyzeProject(project);const result=await G.analyzeWithModel({project,graph,purpose:'repair',goal:'每次增加一',diagnosis:{revision:graph.revision,summary:'源码使用加二'},config:{baseUrl:base,model:'test',apiKey:'synthetic-test-only'}});assert.equal(calls,1);assert.equal(result.source,'model');assert.equal(result.status,'proposed');assert.equal(result.baseRevision,D.revisionOf(project));assert.equal(result.checks,undefined);assert.equal(result.cases,undefined);assert.match(P.applyPlan(project,result).project.files['main.js'],/input.count\+1/);}finally{await close(model);}
});
test('malformed or ungrounded repairs get at most one structural correction; stale diagnosis never calls the model',async()=>{
 let calls=0;const model=http.createServer((req,res)=>{calls++;reply(res,{...proposal,edits:[{file:'main.js',oldText:'invented source',newText:'something'}]});});const base=await listen(model);
 try{const graph=await analyzeProject(project),config={baseUrl:base,model:'test',apiKey:'synthetic-test-only'};await assert.rejects(G.analyzeWithModel({project,graph,purpose:'repair',diagnosis:{revision:'wrong',summary:'old'},config}),/当前代码/);assert.equal(calls,0);await assert.rejects(G.analyzeWithModel({project,graph,purpose:'repair',diagnosis:{revision:graph.revision,summary:'加二'},config}),/不一致/);assert.equal(calls,2);}finally{await close(model);}
});
test('repair API streams only a proposal, requires sharing approval and serves the repair contract',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'aftercode-repair-api-'));let calls=0;const model=http.createServer((req,res)=>{calls++;reply(res,proposal);});const modelUrl=await listen(model);const app=createServer({privateDir:dir}),url=await listen(app);
 try{
  const key='synthetic-key-never-returned';const config=await fetch(url+'/api/model/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseUrl:modelUrl,model:'test',apiKey:key})});assert.equal(config.status,200);assert.ok(!(await config.text()).includes(key));
  const payload={project,purpose:'repair',goal:'每次加一',diagnosis:{revision:D.revisionOf(project),summary:'当前实现加二'}};
  const denied=await fetch(url+'/api/agent/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(denied.status,403);assert.equal(calls,0);
  const response=await fetch(url+'/api/agent/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,shareApproved:true})});assert.equal(response.status,200);const text=await response.text();assert.ok(!text.includes(key));const events=text.trim().split('\n').map(JSON.parse);const result=events.find(e=>e.type==='result').data;assert.equal(result.purpose,'repair');assert.equal(result.status,'proposed');assert.equal(result.edits.length,1);assert.equal(result.checks,undefined);assert.equal(calls,1);
  const script=await fetch(url+'/domain/repairs.js');assert.equal(script.status,200);assert.ok((await script.text()).includes('applyPlan'));
 }finally{await close(app);await close(model);await fs.rm(dir,{recursive:true,force:true});}
});
