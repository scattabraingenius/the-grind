#!/usr/bin/env python3
"""Import all dated Writing Sessions packets, preserving sources and existing rating IDs."""
import argparse, csv, datetime, hashlib, json, re
from pathlib import Path
HERE = Path(__file__).resolve().parent
LEGACY = {'2026-10-08-Reset':'Oct 8 Reset', '2026-10-09-Lyric-Mine':'Oct 9 Lyric Mine'}
PATTERN = re.compile(r'^(?P<slug>[a-z0-9-]+)_v(?P<ver>\d+)_(?P<writer>[A-Za-z]+)_lyrics\.md$')

def label(folder):
    if folder in LEGACY: return LEGACY[folder]
    dated = bool(re.match(r'^\d{4}-\d{2}-\d{2}(?:-|$)', folder))
    date = datetime.date.fromisoformat(folder[:10] if dated else folder[:7]+'-01')
    suffix = re.sub(r'Battle(\d+)', r'Battle \1', folder[10 if dated else 7:].strip('-').replace('-', ' '))
    return (f'{date:%b} {date.day}' if dated else f'{date:%b}') + (' ' + suffix if suffix else '')

def build(source):
    source = Path(source)
    if not source.is_dir(): raise ValueError(f'Writing Sessions folder not found: {source}')
    songs, sessions, inputs, ids = {}, [], {}, set()
    def read(path):
        if not path.is_file(): return ''
        data = path.read_bytes()
        inputs[str(path.relative_to(source))] = hashlib.sha256(data).hexdigest()
        return data.decode('utf-8-sig').replace('\r\n', '\n')
    for directory in sorted(source.iterdir()):
        if not directory.is_dir() or not re.fullmatch(r'\d{4}-\d{2}(?:-\d{2})?(?:-.+)?', directory.name): continue
        folder, session, count = directory.name, label(directory.name), 0
        for path in sorted(directory.glob('*_lyrics.md')):
            match = PATTERN.fullmatch(path.name)
            if not match: raise ValueError(f'Unrecognized lyric packet name: {path}')
            file_stem = path.name[:-len('_lyrics.md')]
            stem = file_stem if folder in LEGACY else f'{folder}/{file_stem}'
            if stem in ids: raise ValueError(f'Repeated version ID: {stem}')
            ids.add(stem)
            raw = read(path)
            tm = re.match(r'# (.+)\n', raw)
            title = tm.group(1).strip() if tm else match['slug'].replace('-', ' ').title()
            body = re.sub(r'\A# [^\n]*\n+', '', raw).strip('\n')
            if not body.strip(): raise ValueError(f'Empty lyrics: {path}')
            suno = {k:read(directory/'Suno Pass'/f'{file_stem}_suno-{suffix}.txt') for k,suffix in [('title','title'),('lyrics','lyrics'),('style','style'),('exclude','exclude'),('instrumental','style-instrumental')]}
            if not suno['lyrics']: suno['lyrics'] = body
            chars = len(suno['lyrics'].encode('utf-16-le')) // 2
            if suno['lyrics'] == body: suno['lyrics'] = None
            if not suno['title']: suno['title'] = title
            header = re.search(r'^Version v\d+\..*$', read(directory/f'{file_stem}_notes.md'), re.M)
            writer = 'Misc' if match['writer'].lower() == 'cg' else match['writer']
            v = dict(stem=stem,file_stem=file_stem,version=int(match['ver']),writer=writer,session=session,folder=folder,source=f'{folder}/{path.name}',title=title,lyrics=body,suno=suno,header=header.group(0).replace('**','') if header else '',chars=chars)
            song = songs.setdefault(match['slug'],dict(slug=match['slug'],ep=match['slug'].startswith('ep'),versions=[]))
            song['versions'].append(v); count += 1
        if count: sessions.append(dict(folder=folder,label=session,versions=count))
    if not songs: raise ValueError('No lyric packets found; existing catalogue was not replaced.')
    out = []
    for song in songs.values():
        song['versions'].sort(key=lambda v:(v['folder'],v['version'],v['writer']=='Cue',v['stem']))
        latest = song['versions'][-1]
        song.update(title=latest['title'],session=latest['session'],latest=latest['stem'])
        out.append(song)
    out.sort(key=lambda s:s['title'].lower())
    out.sort(key=lambda s:s['versions'][-1]['folder'],reverse=True)
    for relative,digest in inputs.items():
        if hashlib.sha256((source/relative).read_bytes()).hexdigest() != digest: raise ValueError(f'Source changed while reading: {relative}; rerun.')
    return out,sessions,inputs

def attach_clips(songs, snapshot):
    clips = []
    if not snapshot.is_file(): return clips
    by_source = {}
    with snapshot.open(encoding='utf-8') as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        clip = dict(id=row['clip_id'],title=row['title'],oldTitle=row['old_title'],result=row['result'])
        if not re.fullmatch(r'[0-9a-f-]{36}', clip['id']): raise ValueError('Invalid Suno clip ID')
        clips.append(clip)
        by_source.setdefault(row['source'], []).append(clip)
    for song in songs:
        for v in song['versions']:
            v['clips'] = by_source.get('02 Album Project/Writing Sessions/'+v['source'], [])
            # Only exact, approved source matches supply a renamed clip title.
            vocals = [c for c in v['clips'] if re.search(r'\.[CMS]\d+\.\d+$', c['title'])]
            v['naming'] = f"{v['title']}.{ {'Cue':'C','Misc':'M','Scatta':'S'}.get(v['writer'],v['writer']) }{v['version']}"
            if vocals:
                v['suno']['sourceTitle'] = v['suno']['title']
                v['suno']['title'] = vocals[0]['title']
    return clips

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',nargs='?',type=Path,default=HERE.joinpath('../../../../../SBGLP/02 Album Project/Writing Sessions').resolve())
    p.add_argument('--output',type=Path,default=HERE/'songs.js')
    p.add_argument('--manifest',type=Path)
    p.add_argument('--built-at')
    p.add_argument('--suno-titles',type=Path,default=HERE/'suno-titles.csv')
    args = p.parse_args(argv)
    try:
        songs,sessions,inputs = build(args.source)
        clips = attach_clips(songs,args.suno_titles)
    except (ValueError,OSError,UnicodeError) as e: p.error(str(e))
    built = args.built_at or datetime.datetime.now().astimezone().isoformat(timespec='minutes')
    js = '// Generated by build_songs.py. Do not edit by hand.\n'
    for key,value in [('ALBUM_BUILT',built),('ALBUM_SESSIONS',sessions),('ALBUM_SONGS',songs),('ALBUM_CLIPS',clips)]: js += f'window.{key} = {json.dumps(value,ensure_ascii=False)};\n'
    tmp = args.output.with_suffix('.js.tmp'); tmp.write_text(js,encoding='utf-8'); tmp.replace(args.output)
    if args.output.resolve() == (HERE/'songs.js').resolve():
        shell = HERE.parent/'service-worker.js'
        if shell.is_file():
            cache_source = (HERE.parent/'mm-home/index.html').read_text(encoding='utf-8')+'\n'+''.join((HERE/name).read_text(encoding='utf-8') for name in ('index.html','songs.js','sync.js'))
            for asset in [HERE/'manifest.webmanifest', *sorted((HERE/'icons').glob('*.png'))]:
                if asset.is_file(): cache_source += hashlib.sha256(asset.read_bytes()).hexdigest()
            cache_name = 'scattabrain-unified-shell-v5-'+hashlib.sha256(cache_source.encode()).hexdigest()[:12]
            worker = re.sub(r'const CACHE_NAME = "[^"]+";', f'const CACHE_NAME = "{cache_name}";', shell.read_text(encoding='utf-8'),count=1)
            shell.write_text(worker,encoding='utf-8')
    count = sum(s['versions'] for s in sessions)
    if args.manifest: args.manifest.write_text(json.dumps(dict(source=str(args.source.resolve()),built=built,songs=len(songs),versions=count,sessions=sessions,sha256=inputs),indent=2),encoding='utf-8')
    print(f'{len(songs)} songs, {count} versions, {len(sessions)} sessions -> {args.output}')
if __name__ == '__main__': main()
