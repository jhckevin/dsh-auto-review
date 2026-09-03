import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('launcher',ROOT/'launcher-evidence.py')
gate=importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='launcher-proof-')
        self.root=Path(self.temp.name)
        for path in ('provenance/launcher-upstream','licenses/deepseek-landlock-run'):
            shutil.copytree(ROOT/'packages/platform'/path,self.root/path)
        (self.root/'bin').mkdir()
        shutil.copyfile(ROOT/'packages/platform/bin/landlock-run',self.root/'bin/landlock-run')
    def tearDown(self): self.temp.cleanup()
    def test_official_binary_license_and_companion_source(self):
        result=gate.inspect(self.root)
        self.assertFalse(result['sourceToBinaryReproducibilityClaim'])
        self.assertEqual(len(result['packages']),2)
    def test_tampered_archive_binary_license_source_receipt_fail(self):
        for path in ('provenance/launcher-upstream/platform-0.1.1.tgz','bin/landlock-run',
                     'licenses/deepseek-landlock-run/LICENSE',
                     'provenance/launcher-upstream/entry/src/main.c.source',
                     'provenance/launcher-upstream/source-manifest.json'):
            with self.subTest(path=path):
                p=self.root/path
                original=p.read_bytes()
                p.write_bytes(b'forged')
                with self.assertRaises(ValueError): gate.inspect(self.root)
                p.write_bytes(original)

if __name__=='__main__': unittest.main(verbosity=2)
