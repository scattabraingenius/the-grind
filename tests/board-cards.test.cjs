const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const BASE=process.env.APP_BASE_URL;
const checked=message=>console.log('PASS '+message);
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  try {
    for (const [name,url,key] of [['Audio Board','/audio-board/','grind.audio.v1'],['Lyric Board','/album-board/','grind.album.v1']]) {
      const context=await browser.newContext({viewport:{width:390,height:844}});
      await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(BASE).origin?route.continue():route.abort());
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(BASE+url,{waitUntil:'networkidle'});
      if (name==='Lyric Board') await page.getByRole('button',{name:'All',exact:true}).click();
      const rows=page.locator('#list .row'),title=n=>rows.nth(n).locator('.card-head .t b');

      // Opening a card expands it in place instead of jumping to a side panel at the bottom of the page.
      const before=await page.evaluate(()=>scrollY);
      await rows.first().locator('.card-head .t').click();
      assert.equal(await page.locator('#list .row.active #detail').count(),1,'detail lives inside the open card');
      assert(Math.abs(await page.evaluate(()=>scrollY)-before)<40,'opening a card does not scroll the page');
      await rows.first().locator('#detailBack').click();
      assert.equal(await page.locator('#list .row.active').count(),0);
      checked(name+': a card opens and collapses in place without scrolling');

      // Enter stores a score and drops into the next card's box; the list does not reshuffle mid-entry.
      await page.locator('#sort').selectOption('score');
      const first=await rows.nth(0).getAttribute('data-slug'),second=await rows.nth(1).getAttribute('data-slug');
      await rows.nth(0).locator('.card-score').fill('61');await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>document.activeElement.closest('.row').dataset.slug),second);
      await page.keyboard.type('88');await page.keyboard.press('Enter');
      assert.equal(await rows.nth(1).getAttribute('data-slug'),second,'order holds while scores are being entered');
      await page.evaluate(()=>document.activeElement.blur());
      await page.waitForFunction(()=>!ui.stale);
      assert.equal(await rows.nth(0).getAttribute('data-slug'),second,'sort catches up when the score box is released');
      const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).ratings,key);
      assert.equal(Object.values(saved).filter(r=>r.score===88).length,1);assert.equal(Object.values(saved).filter(r=>r.score===61).length,1);
      checked(name+': Enter moves down the score boxes and saves each score');

      // Sort direction and grouping.
      const top=await rows.nth(0).getAttribute('data-slug');
      await page.locator('#sortDir').click();
      assert.notEqual(await rows.nth(0).getAttribute('data-slug'),top,'reversing changes which card is first');
      assert.match(await page.locator('#sortDir').textContent(),/Low → high/);
      await page.locator('#sortDir').click();
      await page.locator('#groupBy').selectOption(name==='Audio Board'?'song':'status');
      assert((await page.locator('.group-head').count())>=1);
      await page.locator('#groupBy').selectOption('none');
      assert.equal(await page.locator('.group-head').count(),0);
      checked(name+': sort direction flips and grouping adds headers');

      // Card actions: status, tracklist and the lyrics dropdown.
      await page.locator('#sort').selectOption('title');
      const row=rows.nth(0),slug=await row.getAttribute('data-slug');
      await row.locator('[data-card-status="short"]').click();
      assert.equal(await page.locator(`.row[data-slug="${slug}"] [data-card-status="short"]`).getAttribute('aria-pressed'),'true');
      await page.locator(`.row[data-slug="${slug}"] [data-card-album]`).click();
      assert.equal(await page.locator('#albumCount').textContent(),'(1)');
      await page.locator(`.row[data-slug="${slug}"] details.card-lyrics summary`).click();
      assert.equal(await page.locator(`.row[data-slug="${slug}"] details.card-lyrics`).evaluate(el=>el.open),true);
      await page.locator('#sortDir').click();await page.locator('#sortDir').click();
      assert.equal(await page.locator(`.row[data-slug="${slug}"] details.card-lyrics`).evaluate(el=>el.open),true,'lyrics stay open through redraws');
      checked(name+': status, tracklist and lyrics dropdown work from the card');

      // Rename keeps the Suno name and yields to a Suno rename.
      const mine=page.locator(`.row[data-slug="${slug}"]`),original=await mine.locator('.card-head .t b').textContent();
      await mine.locator('[data-card-rename]').click();
      await page.keyboard.press('Control+A');await page.keyboard.type('My nickname');await page.keyboard.press('Enter');
      assert.equal(await mine.locator('.card-head .t b').textContent(),'My nickname');
      assert.match(await mine.locator('.card-head .t small').first().textContent(),new RegExp('Suno name: '+original.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
      await page.reload({waitUntil:'networkidle'});
      if (name==='Lyric Board') await page.getByRole('button',{name:'All',exact:true}).click();
      assert.equal(await page.locator('.row b',{hasText:'My nickname'}).count(),1,'rename survives reload');
      await page.evaluate(k=>{const s=JSON.parse(localStorage.getItem(k));for(const r of Object.values(s.ratings))if(r.alias)r.aliasFrom='An older Suno name';localStorage.setItem(k,JSON.stringify(s));},key);
      await page.reload({waitUntil:'networkidle'});
      if (name==='Lyric Board') await page.getByRole('button',{name:'All',exact:true}).click();
      assert.equal(await page.locator('.row b',{hasText:'My nickname'}).count(),0,'a changed Suno name replaces the old nickname');
      assert.equal(await page.locator('.row b',{hasText:original}).count()>=1,true);
      checked(name+': rename keeps the Suno name and is retired when Suno changes it');

      // Remove hides the card; the Removed filter brings it back.
      const total=await rows.count(),target=await rows.nth(0).getAttribute('data-slug');
      await rows.nth(0).locator('[data-card-remove]').click();
      assert.equal(await rows.count(),total-1);assert.equal(await page.locator(`.row[data-slug="${target}"]`).count(),0);
      await page.getByRole('button',{name:'Removed',exact:true}).click();
      assert.equal(await rows.count(),1);
      await rows.nth(0).locator('[data-card-restore]').click();
      await page.getByRole('button',{name:'Any rating',exact:true}).click();
      assert.equal(await rows.count(),total);
      checked(name+': Remove hides a card from the main list and Restore brings it back');
      assert.deepEqual(errors,[]);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
