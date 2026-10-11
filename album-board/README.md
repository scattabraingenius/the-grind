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

It discovers every dated session folder in `SBGLP/02 Album Project/Writing Sessions`. Pass that folder explicitly when working from another checkout:

    python album-board/build_songs.py "D:\SYNCt\SBGLP\02 Album Project\Writing Sessions"

Future dated sessions and their filter chips are discovered automatically. Song packets use `<slug>_v<version>_<writer>_lyrics.md`; accompanying Suno fields are read from `Suno Pass`. Missing prompts are shown as missing, rather than invented from the notes. `cg` is displayed as Misc; source filenames stay unchanged. Instrumental-style prompts are included when provided. Newest sessions appear first.

The October 8 and October 9 version IDs stay unchanged so existing scores, notes, picks and copies retain their links. Other sessions use IDs that include the session folder, keeping repeated filenames distinct. Building refuses missing/empty sources and duplicate IDs, verifies hashes after reading, and refreshes the offline-cache version. `--manifest <path>` writes an optional source-hash receipt. Source song files are never changed.

## Rating and your own versions

Each version of a song has its own score, Shortlist/Maybe/Cut and notes. The song list shows the best score across a song's versions. **Copy & edit** makes your own copy of the version you are viewing, with editable name, title, style, exclude and lyrics that save as you type. The Copy buttons use your edited text. Your versions appear as extra chips on the song, are never touched by `build_songs.py`, and can be deleted. The **My versions** filter lists songs that have one.

Title, style prompt, excluded styles and lyrics have separate visible boxes, each with its own Copy button and character count. The displayed lyrics are exactly the Suno copy text. When the writing draft differs, it remains available under **Full writing draft**. Original packets are read-only; **Copy & edit** makes an editable version. Search covers prompts and every version, including your own. A **Back to songs** button returns phone users to the selected row. Copy and storage failures are reported explicitly.

## Where your scores live

In the browser, under the localStorage key `grind.album.v1` (the same `grind.` prefix The Grind uses). It is device-local for now: it is **not** synced through The Grind's Firebase node yet. Use **Export scores** and **Import scores** at the bottom of the page to move them between devices.

## Verification

    python -B tests/album-board-import.test.py
    APP_BASE_URL=http://127.0.0.1:8765 node tests/album-board.test.cjs

The browser runner uses the existing external Playwright installation via `NODE_PATH` and accepts `BROWSER_EXECUTABLE` and `ARTIFACT_DIR`. It creates a fresh browser context, uses synthetic scores, substitutes a fake clipboard, and blocks all non-local requests. No real account or existing browser profile is touched.

## Current scope

- The shared app bar already links to Album Board, and the service worker precaches its page and catalogue.
- **Firebase sync.** Would add an `album` key to `planners/the-grind-scattabrain-2026` using `db.update()`. The readiness check says sync changes need comparing against the deployed rules and an isolated test first.
- This page contains writing packets and local ratings. It does not download audio or consume Suno downloads.

The October 10 refresh includes 69 songs and 98 versions from six sessions: October 4 (4 versions), October 4 Cold Pass (12), October 8 Reset (39), October 9 Lyric Mine (29), October 10 Cue Battle 01 (7), and October 10 Misc Battle 01 (7). Source packets remain drafts unless Scatta approves them; catalogue inclusion is not listening approval.
