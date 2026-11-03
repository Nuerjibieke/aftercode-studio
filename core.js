/* Shared runtime: facts, semantic commit boundaries, and immutable run snapshots. */
(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  class Cancelled extends Error { constructor() { super('运行已取消'); this.name = 'Cancelled'; } }
  class Runtime {
    constructor({ app, version, input, rule, parent = null, onChange = () => {} }) {
      this.id = uid('run');
      this.instanceId = uid('app');
      this.app = app;
      this.version = version;
      this.input = clone(input);
      this.rule = clone(rule);
      this.parent = parent;
      this.events = [];
      this.observations = [];
      this.checks = [];
      this.predictions = [];
      this.state = {};
      this.startedAt = new Date().toISOString();
      this.status = 'idle';
      this.control = 'free';
      this.breakpoint = false;
      this.pending = null;
      this.revision = 0;
      this.cancelled = false;
      this.onChange = onChange;
      this.queue = Promise.resolve();
    }
    notify() { this.onChange(this); }
    event(type, label, detail = {}) {
      if (this.cancelled) return null;
      const event = { id: uid('evt'), runId: this.id, instanceId: this.instanceId, type, label, detail: clone(detail), at: new Date().toISOString(), revision: this.revision };
      this.events.push(event);
      this.notify();
      return event;
    }
    observe(object, value, source) {
      if (this.cancelled) return;
      const observation = { id: uid('obs'), runId: this.id, instanceId: this.instanceId, object, value: clone(value), source, at: new Date().toISOString(), revision: this.revision };
      this.observations.push(observation);
      this.notify();
      return observation;
    }
    check(expected, actual, label, evidence = []) {
      const check = { id: uid('check'), runId: this.id, rule: clone(this.rule), expected: clone(expected), actual: clone(actual), passed: JSON.stringify(expected) === JSON.stringify(actual), label, evidence: clone(evidence), at: new Date().toISOString() };
      this.checks.push(check);
      this.notify();
      return check;
    }
    requestPause() { this.control = 'requested'; this.notify(); }
    step() {
      if (!this.pending) return false;
      const pending = this.pending;
      this.pending = null;
      this.control = 'stepping';
      pending.release();
      this.notify();
      return true;
    }
    continue() {
      this.control = 'free';
      if (this.pending) { const pending = this.pending; this.pending = null; pending.release(); }
      this.notify();
    }
    async boundary(name, proposal, commit, guard = () => true) {
      const operation = async () => {
        if (this.cancelled) throw new Cancelled();
        const id = uid('boundary');
        this.event('proposal', name, { boundaryId: id, proposal });
        if (this.breakpoint || ['requested', 'stepping'].includes(this.control)) {
          await new Promise((resolve, reject) => {
            this.pending = { id, name, proposal: clone(proposal), release: resolve, reject };
            this.control = 'paused';
            this.notify();
          });
        }
        if (this.cancelled) throw new Cancelled();
        if (!guard()) { this.event('ignored', '拒绝过期提交', { boundaryId: id, proposal }); return false; }
        await commit();
        if (this.cancelled) throw new Cancelled();
        this.revision++;
        this.event('commit', name, { boundaryId: id, proposal });
        return true;
      };
      const result = this.queue.then(operation);
      this.queue = result.catch(() => {});
      return result;
    }
    cancel() {
      if (this.cancelled) return;
      this.event('cancel', '封存运行；旧回调失效');
      this.cancelled = true;
      this.status = 'cancelled';
      if (this.pending) { this.pending.reject(new Cancelled()); this.pending = null; }
      this.notify();
    }
    snapshot() {
      return clone({ id: this.id, instanceId: this.instanceId, app: this.app, version: this.version, input: this.input, rule: this.rule, parent: this.parent, state: this.state, events: this.events, observations: this.observations, checks: this.checks, predictions: this.predictions, revision: this.revision, status: this.status, startedAt: this.startedAt });
    }
  }
  function compareValues(actual, expected, operator) {
    if (operator === 'equals') return actual === expected;
    if (operator === 'contains') return actual.includes(expected);
    if (!['greater', 'less'].includes(operator)) return null;
    const a = Number(actual), b = Number(expected);
    if (actual.trim() === '' || expected.trim() === '' || !Number.isFinite(a) || !Number.isFinite(b)) return null;
    return operator === 'greater' ? a > b : a < b;
  }
  const api = { Runtime, Cancelled, clone, uid, compareValues };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.IntentCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
