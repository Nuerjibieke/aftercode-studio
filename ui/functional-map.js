(() => {
  'use strict';
  const V=window.AcceptanceView, original=V.renderLogic;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function functionalMap(m){
    const explicit=m.features.filter(f=>m.delivery.features?.some(x=>x.id===f.id)||m.cases.some(c=>c.featureId===f.id)||f.source==='model-inference');
    const features=(explicit.length?explicit:m.features).slice(0,8);
    const targets=new Map(),links=[];
    for(const f of features){
      for(const node of m.graph.nodes.filter(node=>f.nodeIds?.includes(node.id)&&node.selector&&node.evidenceType==='commit-boundary')){
        const id='value:'+node.selector;
        if(!targets.has(id))targets.set(id,{id,title:node.objectLabel||node.label.replace(/^更新[“]?/,'').replace(/[”]$/,''),selector:node.selector});
        if(!links.some(link=>link.from===f.id&&link.to===id))links.push({from:f.id,to:id});
      }
    }
    const height=Math.max(330,features.length*112+50,targets.size*112+50);
    const positions=new Map(features.map((f,i)=>[f.id,{x:35,y:28+i*112}]));[...targets.values()].forEach((target,i)=>positions.set(target.id,{x:420,y:42+i*112}));
    return `<section class="fm-main"><header class="fm-heading"><div><span>功能脉络</span><h2>${esc(m.delivery.title||m.project.name)}</h2></div><button class="st-button is-secondary" data-acceptance-action="overview">验收需求</button></header><p class="fm-intro">选择一个功能，继续看它的规则、条件和数据变化。</p><div class="st-architecture-canvas fm-canvas"><svg width="730" height="${height}" viewBox="0 0 730 ${height}" aria-label="功能与状态关系"><defs><marker id="fm-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="none" stroke="#afbed9"/></marker></defs>${links.map(link=>{const a=positions.get(link.from),b=positions.get(link.to);return `<path class="st-map-edge" d="M${a.x+235},${a.y+44}C330,${a.y+44} 355,${b.y+40} ${b.x},${b.y+40}" marker-end="url(#fm-arrow)"/><text x="330" y="${(a.y+b.y)/2+29}" class="fm-edge-label">更新</text>`}).join('')}${features.map(f=>{const p=positions.get(f.id),cases=m.cases.filter(c=>c.featureId===f.id),failed=cases.filter(c=>m.checks.filter(x=>x.caseId===c.id&&x.revision===m.revision&&x.ruleRevision===c.ruleRevision).at(-1)?.state==='failed').length;return `<foreignObject x="${p.x}" y="${p.y}" width="240" height="94"><div xmlns="http://www.w3.org/1999/xhtml"><button class="fm-feature ${failed?'has-issue':''}" data-acceptance-action="drill-feature" data-id="${esc(f.id)}"><span>${f.source==='model-inference'?'模型整理':m.delivery.features?.some(x=>x.id===f.id)?'任务中的功能':'实现入口'}</span><b>${esc(f.title)}</b><small>${failed?`${failed} 个情况需要核对`:cases.length?`${cases.length} 个验收点`:'可以继续展开'}</small></button></div></foreignObject>`}).join('')}${[...targets.values()].map(target=>{const p=positions.get(target.id);return `<foreignObject x="${p.x}" y="${p.y}" width="250" height="90"><div xmlns="http://www.w3.org/1999/xhtml"><div class="fm-value"><span>共享状态 / 页面对象</span><b>${esc(target.title)}</b><small>${esc(target.selector)}</small></div></div></foreignObject>`}).join('')}</svg>${!features.length?'<div class="st-empty"><h3>先整理这份实现的脉络</h3><p>可以打开一个项目，或从已有验收需求开始梳理。</p></div>':''}</div></section>`;
  }
  V.renderLogic=m=>{
    const html=original(m);
    if((m.logicLevel||'feature')!=='project')return html;
    const controls=`<div class="fm-view-switch"><button class="${m.logicMapMode!=='files'?'active':''}" data-acceptance-action="logic-map-functions">功能逻辑</button><button class="${m.logicMapMode==='files'?'active':''}" data-acceptance-action="logic-map-files">文件关系</button><button class="fm-model-action" data-acceptance-action="analyze-architecture">梳理整体逻辑</button></div>`;
    if(m.logicMapMode==='files')return html.replace('<div class="st-breadcrumb">',controls+'<div class="st-breadcrumb">');
    const start=html.indexOf('<div class="st-breadcrumb">');
    return start<0?html:html.slice(0,start)+controls+functionalMap(m)+'</div>';
  };
})();
