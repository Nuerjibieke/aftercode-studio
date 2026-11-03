import ast
import json
import sys

project = json.load(sys.stdin)
revision = project['revision']
nodes, edges, features, gaps, symbols, dependencies = [], [], [], [], [], []
for filename, source in project['files'].items():
    if not filename.endswith('.py'):
        continue
    if len(source) > 500000:
        gaps.append({'file': filename, 'message': '文件过大，未解析'})
        continue
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError as error:
        gaps.append({'file': filename, 'message': '无法解析：' + str(error)})
        continue
    file_ids = []
    framework_classes = set()
    framework_modules = set()
    route_instances = set()
    for item in ast.walk(tree):
        if isinstance(item, ast.ImportFrom) and item.module in ('fastapi', 'flask'):
            for alias in item.names:
                if alias.name in ('FastAPI', 'APIRouter', 'Flask'):
                    framework_classes.add(alias.asname or alias.name)
        if isinstance(item, ast.Import):
            for alias in item.names:
                if alias.name in ('fastapi', 'flask'):
                    framework_modules.add(alias.asname or alias.name)
    for item in ast.walk(tree):
        if isinstance(item, ast.Assign) and isinstance(item.value, ast.Call):
            fn = item.value.func
            known = isinstance(fn, ast.Name) and fn.id in framework_classes or isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name) and fn.value.id in framework_modules and fn.attr in ('FastAPI', 'APIRouter', 'Flask')
            if known:
                route_instances.update(target.id for target in item.targets if isinstance(target, ast.Name))
    for item in ast.walk(tree):
        if isinstance(item, ast.Import):
            for alias in item.names:
                dependencies.append({'from': filename, 'module': alias.name, 'kind': '导入', 'sourceRef': {'revision': revision, 'file': filename, 'startLine': item.lineno, 'endLine': item.end_lineno}})
        elif isinstance(item, ast.ImportFrom):
            names = [item.module] if item.module else [alias.name for alias in item.names]
            for name in names:
                dependencies.append({'from': filename, 'module': name, 'level': item.level, 'kind': '导入', 'sourceRef': {'revision': revision, 'file': filename, 'startLine': item.lineno, 'endLine': item.end_lineno}})

    def walk(node, owner=None, feature=None, branch=None):
        if len(nodes) >= 700:
            return
        kind, label, detail = None, '', ast.get_source_segment(source, node) or ''
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            kind, label = 'function', node.name
        elif isinstance(node, (ast.If, ast.IfExp, ast.While)):
            expression = ast.get_source_segment(source, node.test) or ''
            if isinstance(node.test, ast.Compare) and len(node.test.ops) == 1:
                names = {ast.Gt: '大于', ast.GtE: '不小于', ast.Lt: '小于', ast.LtE: '不大于', ast.Eq: '等于', ast.NotEq: '不等于'}
                word = names.get(type(node.test.ops[0]))
                if word:
                    expression = (ast.get_source_segment(source, node.test.left) or '') + ' ' + word + ' ' + (ast.get_source_segment(source, node.test.comparators[0]) or '')
            kind, label = 'condition', '判断：' + expression
        elif isinstance(node, ast.For):
            kind, label = 'condition', '遍历 ' + (ast.get_source_segment(source, node.iter) or '')
        elif isinstance(node, (ast.Assign, ast.AugAssign, ast.AnnAssign)):
            kind, label = 'calculation', '计算或更新 ' + detail.split('=')[0].strip()
        elif isinstance(node, ast.Return):
            kind, label = 'output', '返回结果'
        elif isinstance(node, ast.Await):
            kind, label = 'effect', '等待异步结果'
        elif isinstance(node, ast.Call):
            target = ast.get_source_segment(source, node.func) or ''
            if target == 'print':
                kind, label = 'output', '输出结果'
            elif target in ('open', 'input') or target.endswith(('.write', '.write_text', '.write_bytes', '.read', '.load')):
                kind, label = 'effect', '调用 ' + target
            elif isinstance(node.func, ast.Name):
                kind, label = 'effect', '调用 ' + target
        if kind and hasattr(node, 'lineno'):
            item = {'id': 'n-' + str(len(nodes) + 1), 'type': kind, 'label': label[:100], 'detail': detail[:5000], 'sourceRef': {'revision': revision, 'file': filename, 'startLine': node.lineno, 'endLine': getattr(node, 'end_lineno', node.lineno)}}
            nodes.append(item)
            file_ids.append(item['id'])
            if owner:
                edges.append({'id': 'e-' + str(len(edges) + 1), 'from': owner, 'to': item['id'], 'kind': branch or 'contains', 'certainty': 'static'})
            if feature:
                feature['nodeIds'].append(item['id'])
            if kind == 'function':
                feature = {'id': 'f-' + str(len(features) + 1), 'title': node.name, 'description': '由 Python AST 提取，业务含义尚待确认', 'nodeIds': [item['id']], 'sourceRefs': [item['sourceRef']]}
                for decorator in node.decorator_list:
                    if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute) and isinstance(decorator.func.value, ast.Name) and decorator.func.value.id in route_instances and decorator.func.attr in ('get','post','put','patch','delete','head','options','route') and decorator.args and isinstance(decorator.args[0], ast.Constant) and isinstance(decorator.args[0].value, str):
                        method = decorator.func.attr.upper()
                        if method == 'ROUTE':
                            methods = next((keyword.value for keyword in decorator.keywords if keyword.arg == 'methods'), None)
                            method = '/'.join(value.value for value in methods.elts if isinstance(value, ast.Constant) and isinstance(value.value, str)) if isinstance(methods, (ast.List, ast.Tuple)) else 'GET'
                        route = decorator.args[0].value
                        feature['title'] = method + ' ' + route
                        feature['trigger'] = {'kind': 'http', 'method': method, 'path': route}
                        feature['sourceRefs'].append({'revision': revision, 'file': filename, 'startLine': decorator.lineno, 'endLine': decorator.end_lineno})
                features.append(feature)
                symbols.append({'name': node.name, 'sourceRef': item['sourceRef']})
            if kind in ('function', 'condition'):
                owner = item['id']
        for field, value in ast.iter_fields(node):
            next_branch = 'then' if isinstance(node, ast.If) and field == 'body' else 'else' if isinstance(node, ast.If) and field == 'orelse' else branch
            children = value if isinstance(value, list) else [value]
            for child in children:
                if isinstance(child, ast.AST):
                    walk(child, owner, feature, next_branch)

    walk(tree)
    if filename == project['entry']:
        features.append({'id': 'f-entry', 'title': filename, 'description': '入口文件的实现结构', 'nodeIds': file_ids, 'sourceRefs': [node['sourceRef'] for node in nodes if node['sourceRef']['file'] == filename][:1]})
print(json.dumps({'revision': revision, 'features': features, 'nodes': nodes, 'edges': edges, 'gaps': gaps, 'sourceIndex': symbols, 'dependencies': dependencies, 'source': 'local-ast'}, ensure_ascii=False))
