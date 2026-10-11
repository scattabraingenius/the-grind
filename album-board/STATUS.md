# Album Board status - 2026-10-10

Prepared locally from published main commit `90cd159ae033ceb417a213cec2c6b4c38ad28ee6`. Jason approved publication on October 10 with 'push when done'. The newly included writing drafts are included in that authorized public release.

The catalogue now contains 69 songs and 98 versions from all six dated Writing Sessions folders. It includes both October 10 battle sessions (14 versions) and both previously omitted October 4 sessions (16 versions). Every existing October 8/9 rating ID is preserved. New IDs include the session folder so repeated filenames cannot share scores. All 98 packet paths were independently matched to the generated catalogue; 526 read source files passed final SHA-256 verification with zero changes.

The detail panel has visible title, style, excluded-style and lyric boxes with adjacent Copy buttons. Instrumental styles appear when provided. Displayed and copied text match, editable copies retain their fields, failures are reported accurately, and phone users can return to their selected song. Search covers every version and its prompts. Session filters are generated from the catalogue. Future catalogue builds also update the offline-cache version.

Verification: three importer regression tests and twelve headless browser check groups passed, covering old rating IDs, synthetic saved scores/notes/copies, exact copy text, failure handling, editing and reload, six session filters, missing prompts, search, keyboard use, three viewport widths, and offline reload. Browser checks used a fresh context, fake clipboard and blocked external requests. Existing live browser data was not accessed. Test evidence is in the sibling `album-board-verification` folder, outside this repository.

The normal Chrome/in-app browser control runtime cannot launch because its sandbox fails while enumerating unrelated I:/J: volumes. Local headless browser verification succeeded. The canonical ILS directory is unavailable on this PC; the synced source checkout and its broken copied worktree registrations were preserved. This implementation lives in the isolated `album-board-improvements` checkout in the current chat workspace.

Multi-device score sync remains a separate improvement; Album Board currently saves in each browser locally and supports export/import.
