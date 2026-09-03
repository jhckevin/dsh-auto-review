#!/usr/bin/env python3
"""Archive metadata tests; never certify a native build or legal sufficiency."""
import copy
import io
import hashlib
import importlib.util
import json
import pathlib
import tarfile
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('source_archive', ROOT/'source-archive.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class SourceMetadataTests(unittest.TestCase):
    def setUp(self):
        self.raw = (ROOT/'packages/platform/provenance/license-audit.json').read_bytes()
        self.audit = json.loads(self.raw)

    def test_actual_material_coverage_preserves_original_file_gaps(self):
        result = module.license_metadata(self.raw)
        self.assertEqual(result['components'], 672)
        self.assertEqual(result['materialMissing'], [])
        self.assertEqual(len(result['upstreamOriginalLicenseFilesMissing']), 10)
        self.assertFalse(result['legalApproval'])
        self.assertEqual(result['auditSha256'], hashlib.sha256(self.raw).hexdigest())

    def test_missing_material_is_not_hidden(self):
        self.audit['missing'] = ['example@1: missing license text/expression']
        result = module.license_metadata(json.dumps(self.audit).encode())
        self.assertEqual(result['materialMissing'], self.audit['missing'])

    def test_legal_approval_or_unknown_classification_is_rejected(self):
        for changes in ({'legalApproval': True}, {'components': True},
                        {'missing': None}, {'upstreamLicenseFilesMissing': None}):
            audit = copy.deepcopy(self.audit)
            audit.update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                module.license_metadata(json.dumps(audit).encode())

    def test_duplicate_component_gap_is_rejected(self):
        self.audit['upstreamLicenseFilesMissing'] *= 2
        with self.assertRaises(ValueError):
            module.license_metadata(json.dumps(self.audit).encode())

    def test_archive_materials_reject_missing_and_changed_bytes(self):
        material = b'original-license'
        inventory = [{'path': 'licenses/example@1/LICENSE',
                      'sha256': hashlib.sha256(material).hexdigest()}]
        sbom = {'components': [{'properties': [{'name': 'licenseMaterials',
                                               'value': json.dumps(inventory)}]}]}
        for payload in (None, b'changed', material):
            with tempfile.TemporaryDirectory() as directory:
                path = pathlib.Path(directory)/'source.tar.gz'
                with tarfile.open(path, 'w:gz') as archive:
                    entries = {'bridge/packages/platform/provenance/sbom.cdx.json': json.dumps(sbom).encode()}
                    if payload is not None:
                        entries['bridge/packages/platform/licenses/example@1/LICENSE'] = payload
                    for name, data in entries.items():
                        item = tarfile.TarInfo(name)
                        item.size = len(data)
                        archive.addfile(item, io.BytesIO(data))
                if payload == material:
                    self.assertEqual(module.verify_archived_materials(path, 1), 1)
                    with self.assertRaises(ValueError):
                        module.verify_archived_materials(path, 2)
                else:
                    with self.assertRaises((KeyError, ValueError)):
                        module.verify_archived_materials(path, 1)

if __name__ == '__main__':
    unittest.main()
