#!/usr/bin/env python3
# Post-build: drop comment-only lines containing CJK from dist JS.
# Comments are non-semantic; this keeps the npm artifact comment-free while
# data strings (status labels etc.) are handled by the future locale pass.
import re, sys, glob

removed = 0
for f in glob.glob('dist/*.js'):
    lines = open(f, encoding='utf-8').readlines()
    keep = []
    for line in lines:
        if re.match(r'\s*//', line) and re.search(r'[\u4e00-\u9fff]', line):
            removed += 1
            continue
        keep.append(line)
    open(f, 'w', encoding='utf-8').writelines(keep)
print(f'stripped {removed} CJK comment lines')
