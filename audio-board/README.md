# Audio Board

A listening companion to Lyric Board. Open `/audio-board/`. Every Suno clip is one take with a separate score, Shortlist/Maybe/Cut decision, notes and tracklist membership. Recording IDs stay tied to Suno UUIDs even if titles change.

The October 12 catalogue includes 295 clips: 190 vocal takes, 57 instrumentals and 48 stems. Vocals are the initial view. Filter by song, lyric writer, recording type or lyric-match status; search includes current and previous titles, lyrics and source files. Sort by newest, title or score. Custom listening sessions collect chosen takes across songs and sync between devices.

Lyrics and generation style opens by default for each take. When sync, focus changes or ratings refresh the same take, disclosure sections preserve their current open/closed state. Switching takes starts the lyrics section open again.

Every take has **Open in Suno** and **Copy title**. Exact matches link to the corresponding Lyric Board version. The generic audio_url is a private placeholder, and the returned M4A/Opus media streams carry Suno’s encoding marker. Chrome’s native player cannot decode those streams, so the board opens the original Suno take for listening. The importer skips private placeholders, signed URLs and encoded streams. A native player is supported when a future export supplies a plain playable URL, preserving the player through rating/status changes. No credentials or downloaded audio files are published.

Voice labels come from Suno persona metadata. The current catalogue identifies Write what I can on 125 takes: 86 vocals and 39 instrumentals. Vocal takes using that confirmed persona show Your voice; instrumentals show Persona setting. Six older vocals reference the vsJBrazen persona ID; its name is verified with Suno’s persona endpoint. Both IDs/names are recorded in `voice-personas.json` to retain labels when the feed omits a persona object. No persona listed means Suno has no persona attached, not that the track cannot contain an uploaded voice. Unknown metadata stays unconfirmed. Persona names preserve any explicitly named version; this persona has only one version, so no version number is invented. Use the voice filter to compare takes. Derived recordings also expose their recorded source-take links.

Audio Board installs separately in Chrome using today’s original neon cassette icon, stored in `audio-board/icons/`. Its manifest ID and scope are `/audio-board/`; Lyric Board retains its original `/album-board/` identity. The shared service worker precaches both pages and their data. Audio itself remains online.

Scores, notes, listening sessions and exact-take tracklist sync using the existing Google sign-in. Local storage is `grind.audio.v1`; cloud records are isolated at `planners/the-grind-scattabrain-2026/album/audio/accounts/<UID>`. Lyric records, planner tasks and old local ratings are never copied or moved. Export/import is board-specific.

## Refresh the catalogue

Export full library metadata with the existing read-only Suno downloader and match it to SBGLP, then run:

    python3 audio-board/build_tracks.py --library /path/to/library-current.json --matches /path/to/matched-data.json

The CLI list response omits persona and media-source fields; importing it is supported, but those voice labels remain unconfirmed. Use a full feed export to retain voice/source provenance.

The optional match file is the earlier tracklist export’s JSON, with a `rows` array containing clip_id, source, writer, version, match, type and sbglp_lyrics. Without it, writer/version labels can be parsed from titles, but source matches remain unconfirmed. The builder rejects empty sources, invalid or duplicate UUIDs; filters private, signed and untrusted audio URLs; preserves clip IDs; writes `tracks.js` and the lyric comparison index; then refreshes the offline cache. It never changes songs on Suno or source files in SBGLP.

## Verification

    python3 -B tests/audio-import.test.py
    APP_BASE_URL=http://127.0.0.1:8765 node tests/audio-board.test.cjs
    APP_BASE_URL=http://127.0.0.1:8765 node tests/audio-media.test.cjs  # isolated plain-audio fixture

Browser checks use an isolated backend with synthetic accounts and cover independent scores for two takes of one lyric packet, separate tracklist membership, two-device sync, intact lyric data, exact source navigation, writer/song/type filters, listening sessions, installability, responsive layout and offline reload.

## Installation identity fix

The previous `id: "./"` resolved against the site origin, making both boards collide. The fixed IDs are `/the-grind/album-board/` and `/the-grind/audio-board/`. Start URLs, scopes, browser storage and cloud score paths are unchanged. A previously installed board with the shared origin-root identity may need to be removed and installed again from the correct board URL. Tests now verify Chrome’s processed identities as well as origin-based ID resolution.

## Album Planner

`/audio-board/album/` turns the take catalogue into album decisions in three steps:

1. **Considered.** Every candidate take on one page, grouped by song or flat. Each card has ▶ Suno, Compare, + Album and Delete. **+ Add takes** imports a whole Audio Board listening session or the tracklist, pasted Suno links/IDs (IDs newer than the snapshot keep a Suno link and a placeholder title), or catalogue search. Delete removes the take from the plan everywhere and offers Undo. Sort by title, score, newest or length, ascending or descending. Filter by stage: not sorted yet, in a session, winners, lost a session, on an album.
2. **Sessions.** Compare puts like-takes head to head. **Auto-build sessions** makes one session per song with two or more unsorted takes. Each session shows Audio Board score, status and note, lyrics and style per take, **Score it** (opens that take in Audio Board via `?take=<uuid>`), **Pick winner**, session notes, and **Drop the other N** to clear losers from Considered.
3. **Albums.** Album 1 · Debut and Album 2 by default; add, rename or delete albums and set a track-count target. Drag or use ↑/↓ to order, move tracks between albums, copy the tracklist. **Ready to place** lists session winners and uncompared takes. **What's missing** flags track count, runtime, the same song twice, unscored or Cut tracks, non-vocal takes, sessions without winners, unplaced winners and songs split across albums.

Scores are read from the Audio Board account (read-only); the planner never writes Audio Board records. The plan syncs with the same Google sign-in at `planners/the-grind-scattabrain-2026/album/planner/accounts/<UID>` using the same per-record revision merge as the boards, with tombstones for deletions. Local storage key: `grind.planner.v1`. Export/Import plan is separate from the boards' backups.

Audio Board and Lyric Board also gained an ascending/descending toggle beside Sort (natural defaults: newest first, highest score first, A to Z; unscored stays last).

Verification: `APP_BASE_URL=http://127.0.0.1:8765 node tests/album-planner.test.cjs` (synthetic data, Firebase blocked).
