#!/usr/bin/env python3
"""Decrypt on the owner's machine, restore to isolated PostgreSQL, compare, erase plaintext."""
from __future__ import annotations
import argparse,datetime as dt,json,os,pathlib,re,shutil,subprocess,tarfile,time,uuid
from backup_common import snapshots,sha256,save_json,guarded

def run(args,data=None):
    p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if p.returncode:raise RuntimeError(args[0]+' failed with exit '+str(p.returncode))
    return p.stdout.decode()
def unpack(source,target):
    target=target.resolve();target.mkdir(exist_ok=True,mode=0o700)
    with tarfile.open(source) as archive:
        for member in archive.getmembers():
            destination=(target/member.name).resolve()
            if member.issym() or member.islnk() or not (member.isfile() or member.isdir()) or not (destination==target or target in destination.parents):raise ValueError('Unsafe archive member')
        archive.extractall(target)
    for path in target.rglob('*'):path.chmod(0o700 if path.is_dir() else 0o600)

def verify(config,name=None):
    os.umask(0o077);root=pathlib.Path(config['localRoot']).expanduser().resolve();items=snapshots(root)
    chosen=next((v for v in items if v['name']==name),None) if name else next(iter(items),None)
    if not chosen:raise ValueError('No completed encrypted snapshot available')
    encrypted=guarded(root,chosen['name']);assert sha256(encrypted)==chosen['sha256']
    base=root.parent/'restore-tests';base.mkdir(exist_ok=True,mode=0o700);token=uuid.uuid4().hex;stage=base/token;stage.mkdir(mode=0o700)
    container='kickoffwhen-backup-restore-'+token[:12];created=False
    try:
        run([config['ageBinary'],'-d','-i',config['identity'],'-o',str(stage/'bundle.tar'),str(encrypted)])
        unpack(stage/'bundle.tar',stage/'content');content=stage/'content'
        checks=json.loads((content/'checksums.json').read_text())
        for filename,digest in checks.items():
            path=content/filename
            if path.parent.resolve()!=content.resolve() or not path.is_file() or sha256(path)!=digest:raise ValueError('Archive content checksum mismatch')
        facts=json.loads((content/'facts.json').read_text());unpack(content/'media.tar.gz',stage/'restored-media')
        media=stage/'restored-media/media';actual={str(p.relative_to(media)):sha256(p) for p in media.rglob('*') if p.is_file()}
        if actual!=facts['media']:raise ValueError('Media restore mismatch')
        run(['docker','run','-d','--name',container,'--network','none','--label','com.kickoffwhen.backup-drill=true','-e','POSTGRES_USER=restore','-e','POSTGRES_DB=family_learning_restore_test','-e','POSTGRES_PASSWORD='+uuid.uuid4().hex,'postgres:17-alpine']);created=True
        for i in range(60):
            p=subprocess.run(['docker','exec',container,'pg_isready','-U','restore','-d','family_learning_restore_test'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            if p.returncode==0:break
            time.sleep(1)
        else:raise RuntimeError('Isolated database did not start')
        run(['docker','exec','-i',container,'pg_restore','--no-owner','--no-acl','-U','restore','-d','family_learning_restore_test'],data=(content/'database.dump').read_bytes())
        def query(sql):return run(['docker','exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','restore','-d','family_learning_restore_test','-At'],data=sql.encode()).strip()
        if int(query('SELECT count(*) FROM drizzle.__drizzle_migrations;'))!=facts['migrations']:raise ValueError('Migration count mismatch')
        names=json.loads(query("SELECT json_agg(table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"))
        if set(names)!=set(facts['tables']):raise ValueError('Restored table set mismatch')
        for table,expected in facts['tables'].items():
            if not re.fullmatch('[a-zA-Z_][a-zA-Z_0-9]*',table):raise ValueError('Invalid table name')
            value=query('SELECT count(*)::text||\'|\'||md5(coalesce(string_agg(md5(to_jsonb(t)::text),\'\' ORDER BY md5(to_jsonb(t)::text)),\'\')) FROM public."'+table+'" t;');count,digest=value.split('|')
            if {'count':int(count),'hash':digest}!=expected:raise ValueError('Restored business table mismatch')
        result={'ok':True,'verifiedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'snapshot':chosen['name'],'migrations':facts['migrations'],'tables':len(facts['tables']),'mediaFiles':len(facts['media']),'network':'none','plaintextRemovedAfterRun':True}
    finally:
        try:
            if created:
                if not re.fullmatch('kickoffwhen-backup-restore-[a-f0-9]{12}',container):raise ValueError('Invalid drill container cleanup')
                run(['docker','rm','-f','-v',container])
        finally:
            if stage.is_symlink() or stage.resolve().parent!=base.resolve() or not re.fullmatch('[a-f0-9]{32}',stage.name):raise ValueError('Unsafe plaintext cleanup')
            shutil.rmtree(stage)
    save_json(root.parent/'restore-status.json',result);print(json.dumps(result))

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',default=str(pathlib.Path.home()/'.local/share/kickoffwhen-backups/config.json'));parser.add_argument('--snapshot');args=parser.parse_args();verify(json.loads(pathlib.Path(args.config).read_text()),args.snapshot)
if __name__=='__main__':main()
