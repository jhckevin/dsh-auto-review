#!/usr/bin/env python3
"""Real artifact negative regressions; no network or native compilation."""
import importlib.util
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('license_evidence',ROOT/'license-evidence.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

class EvidenceTests(unittest.TestCase):
    def setUp(self):
        (ROOT/'dist').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='license-evidence-test-',dir=ROOT/'dist')
        self.root = pathlib.Path(self.temp.name)
        for relative in ('provenance/license-declarations','provenance/license-exact-source'):
            shutil.copytree(ROOT/'packages/platform'/relative,self.root/relative)
        shutil.copyfile(ROOT/'packages/platform/provenance/license-material-coverage.json',self.root/'provenance/license-material-coverage.json')
        for ref in gate.EXPECTED:
            shutil.copytree(ROOT/'packages/platform/licenses'/ref,self.root/'licenses'/ref)
        self.docpath = self.root/'provenance/license-declarations/declarations.json'

    def tearDown(self):
        if self.root.resolve().parent != (ROOT/'dist').resolve() or self.root.is_symlink():
            raise RuntimeError('refuse unsafe test cleanup')
        self.temp.cleanup()

    def edit_doc(self, edit):
        doc = json.loads(self.docpath.read_text())
        edit(doc)
        self.docpath.write_text(json.dumps(doc))

    def test_actual_materials_and_honest_classification(self):
        result,_ = gate.inspect(self.root)
        self.assertEqual(len(result['components']),12)
        self.assertEqual(len(result['upstreamLicenseFilesMissing']),10)
        self.assertEqual(result['originalSelectedFiles'],119)
        self.assertFalse(result['legalApproval'])
        self.assertEqual(sum(x['upstreamLicenseFileRecovered'] for x in result['components'].values()),2)

    def test_forged_license_expression_and_selected_branch_fail(self):
        for field,value in (('originalLicenseExpression','GPL-3.0-only'),('selectedStandard','MIT')):
            with self.subTest(field=field):
                original = self.docpath.read_bytes()
                self.edit_doc(lambda d:d['components'][0].update({field:value}))
                with self.assertRaises(ValueError): gate.inspect(self.root)
                self.docpath.write_bytes(original)

    def test_pack_safe_mapping_is_fixed_source_bound_and_injective(self):
        result,_ = gate.inspect(self.root)
        for ref,row in result['components'].items():
            paths = []
            for item in row['originalCrateFiles']:
                original = item['archiveMember'].split('/',1)[1]
                self.assertEqual(item['materialPath'],'licenses/'+ref+'/original-crate/'+original+'.source')
                self.assertEqual(item['sha256'],gate.sha((self.root/item['materialPath']).read_bytes()))
                paths.append(item['materialPath'])
            self.assertEqual(len(paths),len(set(paths)))

    def test_relabelled_mapping_cannot_replace_missing_original(self):
        coverage = self.root/'provenance/license-material-coverage.json'
        doc = json.loads(coverage.read_text())
        row = doc['components']['debugserver-types@0.5.0']['originalCrateFiles'][0]
        row['materialPath'] += '.arbitrary'
        coverage.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError,'self-reported coverage'):
            gate.inspect(self.root)

    def test_npm_filtered_original_requires_exact_safe_copy(self):
        path = self.root/'licenses/debugserver-types@0.5.0/original-crate/Cargo.toml.orig.source'
        path.rename(path.with_name('Cargo.toml.orig.source.extra'))
        with self.assertRaises(ValueError):
            gate.inspect(self.root)

    def test_missing_and_duplicate_component_fail(self):
        for duplicate in (False,True):
            with self.subTest(duplicate=duplicate):
                original = self.docpath.read_bytes()
                def edit(d):
                    if duplicate: d['components'][-1]=d['components'][0]
                    else: d['components'].pop()
                self.edit_doc(edit)
                with self.assertRaises(ValueError): gate.inspect(self.root)
                self.docpath.write_bytes(original)

    def test_archive_tamper_cannot_be_reblessed_by_declared_hash(self):
        doc = json.loads(self.docpath.read_text())
        row = doc['components'][0]
        path = self.root/'provenance/license-declarations'/row['archive']
        changed = path.read_bytes()+b'altered'
        path.write_bytes(changed)
        row['archiveSha256'] = gate.sha(changed)
        self.docpath.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError,'checksum'): gate.inspect(self.root)

    def test_standard_tamper_cannot_be_reblessed(self):
        doc = json.loads(self.docpath.read_text())
        item = doc['standardTexts'][0]
        path = self.root/'provenance/license-declarations'/item['artifact']
        path.write_text('not the license')
        item['sha256'] = gate.sha(path.read_bytes())
        self.docpath.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError,'standard license hash'): gate.inspect(self.root)

    def test_original_source_tamper_and_omitted_notice_file_fail(self):
        doc = json.loads(self.docpath.read_text())
        row = doc['components'][0]
        item = row['files'][0]
        path = self.root/'provenance/license-declarations'/(item['artifact']+'.source')
        original = path.read_bytes()
        path.write_bytes(original+b'\nforged notice\n')
        item['sha256'] = gate.sha(path.read_bytes())
        self.docpath.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError,'original member'): gate.inspect(self.root)
        path.write_bytes(original)
        row['files'].pop()
        self.docpath.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError,'source coverage'): gate.inspect(self.root)

    def test_distributed_copy_hash_and_symlink_fail(self):
        result,_ = gate.inspect(self.root)
        relative = result['components']['fxhash@0.2.1']['materials'][0]['path']
        path = self.root/relative
        original = path.read_bytes()
        path.write_bytes(original+b'bad')
        with self.assertRaisesRegex(ValueError,'distributed'): gate.inspect(self.root)
        path.unlink()
        path.symlink_to(ROOT/'packages/platform'/relative)
        with self.assertRaisesRegex(ValueError,'symlink'): gate.inspect(self.root)

    def test_exact_upstream_archive_and_commit_proof_are_pinned(self):
        path = self.root/'provenance/license-exact-source/allocative-exact-proof.json'
        doc = json.loads(path.read_text())
        doc['commit']='0'*40
        path.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError,'exact upstream source'): gate.inspect(self.root)

    def test_author_fields_cannot_be_invented(self):
        self.edit_doc(lambda d:d['components'][0].update({'authors':['Invented copyright owner 2026']}))
        with self.assertRaisesRegex(ValueError,'attribution'): gate.inspect(self.root)

    def test_forged_coverage_status_cannot_erase_upstream_file_gaps(self):
        path = self.root/'provenance/license-material-coverage.json'
        doc = json.loads(path.read_text())
        doc['upstreamLicenseFilesMissing'] = []
        doc['legalApproval'] = True
        path.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError,'self-reported coverage'): gate.inspect(self.root)

    def test_absolute_traversal_and_empty_paths_fail(self):
        for path in ('','/etc/passwd','../README','licenses/../README','a\\b','a//b','a/\0b'):
            with self.subTest(path=path):
                with self.assertRaises(ValueError): gate.read(self.root,path)

    def test_python_optimization_does_not_disable_validation(self):
        self.edit_doc(lambda d:d['components'][0].update({'originalLicenseExpression':'UNKNOWN'}))
        child=subprocess.run(['python3','-O',str(ROOT/'license-evidence.py'),'--platform-root',str(self.root)],capture_output=True,text=True)
        self.assertNotEqual(child.returncode,0)
        self.assertIn('license expression',child.stderr)

if __name__ == '__main__': unittest.main(verbosity=2)
