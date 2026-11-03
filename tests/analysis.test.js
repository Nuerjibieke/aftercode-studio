'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../domain/acceptance');
const { analyzeProject, sliceGraph, validateGraph } = require('../analysis');
test('unseen JavaScript extracts actual events, conditions, state and valid sources', async () => {
  const project = D.normalizeProject({ name: 'new', entry: 'main.js', files: { 'main.js': `const button = document.querySelector('#go');\nconst out = document.querySelector('#answer');\nbutton.addEventListener('click', () => {\n const amount = 4 + 3;\n if (amount > 5) out.textContent = amount;\n});` } });
  const graph = await analyzeProject(project);
  assert.ok(graph.nodes.some(node => node.type === 'condition' && node.detail === 'amount > 5'));
  assert.ok(graph.nodes.some(node => node.type === 'state' && node.selector === '#answer'));
  assert.equal(graph.features[0].trigger.selector, '#go');
  assert.equal(validateGraph(project, graph), true);
  assert.ok(sliceGraph(graph, graph.features[0].id).nodes.length > 2);
  graph.nodes[0].sourceRef.file = 'invented.js';
  assert.throws(() => validateGraph(project, graph));
});
test('Python analysis parses without executing the imported program', async () => {
  const project = D.normalizeProject({ name: 'py', entry: 'main.py', files: { 'main.py': `raise RuntimeError('must not execute')\ndef allowed(age):\n    if age >= 21:\n        return True\n    return False\n` } });
  const graph = await analyzeProject(project);
  assert.ok(graph.nodes.some(node => node.type === 'condition' && node.detail.includes('age >= 21') && node.label.includes('不小于')));
  assert.equal(validateGraph(project, graph), true);
});
test('broken or unsupported source preserves explicit gaps instead of inventing a graph', async () => {
  const project = D.normalizeProject({ name: 'broken', entry: 'x.js', files: { 'x.js': 'function {' } });
  const graph = await analyzeProject(project);
  assert.equal(graph.nodes.length, 0);
  assert.ok(graph.gaps.length);
});
