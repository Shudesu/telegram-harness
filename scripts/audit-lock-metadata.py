#!/usr/bin/env python3
"""Read pnpm v9 lock package keys and query public npm metadata; never run package code."""
import concurrent.futures, hashlib, json, pathlib, re, sys, urllib.request
lock=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);raw=lock.read_text()
section=raw.split('\npackages:\n',1)[1].split('\nsnapshots:\n',1)[0]
entries=[]
for match in re.finditer(r'^  ([^\n]+):\n(.*?)(?=^  \S|\Z)',section,re.M|re.S):
 key=match.group(1).strip("'");name,version=key.rsplit('@',1)
 integrity=re.search(r'integrity: ([^,}\s]+)',match.group(2))
 entries.append((name,version,integrity.group(1) if integrity else None))
def get(entry):
 name,version,integrity=entry
 try:
  url='https://registry.npmjs.org/'+name.replace('/','%2f')+'/'+version
  with urllib.request.urlopen(url,timeout=30) as response: d=json.load(response)
  return {'name':name,'version':version,'registryUrl':url,'integrityMatchesRegistry':bool(integrity and integrity==d.get('dist',{}).get('integrity')),'lockIntegrity':integrity,'license':d.get('license'),'deprecated':d.get('deprecated'),'repository':d.get('repository'),'lifecycle':{k:v for k,v in d.get('scripts',{}).items() if k in ['preinstall','install','postinstall','prepare']},'hasInstallScript':d.get('hasInstallScript',False),'tarball':d.get('dist',{}).get('tarball')}
 except Exception as e:return {'name':name,'version':version,'error':str(e)}
results=list(concurrent.futures.ThreadPoolExecutor(max_workers=8).map(get,entries))
out.write_text(json.dumps({'lockSha256':hashlib.sha256(lock.read_bytes()).hexdigest(),'entries':results},indent=2)+'\n')
print(json.dumps({'entries':len(results),'errors':sum('error'in r for r in results),'integrityMismatches':sum(not r.get('integrityMatchesRegistry',False) for r in results),'postinstall':[r['name']+'@'+r['version'] for r in results if 'postinstall'in r.get('lifecycle',{})]}))

if not results or any('error' in r or not r.get('integrityMatchesRegistry') for r in results):
 sys.exit(1)
