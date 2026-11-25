#!/usr/bin/env python3
"""Pull only encrypted snapshots to the owner's Mac; authenticate before publishing."""
from __future__ import annotations
import argparse,datetime as dt,fcntl,json,os,pathlib,re,subprocess,uuid
from backup_common import guarded,sha256,save_json,prune
REMOTE='/root/backups/kickoffwhen/automatic'
DEFAULT=pathlib.Path.home()/'.local/share/kickoffwhen-backups/config.json'
def run(args,output=None):
    p=subprocess.run(args,stdout=output or subprocess.PIPE,stderr=subprocess.PIPE)
    if p.returncode:raise RuntimeError(args[0]+' failed with exit '+str(p.returncode))
    return p.stdout.decode() if output is None else ''

def pull(config):
    root=pathlib.Path(config['localRoot']).expanduser().resolve();root.mkdir(parents=True,exist_ok=True,mode=0o700);root.chmod(0o700)
    identity=pathlib.Path(config['identity']).expanduser().resolve();age=pathlib.Path(config['ageBinary']).expanduser().resolve();host=config.get('host','hetzner')
    if identity.is_symlink() or identity.stat().st_mode&0o077 or not re.fullmatch('[a-zA-Z0-9_-]+',host):raise ValueError('Unsafe backup identity or host')
    with (root/'sync.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return
        try:
            data=json.loads(run(['/usr/bin/ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',host,'python3 /root/family-learning/backup/bin/server_backup.py list']))
            if not data:raise RuntimeError('No completed server snapshots yet')
            copied=0
            for value in data:
                name=value['name'];target=guarded(root,name)
                if not re.fullmatch('[0-9a-f]{64}',value['sha256']) or not isinstance(value['bytes'],int):raise ValueError('Invalid remote metadata')
                if target.is_file() and target.stat().st_size==value['bytes'] and sha256(target)==value['sha256']:continue
                part=root/(name+'.'+uuid.uuid4().hex+'.partial')
                if part.parent.resolve()!=root or part.exists():raise ValueError('Invalid download target')
                run(['/usr/bin/scp','-q','-o','BatchMode=yes','-o','ConnectTimeout=15',host+':'+REMOTE+'/'+name,str(part)])
                part.chmod(0o600)
                if part.stat().st_size!=value['bytes'] or sha256(part)!=value['sha256']:raise ValueError('Encrypted snapshot checksum mismatch')
                # Authenticated decryption is discarded, never logged or stored as plaintext.
                with open(os.devnull,'wb') as sink:run([str(age),'-d','-i',str(identity),str(part)],output=sink)
                if part.resolve().parent!=root or target.resolve().parent!=root or target.is_symlink():raise ValueError('Unsafe publish target')
                os.replace(part,target);save_json(root/(name+'.json'),value);copied+=1
            removed=prune(root,daily=30,monthly=12)
            save_json(root/'status.json',{'ok':True,'lastSuccess':dt.datetime.now(dt.timezone.utc).isoformat(),'copied':copied,'availableSnapshots':len(data),'pruned':len(removed)})
            print(json.dumps({'ok':True,'copied':copied,'availableSnapshots':len(data)}))
        except Exception as error:
            save_json(root/'status.json',{'ok':False,'failedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'error':type(error).__name__});raise

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',default=str(DEFAULT));args=parser.parse_args();pull(json.loads(pathlib.Path(args.config).read_text()))
if __name__=='__main__':main()
