'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../domain/acceptance'), P = require('../domain/repairs');
const project = () => ({ name:'unseen-calculation', runtime:'node', entry:'clock.js', files:{'clock.js':'function next(n) { return n + 2; }\nconsole.log(next(0));\n','other.js':'export const label = "原来";\n'},delivery:{goal:'每次增加一',cases:[{id:'one',expected:{value:1}}]} });
const plan = (p, edits=[{file:'clock.js',oldText:'return n + 2;',newText:'return n + 1;',reason:'修正增加规则'}]) => P.createPlan(p,{title:'修正计算',summary:'按既定标准调整实现',edits,questions:[]});
test('a repair is a source-grounded proposal, not an execution fact, and changes only its exact source span',()=>{
 const p=project(),before=JSON.stringify(p),proposal=plan(p);assert.equal(proposal.status,'proposed');assert.ok(D.validSourceRef(p,proposal.edits[0].sourceRef));
 const result=P.applyPlan(p,proposal);assert.match(result.project.files['clock.js'],/return n \+ 1;/);assert.equal(result.project.files['other.js'],p.files['other.js']);
 assert.deepEqual(result.project.delivery,p.delivery);assert.equal(JSON.stringify(p),before);assert.notEqual(result.transaction.appliedRevision,proposal.baseRevision);
 assert.deepEqual(Object.entries(P.undo(result.project,result.transaction).files),Object.entries(p.files));
});
test('multiple edits use original offsets and are applied atomically across files',()=>{
 const p=project();const proposal=plan(p,[{file:'clock.js',oldText:'return n + 2;',newText:'return (n + 1);'},{file:'clock.js',oldText:'next(0)',newText:'next(10)'},{file:'other.js',oldText:'原来',newText:'更新'}]);
 const result=P.applyPlan(p,proposal);assert.match(result.project.files['clock.js'],/return \(n \+ 1\);/);assert.match(result.project.files['clock.js'],/next\(10\)/);assert.match(result.project.files['other.js'],/更新/);
 const before=JSON.stringify(p);assert.throws(()=>plan(p,[{file:'clock.js',oldText:'return n + 2;',newText:'return 1;'},{file:'other.js',oldText:'不存在',newText:'x'}]),/不一致/);assert.equal(JSON.stringify(p),before);
});
test('ambiguous, overlapping, missing and no-op edits cannot be applied',()=>{
 const p=project();assert.throws(()=>plan(p,[{file:'clock.js',oldText:'n',newText:'x'}]),/不唯一/);
 assert.throws(()=>plan(p,[{file:'clock.js',oldText:'return n + 2;',newText:'return 1;'},{file:'clock.js',oldText:'n + 2',newText:'n + 1'}]),/重叠/);
 assert.throws(()=>plan(p,[{file:'outside.js',oldText:'x',newText:'y'}]),/已有/);
 assert.throws(()=>plan(p,[{file:'clock.js',oldText:'return n + 2;',newText:'return n + 2;'}]),/实际修改/);
});
test('changed source blocks an old proposal and later manual edits block undo',()=>{
 const p=project(),proposal=plan(p),changed=structuredClone(p);changed.files['clock.js']+='// user edit\n';assert.throws(()=>P.applyPlan(changed,proposal),/代码已变化/);
 const applied=P.applyPlan(p,proposal);applied.project.files['other.js']+='// keep this\n';const before=JSON.stringify(applied.project);assert.throws(()=>P.undo(applied.project,applied.transaction),/新的修改/);assert.equal(JSON.stringify(applied.project),before);
});
test('repairs cannot rewrite tests, dependency configuration, credentials, standards or pass/fail claims',()=>{
 const p=project();for(const file of ['tests/a.js','a.spec.js','package.json','poetry.lock','.env']){p.files[file]='old';assert.throws(()=>plan(p,[{file,oldText:'old',newText:'new'}]),/不修改/);}
 for(const field of ['cases','runs','checks','decisions','status','passed','verification'])assert.throws(()=>P.createPlan(p,{title:'x',edits:[],[field]:true}),/不能改变/);
 assert.throws(()=>P.createPlan(p,{edits:[],questions:[]}),/精确修改/);
});
test('genuinely missing business information stays a question, not a fake applicable repair',()=>{
 const p=project(),proposal=P.createPlan(p,{summary:'缺少金额取整标准',edits:[],questions:['金额应向上取整还是四舍五入？']});assert.equal(proposal.status,'needs_info');assert.equal(proposal.edits.length,0);assert.throws(()=>P.applyPlan(p,proposal),/补充|没有可应用/);
});
test('the standard fingerprint changes with oracle, inputs or confirmation, not source revision',()=>{
 const c=D.createCase({id:'one',origin:'user',confirmed:true,input:{n:0},expected:{target:{kind:'json'},operator:'jsonEquals',value:1}},'before');
 assert.equal(P.criteriaKey([c]),P.criteriaKey([{...c,revision:'after'}]));assert.notEqual(P.criteriaKey([c]),P.criteriaKey([{...c,expected:{...c.expected,value:2}}]));assert.notEqual(P.criteriaKey([c]),P.criteriaKey([{...c,confirmed:false}]));
});
