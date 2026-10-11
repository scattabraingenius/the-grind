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

Refresh Album Board on the phone that holds your existing ratings, then on your PCs. Use the same Google account on each device. The page restores The Grind's existing sign-in on the same browser origin; if it is signed out, use **Sign in with Google**. Wait for **Synced across devices** before closing the page. Ratings, Shortlist/Maybe/Cut, notes, editable copies and tracklist sync automatically. The selected version and search/filter choices remain local to each browser.

The existing localStorage key `grind.album.v1` stays in use. The first sync keeps a separate `grind.album.v1.before-cloud-sync` backup. Offline edits and their pending revisions are saved locally and merge when you reconnect. Signing out keeps your local data; switching accounts uses separate caches and does not upload the previous account's data. **Export scores** and **Import scores** remain available for separate backups. Import replaces this account's current board content and syncs that change.

Cloud data lives only at `planners/the-grind-scattabrain-2026/album/accounts/<Google UID>` in the existing Firebase Realtime Database. No database listener attaches while signed out. Existing planner access rules apply; this release does not change those rules. A denied read is an error, never an empty board. An empty PC cannot clear phone ratings. Each rating field has its own revision, so a concurrent score edit and note edit both survive. Concurrent edits to the same field resolve to the later revision; clock ties resolve consistently. Custom copies resolve per version. Deleted copies and removed tracks keep tombstones so stale devices cannot silently restore them. Firebase transactions merge the account's record map without touching planner tasks, family data or any other account.

The sync badge reports saving, synced, offline, and failures separately. Failed writes retain the local queue and offer **Retry sync**. Remote updates do not replace a focused editor. If local storage fails, export a backup before closing. Firebase's [authentication persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence), [transaction semantics](https://firebase.google.com/docs/database/web/read-and-write) and [inherited access rules](https://firebase.google.com/docs/database/security/core-syntax) inform this implementation.

## Verification

    python -B tests/album-board-import.test.py
    APP_BASE_URL=http://127.0.0.1:8765 node tests/album-board.test.cjs
    node tests/album-sync.test.cjs
    APP_BASE_URL=http://127.0.0.1:8765 node tests/album-sync-browser.test.cjs

The browser runner uses the existing external Playwright installation via `NODE_PATH` and accepts `BROWSER_EXECUTABLE` and `ARTIFACT_DIR`. It creates a fresh browser context, uses synthetic scores, substitutes a fake clipboard, and blocks all non-local requests. No real account or existing browser profile is touched.

Sync checks use two independent browser contexts and an isolated transactional backend that replaces Firebase SDK requests. They cover migration, concurrent changes, offline reload, deletion, denied reads/writes, retry, account switching and redirect fallback. A separate fresh-browser smoke check initializes the real Firebase SDK while signed out and verifies that no protected database request occurs. The live account path rejects an unauthenticated read (HTTP 401). Positive access with Jason's actual signed-in account could not be checked because the normal browser-control runtime cannot launch; confirm **Synced across devices** on the phone and PCs after release.

## Current scope

- The shared app bar already links to Album Board, and the service worker precaches its page and catalogue.
- Account sync is confined to Album Board's child node; The Grind's existing partial planner updates preserve it. The service worker also precaches `sync.js`, and catalogue/planner release scripts include it in the cache hash.
- This page contains writing packets and local ratings. It does not download audio or consume Suno downloads.

The October 10 refresh includes 69 songs and 98 versions from six sessions: October 4 (4 versions), October 4 Cold Pass (12), October 8 Reset (39), October 9 Lyric Mine (29), October 10 Cue Battle 01 (7), and October 10 Misc Battle 01 (7). Source packets remain drafts unless Scatta approves them; catalogue inclusion is not listening approval.
