# Album Board

A page inside The Grind for the 2026 album: every song from the writing sessions in one list. Read the lyrics, copy each Suno field with one tap, score songs 0 to 100, mark them Shortlist, Maybe or Cut, keep notes, and build the tracklist.

Built by Cue (Claude), October 9, 2026.

## Open it

Serve The Grind as usual and go to `/album-board/`. For example, from `ScattaBrain to Genius`:

    python3 -m http.server 8765 --bind 127.0.0.1

then open http://127.0.0.1:8765/album-board/

## Update the songs

The song list is a generated file, `songs.js`. After new songs land in SBGLP, run:

    python3 album-board/build_songs.py

It reads `SBGLP/02 Album Project/Writing Sessions` (the `2026-10-08-Reset` and `2026-10-09-Lyric-Mine` folders) using the same relative path on the Mac mini and the PC. Pass a different Writing Sessions path as the first argument if needed. To add a future session folder, add it to `SESSIONS` at the top of the script.

## Rating and your own versions

Each version of a song has its own score, Shortlist/Maybe/Cut and notes. The song list shows the best score across a song's versions. **Copy & edit** makes your own copy of the version you are viewing, with editable name, title, style, exclude and lyrics that save as you type. The Copy buttons use your edited text. Your versions appear as extra chips on the song, are never touched by `build_songs.py`, and can be deleted. The **My versions** filter lists songs that have one.

## Where your scores live

In the browser, under the localStorage key `grind.album.v1` (the same `grind.` prefix The Grind uses). It is device-local for now: it is **not** synced through The Grind's Firebase node yet. Use **Export scores** and **Import scores** at the bottom of the page to move them between devices.

## Not done yet (needs Jason's go-ahead)

- **A button in The Grind's app bar.** The shared app bar is duplicated between this repo and MM..HOME and must stay identical, and this checkout is on `famos-2026-09-11-verified-transfer` with `origin/main` three commits ahead (see `../CLAUDE_READINESS_CHECK_2026-10-08.md`). Adding the link means picking the base first.
- **Firebase sync.** Would add an `album` key to `planners/the-grind-scattabrain-2026` using `db.update()`. The readiness check says sync changes need comparing against the deployed rules and an isolated test first.
- **Service worker / offline.** The page is not in the PWA precache list yet.

Nothing in The Grind's existing files was changed. This folder is new and untracked in Git.
