import json
import os
import runpy
import sys

entry, trace_file = sys.argv[1:3]
sys.argv = [entry] + sys.argv[3:]
workspace = os.path.realpath(os.getcwd()) + os.sep
seen = {}

def trace(frame, event, arg):
    if event not in ('line', 'call'):
        return trace
    filename = os.path.realpath(frame.f_code.co_filename)
    if not filename.startswith(workspace):
        return trace
    relative = os.path.relpath(filename, workspace)
    line = frame.f_code.co_firstlineno if event == 'call' else frame.f_lineno
    key = (relative, line, event)
    if len(seen) < 20000 or key in seen:
        seen[key] = seen.get(key, 0) + 1
    return trace

sys.path.insert(0, os.getcwd())
sys.settrace(trace)
try:
    runpy.run_path(entry, run_name='__main__')
finally:
    sys.settrace(None)
    with open(trace_file, 'w', encoding='utf-8') as stream:
        json.dump([{'file': file, 'line': line, 'kind': kind, 'count': count, 'source': 'runtime'} for (file, line, kind), count in seen.items()], stream)
