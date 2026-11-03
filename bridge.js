window.AftercodeBridge = function (runId) {
  'use strict';
  const send = (kind, data = {}) => parent.postMessage({ channel: 'aftercode', runId, kind, data }, '*');
  let selecting = false;
  let replaying = false;
  let sequence = 0;
  let activeTasks = 0;
  const permits = new Map();
  const watching = new Set();
  const signatures = new Map();
  const style = document.createElement('style');
  style.textContent = '[data-ac-hover]{outline:2px solid #879e5d!important;outline-offset:3px!important;cursor:crosshair!important}[data-ac-selected]{outline:2px solid #879e5d!important;outline-offset:3px!important}';
  document.head.appendChild(style);
  const selectorFor = el => {
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      const tag = el.tagName.toLowerCase();
      const siblings = el.parentElement ? [...el.parentElement.children].filter(node => node.tagName === el.tagName) : [];
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(el) + 1})` : tag);
      el = el.parentElement;
    }
    return parts.join(' > ');
  };
  const inspect = selector => {
    let el;
    try { el = document.querySelector(selector); } catch { return null; }
    if (!el) return null;
    return { selector, tag: el.tagName.toLowerCase(), value: 'value' in el ? String(el.value) : el.textContent.trim(), source: 'value' in el ? 'DOM.value' : 'DOM.textContent.trim()', attributes: [...el.attributes].filter(a => !a.name.startsWith('data-ac-')).map(a => [a.name, a.value]) };
  };
  const observe = (selector, force = false) => {
    const data = inspect(selector);
    if (!data) { if (force) send('missing', { selector }); return; }
    const signature = JSON.stringify(data);
    if (force || signatures.get(selector) !== signature) { signatures.set(selector, signature); send('observation', data); }
  };
  window.debug = Object.freeze({
    expose(selector, options = {}) { send('capability', { selector, label: String(options.label || selector), beforeCommit: options.beforeCommit === true }); },
    async commit(selector, value, apply) {
      if (typeof apply !== 'function') throw new Error('debug.commit requires an apply function');
      const id = `commit-${++sequence}`;
      await new Promise((resolve, reject) => {
        permits.set(id, { resolve, reject });
        send('boundary', { id, selector, value: structuredClone(value), label: `更新 ${selector}` });
      });
      try {
        await apply();
        await Promise.resolve();
        send('committed', { id, observation: inspect(selector) });
      } catch (error) { send('commit-error', { id, message: error.message }); throw error; }
    },
    observe(selector) { watching.add(selector); observe(selector, true); },
    async task(work) { activeTasks++; try { return await work(); } finally { activeTasks--; } }
  });
  const settle = async () => {
    // Replayed actions wait for registered asynchronous work, not arbitrary timers.
    await new Promise(resolve => setTimeout(resolve, 0));
    while (permits.size || activeTasks) await new Promise(resolve => setTimeout(resolve, 20));
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  window.addEventListener('message', async event => {
    const message = event.data;
    if (event.source !== parent || message?.channel !== 'aftercode-control' || message.runId !== runId) return;
    const { kind, data = {} } = message;
    if (kind === 'permit') { const pending = permits.get(data.id); permits.delete(data.id); pending?.resolve(); }
    if (kind === 'select-mode') {
      selecting = data.enabled;
      document.querySelectorAll('[data-ac-hover]').forEach(el => el.removeAttribute('data-ac-hover'));
    }
    if (kind === 'observe') { watching.add(data.selector); observe(data.selector, true); }
    if (kind === 'unwatch') watching.delete(data.selector);
    if (kind === 'inspect') {
      document.querySelectorAll('[data-ac-selected]').forEach(el => el.removeAttribute('data-ac-selected'));
      const el = document.querySelector(data.selector);
      if (el) { el.setAttribute('data-ac-selected', ''); send('selected', inspect(data.selector)); }
      else send('missing', { selector: data.selector });
    }
    if (kind === 'replay') {
      replaying = true;
      try {
        let previousTime = data.actions[0]?.atMs;
        for (const action of data.actions) {
          const delay = Math.max(0, (action.atMs ?? 0) - (previousTime ?? 0));
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          previousTime = action.atMs;
          while (permits.size) await new Promise(resolve => setTimeout(resolve, 20));
          const el = document.querySelector(action.selector);
          if (!el) throw new Error(`无法重放：${action.selector} 不存在`);
          if (action.type === 'change') { el.value = action.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
          else el.click();
        }
        await settle();
        send('replayed', { count: data.actions.length });
      } catch (error) { send('replay-error', { message: error.message }); }
      finally { replaying = false; }
    }
  });
  document.addEventListener('pointerover', event => {
    if (!selecting) return;
    document.querySelectorAll('[data-ac-hover]').forEach(el => el.removeAttribute('data-ac-hover'));
    if (event.target instanceof Element) event.target.setAttribute('data-ac-hover', '');
  }, true);
  let suppressClick = false;
  const select = event => {
    if (event.type === 'click' && suppressClick) {
      suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); return true;
    }
    if (!selecting) return false;
    event.preventDefault(); event.stopImmediatePropagation();
    suppressClick = event.type === 'pointerdown';
    const el = event.target instanceof Element ? event.target : event.target.parentElement;
    const selector = selectorFor(el);
    document.querySelectorAll('[data-ac-selected],[data-ac-hover]').forEach(node => { node.removeAttribute('data-ac-selected'); node.removeAttribute('data-ac-hover'); });
    el.setAttribute('data-ac-selected', '');
    selecting = false; watching.add(selector);
    send('selected', inspect(selector)); observe(selector, true);
    return true;
  };
  document.addEventListener('pointerdown', select, true);
  document.addEventListener('click', event => {
    if (select(event)) return;
    const el = event.target.closest('button,input,select,textarea,a') || event.target;
    if (el.closest('a[href]')) { event.preventDefault(); send('console', { level: 'info', args: ['此预览不支持跨页面导航。'] }); }
    if (!replaying) send('action', { type: 'click', selector: selectorFor(el), atMs: performance.now() });
  }, true);
  document.addEventListener('change', event => {
    const selector = selectorFor(event.target);
    if (!replaying) send('action', { type: 'change', selector, value: event.target.value, atMs: performance.now() });
    for (const key of watching) observe(key);
  }, true);
  new MutationObserver(mutations => {
    if (mutations.every(m => m.type === 'attributes' && m.attributeName?.startsWith('data-ac-'))) return;
    for (const selector of watching) observe(selector);
  }).observe(document.documentElement, { subtree: true, characterData: true, childList: true, attributes: true });
  for (const level of ['log', 'warn', 'error', 'info']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      send('console', { level, args: args.map(value => { try { return typeof value === 'string' ? value : JSON.stringify(value); } catch { return String(value); } }) });
      original(...args);
    };
  }
  window.addEventListener('error', event => send('console', { level: 'error', args: [event.message], line: event.lineno }));
  window.addEventListener('unhandledrejection', event => send('console', { level: 'error', args: [String(event.reason?.message || event.reason)] }));
  window.addEventListener('DOMContentLoaded', () => send('ready'));
};
