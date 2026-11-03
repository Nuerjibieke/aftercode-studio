'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../domain/acceptance');
const { analyzeProject } = require('../analysis');
const { searchLogic } = require('../analysis/search');
test('project structure resolves TypeScript modules and exposes library functions without executing them', async () => {
  const p = D.normalizeProject({ name:'typed-project',entry:'index.html',files:{'index.html':'<script type="module" src="src/main.tsx"></script>','src/main.tsx':"import {calculate} from './rules'; export function App(){return <b>{calculate(2)}</b>}",'src/rules.ts':'export function calculate(value: number): number { if(value >= 2) return value + 1; return 0; }'} });
  const graph=await analyzeProject(p);
  assert.ok(graph.architecture.relations.some(edge=>edge.from==='file:src/main.tsx'&&edge.to==='file:src/rules.ts'));
  assert.ok(graph.features.some(f=>f.title==='calculate'));
  assert.ok(graph.nodes.some(node=>node.type==='condition'&&node.detail==='value >= 2'));
  assert.ok(graph.edges.some(edge=>edge.kind==='then'));
  assert.ok(graph.nodes.every(node=>D.validSourceRef(p,node.sourceRef)));
});
test('backend route labels come from actual framework registrations', async () => {
  const js=D.normalizeProject({name:'route',entry:'main.js',files:{'main.js':"const express=require('express');const app=express();app.post('/orders',(req,res)=>{if(req.body.qty>0)return res.send('ok');res.send('bad');});"}});
  const a=await analyzeProject(js);assert.ok(a.features.some(f=>f.title==='POST /orders'));assert.equal(a.architecture.modules[0].kind,'接口路由');
  const py=D.normalizeProject({name:'route-py',entry:'main.py',files:{'main.py':"from fastapi import FastAPI\napp=FastAPI()\n@app.get('/eligible')\ndef eligible(age:int):\n    return age>=18\n"}});
  const b=await analyzeProject(py);assert.ok(b.features.some(f=>f.title==='GET /eligible'));assert.equal(b.architecture.modules[0].kind,'接口路由');
});
test('logic search returns source-backed locations and cases, not a fabricated verification answer', async () => {
  const p=D.normalizeProject({name:'search',entry:'main.js',files:{'main.js':'export function increase(count){ return count+2; }'}});const graph=await analyzeProject(p);
  const result=searchLogic({project:p,graph,cases:[{id:'once',title:'一次计数只增加一',input:{count:0},expected:{value:1},confirmed:true}],goal:'每次计数增加一'},'计数');
  assert.equal(result.mode,'text-index');assert.ok(result.results.some(x=>x.kind==='case'&&x.id==='once'));assert.ok(!result.passed);
  assert.equal(searchLogic({project:p,graph},'never-matches-xyz').results.length,0);
});
