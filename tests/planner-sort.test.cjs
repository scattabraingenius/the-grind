const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),vm=require('vm');
const BASE=process.env.APP_BASE_URL,ROOT=path.join(__dirname,'..');
const checked=message=>console.log('PASS '+message);
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'audio-board/tracks.js'),'utf8'),ctx);
const SONGS=ctx.window.ALBUM_SONGS,count=type=>SONGS.filter(s=>s.versions[0].type===type).length;
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(BASE).origin?route.continue():route.abort());
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const plan=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('grind.planner.v1')));
    const cards=page.locator('#sortList .card'),chip=k=>page.locator(`[data-sf="${k}"]`);
    await page.goto(BASE+'/audio-board/',{waitUntil:'networkidle'});
    assert.match(page.url(),/view=sort/);
    assert.equal(await page.locator('#viewSort').isVisible(),true);
    assert.equal(await cards.count(),count('Vocal'),'Sort shows vocals only by default');
    await page.locator('#sortType').selectOption('Instrumental');
    assert.equal(await cards.count(),count('Instrumental'));
    await page.locator('#sortType').selectOption('Vocal');
    checked('Sort starts with every undecided vocal take; instrumentals and stems stay out');

    const total=count('Vocal');
    const first=await cards.nth(0).getAttribute('data-stem');
    await cards.nth(0).locator('[data-bucket="debut"]').click();
    assert.equal(await cards.count(),total-1);
    assert.equal(await page.locator(`.card[data-stem="${first}"]`).count(),0,'a sorted take leaves the list');
    assert.deepEqual((await plan()).albums.debut.order,[first]);
    await chip('done').click();
    assert.equal(await page.locator(`#sortList .card[data-stem="${first}"] [data-bucket="debut"]`).getAttribute('aria-pressed'),'true');
    checked('An album bucket places the take and moves the next one up');

    await chip('todo').click();
    const second=await cards.nth(0).getAttribute('data-stem');
    await cards.nth(0).locator('[data-bucket="__later"]').click();
    await chip('later').click();
    assert.equal(await cards.count(),1);assert.equal(await cards.nth(0).getAttribute('data-stem'),second);
    assert.equal((await plan()).considered[second].later,true);
    await chip('todo').click();
    const third=await cards.nth(0).getAttribute('data-stem');
    await cards.nth(0).locator('[data-bucket="__delete"]').click();
    assert.equal(await page.locator(`#sortList .card[data-stem="${third}"]`).count(),0);
    assert.equal((await plan()).considered[third].del,true);
    checked('Later and Delete park a take outside To sort');

    await page.click('#toastUndo');
    assert.equal(await page.locator(`#sortList .card[data-stem="${third}"]`).count(),1,'Undo puts the deleted take back');
    await cards.nth(0).locator('[data-bucket="second"]').click();
    await chip('done').click();
    await page.locator(`#sortList .card[data-stem="${first}"] [data-bucket="debut"]`).click();
    await chip('todo').click();
    assert.equal(await page.locator(`#sortList .card[data-stem="${first}"]`).count(),1,'tapping the current album again takes it off');
    checked('Undo works, and tapping the same album again takes a take back off it');

    assert.match(await page.locator('#countSort').textContent(),/^\(\d+\)$/);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
