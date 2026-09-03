#!/usr/bin/env python3
"""Deterministic tracked-source archives, never a successful binary release gate."""
import argparse, gzip, hashlib, json, pathlib, subprocess, tarfile

ROOT = pathlib.Path(__file__).resolve().parent
UPSTREAM = '9f97cb79eb15b38d24c552c56fe24e211ff9cf3a'
MAX_TAR_BYTES = 256 * 1024 * 1024

def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], timeout=60).decode().strip()

def archive(repo, revision, target, prefix):
    # git archive excludes dirty/untracked files, untracked caches and .git.
    with target.open('xb') as output:
        with gzip.GzipFile(filename='', mode='wb', fileobj=output, mtime=0, compresslevel=9) as zipped:
            child = subprocess.Popen(['git', '-C', str(repo), 'archive', '--format=tar', '--prefix='+prefix, revision], stdout=subprocess.PIPE)
            size = 0
            try:
                while chunk := child.stdout.read(65536):
                    size += len(chunk)
                    if size > MAX_TAR_BYTES:
                        raise RuntimeError('source archive exceeded 256 MiB limit')
                    zipped.write(chunk)
                if child.wait(timeout=60):
                    raise RuntimeError('git archive failed')
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait()
    return {'file': target.name, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
            'bytes': target.stat().st_size, 'uncompressedTarBytes': size}

def license_metadata(raw):
    # This describes the archived revision, never a dirty/live worktree or a
    # legal determination. The separate source-bound checker remains mandatory.
    audit = json.loads(raw)
    if type(audit.get('components')) is not int or audit['components'] <= 0:
        raise ValueError('invalid recorded component count')
    for key in ('missing', 'upstreamLicenseFilesMissing'):
        value = audit.get(key)
        if not isinstance(value, list) or any(not isinstance(x, str) or not x for x in value):
            raise ValueError('missing or invalid recorded license classification')
        if len(value) != len(set(value)):
            raise ValueError('duplicate recorded license classification')
    if audit.get('legalApproval') is not False:
        raise ValueError('source metadata cannot assert legal approval')
    return {
        'scope': 'recorded source-bound material inventory; not a fresh gate execution or legal certification',
        'auditPath': 'packages/platform/provenance/license-audit.json',
        'auditSha256': hashlib.sha256(raw).hexdigest(),
        'components': audit['components'],
        'materialMissing': audit['missing'],
        'upstreamOriginalLicenseFilesMissing': audit['upstreamLicenseFilesMissing'],
        'legalApproval': False,
    }

def verify_archived_materials(path, expected_components):
    # Nested upstream .gitignore files can hide copied Cargo.lock/notice material
    # from git add. Validate the actual archive, not only the source directory.
    with tarfile.open(path, 'r:gz') as archive:
        def read(name):
            member = archive.getmember('bridge/'+name)
            if not member.isfile() or member.size > 8 * 1024 * 1024:
                raise ValueError('invalid archived material type/size')
            return archive.extractfile(member).read()
        sbom = json.loads(read('packages/platform/provenance/sbom.cdx.json'))
        if len(sbom['components']) != expected_components:
            raise ValueError('archived SBOM component count differs from audit')
        count = 0
        for component in sbom['components']:
            props = [p for p in component['properties'] if p['name'] == 'licenseMaterials']
            if len(props) != 1:
                raise ValueError('invalid archived license material inventory')
            for material in json.loads(props[0]['value']):
                name = material['path']
                if not name.startswith('licenses/') or any(x in ('', '.', '..') for x in name.split('/')):
                    raise ValueError('unsafe archived material path')
                if hashlib.sha256(read('packages/platform/'+name)).hexdigest() != material['sha256']:
                    raise ValueError('archived material hash mismatch')
                count += 1
        return count

def source_gate_metadata(licensing):
    # An archive cannot infer workflow outcome from the current day, checkout,
    # or a copied status field. The independent source-bound receipt decides it.
    reasons = ['source archives do not establish binary release eligibility; consult the independent execution and artifact receipts']
    if licensing['materialMissing']:
        reasons.append('source-recorded license material coverage incomplete')
    return {'releaseEligible': False, 'gateReasons': reasons,
            'executionAssessment': {'status': 'not-assessed-by-source-archive',
                                    'requiredEvidence': 'independent source-bound development execution receipt and binary provenance',
                                    'verifier': 'development-evidence.mjs:verifyDevelopmentRun'}}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--upstream-repo', required=True, type=pathlib.Path)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--out', required=True, type=pathlib.Path)
    args = parser.parse_args()
    revision = git(ROOT, 'rev-parse', '--verify', args.revision+'^{commit}')
    if git(args.upstream_repo, 'rev-parse', '--verify', UPSTREAM+'^{commit}') != UPSTREAM:
        raise RuntimeError('fixed upstream commit is unavailable')
    raw = subprocess.check_output(['git', '-C', str(ROOT), 'show',
                                  revision+':packages/platform/provenance/license-audit.json'], timeout=60)
    licensing = license_metadata(raw)
    out = args.out.resolve()
    if not out.is_relative_to(ROOT / 'dist') or out == ROOT / 'dist':
        raise RuntimeError('output must be a new directory strictly inside this worktree/dist')
    out.mkdir(parents=True, exist_ok=False)
    files = [archive(ROOT, revision, out/'bridge-source.tar.gz', 'bridge/'),
             archive(args.upstream_repo, UPSTREAM, out/'upstream-source.tar.gz', 'upstream/')]
    licensing['archivedMaterialReferencesVerified'] = verify_archived_materials(
        out/'bridge-source.tar.gz', licensing['components'])
    manifest = {'schemaVersion': 2,
                'scope': 'tracked source only; not a binary release, reproducible build or legal certification',
                'bridgeRevision': revision, 'upstreamCommit': UPSTREAM,
                **source_gate_metadata(licensing), 'licenseEvidence': licensing, 'files': files}
    (out/'source-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(manifest, indent=2))

if __name__ == '__main__':
    main()
