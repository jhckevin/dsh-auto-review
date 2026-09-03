import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectLicenseEvidence} from './evidence-gates.mjs';

const repo = dirname(fileURLToPath(import.meta.url));
const source = join(repo,'packages/platform');
function fixture(run) {
  const root = mkdtempSync(join(repo,'dist/license-source-gate-'));
  try {
    for (const part of ['provenance','licenses']) cpSync(join(source,part),join(root,part),{recursive:true});
    run(root);
  } finally {
    assert.equal(dirname(realpathSync(root)),realpathSync(join(repo,'dist')));
    rmSync(root,{recursive:true});
  }
}
function mutate(root, relative, change) {
  const path = join(root,relative);
  const data = JSON.parse(readFileSync(path,'utf8'));
  change(data);
  writeFileSync(path,JSON.stringify(data));
}

test('a fake clean audit cannot hide original upstream file gaps',()=>fixture(root=>{
  mutate(root,'provenance/license-audit.json',audit=>{audit.upstreamLicenseFilesMissing=[];});
  assert.throws(()=>inspectLicenseEvidence(root),/original upstream license availability/);
}));

test('SBOM cannot relabel a declaration as an original upstream LICENSE',()=>fixture(root=>{
  mutate(root,'provenance/sbom.cdx.json',sbom=>{
    const item=sbom.components.find(row=>row['bom-ref']==='fxhash@0.2.1');
    item.properties.find(row=>row.name==='licenseMaterialSourceType').value='exact-upstream-license-and-published-declaration';
  });
  assert.throws(()=>inspectLicenseEvidence(root),/license source classification/);
}));

test('nonempty but partial material lists do not satisfy source coverage',()=>fixture(root=>{
  mutate(root,'provenance/sbom.cdx.json',sbom=>{
    const item=sbom.components.find(row=>row['bom-ref']==='fxhash@0.2.1');
    const material=item.properties.find(row=>row.name==='licenseMaterials');
    material.value=JSON.stringify(JSON.parse(material.value).slice(0,1));
  });
  assert.throws(()=>inspectLicenseEvidence(root),/source-bound distributed material inventory/);
}));
