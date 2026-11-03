'use strict';
const D = require('../domain/acceptance');
const capabilities = Object.freeze({
  web: { interactive: true, domObservation: true, structuredOutput: false, beforeCommit: 'requires-hook', sourceTrace: 'observed-boundaries-only' },
  node: { interactive: false, domObservation: false, structuredOutput: true, beforeCommit: false, sourceTrace: 'coverage-if-available' },
  python: { interactive: false, domObservation: false, structuredOutput: true, beforeCommit: false, sourceTrace: 'line-if-available' }
});
function makeRun(project, acceptanceCase) {
  return { id: D.id('run'), revision: D.revisionOf(project), runtime: project.runtime, projectName: project.name, caseId: acceptanceCase.id, caseTitle: acceptanceCase.title || '', input: D.copy(acceptanceCase.input ?? {}), actions: D.copy(acceptanceCase.actions || []), status: 'preparing', stdout: '', stderr: '', output: null, outputParsed: false, exitCode: null, observations: [], trace: [], evidence: [], startedAt: new Date().toISOString(), capabilities: capabilities[project.runtime] };
}
function normalizeInput(input) {
  if (input && typeof input === 'object' && !Array.isArray(input) && Object.hasOwn(input, 'stdin')) {
    const args = input.args || [];
    if (!Array.isArray(args) || args.length > 32 || args.some(value => typeof value !== 'string' || value.length > 4000)) throw new Error('运行参数必须是有限的字符串列表');
    return { stdin: typeof input.stdin === 'string' ? input.stdin : JSON.stringify(input.stdin), args };
  }
  return { stdin: typeof input === 'string' ? input : JSON.stringify(input ?? {}), args: [] };
}
module.exports = { capabilities, makeRun, normalizeInput };
