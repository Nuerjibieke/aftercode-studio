(() => {
  const projects = window.AftercodeProjects;
  projects.focus.runtime = 'web';
  projects.focus.description = '交付验收示例';
  projects.focus.delivery = {
    title: '专注记录', source: 'sample-task', goal: '每完成一次专注，完成次数只增加一次；重新开始后归零。',
    features: [{ id: 'complete', title: '记录一次完成', selector: '#complete' }, { id: 'reset', title: '重新开始', selector: '#reset' }],
    cases: [
      { id: 'complete-once', featureId: 'complete', title: '完成一次，次数增加一', origin: 'sample-task', confirmed: true, actions: [{ type: 'click', selector: '#complete' }], expected: { target: { kind: 'dom', selector: '#count' }, operator: 'equals', value: '1' } },
      { id: 'complete-twice', featureId: 'complete', title: '连续完成两次，累计为二', origin: 'sample-task', confirmed: true, actions: [{ type: 'click', selector: '#complete' }, { type: 'click', selector: '#complete' }], expected: { target: { kind: 'dom', selector: '#count' }, operator: 'equals', value: '2' } },
      { id: 'reset-count', featureId: 'reset', title: '重新开始，不保留上次计数', kind: 'regression', origin: 'sample-task', confirmed: true, actions: [{ type: 'click', selector: '#complete' }, { type: 'click', selector: '#reset' }], expected: { target: { kind: 'dom', selector: '#count' }, operator: 'equals', value: '0' } }
    ]
  };
  projects.focus.baseline = { entry: projects.focus.entry, runtime: 'web', files: { ...projects.focus.files, 'app.js': projects.focus.files['app.js'].replace('count + 2', 'count + 1') } };
  projects.calculator.runtime = 'web'; projects.calculator.description = '普通页面，无调试钩子';
  projects.search.runtime = 'web'; projects.search.description = '异步交互项目';
  projects['node-fees'] = {
    name: '费用计算', runtime: 'node', entry: 'main.js', description: 'Node.js / JSON 输入输出',
    files: { 'main.js': `let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const { goods, shipping, discountPct } = JSON.parse(input);
  const discount = Math.round((goods + shipping) * discountPct / 100);
  const total = goods + shipping - discount;
  console.log(JSON.stringify({ total }));
});` },
    delivery: {
      title: '费用计算', source: 'sample-task', goal: '只对商品金额打折，运费原价计入；金额单位为分。',
      features: [{ id: 'fees', title: '计算最终金额' }],
      cases: [
        { id: 'shipping-normal', featureId: 'fees', title: '商品享优惠，运费不参与', input: { goods: 10000, shipping: 1000, discountPct: 20 }, origin: 'sample-task', confirmed: true, expected: { target: { kind: 'json', path: 'total' }, operator: 'jsonEquals', value: 9000 } },
        { id: 'free-shipping', featureId: 'fees', title: '没有运费时仍正常计算', kind: 'regression', input: { goods: 10000, shipping: 0, discountPct: 20 }, origin: 'sample-task', confirmed: true, expected: { target: { kind: 'json', path: 'total' }, operator: 'jsonEquals', value: 8000 } }
      ]
    }
  };
  projects['python-eligibility'] = {
    name: '申请资格', runtime: 'python', entry: 'main.py', description: 'Python / 边界条件',
    files: { 'main.py': `import json
import sys

def can_apply(age):
    if age > 18:
        return True
    return False

data = json.load(sys.stdin)
print(json.dumps({"eligible": can_apply(data["age"])}))
` },
    delivery: {
      title: '申请资格', source: 'sample-task', goal: '年满 18 岁可申请，未满 18 岁不可申请。',
      features: [{ id: 'eligibility', title: '判断申请资格' }],
      cases: [
        { id: 'boundary-18', featureId: 'eligibility', title: '刚满十八岁也可以申请', input: { age: 18 }, kind: 'boundary', origin: 'sample-task', confirmed: true, expected: { target: { kind: 'json', path: 'eligible' }, operator: 'jsonEquals', value: true } },
        { id: 'under-18', featureId: 'eligibility', title: '未满十八岁不可申请', input: { age: 17 }, origin: 'sample-task', confirmed: true, expected: { target: { kind: 'json', path: 'eligible' }, operator: 'jsonEquals', value: false } },
        { id: 'over-18', featureId: 'eligibility', title: '成年申请保持正常', input: { age: 21 }, kind: 'regression', origin: 'sample-task', confirmed: true, expected: { target: { kind: 'json', path: 'eligible' }, operator: 'jsonEquals', value: true } }
      ]
    }
  };
})();
