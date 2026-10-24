"""Read-only file/size/byte-duplicate audit. Never opens source text for interpretation."""
import argparse,collections,hashlib,json
from pathlib import Path

def audit(root):
    root=Path(root); files=[p for p in root.rglob('*') if p.is_file()]
    groups=collections.defaultdict(lambda:dict(files=0,bytes=0)); sizes=collections.defaultdict(list)
    for p in files:
        size=p.stat().st_size; group=groups[p.relative_to(root).parts[0]]; group['files']+=1; group['bytes']+=size
        sizes[size].append(p)
    duplicates=[]
    for size,paths in sizes.items():
        if not size or len(paths)<2: continue
        hashes=collections.defaultdict(list)
        for p in paths:
            h=hashlib.sha256()
            with p.open('rb') as f:
                for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
            hashes[h.hexdigest()].append(p.relative_to(root).as_posix())
        for digest,copies in hashes.items():
            if len(copies)>1: duplicates.append(dict(sha256=digest,bytes=size,paths=copies))
    return dict(files=len(files),bytes=sum(g['bytes'] for g in groups.values()),categories=dict(groups),duplicateGroups=len(duplicates),extraCopies=sum(len(g['paths'])-1 for g in duplicates),duplicateBytes=sum(g['bytes']*(len(g['paths'])-1) for g in duplicates),duplicates=duplicates)

def summary(data):
    lines=['# Studio growth snapshot','',f"Read-only audit: {data['files']:,} files, {data['bytes']/1e9:.2f} GB ({data['bytes']:,} bytes). No files changed or deleted.",'','| Area | Files | MB |','|---|---:|---:|']
    for name,item in sorted(data['categories'].items(),key=lambda pair:pair[1]['bytes'],reverse=True):
        lines.append(f"| {name} | {item['files']:,} | {item['bytes']/1e6:.2f} |")
    lines += ['',f"Byte-identical copies: {data['duplicateGroups']:,} groups with {data['extraCopies']:,} extra copies totalling {data['duplicateBytes']/1e6:.2f} MB. This is a theoretical upper bound, not an approved deletion list.",'',
      'Recommended next steps:', '',
      '1. Keep song and batch navigation as links to the same authored version. Avoid new library copies merely for browsing.',
      '2. Review duplicate copies under Reference first. Preserve source receipts, archived originals and intentional backups until their roles are checked.',
      '3. Keep generated Suno fields together and regenerate future working exports when practical. Preserve the exact fields actually submitted with a take.',
      '4. Keep older writing and audio reachable through history while everyday views focus on current work.',
      '5. Treat audio size and document count as separate problems. Do not convert or delete master audio to reduce browser clutter.',
      '', 'The JSON companion contains the private exact-path and SHA-256 evidence. Only byte equality was checked; no source messages were interpreted.']
    return '\n'.join(lines)+'\n'

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    data=audit(args.source);args.output.write_text(json.dumps(data,indent=2),encoding='utf-8');args.output.with_suffix('.md').write_text(summary(data),encoding='utf-8')
    print(json.dumps({k:v for k,v in data.items() if k!='duplicates'}))
