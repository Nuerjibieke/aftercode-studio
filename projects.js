window.AftercodeProjects = {
  focus: {
    name: 'focus', entry: 'index.html',
    files: {
      'index.html': `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><main class="card"><div class="logo">◒ <span>focus</span></div><div class="date">留一点时间，给重要的事。</div><h1>今天，又向前了一点。</h1><p class="subtitle">完成一次专注，就为自己记下一次。</p><section class="counter"><span class="caption">今日完成</span><strong id="count">0</strong><span class="unit">次专注</span><div class="dots"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></section><button id="complete">完成一次专注 <span>＋</span></button><button id="reset" class="secondary">重新开始</button></main><script src="app.js"></script></body></html>`,
      'style.css': `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:36px 24px;background:#f1f3ec;color:#2f4033;font:14px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.card{width:100%;max-width:450px;padding:36px 40px;background:#fff;border:1px solid #e4e9dc;border-radius:18px;box-shadow:0 14px 50px #263e2310}.logo{display:flex;align-items:center;gap:8px;font-size:26px;color:#728255}.logo span{font-size:19px;letter-spacing:-.7px;font-weight:650}.date{margin-top:28px;font-size:11px;color:#9aa28f}h1{font-size:22px;font-weight:550;letter-spacing:-.7px;margin:9px 0}.subtitle{font-size:12px;color:#9aa28f;margin:0}.counter{margin:30px 0 25px;background:#f5f7f0;border-radius:12px;text-align:center;padding:24px}.caption{display:block;font-size:11px;color:#8f9b7c}strong{display:block;font:76px Georgia,serif;line-height:1.35;color:#536b3c}.unit{font-size:11px;color:#93a17f}.dots{display:flex;justify-content:center;gap:6px;margin-top:18px}.dots i{width:7px;height:7px;border-radius:50%;background:#dfe7d3}.dots i.done{background:#839d65}button{font:12px inherit;width:100%;padding:13px 18px;border:0;border-radius:8px;cursor:pointer;background:#3d5b41;color:#fff;display:flex;align-items:center;justify-content:space-between}button:hover{filter:brightness(.95)}button:focus-visible{outline:3px solid #bdd594;outline-offset:3px}button span{font-size:18px}.secondary{background:none;color:#9aa58b;justify-content:center;font-size:11px;margin-top:8px}button:disabled{opacity:.5;cursor:wait}@media(max-width:400px){body{padding:15px}.card{padding:28px 23px}h1{font-size:20px}}`,
      'app.js': `let count = 0;
const output = document.querySelector('#count');
const complete = document.querySelector('#complete');

// 声明一个可以在写入前暂停的对象。
debug.expose('#count', { label: '今日完成', beforeCommit: true });

complete.addEventListener('click', async () => {
  complete.disabled = true;
  try {
    const next = count + 2;
    await debug.commit('#count', next, () => {
      count = next;
      output.textContent = count;
      document.querySelectorAll('.dots i').forEach((dot, i) => {
        dot.classList.toggle('done', i < count);
      });
    });
  } finally {
    complete.disabled = false;
  }
});

document.querySelector('#reset').addEventListener('click', async () => {
  await debug.commit('#count', 0, () => {
    count = 0;
    output.textContent = count;
    document.querySelectorAll('.dots i').forEach(dot => dot.classList.remove('done'));
  });
});`
    }
  },
  calculator: {
    name: 'calculator', entry: 'index.html',
    files: {
      'index.html': `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><main><span class="brand">比例计算器</span><h1>每一个数字，都算数。</h1><label>原始金额<input id="amount" type="number" value="100" step="0.01"></label><label>比例（%）<input id="rate" type="number" value="20"></label><button id="calculate">计算</button><section><span>计算结果</span><strong id="result">20.00</strong></section></main><script src="app.js"></script></body></html>`,
      'style.css': `*{box-sizing:border-box}body{margin:0;background:#f5f2ec;color:#51483b;min-height:100vh;display:grid;place-items:center;padding:25px;font:13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{width:100%;max-width:390px;padding:32px;background:#fff;border:1px solid #e8e2d8;border-radius:15px}.brand{font-size:11px;color:#aa9b85}h1{font-size:23px;margin:16px 0 24px}label{display:block;font-size:12px;margin:14px 0;color:#8d7d65}input{display:block;width:100%;border:1px solid #e2d9ca;padding:12px;font:15px inherit;margin-top:7px;border-radius:7px;color:#65543f}button{background:#8a7150;color:#fff;padding:12px;border:0;border-radius:7px;width:100%;cursor:pointer;margin-top:8px}section{margin-top:25px;border-top:1px solid #eee6d9;padding-top:20px}section span{font-size:11px;color:#aa9c87}strong{display:block;font:40px Georgia,serif;margin-top:7px;color:#7a6346}`,
      'app.js': `// 普通程序：没有 debug 接入，仍可选择、观察和检查 DOM。
const amount = document.querySelector('#amount');
const rate = document.querySelector('#rate');
const result = document.querySelector('#result');
document.querySelector('#calculate').addEventListener('click', () => {
  result.textContent = (Number(amount.value) * Number(rate.value) / 100).toFixed(2);
});`
    }
  },
  search: {
    name: 'search', entry: 'index.html',
    files: {
      'index.html': `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><main><span class="brand">FIELDNOTES</span><h1>找一点新灵感。</h1><div class="controls"><input id="query" placeholder="搜索 设计 或 工程" aria-label="关键词"><button id="search">搜索</button></div><div class="hint">“设计”需 800ms，“工程”需 150ms。</div><section id="results">等待搜索</section></main><script src="app.js"></script></body></html>`,
      'style.css': `*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#eef3f3;color:#3f5657;display:grid;place-items:center;padding:30px;font:13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{background:white;border:1px solid #dce6e5;border-radius:15px;padding:32px;max-width:480px;width:100%}.brand{font-size:10px;letter-spacing:2px;color:#89a5a3}h1{font-weight:550;font-size:24px;margin:15px 0 24px}.controls{display:flex;gap:9px}input{min-width:0;width:100%;padding:11px;border:1px solid #d3e0df;border-radius:7px;color:#526968}button{border:0;background:#496f6c;border-radius:7px;color:white;padding:8px 16px;white-space:nowrap;cursor:pointer}.hint{font-size:10px;color:#96a8a6;margin:10px 0 20px}section{min-height:80px;background:#f3f7f7;padding:20px;border-radius:8px;line-height:1.9;color:#6b8b88}`,
      'app.js': `const query = document.querySelector('#query');
const results = document.querySelector('#results');
const docs = ['设计：让状态可见', '设计：更少但更好的交互', '工程：隔离运行与可复验证据'];
debug.expose('#results', { label: '搜索结果', beforeCommit: true });
document.querySelector('#search').addEventListener('click', () => debug.task(async () => {
  const q = query.value;
  await new Promise(resolve => setTimeout(resolve, q === '设计' ? 800 : 150));
  const matches = docs.filter(text => text.includes(q));
  await debug.commit('#results', matches.join(' / ') || '没有结果', () => {
    results.textContent = matches.join(' / ') || '没有结果';
  });
}));`
    }
  }
};
