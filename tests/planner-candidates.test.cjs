// Exercise the real planner against isolated, synthetic stored decisions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const elements = new Map(), listeners = {};
function element(id) {
  if (!elements.has(id)) elements.set(id, {innerHTML:'', textContent:'', dataset:{}, value:'', hidden:false,
    classList:{add(){}, remove(){}, toggle(){}}, setAttribute(){}, addEventListener(){}, scrollIntoView(){}});
  return elements.get(id);
}
const stems = ['active', 'short', 'audio-cut', 'local-cut', 'delete', 'both', 'done', 'short-delete'];
const plan = {considered:Object.fromEntries(stems.map(s => [s, {added:1}])),
  albums:{debut:{name:'Album 1', created:1, order:['active'], cut:['local-cut'], target:12}},
  sessions:{session:{name:'Compare', created:1, members:stems}}};
plan.considered.delete.del = true;
plan.considered.both.del = true;
plan.considered.done = {added:1, del:true, delDone:1};
plan.considered['short-delete'].del = true;
const audio = {v:2, ratings:{'audio-cut':{status:'cut'}, both:{status:'cut'}, short:{status:'short'}, 'short-delete':{status:'short'}}, tracklist:[], pick:{}, custom:{}, collections:{}};
const storage = new Map([['grind.planner.v1', JSON.stringify(plan)], ['grind.audio.v1', JSON.stringify(audio)]]);
const location = {href:'http://localhost/audio-board/album/', pathname:'/audio-board/album/', search:'', origin:'http://localhost'};
const history = {state:null, entries:[], replaceState(state){this.state=state;}, pushState(state, _, url){this.state=state;this.entries.push(state);const u=new URL(url);location.href=u.href;location.search=u.search;}};
const context = vm.createContext({console, URL, URLSearchParams, crypto:require('node:crypto').webcrypto,
  navigator:{}, location, history, innerWidth:1200,
  localStorage:{getItem:key=>storage.get(key) || null, setItem:(key,value)=>storage.set(key,value)},
  document:{activeElement:null, getElementById:element, querySelector:element, querySelectorAll:()=>[], addEventListener(){}},
  window:{ALBUM_SONGS:stems.map(s=>({slug:s,title:s,versions:[{title:s,baseTitle:s,writer:'Cue',duration:120}]})), addEventListener:(name, callback)=>{listeners[name]=callback;}},
  PlannerSync:require('../audio-board/album/planner-sync.js'), AlbumSync:require('../album-board/sync.js'),
  setTimeout:()=>0, clearTimeout(){}, confirm:()=>true});
vm.runInContext(fs.readFileSync(path.join(root,'audio-board/album/planner.js'),'utf8'),context);
const run = code => vm.runInContext(code,context);
assert.equal(run('live().filter(eligible).length'), 2);
assert.match(element('summary').textContent, /^2 takes still in contention/);
assert.equal(element('countConsider').textContent, '(2)');
assert.equal(run('filters().find(([key])=>key==="short")[2]("short-delete")'),false);
assert.equal(run('filters().find(([key])=>key==="cut")[2]("audio-cut")'),true);
assert.equal(run('filters().find(([key])=>key==="del")[2]("delete")'),true);
assert.equal(run('filters().find(([key])=>key==="all")[2]("delete")'),true);
run('ui.session="session";renderSessions()');
assert.match(element('sessionDetail').innerHTML,/data-stem="active"/);
assert.doesNotMatch(element('sessionDetail').innerHTML,/data-stem="(?:audio-cut|local-cut|delete|both|done|short-delete)"/);
run('ui.showExcluded=true;renderSessions()');
assert.match(element('sessionDetail').innerHTML,/data-stem="audio-cut"/);
assert.match(element('sessionDetail').innerHTML,/data-stem="delete"/);
assert.doesNotMatch(element('sessionDetail').innerHTML,/data-stem="done"/);
run('toggleCut("audio-cut")');
assert.equal(run('eligible("audio-cut")'),true);
assert.equal(run('rating("audio-cut").status'),null);
const html = run('card("active")');
assert.match(html,/target="_blank"/); // Suno remains an external destination.
assert.doesNotMatch(html,/href="[^"]*(?:album-board|take=)[^"]*" target="_blank"/);
assert.match(html,/returnTo=/);
assert(html.indexOf('class="decision"') < html.indexOf('class="link-row"'));
run('ui.session="";saveView();gotoSession("session")');
assert(history.entries.length >= 1);
listeners.popstate({state:{plannerNavigation:{view:'consider',session:'',album:'debut'}}});
assert.equal(run('ui.view'),'consider');
assert.equal(run('ui.session'),'');
for (const board of ['album-board','audio-board']) {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,board,'manifest.webmanifest')));
  assert.equal(manifest.scope,'../');
}
console.log('PASS: shared cuts, deletion exclusion, counts, session review toggle, undo, same-window links, navigation history, PWA scope.');
