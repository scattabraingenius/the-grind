// Album Planner + sort-direction checks. Run with a static server at the repo root:
//   python3 -m http.server 8765 --bind 127.0.0.1
//   APP_BASE_URL=http://127.0.0.1:8765 node tests/album-planner.test.cjs
// Uses synthetic local data and blocks Firebase, so no real account is touched.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const Sync = require('../audio-board/album/planner-sync.js');
const BASE = process.env.APP_BASE_URL;
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.ARTIFACT_DIR || path.resolve(ROOT, '../album-planner-verification');
const ctx = {window:{}}; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'audio-board/tracks.js'), 'utf8'), ctx);
const vocals = ctx.window.ALBUM_SONGS.filter(s => s.session === 'Vocals');
const pick = vocals.slice(0, 110).map(s => s.slug);
const ratings = Object.fromEntries(pick.slice(0, 40).map((s, i) => [s, {score:40 + (i * 7) % 60, at:1}]));
ratings[pick[3]].status = 'cut';
const audioSeed = {v:2, ratings, tracklist:pick.slice(0, 5), custom:{}, pick:{}, collections:{cand:{name:'Album candidates', created:1, members:pick}}};

// Pure sync checks: capture, tombstones and merge.
{
  const a = Sync.prepare(Sync.empty());
  const next = JSON.parse(JSON.stringify(a)); next.considered.x = {added:1}; next.sessions.s1 = {name:'S', created:1, winner:null, members:['x']};
  const b = Sync.capture(a, next, 'dev1', 10);
  const p = Sync.project(b._sync.records, 'o');
  assert.deepEqual(p.sessions.s1.members, ['x']); assert(p.considered.x);
  const del = JSON.parse(JSON.stringify(p)); delete del.considered.x; del.sessions.s1.members = [];
  const c = Sync.capture(p, del, 'dev2', 20);
  const merged = Sync.merge(b._sync.records, c._sync.records);
  const q = Sync.project(merged, 'o');
  assert(!q.considered.x, 'deletion tombstone wins over stale add'); assert.deepEqual(q.sessions.s1.members, []);
  assert.doesNotThrow(() => Sync.recordsOf({v:1, records:merged}));
}

(async () => {
  fs.mkdirSync(OUT, {recursive:true});
  const browser = await chromium.launch({headless:true});
  const errors = [];
  try {
    const context = await browser.newContext({viewport:{width:1440, height:1000}});
    await context.route(/gstatic\.com|firebaseio\.com|googleapis\.com/, r => r.abort());
    await context.addInitScript(seed => { if (!localStorage.getItem('seeded')) { localStorage.setItem('grind.audio.v1', seed); localStorage.setItem('seeded', '1'); } }, JSON.stringify(audioSeed));
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());

    // Sort direction toggle on Audio Board.
    await page.goto(BASE + '/audio-board/');
    await page.selectOption('#sort', 'title');
    assert.equal((await page.textContent('#sortDir')).trim(), '↑ Asc');
    const firstAsc = await page.locator('#list .row b').first().textContent();
    await page.click('#sortDir');
    assert.equal((await page.textContent('#sortDir')).trim(), '↓ Desc');
    const firstDesc = await page.locator('#list .row b').first().textContent();
    assert.notEqual(firstAsc, firstDesc, 'descending title order differs');
    await page.reload(); assert.equal((await page.textContent('#sortDir')).trim(), '↓ Desc', 'direction persists');
    await page.goto(BASE + '/audio-board/?take=' + pick[0]);
    assert.match(await page.textContent('#detail'), new RegExp(vocals[0].title.replace(/[?.]/g, '.')), 'take deep link opens the take');

    // Planner: import 110 from an Audio Board session.
    await page.goto(BASE + '/audio-board/album/');
    assert.match(await page.textContent('#considerList'), /Nothing considered yet/);
    await page.click('#importOpen');
    await page.click('[data-import="c:cand"]');
    await page.click('#importClose');
    assert.equal(await page.locator('#considerList .card').count(), 110, 'all 110 visible at once');
    await page.screenshot({path:path.join(OUT, 'considered-desktop.png'), fullPage:false});

    // Sorting in planner both ways.
    await page.click('#groupToggle');
    await page.selectOption('#sort', 'score');
    const top = await page.locator('#considerList .card .score').first().textContent();
    await page.click('#sortDir');
    const low = await page.locator('#considerList .card .score').first().textContent();
    assert(Number(top) > Number(low), `score desc ${top} then asc ${low}`);
    await page.click('#groupToggle');

    // Auto-build sessions, pick a winner, place on the debut album.
    await page.click('#autoGroup');
    const sessions = await page.locator('#sessionList .session-row').count();
    assert(sessions > 5, 'sessions created: ' + sessions);
    await page.locator('#sessionList .session-row').first().click();
    const members = await page.locator('#sessionDetail .compare-card').count();
    assert(members >= 2);
    await page.locator('#sessionDetail [data-win]').first().click();
    assert.equal(await page.locator('#sessionDetail .compare-card.winner').count(), 1);
    await page.click('#sessionDetail [data-place="debut"]');
    await page.screenshot({path:path.join(OUT, 'session-desktop.png')});

    await page.click('#tabAlbums');
    assert.equal(await page.locator('#albumTracks .track').count(), 1);
    assert.match(await page.textContent('#missing'), /sessions? without a winner/);
    await page.locator('#pool [data-place]').first().click();
    assert.equal(await page.locator('#albumTracks .track').count(), 2);
    await page.locator('#albumTracks [data-move="-1"]').nth(1).click();
    await page.locator('#albumTracks [data-to-album="second"]').first().click();
    assert.equal(await page.locator('#albumTracks .track').count(), 1, 'moved to album 2');
    await page.screenshot({path:path.join(OUT, 'albums-desktop.png')});

    // Delete + undo on Considered.
    await page.click('#tabConsider');
    const before = await page.locator('#considerList .card').count();
    await page.locator('#considerList [data-act="delete"]').first().click();
    assert.equal(await page.locator('#considerList .card').count(), before - 1);
    await page.click('#toastUndo');
    assert.equal(await page.locator('#considerList .card').count(), before);

    // Compare from a card into a new session.
    await page.locator('#considerList [data-act="compare"]').last().click();
    await page.click('#compareCreate');
    assert.equal(await page.locator('#viewSessions:not(.hidden)').count(), 1);

    // Persistence across reload.
    await page.reload();
    await page.click('#tabConsider');
    assert.equal(await page.locator('#considerList .card').count(), 110);

    // Phone layout: no horizontal scroll.
    await page.setViewportSize({width:390, height:844});
    for (const tab of ['#tabConsider', '#tabSessions', '#tabAlbums']) {
      await page.click(tab);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(overflow <= 1, tab + ' overflows by ' + overflow);
    }
    await page.click('#tabConsider'); await page.screenshot({path:path.join(OUT, 'considered-phone.png')});
    assert.deepEqual(errors, []);
    console.log('Album Planner checks passed');
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exit(1); });
