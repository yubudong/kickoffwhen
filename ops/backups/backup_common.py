"""Shared, non-secret backup metadata and bounded retention rules (Python 3.9+)."""
from __future__ import annotations
import datetime as dt
import hashlib
import json
import pathlib
import re
import os
NAME = re.compile(r'^family-learning-(\d{8}T\d{6}Z)-[0-9a-f]{8}\.tar\.age$')
def sha256(path):
    digest=hashlib.sha256()
    with pathlib.Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()
def guarded(root, name):
    root=pathlib.Path(root).resolve();path=root/name
    if not NAME.fullmatch(name) or path.parent.resolve()!=root or path.is_symlink():raise ValueError('Invalid managed backup path')
    return path

def snapshots(root):
    root=pathlib.Path(root).resolve();result=[]
    if not root.exists():return result
    for meta in root.glob('family-learning-*.tar.age.json'):
        try:
            value=json.loads(meta.read_text());path=guarded(root,value['name'])
            if meta.name!=value['name']+'.json' or not re.fullmatch('[0-9a-f]{64}',value['sha256']):continue
            if path.is_file() and path.stat().st_size==value['bytes']:result.append(value)
        except (ValueError,KeyError,OSError,TypeError):continue
    return sorted(result,key=lambda value:value['name'],reverse=True)

def keep_names(items,daily,weekly=0,monthly=0):
    ordered=sorted(items,key=lambda value:value['name'],reverse=True);keep={v['name'] for v in ordered[:2]}
    for period,limit in [('day',daily),('week',weekly),('month',monthly)]:
        groups=set()
        for value in ordered:
            match=NAME.fullmatch(value['name'])
            if not match:continue
            date=dt.datetime.strptime(match[1],'%Y%m%dT%H%M%SZ')
            key=date.strftime('%Y%m%d') if period=='day' else tuple(date.isocalendar()[:2]) if period=='week' else date.strftime('%Y%m')
            if key not in groups:
                if len(groups)<limit:keep.add(value['name'])
                groups.add(key)
    return keep

def prune(root,daily,weekly=0,monthly=0):
    root=pathlib.Path(root).resolve();items=snapshots(root);keep=keep_names(items,daily,weekly,monthly);removed=[]
    for value in items:
        if value['name'] in keep:continue
        path=guarded(root,value['name']);meta=root/(value['name']+'.json')
        if meta.parent.resolve()!=root or meta.is_symlink():raise ValueError('Invalid metadata path')
        path.unlink();meta.unlink();removed.append(value['name'])
    return removed

def save_json(path,value):
    path=pathlib.Path(path);temp=path.with_name(path.name+'.tmp')
    if temp.parent.resolve()!=path.parent.resolve() or temp.is_symlink() or path.is_symlink():raise ValueError('Invalid atomic metadata target')
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');temp.chmod(0o600)
    os.replace(temp,path)
