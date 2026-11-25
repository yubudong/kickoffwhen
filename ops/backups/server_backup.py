#!/usr/bin/env python3
"""Consistent, age-encrypted backups for this application only. No private key on server."""
from __future__ import annotations
import argparse,datetime as dt,fcntl,json,os,pathlib,re,shutil,subprocess,tarfile,time,uuid
from backup_common import sha256,snapshots,prune,save_json,guarded
WEB='family-learning-web-1';WORKER='family-learning-worker-1';DB='family-learning-db-1'
ROOT=pathlib.Path('/root/backups/kickoffwhen/automatic')
OPS=pathlib.Path('/root/family-learning/releases/20260922-recording1/ops')
MEDIA=pathlib.Path('/var/lib/docker/volumes/family-learning_private_media/_data')
CADDY=pathlib.Path('/root/ecomsellerkit/current/deploy/hetzner/Caddyfile')
def run(args,output=None,data=None):
    p=subprocess.run(args,input=data,stdout=output or subprocess.PIPE,stderr=subprocess.PIPE)
    if p.returncode:raise RuntimeError(args[0]+' failed with exit '+str(p.returncode))
    return p.stdout.decode() if output is None else ''
def docker(*args,**kw):return run(['docker',*args],**kw)
def inspect(name):return json.loads(docker('inspect',name))[0]
def sql(query):return docker('exec','-i',DB,'sh','-c','exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At',data=query.encode())
def table_facts():
    names=json.loads(sql("SELECT coalesce(json_agg(table_name),'[]') FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"));result={}
    for name in names:
        if not re.fullmatch('[a-zA-Z_][a-zA-Z_0-9]*',name):raise ValueError('Invalid table name')
        raw=sql('SELECT count(*)::text||\'|\'||md5(coalesce(string_agg(md5(to_jsonb(t)::text),\'\' ORDER BY md5(to_jsonb(t)::text)),\'\')) FROM public."'+name+'" t;').strip();count,digest=raw.split('|');result[name]={'count':int(count),'hash':digest}
    return result

def cleanup_stage(stage,base):
    intended=base.resolve();target=stage.resolve()
    if stage.is_symlink() or target.parent!=intended or not re.fullmatch('[0-9a-f]{32}',target.name):raise ValueError('Refuse unsafe staging cleanup')
    shutil.rmtree(target)

def backup(config):
    if ROOT.is_symlink() or pathlib.Path(config.get('root','')).resolve()!=ROOT:raise ValueError('Unexpected backup root')
    ROOT.mkdir(parents=True,exist_ok=True,mode=0o700);ROOT.chmod(0o700)
    recipient=config['recipient'];age=pathlib.Path(config['ageBinary'])
    if not re.fullmatch('age1[0-9a-z]+',recipient) or not age.is_absolute() or not age.is_file():raise ValueError('Invalid encryption configuration')
    with open('/run/lock/family-learning-backup.lock','a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise SystemExit(75)
        started=time.time();stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ');token=uuid.uuid4().hex
        name='family-learning-'+stamp+'-'+token[:8]+'.tar.age';target=guarded(ROOT,name)
        staging=ROOT/'.staging';staging.mkdir(exist_ok=True,mode=0o700);stage=staging/token;stage.mkdir(mode=0o700)
        running=[n for n in [WEB,WORKER] if inspect(n)['State']['Running']];resumed=False
        try:
            current=inspect(WEB)
            mounted=pathlib.Path(next(m['Source'] for m in current['Mounts'] if m['Destination']=='/app/var/media')).resolve()
            if mounted!=MEDIA:raise ValueError('Unexpected media mount')
            try:
                if running:docker('stop','-t','30',*running)
                with (stage/'database.dump').open('wb') as out:docker('exec',DB,'sh','-c','exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc',output=out)
                with tarfile.open(stage/'media.tar.gz','w:gz') as archive:archive.add(MEDIA,arcname='media')
                for source,name_in in [(OPS/'.env.production','app.env'),(OPS/'compose.production.yml','compose.yml'),(CADDY,'Caddyfile')]:shutil.copy2(source,stage/name_in)
                media={str(p.relative_to(MEDIA)):sha256(p) for p in sorted(MEDIA.rglob('*')) if p.is_file()}
                facts={'format':1,'createdAt':stamp,'image':current['Config']['Image'],'migrations':int(sql('SELECT count(*) FROM drizzle.__drizzle_migrations;')),'tables':table_facts(),'media':media}
                save_json(stage/'facts.json',facts)
                for p in stage.iterdir():p.chmod(0o600)
                save_json(stage/'checksums.json',{p.name:sha256(p) for p in stage.iterdir() if p.is_file()})
            finally:
                if running:docker('start',*running)
                resumed=True
            # Encryption occurs after restoring application availability.
            plain=stage/'bundle.tar'
            with tarfile.open(plain,'w') as archive:
                for p in sorted(stage.iterdir()):
                    if p.is_file() and p!=plain:archive.add(p,arcname=p.name)
            plain.chmod(0o600);part=ROOT/(name+'.partial')
            if part.is_symlink() or part.parent.resolve()!=ROOT:raise ValueError('Invalid encryption output')
            run([str(age),'-r',recipient,'-o',str(part),str(plain)]);part.chmod(0o600)
            if target.exists() or part.resolve().parent!=ROOT or target.resolve().parent!=ROOT:raise ValueError('Invalid publish target')
            os.replace(part,target)
            meta={'format':1,'name':name,'sha256':sha256(target),'bytes':target.stat().st_size,'createdAt':stamp,'recipientFingerprint':__import__('hashlib').sha256(recipient.encode()).hexdigest()[:16]}
            save_json(ROOT/(name+'.json'),meta);save_json(ROOT/'status.json',{'ok':True,'lastSuccess':stamp,'snapshot':name,'bytes':meta['bytes'],'durationSeconds':round(time.time()-started,2),'servicesRestored':resumed})
            cleanup_stage(stage,staging)
            removed=prune(ROOT,daily=14,weekly=8)
            print(json.dumps({'ok':True,'snapshot':name,'bytes':meta['bytes'],'pruned':len(removed),'durationSeconds':round(time.time()-started,2)}))
        except Exception as error:
            save_json(ROOT/'status.json',{'ok':False,'failedAt':stamp,'error':type(error).__name__,'servicesRestored':resumed})
            raise

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['run','list','status']);parser.add_argument('--config',default='/etc/family-learning/backup.json');args=parser.parse_args()
    if args.action=='list':print(json.dumps(snapshots(ROOT)));return
    if args.action=='status':print((ROOT/'status.json').read_text() if (ROOT/'status.json').exists() else '{"ok":false}');return
    config=json.loads(pathlib.Path(args.config).read_text());backup(config)
if __name__=='__main__':main()
