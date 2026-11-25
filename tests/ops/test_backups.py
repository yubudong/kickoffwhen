import datetime as dt
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'ops/backups'))
from backup_common import guarded,keep_names,prune,sha256,snapshots,save_json
from verify_restore import unpack
import tarfile,io

def name(day,index=0):return 'family-learning-'+day.strftime('%Y%m%dT%H%M%SZ')+'-'+format(index,'08x')+'.tar.age'
class BackupRules(unittest.TestCase):
 def test_retention_keeps_latest_and_weekly_offline_recovery_points(self):
  start=dt.datetime(2026,11,25);items=[{'name':name(start-dt.timedelta(days=i),i)} for i in range(100)]
  keep=keep_names(items,daily=14,weekly=8)
  self.assertTrue(all(item['name'] in keep for item in items[:14]));self.assertGreater(len(keep),14);self.assertLess(len(keep),25)
 def test_retention_keeps_monthly_mac_copies(self):
  start=dt.datetime(2026,11,25);items=[{'name':name(start-dt.timedelta(days=i),i)} for i in range(400)]
  keep=keep_names(items,daily=30,monthly=12);self.assertGreater(len(keep),30);self.assertLess(len(keep),45)
 def test_prune_only_complete_managed_files_never_manual_backups(self):
  with tempfile.TemporaryDirectory() as temp:
   root=pathlib.Path(temp);manual=root/'manual-production-backup.dump';manual.write_bytes(b'keep')
   for i in range(6):
    n=name(dt.datetime(2026,11,25)-dt.timedelta(days=i),i);p=root/n;p.write_bytes(b'encrypted-test');save_json(root/(n+'.json'),{'name':n,'bytes':p.stat().st_size,'sha256':sha256(p)})
   (root/'family-learning-malformed.tar.age.json').write_text('{}');removed=prune(root,daily=1)
   self.assertEqual(len(removed),4);self.assertEqual(manual.read_bytes(),b'keep');self.assertEqual(len(snapshots(root)),2)
 def test_path_and_symlink_guards(self):
  with tempfile.TemporaryDirectory() as temp:
   root=pathlib.Path(temp)
   with self.assertRaises(ValueError):guarded(root,'../other.tar.age')
   n=name(dt.datetime(2026,11,25));(root/n).symlink_to('/etc/passwd')
   with self.assertRaises(ValueError):guarded(root,n)
 def test_restore_rejects_archive_traversal_and_links(self):
  with tempfile.TemporaryDirectory() as temp:
   root=pathlib.Path(temp);archive=root/'unsafe.tar'
   with tarfile.open(archive,'w') as tar:
    info=tarfile.TarInfo('../escape');info.size=1;tar.addfile(info,io.BytesIO(b'x'))
   with self.assertRaises(ValueError):unpack(archive,root/'restored')
   self.assertFalse((root/'escape').exists())
if __name__=='__main__':unittest.main()
