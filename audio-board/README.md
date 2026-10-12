# Audio Board

A listening companion to Lyric Board. Open `/audio-board/`. Every Suno clip is one take with a separate score, Shortlist/Maybe/Cut decision, notes and tracklist membership. Recording IDs stay tied to Suno UUIDs even if titles change.

The October 12 catalogue includes 295 clips: 190 vocal takes, 57 instrumentals and 48 stems. Vocals are the initial view. Filter by song, lyric writer, recording type or lyric-match status; search includes current and previous titles, lyrics and source files. Sort by newest, title or score. Custom listening sessions collect chosen takes across songs and sync between devices.

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
