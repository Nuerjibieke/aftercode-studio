(() => {
  'use strict';
  const messages=window.AftercodeEnglish||{},key='aftercode:locale';
  const requested=new URLSearchParams(location.search).get('lang');let saved;
  try{saved=localStorage.getItem(key);}catch{}
  let locale=(requested||saved)==='en'?'en':'zh-CN';
  const texts=new WeakMap(),attributes=new WeakMap();let queued=false,observer;
  const hardProtected='script,style,pre,code,kbd,samp,textarea,iframe,[data-i18n-protect],.st-case-values strong,.ac-value-grid strong,.fx-values strong,.json-view,.rp-summary,.rp-diagnosis,.rp-workflow h3,.rp-review h3,.rp-review>p:not(.rp-standard),.st-search-answer p,.st-search-answer li,.st-plan-summary p,.st-plan-questions button,.fx-interpretation p,.ac-goal p,.ac-logic-goal,.ac-logic-node strong,.st-search-results button b,.st-search-results button small,.st-map-node strong,.st-module-heading h2,.st-module-summary p,.st-search-result-title';
  const names='#project-name,#header-name,#header-name *,#active-file,#file-tree,.file-tab,h1,.ac-case-main>b,.ac-case-main>strong,.ac-logic-node b,.ac-feature strong,.ac-feature b,.fm-feature strong,.fm-feature b,.fm-value strong,.fm-value b,.fm-heading h2,.st-nav-project span,.st-finding-nav span,.fx-details h2,.st-module-grid button strong,.history-list article b';
  const plural=(n,word)=>n+' '+word+(Number(n)===1?'':'s');
  const patterns=[
    [/^(\d+) 个可展开的功能或入口$/,(_,n)=>plural(n,'feature or entry point')+' to explore'],
    [/^(\d+) 个相关节点$/,(_,n)=>plural(n,'related node')],
    [/^应该得到 (.+)$/s,(_,value)=>'Expected '+value],
    [/^(\d+) 个情况需要核对$/,(_,n)=>plural(n,'case')+' to review'],
    [/^(\d+) 个验收点$/,(_,n)=>plural(n,'check')],
    [/^(\d+) 处需要核对$/,(_,n)=>plural(n,'issue')+' to review'],
    [/^(\d+) 个情况符合$/,(_,n)=>plural(n,'case')+' passed'],
    [/^待处理问题 (\d+)$/,(_,n)=>'Open issues: '+n],
    [/^已记录 (\d+) 次运行$/,(_,n)=>plural(n,'run')+' recorded'],
    [/^(\d+) 个文件 · (\d+) 处修改$/,(_,a,b)=>plural(a,'file')+' · '+plural(b,'change')],
    [/^已按原标准重验 (\d+) 项，(\d+) 项符合预期$/,(_,a,b)=>'Rechecked '+plural(a,'original criterion')+': '+b+' passed'],
    [/^保留原验收标准，重验 (\d+) 个已确认的情况。$/,(_,n)=>'Keep the original criteria and rerun '+plural(n,'confirmed case')+'.'],
    [/^后台验收 (\d+) \/ (\d+)：(.*)$/s,(_,a,b,c)=>'Checking '+a+' / '+b+': '+c],
    [/^(.+) · 第 (\d+) 行$/,(_,file,n)=>file+' · line '+n],
    [/^第 (\d+) 行$/,(_,n)=>'Line '+n],
    [/^包含 (\d+) 个可展开的步骤。$/,(_,n)=>'Contains '+plural(n,'step')+' to explore.'],
    [/^分析中提出了 (\d+) 个验证建议$/,(_,n)=>'The analysis proposed '+plural(n,'additional check')],
    [/^会执行 (\d+) 个独立的验收情况，并保存实际结果。关闭页面后也不会丢失。$/,(_,n)=>'Run '+plural(n,'independent case')+' and save the actual results, even if this page closes.'],
    [/^找到 (\d+) 处相关位置$/,(_,n)=>'Found '+plural(n,'matching location')],
    [/^(\d+) 个步骤$/,(_,n)=>plural(n,'step')],
    [/^(\d+) 个功能$/,(_,n)=>plural(n,'feature')],
    [/^(\d+) 个文件$/,(_,n)=>plural(n,'file')],
    [/^(.+ · )(已完成|正在验收|准备验收|未完成|已停止)$/,(_,time,status)=>time+(messages[status]||status)],
    [/^模型服务返回 HTTP (\d+)，请检查模型与授权配置$/,(_,n)=>'Model service returned HTTP '+n+'. Check the model and authorization settings.']
  ];
  function t(source){
    if(locale!=='en')return source;
    if(Object.hasOwn(messages,source))return messages[source];
    for(const [pattern,replace]of patterns)if(pattern.test(source))return source.replace(pattern,replace);
    return source;
  }
  function sampleName(node,source){
    const s=window.AcceptanceApp?.state;if(!s)return false;
    if(s.delivery.source==='sample-task'){
      const project=window.Aftercode?.state.project;
      if((project?.name===source||s.delivery.title===source)&&Object.values(window.AftercodeProjects||{}).some(p=>p.name===source||p.delivery?.title===source))return true;
      if((s.delivery.features||[]).some(f=>f.title===source))return true;
    }
    return [...s.cases,...(s.archivedCases||[])].some(c=>c.origin==='sample-task'&&c.title===source)&&Boolean(node.parentElement.closest('.ac-case,.fx-details,.history-list,.st-finding-nav'));
  }
  function protectedText(node,source){
    const el=node.parentElement;
    if(!el||el.closest('#ac-language-toggle')||el.closest(hardProtected))return true;
    return Boolean(el.closest(names))&&!sampleName(node,source);
  }
  function sourceFor(node){
    const prior=texts.get(node);
    return prior&&node.nodeValue===prior.rendered?prior.source:node.nodeValue;
  }
  function renderText(node){
    const source=sourceFor(node),parts=source.match(/^(\s*)([\s\S]*?)(\s*)$/),value=parts[2];
    if(!value||protectedText(node,value))return;
    let translated=t(value);
    if(locale==='en'&&node.parentElement.closest('.st-stat-row')&&/^\d+$/.test(node.previousSibling?.textContent||''))translated=({'验收点':'checks','符合':'passed','待核对':'to review','尚无结论':'not checked'})[value]||translated;
    if(locale==='en'&&translated!==value&&/^[A-Za-z]/.test(translated)&&/^\d+$/.test(node.previousSibling?.textContent||''))translated=' '+translated;
    const rendered=parts[1]+translated+parts[3];texts.set(node,{source,rendered});if(node.nodeValue!==rendered)node.nodeValue=rendered;
  }
  function switcher(){
    const host=document.querySelector('.header-actions');if(!host)return;
    let button=document.getElementById('ac-language-toggle');
    if(!button){button=document.createElement('button');button.id='ac-language-toggle';button.className='ac-language-toggle';button.type='button';host.append(button);}
    button.textContent=locale==='en'?'中文':'English';button.title=button.ariaLabel=locale==='en'?'Switch interface to Chinese':'切换为英文界面';button.lang=locale==='en'?'zh-CN':'en';
  }
  function localize(){
    queued=false;observer?.disconnect();
    try{
      document.documentElement.lang=locale;document.title=locale==='en'?'Aftercode · Verify AI-built software':'Aftercode · 验收 Agent 的交付';
      switcher();
      if(!document.body)return;
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
      while((node=walker.nextNode()))renderText(node);
      for(const el of document.querySelectorAll('[title],[aria-label],[placeholder]')){
        if(el.closest('#ac-language-toggle,pre,code,[data-i18n-protect]'))continue;
        const prior=attributes.get(el)||{};
        for(const name of ['title','aria-label','placeholder']){
          if(!el.hasAttribute(name))continue;
          const value=el.getAttribute(name),record=prior[name];const source=record&&value===record.rendered?record.source:value;
          const rendered=t(source);prior[name]={source,rendered};if(value!==rendered)el.setAttribute(name,rendered);
        }
        attributes.set(el,prior);
      }
    }finally{observer?.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder']});}
  }
  function schedule(){if(!queued){queued=true;queueMicrotask(localize);}}
  function setLocale(value){locale=value==='en'?'en':'zh-CN';try{localStorage.setItem(key,locale);const url=new URL(location.href);if(url.searchParams.has('lang')){url.searchParams.set('lang',locale);history.replaceState(null,'',url);}}catch{}localize();window.dispatchEvent(new CustomEvent('aftercode:locale-change',{detail:{locale}}));}
  document.addEventListener('click',event=>{if(!event.target.closest('#ac-language-toggle'))return;event.preventDefault();event.stopImmediatePropagation();setLocale(locale==='en'?'zh-CN':'en');},true);
  observer=new MutationObserver(schedule);
  window.AftercodeI18n={t,setLocale,localize,get locale(){return locale;},untranslated(){return [...document.querySelectorAll('body *')].flatMap(el=>[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&/[\u4e00-\u9fff]/.test(sourceFor(n))&&!protectedText(n,sourceFor(n).trim())&&t(sourceFor(n).trim())===sourceFor(n).trim()).map(n=>sourceFor(n).trim())).filter(Boolean);}};
  if(requested==='en'||requested==='zh'||requested==='zh-CN')setLocale(requested);else localize();
})();
