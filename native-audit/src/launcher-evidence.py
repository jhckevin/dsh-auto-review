#!/usr/bin/env python3
"""Independent npm launcher source/material binding, outside the Rust SBOM."""
import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('license_evidence',ROOT/'license-evidence.py')
gate=importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
PINNED={
 'platform':('sha512-OHAzPW2Coe/iYobAJAAA8CeVrBoKV4BnNHsgwvXwOfishxkUVSWSvdyxrZPiwYRXutpIGVrSo9zV3WOQy2euBA==','@deepseek-ai/node-addon-landlock-run-linux-x64'),
 'entry':('sha512-aHGhlQJEutfobKM/4K59SERbT7RmQdD2oMKzD8Bne/Ps7TeT8AweCN+dpdfuxQhMNbFcJMymrgPnID0WYQ30Tw==','@deepseek-ai/node-addon-landlock-run'),
}

def inspect(platform, materialize=False):
    output={'schemaVersion':1,'scope':'official npm launcher and companion source; separate from 672 Rust components',
            'rebuiltLauncher':False,'sourceToBinaryReproducibilityClaim':False,'packages':{}}
    for kind,(integrity,name) in PINNED.items():
        raw=gate.read(platform,'provenance/launcher-upstream/'+kind+'-0.1.1.tgz')
        gate.require('sha512-'+base64.b64encode(hashlib.sha512(raw).digest()).decode()==integrity,'launcher upstream archive integrity mismatch')
        members=gate.archive_members(raw)
        meta=json.loads(members['package/package.json'])
        gate.require(meta['name']==name and meta['version']=='0.1.1','launcher package identity mismatch')
        files={}
        for member,data in sorted(members.items()):
            gate.require(member.startswith('package/'),'launcher source prefix mismatch')
            path='provenance/launcher-upstream/'+kind+'/'+member[len('package/'):]+'.source'
            if materialize:
                target=platform/path
                for parent in [target,*target.parents]:
                    if parent==platform.parent: break
                    gate.require(not parent.is_symlink(),'launcher material symlink')
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(data)
            gate.require(gate.read(platform,path)==data,'launcher source material mismatch')
            files[member]={'path':path,'sha256':gate.sha(data)}
        if kind=='platform':
            gate.require(members['package/bin/landlock-run']==gate.read(platform,'bin/landlock-run'),'launcher binary differs from official npm artifact')
            for filename in ('LICENSE','package.json'):
                gate.require(members['package/'+filename]==gate.read(platform,'licenses/deepseek-landlock-run/'+filename),'launcher original license/package mismatch')
        else:
            gate.require('package/src/main.c' in members and 'package/LICENSE' in members,'launcher source/license absent')
        output['packages'][kind]={'name':name,'version':'0.1.1','integrity':integrity,
            'mirror':'https://registry.npmmirror.com/'+name+'/-/'+name.split('/')[-1]+'-0.1.1.tgz',
            'declaredLicense':meta.get('license'),'repository':meta.get('repository'),'members':files}
    receipt=platform/'provenance/launcher-upstream/source-manifest.json'
    if materialize: receipt.write_text(json.dumps(output,indent=2)+'\n')
    gate.require(json.loads(gate.read(platform,'provenance/launcher-upstream/source-manifest.json'))==output,'launcher provenance declaration mismatch')
    return output

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--platform-root',type=Path,default=ROOT/'packages/platform')
    parser.add_argument('--materialize',action='store_true')
    args=parser.parse_args()
    result=inspect(args.platform_root,args.materialize)
    print(json.dumps({'scope':result['scope'],'officialPackages':2,'sourceMembers':sum(len(x['members']) for x in result['packages'].values()),'accepted':True}))
