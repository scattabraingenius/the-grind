const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),vm=require('vm');
const BASE=process.env.APP_BASE_URL,ROOT=path.join(__dirname,'..');
const checked=message=>console.log('PASS '+message);
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'audio-board/tracks.js'),'utf8'),ctx);
const SONGS=ctx.window.ALBUM_SONGS,vocals=SONGS.filter(s=>s.versions[0].type==='Vocal');
const withLyrics=vocals.find(s=>s.versions[0].lyrics);
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(BASE).origin?route.continue():route.abort());
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',d=>d.type()==='prompt'?d.accept('Planner nickname'):d.accept());

    await page.goto(BASE+'/audio-board/?view=consider',{waitUntil:'networkidle'});
    assert.match(page.url(),/\/audio-board\/album\/\?/);
    assert.equal(await page.locator('#considerList .card').count(),vocals.length);
    checked('Audio Board opens the planner showing every vocal take, not only considered ones');

    await page.locator('#typeFilter').selectOption('all');
    assert.equal(await page.locator('#considerList .card').count(),SONGS.length);
    await page.locator('#typeFilter').selectOption('Vocal');

    // Inline lyrics dropdown.
    const card=page.locator(`.card[data-stem="${withLyrics.slug}"]`);
    const panel=card.locator('details.card-lyrics');
    assert.equal(await panel.evaluate(el=>el.open),false);
    await panel.locator('summary').click();
    assert.equal(await panel.evaluate(el=>el.open),true);
    assert((await panel.locator('pre.lyrics').textContent()).length>20);
    await page.click('#sortDir');
    assert.equal(await page.locator(`.card[data-stem="${withLyrics.slug}"] details.card-lyrics`).evaluate(el=>el.open),true,'lyrics stay open through redraws');
    checked('Each card has a lyrics dropdown that stays open through redraws');

    // Grouping choices.
    await page.locator('#groupBy').selectOption('album');
    assert((await page.locator('.group header h3').allTextContents()).some(t=>/Not on an album/.test(t)));
    await page.locator('#groupBy').selectOption('song');
    checked('Group by song or album');

    // Actions on a take that was never "considered".
    const target=vocals[3].slug,mine=page.locator(`.card[data-stem="${target}"]`);
    await mine.locator('[data-act="rename"]').click();
    assert.match(await mine.locator('.t b').textContent(),/Planner nickname/);
    await mine.locator('[data-act="delete"]').click();
    assert.equal(await page.locator(`.card[data-stem="${target}"]`).count(),0,'a delete-tagged take leaves the main list');
    await page.click('[data-f="del"]');
    assert.equal(await page.locator(`.card[data-stem="${target}"]`).count(),1);
    await page.click('[data-f="contenders"]');
    checked('Rename and Delete work on any take; delete-tagged takes leave the main list');

    // One-take and lyric-source links.
    await page.goto(BASE+'/audio-board/classic.html?take='+vocals[0].slug,{waitUntil:'networkidle'});
    await page.goto(BASE+'/audio-board/?take='+vocals[0].slug,{waitUntil:'networkidle'});
    assert.equal(await page.locator('#considerList .card').count(),1);
    await page.click('#clearOnly');
    assert(await page.locator('#considerList .card').count()>100);
    const matched=vocals.find(s=>s.versions[0].lyricStem);
    await page.goto(BASE+'/audio-board/?lyrics='+encodeURIComponent(matched.versions[0].lyricStem),{waitUntil:'networkidle'});
    const n=await page.locator('#considerList .card').count();
    assert(n>=1&&n<vocals.length);
    checked('Links from Lyric Board and old Audio Board URLs open just the right takes');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
