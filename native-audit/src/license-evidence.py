#!/usr/bin/env python3
"""ISSUE-032: source-bound license materials; not a legal sufficiency certificate."""
import argparse
import hashlib
import io
import json
import pathlib
import tarfile
import tomllib

ROOT = pathlib.Path(__file__).resolve().parent
LOCK_SHA = '9df7b57921c509ea84e7d524f60367fc260d38d080d9c9f3787b3a56ff7752ea'
EXACT_COMMIT = 'fc41670cf9cfebd86ba597925081577897112c51'
EXACT_ARCHIVE_SHA = '6ca85855a1575440ba3f066e2e5e3065a27e81a9a965f364999c5dad58181ea0'
EXACT_PROOF_SHA = 'b879cb62394f1aaa067ff6bf02b736615e6df60520c0477f1665e1b6d92791a9'
STANDARDS = {
    'Apache-2.0': '074e6e32c86a4c0ef8b3ed25b721ca23aca83df277cd88106ef7177c354615ff',
    'MIT': 'b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5',
}
EXPECTED = {
    'allocative@0.3.6': 'Apache-2.0', 'allocative_derive@0.3.6': 'Apache-2.0',
    'debugserver-types@0.5.0': 'MIT', 'display_container@0.9.0': 'MIT OR Apache-2.0',
    'eventsource-stream@0.2.3': 'MIT OR Apache-2.0', 'fxhash@0.2.1': 'Apache-2.0/MIT',
    'io_tee@0.1.1': 'MIT OR Apache-2.0', 'linux-keyutils@0.2.4': 'Apache-2.0 OR MIT',
    'lock_free_hashtable@0.1.4': 'MIT OR Apache-2.0', 'static_interner@0.1.2': 'MIT OR Apache-2.0',
    'strong_hash@0.1.0': 'MIT OR Apache-2.0', 'strong_hash_derive@0.1.0': 'MIT OR Apache-2.0',
}

def require(value, message):
    if not value:
        raise ValueError(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def read(root, relative):
    require(isinstance(relative, str) and 0 < len(relative) <= 512, 'invalid evidence path')
    parts = relative.split('/')
    require(all(p and p not in ('.', '..') and '\\' not in p and '\0' not in p for p in parts), 'unsafe evidence path')
    path = root
    require(not root.is_symlink(), 'symlink root')
    for part in parts:
        path = path / part
        require(not path.is_symlink(), 'symlink evidence')
    require(path.is_file() and 0 < path.stat().st_size <= 2 * 1024 * 1024, 'invalid evidence size/type')
    data = path.read_bytes()
    require(len(data) <= 2 * 1024 * 1024, 'evidence grew beyond bound')
    return data

def archive_members(data):
    result = {}
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        total = 0
        for index,item in enumerate(archive):
            require(index < 4096, 'too many archive members')
            require(not item.issym() and not item.islnk(), 'archive links not accepted')
            if item.isdir():
                continue
            parts = item.name.split('/')
            require(item.isfile() and all(p and p not in ('.', '..') and '\\' not in p for p in parts), 'unsafe archive member')
            require(item.name not in result and 0 <= item.size <= 2 * 1024 * 1024, 'duplicate/oversize archive member')
            total += item.size
            require(total <= 16 * 1024 * 1024, 'archive expands beyond bound')
            result[item.name] = archive.extractfile(item).read()
    return result

def inspect(platform, verify_copies=True):
    decl = 'provenance/license-declarations/'
    lock_raw = read(platform, decl+'Cargo.lock')
    require(sha(lock_raw) == LOCK_SHA, 'fixed Cargo.lock mismatch')
    lock = tomllib.loads(lock_raw.decode())['package']
    doc = json.loads(read(platform, decl+'declarations.json'))
    require(doc['schemaVersion'] == 1 and doc['cargoLockSha256'] == LOCK_SHA, 'declaration schema/source mismatch')
    rows = doc['components']
    require(len(rows) == len(EXPECTED) and {r['component'] for r in rows} == set(EXPECTED), 'unexpected/duplicate declaration component')
    standards = doc['standardTexts']
    require(len(standards) == 2 and {x['license'] for x in standards} == set(STANDARDS), 'standard coverage mismatch')
    texts = {}
    for item in standards:
        data = read(platform, decl+item['artifact'])
        require(sha(data) == item['sha256'] == STANDARDS[item['license']], 'standard license hash mismatch')
        texts[item['license']] = data
    exact_base = 'provenance/license-exact-source/'
    proof_raw = read(platform, exact_base+'allocative-exact-proof.json')
    exact_raw = read(platform, exact_base+'allocative-fixed-source-and-licenses.tar')
    require(sha(proof_raw) == EXACT_PROOF_SHA and sha(exact_raw) == EXACT_ARCHIVE_SHA, 'exact upstream source mismatch')
    proof = json.loads(proof_raw)
    require(proof['commit'] == EXACT_COMMIT, 'wrong upstream commit')
    exact = archive_members(exact_raw)
    output = {}
    copy_bytes = {}
    original_file_count = 0
    for row in rows:
        ref = row['component']
        name, version = ref.split('@')
        prefix = name+'-'+version+'/'
        candidates = [p for p in lock if p['name'] == name and p['version'] == version]
        require(len(candidates) == 1, 'ambiguous lock component')
        raw = read(platform, decl+row['archive'])
        require(sha(raw) == row['archiveSha256'] == candidates[0]['checksum'], 'published archive checksum mismatch')
        entries = archive_members(raw)
        require(all(p.startswith(prefix) for p in entries), 'archive component prefix mismatch')
        package = tomllib.loads(entries[prefix+'Cargo.toml'].decode())['package']
        require(package['name'] == name and package['version'] == version, 'manifest identity mismatch')
        expression = package.get('license')
        require(expression == row['originalLicenseExpression'] == EXPECTED[ref], 'unknown/missing/changed license expression')
        require(package.get('authors', []) == row['authors'] and package.get('repository') == row['repository'], 'original attribution mismatch')
        selected = 'MIT' if expression == 'MIT' else 'Apache-2.0'
        require(row['selectedStandard'] == selected, 'license selection is not authorized by pinned expression')
        selected_files = {p for p in entries if pathlib.PurePosixPath(p).name in ('Cargo.toml','Cargo.toml.orig','README.md','README') or p.endswith('.rs')}
        require(len(row['files']) == len(selected_files) and {f['archiveMember'] for f in row['files']} == selected_files, 'original source coverage mismatch')
        for item in row['files']:
            data = entries[item['archiveMember']]
            original_path = prefix+'original/'+item['archiveMember'][len(prefix):]
            require(item['artifact'] == original_path, 'original evidence path mismatch')
            safe_path = decl+original_path+'.source'
            require(sha(data) == item['sha256'], 'original member hash mismatch')
            if verify_copies:
                require(data == read(platform, safe_path), 'original member hash mismatch')
            copy_bytes[safe_path] = data
            original_file_count += 1
        # Preserve ALL published members, including notices in non-Rust/non-README files.
        # The original archive is checksum-bound; no regex decides which copyright matters.
        material = {}
        original_mapping = []
        for member, data in sorted(entries.items()):
            if data:
                # Fixed, injective mapping prevents npm's .orig/.gitignore filtering.
                # The original member name and bytes remain bound to the raw crate.
                relative = 'original-crate/'+member[len(prefix):]+'.source'
                material[relative] = data
                original_mapping.append({'archiveMember':member,
                    'materialPath':'licenses/'+ref+'/'+relative,'sha256':sha(data)})
        material['normative-'+selected+'.txt'] = texts[selected]
        recovered = ref in ('allocative@0.3.6', 'allocative_derive@0.3.6')
        if recovered:
            for member, data in entries.items():
                rel = member[len(prefix):]
                if rel in ('Cargo.toml','Cargo.lock','.cargo_vcs_info.json'):
                    continue
                upstream = 'allocative-upstream/'+name+'/'+('Cargo.toml' if rel == 'Cargo.toml.orig' else rel)
                require(exact.get(upstream) == data, 'upstream/crate source mismatch')
            for license_name in ('LICENSE-APACHE','LICENSE-MIT'):
                original = exact['allocative-upstream/'+license_name]
                expected = next(x for x in proof['licenses'] if x['upstreamPath'] == license_name)
                require(sha(original) == expected['sha256'], 'exact upstream license mismatch')
                material['upstream-'+license_name] = original
        materials = []
        for relative, data in sorted(material.items()):
            path = 'licenses/'+ref+'/'+relative
            if verify_copies:
                require(read(platform, path) == data, 'distributed license/source material mismatch: '+path)
            copy_bytes[path] = data
            materials.append({'path':path,'sha256':sha(data)})
        output[ref] = {'materials':materials,'originalCrateFiles':original_mapping,
            'sourceType':'exact-upstream-license-and-published-declaration' if recovered else 'published-spdx-declaration-and-normative-text',
            'upstreamLicenseFileRecovered':recovered,'selectedLicense':selected,
            'originalAuthors':package.get('authors',[]),
            'notice':'Every original published crate member is preserved. Missing upstream standalone LICENSE/author fields are not invented. No legal sufficiency certification.'}
    result = {'schemaVersion':1,'components':output,'originalSelectedFiles':original_file_count,
            'upstreamLicenseFilesMissing':sorted(ref for ref,row in output.items() if not row['upstreamLicenseFileRecovered']),
            'legalApproval':False}
    if verify_copies:
        require(json.loads(read(platform,'provenance/license-material-coverage.json')) == result,
                'self-reported coverage disagrees with original source')
    return result, copy_bytes

def materialize(platform):
    result, copies = inspect(platform, verify_copies=False)
    for relative, data in copies.items():
        path = platform/relative
        # Existing parents must not redirect generated evidence outside the package.
        for parent in [path, *path.parents]:
            if parent == platform.parent:
                break
            require(not parent.is_symlink(), 'symlink material destination')
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_bytes(data)
    sbom_path = platform/'provenance/sbom.cdx.json'
    sbom = json.loads(sbom_path.read_text())
    for component in sbom['components']:
        detail = result['components'].get(component['bom-ref'])
        if detail is None:
            continue
        component['properties'] = [p for p in component['properties'] if p['name'] not in ('licenseMaterials','licenseMaterialSourceType')]
        component['properties'].extend([
            {'name':'licenseMaterials','value':json.dumps(detail['materials'],sort_keys=True)},
            {'name':'licenseMaterialSourceType','value':detail['sourceType']}])
    sbom_path.write_text(json.dumps(sbom,indent=2)+'\n')
    audit_path = platform/'provenance/license-audit.json'
    audit = json.loads(audit_path.read_text())
    repaired_gaps = {ref+': missing license text/expression' for ref in result['components']}
    audit['missing'] = [item for item in audit['missing'] if item not in repaired_gaps]
    audit['scope'] = 'Source-bound license material coverage; original upstream file availability and legal sufficiency remain separate.'
    audit['upstreamLicenseFilesMissing'] = result['upstreamLicenseFilesMissing']
    audit['legalApproval'] = False
    audit_path.write_text(json.dumps(audit,indent=2)+'\n')
    (platform/'provenance/license-material-coverage.json').write_text(json.dumps(result,indent=2)+'\n')
    return inspect(platform)[0]

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform-root',type=pathlib.Path,default=ROOT/'packages/platform')
    parser.add_argument('--materialize',action='store_true')
    parser.add_argument('--source-only',action='store_true')
    args = parser.parse_args()
    result = materialize(args.platform_root) if args.materialize else inspect(args.platform_root,not args.source_only)[0]
    print(json.dumps(result))
