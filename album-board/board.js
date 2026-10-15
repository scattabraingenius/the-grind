"use strict";
// Keep the existing local key. Account sync merges private records in a child of The Grind's node.
const AUDIO_BOARD = window.BOARD_KIND === "audio";
const BOARD_NAME = AUDIO_BOARD ? "Audio Board" : "Lyric Board";
const KEY = AUDIO_BOARD ? "grind.audio.v1" : "grind.album.v1";
let installPrompt = null;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event;
  document.getElementById('installApp').hidden = false;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null; document.getElementById('installApp').hidden = true;
});
document.getElementById('installApp').onclick = async () => {
  const prompt = installPrompt; if (!prompt) return;
  installPrompt = null; document.getElementById('installApp').hidden = true;
  try { await prompt.prompt(); await prompt.userChoice; }
  catch (err) { toast('Use Chrome’s address-bar install icon to install '+BOARD_NAME+'.'); }
};
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('../service-worker.js').catch(() => {
    console.warn('Album Board offline support could not start.');
  });
}
const SONGS = (window.ALBUM_SONGS || []);
const BY = Object.fromEntries(SONGS.map(s => [s.slug, s]));
const STATUSES = [["short","Shortlist"],["maybe","Maybe"],["cut","Cut"]];
const SESSIONS = window.ALBUM_SESSIONS || [...new Set(SONGS.flatMap(s => s.versions.map(v => v.session)))].map(label => ({label}));
const FILTERS = [["all","Any rating"],["unrated","Unrated"],["short","Shortlist"],["maybe","Maybe"],["cut","Cut"],["album",AUDIO_BOARD ? "On tracklist" : "On album"],...(AUDIO_BOARD ? [["matched","Matched lyrics"],["unmatched","Needs a lyric match"]] : [["ep","EP"],["mine","My versions"]]),["removed","Removed"]];
const GROUPS = [["none","No grouping"],...(AUDIO_BOARD ? [["song","Group by song"]] : []),["status","Group by status"],["album",AUDIO_BOARD ? "Group by tracklist" : "Group by album"],["writer","Group by writer"]];
const SORT_LABELS = { title:["A → Z","Z → A"], score:["High → low","Low → high"], session:AUDIO_BOARD ? ["Newest first","Oldest first"] : ["Catalog order","Reversed"] };

// v2: ratings are keyed by version stem (one score, status and note per version). Version 1 data was keyed
// by song slug, so it moves onto whichever version of that song was showing.
function migrate(st) {
  st = { ratings:{}, tracklist:[], pick:{}, custom:{}, collections:{}, ...st };
  if (st.v !== 2) {
    for (const slug of Object.keys(st.ratings)) {
      const s = BY[slug]; if (!s) continue;
      const stem = st.pick[slug] || s.versions[s.versions.length - 1].stem;
      st.ratings[stem] = { ...st.ratings[slug], ...(st.ratings[stem] || {}) };
      delete st.ratings[slug];
    }
    st.v = 2;
  }
  return st;
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && typeof s === "object") return migrate(s); } catch (e) {}
  return migrate({});
}
let state = AlbumSync.prepare(load());
let previousState = JSON.parse(JSON.stringify(state)), cloud = null, pendingRemoteDetail = false;
const deviceKey = KEY + ".device";
let deviceId;
try { deviceId = localStorage.getItem(deviceKey); } catch (err) {}
if (!deviceId) { deviceId = crypto.randomUUID(); try { localStorage.setItem(deviceKey, deviceId); } catch (err) {} }
function persist() {
  const status = $("saveStatus");
  try {
    if (state._sync.owner) localStorage.setItem(KEY + ".account." + state._sync.owner, JSON.stringify(state));
    localStorage.setItem(KEY, JSON.stringify(state));
    status.classList.remove("failed");
    status.textContent = "Saved on this device. Export scores keeps a separate backup.";
    return true;
  } catch (e) {
    status.classList.add("failed");
    status.textContent = "Changes could not be saved. Export a backup before closing this page.";
    toast("Changes aren't saved. Export a backup before closing.");
    return false;
  }
}
function save() {
  state = AlbumSync.capture(previousState, state, deviceId);
  previousState = JSON.parse(JSON.stringify(state));
  const saved = persist();
  if (cloud) cloud.changed();
  return saved;
}
let viewPrefs = {};
try { viewPrefs = JSON.parse(localStorage.getItem(KEY + ".view")) || {}; } catch (err) {}
let ui = { view:"songs", scope:viewPrefs.scope || (AUDIO_BOARD ? "session:Vocals" : "all"), filter:FILTERS.some(([key]) => key === viewPrefs.filter) ? viewPrefs.filter : "all", q:"", sort:["session","score","title"].includes(viewPrefs.sort) ? viewPrefs.sort : "session", flip:viewPrefs.flip === true, group:GROUPS.some(([key]) => key === viewPrefs.group) ? viewPrefs.group : "none", open:null, renaming:null, stale:false, lyricsOpen:new Set(), song:"", writer:"", voice:"", lyricSource:new URLSearchParams(location.search).get("lyrics") || "" };
function saveView() { try { localStorage.setItem(KEY + ".view", JSON.stringify({scope:ui.scope,filter:ui.filter === "removed" ? "all" : ui.filter,sort:ui.sort,flip:ui.flip,group:ui.group})); } catch (err) {} }

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function rating(stem) { return state.ratings[stem] || {}; }
function setRating(stem, patch) { state.ratings[stem] = { ...rating(stem), ...patch, at: Date.now() }; save(); }
function versionsOf(s) { return s.versions.concat(state.custom[s.slug] || []); }
function scopedVersions(s) {
  const versions = versionsOf(s);
  if (ui.scope.startsWith("session:")) return versions.filter(v => v.session === ui.scope.slice(8));
  if (ui.scope.startsWith("collection:")) { const members = new Set(state.collections[ui.scope.slice(11)]?.members || []); return versions.filter(v => members.has(v.stem)); }
  return versions;
}
// A removed take or version leaves the main list; the Removed filter shows (and restores) only those.
function visibleVersions(s) {
  const all = scopedVersions(s);
  return ui.filter === "removed" ? all.filter(v => rating(v.stem).removed) : all.filter(v => !rating(v.stem).removed);
}
function version(s) {
  const matching = visibleVersions(s), picked = matching.find(v => v.stem === state.pick[s.slug]);
  return picked || matching[matching.length - 1] || scopedVersions(s).slice(-1)[0] || s.versions[s.versions.length - 1];
}
// A rename is a local nickname. It is remembered with the Suno name it replaced, and stops applying the
// moment the imported Suno name differs, so the original name is never lost and a Suno rename wins.
function origTitle(s, v) { return AUDIO_BOARD ? (v.suno?.title ?? v.title ?? s.title) : s.title; }
function nickname(s, v) { const r = rating(v.stem); return r.alias && r.aliasFrom === origTitle(s, v) ? r.alias : ""; }
function titleOf(s, v) { return nickname(s, v) || origTitle(s, v); }
function best(s, versions = visibleVersions(s)) { const n = versions.map(v => rating(v.stem).score).filter(x => x != null); return n.length ? Math.max(...n) : null; }
function voiceLabel(v) { if (v.voiceName) return (v.type === "Vocal" && v.personalVoice ? "Your voice · " : v.type === "Vocal" ? "Voice persona · " : "Persona setting · ")+v.voiceName; return v.voiceChecked ? "No voice persona listed" : "Voice not confirmed"; }
function verLabel(v) { if (AUDIO_BOARD) return [v.type,v.writer !== "Unknown" ? v.writer : "",v.packetVersion ? "lyrics v"+v.packetVersion : "",v.take ? "take "+v.take : "",v.duration ? Math.floor(Math.round(v.duration)/60)+":"+String(Math.round(v.duration)%60).padStart(2,"0") : "",v.voiceName ? voiceLabel(v) : ""].filter(Boolean).join(" · "); return v.custom ? (v.label || "My copy") : `v${String(v.version).padStart(2,"0")} ${v.writer} · ${v.session}`; }
function inAlbum(slug) { return state.tracklist.includes(slug); }
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 1400); }
function scoreClass(n) { return n == null ? "" : n >= 80 ? "hi" : n >= 50 ? "mid" : ""; }

function matches(s) {
  const versions = visibleVersions(s); if (!versions.length) return false;
  if (AUDIO_BOARD && ((ui.song && s.baseTitle !== ui.song) || (ui.writer && versions[0].writer !== ui.writer) || (ui.lyricSource && versions[0].lyricStem !== ui.lyricSource))) return false;
  if (AUDIO_BOARD && ui.voice && (ui.voice === "none" ? (!versions[0].voiceChecked || !!versions[0].voiceName) : ui.voice === "unknown" ? versions[0].voiceChecked : versions[0].voiceName !== ui.voice)) return false;
  if (AUDIO_BOARD && ui.filter === "matched" && !versions[0].source) return false;
  if (AUDIO_BOARD && ui.filter === "unmatched" && versions[0].source) return false;
  const rs = versions.map(v => rating(v.stem)), f = ui.filter;
  if (f === "unrated" && rs.some(r => r.score != null)) return false;
  if (["short","maybe","cut"].includes(f) && !rs.some(r => r.status === f)) return false;
  if (f === "mine" && !versions.some(v => v.custom)) return false;
  if (f === "album" && !inAlbum(s.slug)) return false;
  if (f === "ep" && !s.ep) return false;
  if (ui.q) {
    const q = ui.q.toLowerCase();
    if (!s.title.toLowerCase().includes(q) && !versions.some(v =>
      [v.title,v.lyrics,v.oldTitle,v.source,v.voiceName,nickname(s,v),rating(v.stem).note,...fieldsOf(v).map(f => f[2])].some(text => String(text || "").toLowerCase().includes(q)))) return false;
  }
  return true;
}
// Each sort has a natural direction; ui.flip reverses it.
function sorted(arr) {
  const a = arr.slice(), name = s => titleOf(s, version(s));
  if (AUDIO_BOARD && ui.sort === "session") a.sort((x,y) => y.versions[0].createdAt.localeCompare(x.versions[0].createdAt));
  else if (ui.sort === "title") a.sort((x,y) => name(x).localeCompare(name(y)));
  else if (ui.sort === "score") a.sort((x,y) => (best(y) ?? -1) - (best(x) ?? -1) || name(x).localeCompare(name(y)));
  return ui.flip ? a.reverse() : a;
}
function groupOf(s) {
  const v = version(s), r = rating(v.stem);
  if (ui.group === "song") return s.baseTitle || s.title;
  if (ui.group === "status") return STATUSES.find(x => x[0] === r.status)?.[1] || "No status";
  if (ui.group === "album") return inAlbum(s.slug) ? (AUDIO_BOARD ? "On tracklist" : "On album") : (AUDIO_BOARD ? "Not on tracklist" : "Not on album");
  if (ui.group === "writer") return v.writer && v.writer !== "Unknown" ? v.writer : "Unknown writer";
  return "";
}

function renderSummary() {
  const live = SONGS.filter(s => versionsOf(s).some(v => !rating(v.stem).removed));
  const rated = live.filter(s => best(s, versionsOf(s).filter(v => !rating(v.stem).removed)) != null).length;
  const removed = SONGS.length - live.length;
  $("summary").textContent = `${live.length} ${AUDIO_BOARD ? "audio takes" : "songs"} · ${rated} scored · ${state.tracklist.length} on the ${AUDIO_BOARD ? "tracklist" : "album"}${removed ? ` · ${removed} removed` : ""}`;
  $("albumCount").textContent = state.tracklist.length ? `(${state.tracklist.length})` : "";
  $("built").textContent = window.ALBUM_BUILT ? `${AUDIO_BOARD ? "Suno snapshot" : "Lyrics loaded"} ${window.ALBUM_BUILT}` : "No songs.js found";
}
function renderChips() {
  $("chips").innerHTML = FILTERS.map(([k,l]) => `<button class="chip" data-f="${esc(k)}" aria-pressed="${ui.filter===k}">${esc(l)}</button>`).join("");
  const scopes = [["all","All"],...SESSIONS.map(s => ["session:"+s.label,s.label]),...Object.entries(state.collections).map(([id,s]) => ["collection:"+id,s.name])];
  $("sessionChips").innerHTML = scopes.map(([key,name]) => `<button class="chip" data-scope="${esc(key)}" aria-pressed="${ui.scope===key}">${esc(name)}</button>`).join("");
  $("manageSession").classList.toggle("hidden", !ui.scope.startsWith("collection:") || !state.collections[ui.scope.slice(11)]);
}
function renderToolbar() {
  $("sort").value = ui.sort;
  $("sortDir").textContent = SORT_LABELS[ui.sort][ui.flip ? 1 : 0] + " ⇅";
  $("sortDir").setAttribute("aria-pressed", ui.flip);
  $("groupBy").value = ui.group;
}
// The open card hosts #detail, so a take is read, scored and edited where it sits in the list.
function placeDetail() {
  const d = $("detail"), host = $("list").querySelector(".row.active .row-detail");
  if (host) { if (d.parentNode !== host) host.appendChild(d); d.hidden = false; }
  else { if (d.parentNode !== $("detailHome")) $("detailHome").appendChild(d); d.hidden = true; }
}
function sessionOptions(stem) {
  return `<option value="">+ Session</option>${Object.entries(state.collections).map(([id,c]) => `<option value="${esc(id)}" ${(c.members || []).includes(stem) ? 'disabled' : ''}>${esc(c.name)}${(c.members || []).includes(stem) ? ' ✓' : ''}</option>`).join("")}<option value="new">+ New session…</option>`;
}
function rowHtml(s) {
  const v = version(s), r = rating(v.stem), bs = best(s), versions = visibleVersions(s), n = versions.length;
  const open = ui.open === s.slug, removedView = ui.filter === "removed", album = inAlbum(s.slug);
  const title = titleOf(s, v), orig = origTitle(s, v), nick = nickname(s, v), retired = r.alias && !nick;
  const listed = ui.sort === "score" ? versions.slice().sort((a,b) => (rating(b.stem).score ?? -1) - (rating(a.stem).score ?? -1)) : versions;
  const lyrics = (v.suno?.lyrics ?? v.lyrics) || "";
  const meta = (n>1 ? `${n} versions in this session` : verLabel(v)) + (nick ? ` · Suno name: ${orig}` : "");
  const titleHtml = ui.renaming === v.stem
    ? `<input class="rename-input" data-rename="${esc(v.stem)}" value="${esc(title)}" maxlength="200" autocomplete="off" aria-label="New name for ${esc(orig)}"><small>Enter saves · Esc cancels · ${nick ? "Clear the box to go back to " : "Suno name stays "}${esc(orig)}</small>`
    : `<b>${esc(title)}</b><small>${esc(meta)}</small>${retired ? `<small class="note-line">Suno renamed this take, so your old rename “${esc(r.alias)}” was retired.</small>` : ""}${r.note ? `<small class="note-line">${esc(r.note.slice(0,90))}</small>` : ""}`;
  return `<div class="row${open?" active":""}${r.removed ? " removed" : ""}" data-slug="${esc(s.slug)}" role="group" tabindex="0" aria-label="Open ${esc(title)}">
    <div class="card-head">
      <button class="btn small chev" data-toggle aria-expanded="${open}" aria-label="${open ? "Collapse" : "Expand"} ${esc(title)}">${open ? "▾" : "▸"}</button>
      <div class="t">${titleHtml}</div>
      ${s.ep ? `<span class="badge ep">EP</span>` : ""}
      ${n>1 && bs != null ? `<span class="badge best-badge" title="Best score in this session">best ${bs}</span>` : ""}
    </div>
    <div class="version-scores">${AUDIO_BOARD ? "" : listed.map(x => versionScoreHtml(s,x,v)).join("")}</div>
    <div class="card-ctl">
      <input class="card-score ${scoreClass(r.score)}" ${open ? 'id="scoreNum"' : ""} type="number" min="0" max="100" inputmode="numeric" data-score="${esc(v.stem)}" value="${r.score ?? ""}" placeholder="–" aria-label="Score for ${esc(title)}, 0 to 100. Enter moves to the next score.">
      ${STATUSES.map(([k,l]) => `<button class="btn small s-${k}" data-card-status="${k}" aria-pressed="${r.status===k}">${l}</button>`).join("")}
      <button class="btn small${album ? " on" : ""}" data-card-album aria-pressed="${album}" title="${album ? "Take it off" : "Put it on"} the ${AUDIO_BOARD ? "tracklist" : "album"}">${album ? "★ " : "☆ "}${AUDIO_BOARD ? "Tracklist" : "Album"}</button>
      <button class="btn small" data-card-rename title="Rename. The Suno name is kept.">✎ Rename</button>
      ${AUDIO_BOARD ? "" : `<button class="btn small" data-card-copyedit>Copy &amp; edit</button>`}
      <select class="card-session" data-card-session aria-label="Add to a custom session">${sessionOptions(v.stem)}</select>
      ${removedView || r.removed ? `<button class="btn small" data-card-restore>↩ Restore</button>` : `<button class="btn small danger" data-card-remove title="Hide this from the list">✕ Remove</button>`}
    </div>
    <details class="card-lyrics" data-lyr="${esc(s.slug)}" ${ui.lyricsOpen.has(s.slug) ? "open" : ""}><summary>Lyrics${lyrics ? "" : " (none in Suno metadata)"}</summary>${lyrics ? `<pre class="lyrics">${lyricHtml(lyrics)}</pre>` : ""}</details>
    ${open ? `<div class="row-detail"></div>` : ""}
  </div>`;
}
function renderList(focusSel) {
  $("detailHome").appendChild($("detail"));
  renderToolbar();
  const rows = sorted(SONGS.filter(matches));
  const count = SONGS.filter(s => visibleVersions(s).length).length;
  const name = ui.scope.startsWith("session:") ? ui.scope.slice(8) : ui.scope.startsWith("collection:") ? (state.collections[ui.scope.slice(11)]?.name || "Custom session") : "All sessions";
  $("scopeNote").textContent = AUDIO_BOARD ? `${name} · ${rows.length} of ${count} takes. Each recording has its own score and notes.` : `${name} · ${rows.length} of ${count} songs · ${SONGS.reduce((n,s) => n + scopedVersions(s).length,0)} versions. Scores and sorting use this session only.`;
  if (!rows.length) { $("list").innerHTML = `<div class="empty-note">${ui.filter === "removed" ? "Nothing is removed." : "Nothing matches."}</div>`; placeDetail(); return; }
  const groups = new Map();
  for (const s of rows) { const g = groupOf(s); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }
  $("list").innerHTML = [...groups].map(([g, members]) => (ui.group === "none" ? "" : `<h3 class="group-head">${esc(g)} <span>${members.length}</span></h3>`) + members.map(rowHtml).join("")).join("");
  ui.stale = false;
  placeDetail();
  if (focusSel) { const el = $("list").querySelector(focusSel); if (el) el.focus({preventScroll:true}); }
}
function versionScoreHtml(s, x, current) {
  const r = rating(x.stem), status = STATUSES.find(([key]) => key === r.status);
  return `<button class="version-score" data-open-ver="${esc(x.stem)}" aria-pressed="${ui.open===s.slug && x.stem===current.stem}" title="${esc(verLabel(x))}" aria-label="Open ${esc(verLabel(x))}, score ${r.score ?? 'unrated'}${status ? ', '+status[1] : ''}"><span>${esc(verLabel(x))}${status ? `<small class="version-status">${status[1]}</small>` : ''}</span><strong>${r.score ?? '–'}</strong></button>`;
}
function lyricHtml(text) {
  return esc(text).replace(/^(\[[^\]\n]+\])/gm, '<span class="tag">$1</span>');
}
function fieldsOf(v) {
  const su = v.suno || {};
  if (AUDIO_BOARD) return [["title","Title",su.title ?? v.title],["style","Generation style",su.style],...(v.lyrics ? [["lyrics","Suno lyrics",v.lyrics]] : [])];
  const fields = [["title","Title",su.title ?? v.title],["style","Style prompt",su.style],["exclude","Excluded styles",su.exclude],["lyrics","Lyrics",su.lyrics ?? v.lyrics]];
  if (su.instrumental) fields.splice(2,0,["instrumental","Instrumental style",su.instrumental]);
  return fields;
}
function countText(val) { return val ? (val.length.toLocaleString() + " chars") : "missing"; }
function fieldHtml(k, label, value, editable) {
  const id = {title:"edTitle",style:"edStyle",exclude:"edExclude",lyrics:"edLyrics",instrumental:"edInstrumental"}[k];
  const heading = editable ? `<label for="${id}">${label}</label>` : `<h3 id="field-${k}">${label}</h3>`;
  const control = editable ? (k === "title" ? `<input id="${id}" value="${esc(value || "")}" autocomplete="off">` :
    `<textarea id="${id}" ${k === "lyrics" ? 'class="ly" rows="16"' : `rows="${k === "exclude" ? 3 : 5}"`}>${esc(value || "")}</textarea>`) :
    `<pre class="field-text ${k === "lyrics" ? "lyrics" : ""}${value ? "" : " field-empty"}" aria-labelledby="field-${k}">${value ? (k === "lyrics" ? lyricHtml(value) : esc(value)) : "No " + label.toLowerCase() + " provided."}</pre>`;
  return `<section class="prompt-field" data-field="${k}"><div class="field-head">${heading}<div class="field-tools"><small class="field-count">${countText(value)}</small><button class="btn small field-copy" data-copy="${k}" aria-label="Copy ${label.toLowerCase()}" ${value ? "" : "disabled"}>Copy</button></div></div>${control}</section>`;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
  const active = document.activeElement, selection = window.getSelection();
  const ranges = Array.from({length:selection.rangeCount},(_,i) => selection.getRangeAt(i).cloneRange());
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) {}
  ta.remove(); if (active && active.isConnected) active.focus({preventScroll:true});
  selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range));
  return ok;
}
function chipHtml(s, x, cur) {
  const sc = rating(x.stem).score;
  return `<button class="btn small" data-ver="${esc(x.stem)}" aria-pressed="${x.stem===cur.stem}" style="${x.stem===cur.stem?"border-color:var(--signal)":""}"><span>${esc(verLabel(x))}</span>${sc != null ? ` <small>· ${sc}</small>` : ""}</button>`;
}
function renderDetail() {
  const d = $("detail"), s = BY[ui.open];
  const previousPlayer = d.querySelector("audio"), previousStem = d.dataset.stem;
  const previousPanels = new Map(Array.from(d.querySelectorAll("details[data-panel]"), panel => [panel.dataset.panel, panel.open]));
  if (!s || !visibleVersions(s).length) { d.className = "detail empty"; d.textContent = AUDIO_BOARD ? "Pick a take in this session to open it in Suno and score it." : "Pick a song in this session to read it, score it, and copy its Suno fields."; placeDetail(); return; }
  const v = version(s), r = rating(v.stem), su = v.suno || {}, fields = fieldsOf(v);
  const vs = visibleVersions(s), src = v.custom ? versionsOf(s).find(x => x.stem === v.copiedFrom) : null;
  d.className = "detail";
  const body = `<div class="${v.custom ? "editor" : "fields"}">
    ${v.custom ? `<label>Version name<input id="edLabel" value="${esc(v.label || "")}" autocomplete="off"></label>` : ""}
    ${fields.map(([k,label,value]) => fieldHtml(k,label,value,v.custom)).join("")}
    ${v.custom ? `<div><button class="btn" id="delMine">Delete my version</button></div>` : su.lyrics != null && su.lyrics !== v.lyrics ?
      `<details class="style" data-panel="writing-draft"><summary>Full writing draft</summary><p>The boxes above contain the exact Suno fields. This is the original writing draft.</p><pre class="lyrics">${lyricHtml(v.lyrics)}</pre></details>` : ""}
    </div>`;
  const changedVersion = d.dataset.stem !== v.stem;
  d.dataset.stem = v.stem;
  d.innerHTML = `
    <button class="btn small detail-back" id="detailBack">▴ Collapse</button>
    <div class="eyebrow">${esc(v.session)}${s.ep ? " · EP" : ""}</div>
    <h2>${esc(nickname(s, v) || su.title || v.title || s.title)}</h2>
    <div class="meta">${v.custom ? `Your version${src ? ", copied from " + esc(verLabel(src)) : ""}. Edits save as you type.` : esc(v.header || "")}</div>
    ${AUDIO_BOARD ? audioHtml(v) : `<div class="versions">${vs.map(x => chipHtml(s, x, v)).join("")}</div>`}
    ${!AUDIO_BOARD && v.naming ? `<div class="meta">Suno naming: ${esc(v.naming)}.[clip number] · instrumental: ${esc(v.naming.replace(/\.([CMS])/,'.i$1'))}.[clip number]</div>` : ''}
    ${!AUDIO_BOARD && window.LYRIC_AUDIO_COUNTS?.[v.stem] ? `<p class="meta"><a href="../audio-board/?lyrics=${encodeURIComponent(v.stem)}">Compare ${window.LYRIC_AUDIO_COUNTS[v.stem]} Suno takes on Audio Board →</a></p>` : ""}
    <div class="scope-tools"><select id="addSession" aria-label="Add this ${AUDIO_BOARD ? "take" : "version"} to a custom session"><option value="">Add ${AUDIO_BOARD ? "take" : "version"} to a custom session…</option>${Object.entries(state.collections).map(([id,c]) => `<option value="${esc(id)}" ${(c.members || []).includes(v.stem) ? 'disabled' : ''}>${esc(c.name)}${(c.members || []).includes(v.stem) ? ' (included)' : ''}</option>`).join("")}<option value="new">+ New custom session…</option></select>${ui.scope.startsWith('collection:') ? '<button class="btn small" id="removeSessionVersion">Remove from session</button>' : ''}</div>
    <div class="status">
      ${STATUSES.map(([k,l]) => `<button class="btn s-${k}" data-status="${k}" aria-pressed="${r.status===k}">${l}</button>`).join("")}
      <button class="btn ${inAlbum(s.slug) ? "" : "primary"}" id="albumToggle">${inAlbum(s.slug) ? "Remove from "+(AUDIO_BOARD ? "tracklist" : "album") : "+ Add to "+(AUDIO_BOARD ? "tracklist" : "album")}</button>
      ${AUDIO_BOARD ? "" : `<button class="btn" id="copyEdit">Copy &amp; edit</button>`}
    </div>
    <textarea id="note" aria-label="Notes for this version" placeholder="Notes for this version: timestamps, what hit, what to fix">${esc(r.note || "")}</textarea>
    ${AUDIO_BOARD ? `<details class="style" data-panel="audio-fields" open><summary>Lyrics and generation style</summary>${body}</details>` : body}`;
  // Focus changes and cloud acknowledgments can rebuild the same detail view.
  // Read the live DOM state rather than waiting for an asynchronously dispatched toggle event.
  if (!changedVersion) for (const panel of d.querySelectorAll("details[data-panel]")) {
    if (previousPanels.has(panel.dataset.panel)) panel.open = previousPanels.get(panel.dataset.panel);
  }
  d._fields = Object.fromEntries(fields.map(([k,,val]) => [k, val || ""]));
  if (AUDIO_BOARD && previousPlayer) {
    const player = d.querySelector("audio");
    if (previousStem === v.stem && player) player.replaceWith(previousPlayer); else previousPlayer.pause();
  }
  const player = d.querySelector("audio");
  if (player) player.onerror = () => { const notice = $("audioNotice"); if (notice) notice.textContent = "Playback is unavailable here. Open this take in Suno to listen."; };
  placeDetail();
}
function refreshCopyButtons(v) {
  const d = $("detail"), fields = fieldsOf(v);
  d._fields = Object.fromEntries(fields.map(([k,,val]) => [k, val || ""]));
  for (const [k,,val] of fields) {
    const section = d.querySelector(`[data-field="${k}"]`), button = section && section.querySelector("[data-copy]");
    if (!button) continue;
    section.querySelector(".field-count").textContent = countText(val);
    button.disabled = !val; button.classList.remove("copied"); button.textContent = "Copy";
  }
}
function renderAlbum() {
  const t = state.tracklist.filter(slug => BY[slug] && versionsOf(BY[slug]).some(v => !rating(v.stem).removed));
  if (!t.length) { $("tracks").innerHTML = AUDIO_BOARD ? `<div class="empty-note">No takes on the tracklist yet. Open a take and tap “+ Add to tracklist”.</div>` : `<div class="empty-note">No songs on the album yet. Open a song and tap “+ Add to album”.</div>`; return; }
  $("tracks").innerHTML = t.map((slug, i) => {
    const s = BY[slug], v = version(s), r = rating(v.stem);
    return `<div class="track" data-slug="${esc(slug)}">
      <div class="n">${i+1}</div>
      <div class="score ${scoreClass(r.score)}">${r.score ?? "–"}</div>
      <div class="t"><b>${esc(titleOf(s, v))}</b><small>${esc(verLabel(v))}${r.note ? " · " + esc(r.note.slice(0,80)) : ""}</small></div>
      <div class="ctl">
        <button class="btn small" data-move="-1" aria-label="Move up" ${i===0?"disabled":""}>↑</button>
        <button class="btn small" data-move="1" aria-label="Move down" ${i===t.length-1?"disabled":""}>↓</button>
        <button class="btn small" data-remove aria-label="Remove">✕</button>
      </div>
    </div>`;
  }).join("");
}
function render() {
  renderSummary();
  $("viewSongs").classList.toggle("hidden", ui.view !== "songs");
  $("viewAlbum").classList.toggle("hidden", ui.view !== "album");
  $("tabSongs").setAttribute("aria-selected", ui.view === "songs");
  $("tabAlbum").setAttribute("aria-selected", ui.view === "album");
  if (ui.view === "songs") { renderChips(); renderList(); renderDetail(); } else renderAlbum();
}
function rerenderKeepDetail() { renderSummary(); renderList(); }

// Events
$("tabSongs").onclick = () => { ui.view = "songs"; render(); };
$("tabAlbum").onclick = () => { ui.view = "album"; render(); };
$("q").oninput = e => { ui.q = e.target.value.trim(); renderList(); };
$("sort").onchange = e => { ui.sort = e.target.value; ui.flip = false; saveView(); renderList(); };
$("sortDir").onclick = () => { ui.flip = !ui.flip; saveView(); renderList(); };
$("groupBy").innerHTML = GROUPS.map(([k,l]) => `<option value="${k}">${esc(l)}</option>`).join("");
$("groupBy").onchange = e => { ui.group = e.target.value; saveView(); renderList(); };
$("chips").onclick = e => { const b = e.target.closest("[data-f]"); if (!b) return; ui.filter = b.dataset.f; saveView(); renderChips(); renderList(); if (BY[ui.open] && scopedVersions(BY[ui.open]).length) renderDetail(); };
function chooseScope(key) { ui.scope = key; saveView(); renderChips(); renderList(); renderDetail(); }
$("sessionChips").onclick = e => { const button = e.target.closest("[data-scope]"); if (button) chooseScope(button.dataset.scope); };
function afterCardChange(s, focusSel) { renderSummary(); renderList(focusSel); if (ui.open === s.slug) renderDetail(); }
function copyEdit(s, cur) {
  const su = cur.suno || {}, lyr = su.lyrics ?? cur.lyrics, list = state.custom[s.slug] || (state.custom[s.slug] = []);
  const nv = { stem: `mine-${s.slug}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0,8)}`, custom:true, version:0, label:`My copy ${list.length + 1}`, writer:"Me", session:cur.session,
    copiedFrom:cur.stem, title:su.title || s.title, lyrics:lyr, header:"", suno:{ title:su.title || s.title, lyrics:lyr, style:su.style || "", exclude:su.exclude || "", ...(su.instrumental ? {instrumental:su.instrumental} : {}) }, created:Date.now() };
  list.push(nv); state.pick[s.slug] = nv.stem; ui.open = s.slug;
  if (ui.scope.startsWith("collection:")) state.collections[ui.scope.slice(11)].members.push(nv.stem);
  save(); renderSummary(); renderList(); renderDetail(); toast("Copied. Edit it below.");
  $("edLyrics") && $("edLyrics").focus();
}
function commitRename(input, cancel) {
  const stem = input.dataset.rename; if (ui.renaming !== stem) return;
  ui.renaming = null;
  const row = input.closest(".row"), s = BY[row.dataset.slug], v = versionsOf(s).find(x => x.stem === stem);
  if (!cancel && v) {
    const val = input.value.trim(), orig = origTitle(s, v);
    if (!val || val === orig) { if (rating(stem).alias) setRating(stem, { alias:null, aliasFrom:null }); }
    else if (val !== nickname(s, v)) setRating(stem, { alias:val, aliasFrom:orig });
  }
  afterCardChange(s, `.row[data-slug="${CSS.escape(s.slug)}"] [data-card-rename]`);
}
$("list").onclick = e => {
  const row = e.target.closest(".row"); if (!row || e.target.closest(".row-detail")) return;
  const s = BY[row.dataset.slug]; if (!s) return;
  const t = e.target, cur = version(s), keep = sel => `.row[data-slug="${CSS.escape(s.slug)}"] ${sel}`;
  const status = t.closest("[data-card-status]");
  if (status) { const k = status.dataset.cardStatus; setRating(cur.stem, { status: rating(cur.stem).status === k ? null : k }); afterCardChange(s, keep(`[data-card-status="${k}"]`)); return; }
  if (t.closest("[data-card-album]")) {
    if (inAlbum(s.slug)) state.tracklist = state.tracklist.filter(x => x !== s.slug); else state.tracklist.push(s.slug);
    save(); afterCardChange(s, keep("[data-card-album]")); renderAlbum(); toast(inAlbum(s.slug) ? "Added to the "+(AUDIO_BOARD ? "tracklist" : "album") : "Removed from the "+(AUDIO_BOARD ? "tracklist" : "album")); return;
  }
  if (t.closest("[data-card-rename]")) { ui.renaming = cur.stem; renderList(keep(".rename-input")); const box = $("list").querySelector(".rename-input"); if (box) box.select(); return; }
  if (t.closest("[data-card-copyedit]")) { copyEdit(s, cur); return; }
  if (t.closest("[data-card-remove]")) {
    setRating(cur.stem, { removed:true }); if (ui.open === s.slug) ui.open = null;
    afterCardChange(s); renderAlbum(); toast(`Removed “${titleOf(s, cur)}”. Open the Removed filter to bring it back.`); return;
  }
  if (t.closest("[data-card-restore]")) { setRating(cur.stem, { removed:null }); afterCardChange(s); renderAlbum(); toast("Restored"); return; }
  const chip = t.closest("[data-open-ver]");
  if (chip && scopedVersions(s).some(v => v.stem === chip.dataset.openVer)) { state.pick[s.slug] = chip.dataset.openVer; save(); }
  else if (t.closest("[data-toggle]")) {
    ui.open = ui.open === s.slug ? null : s.slug; renderList(keep("[data-toggle]")); renderDetail(); return;
  } else if (t.closest("input,select,textarea,summary,a,label,details,button")) return;
  ui.open = s.slug; renderList(chip ? keep(`[data-open-ver="${CSS.escape(chip.dataset.openVer)}"]`) : ""); renderDetail();
};
$("list").addEventListener("keydown",e => {
  if (e.target.closest(".row-detail")) return;
  if (e.target.matches(".card-score") && e.key === "Enter") {
    // Enter commits this score and drops into the next card's score box (Shift+Enter goes back).
    e.preventDefault();
    const boxes = [...$("list").querySelectorAll(".card-score")], next = boxes[boxes.indexOf(e.target) + (e.shiftKey ? -1 : 1)];
    if (next) { next.focus(); next.select(); next.scrollIntoView({ block:"nearest" }); } else e.target.blur();
    return;
  }
  if (e.target.matches(".rename-input")) {
    if (e.key === "Enter") { e.preventDefault(); commitRename(e.target, false); }
    else if (e.key === "Escape") { e.preventDefault(); commitRename(e.target, true); }
    return;
  }
  if (e.target.closest("button,input,select,textarea,summary,a")) return;
  if (e.key === "Enter" || e.key === " ") { const row = e.target.closest(".row"); if (row) { e.preventDefault(); row.click(); } }
});
$("list").addEventListener("input", e => {
  const box = e.target; if (!box.matches(".card-score")) return;
  const row = box.closest(".row"), s = BY[row.dataset.slug], v = s && versionsOf(s).find(x => x.stem === box.dataset.score); if (!v) return;
  let n = box.value === "" ? null : parseInt(box.value, 10);
  if (n !== null && isNaN(n)) return;
  if (n !== null && (n < 0 || n > 100)) { n = Math.max(0, Math.min(100, n)); box.value = n; }
  setRating(v.stem, { score:n });
  // Leave the list alone while typing so Enter can step down it; sorting and grouping catch up on release.
  box.className = "card-score " + scoreClass(n);
  const strip = row.querySelector(`[data-open-ver="${CSS.escape(v.stem)}"] strong`); if (strip) strip.textContent = n ?? "–";
  const bs = best(s), badge = row.querySelector(".best-badge"); if (badge && bs != null) badge.textContent = "best " + bs;
  ui.stale = true; renderSummary(); updateChip(s, v);
});
$("list").addEventListener("change", e => {
  const pick = e.target.closest("[data-card-session]"); if (!pick) return;
  const row = pick.closest(".row"), s = BY[row.dataset.slug], stem = version(s).stem, id = pick.value;
  if (id === "new") { pick.value = ""; openSessionDialog(null, [stem]); return; }
  const session = state.collections[id]; if (!session) return;
  if (!session.members.includes(stem)) session.members.push(stem);
  save(); afterCardChange(s); toast("Added to " + session.name);
});
$("list").addEventListener("focusout", e => {
  if (e.target.matches?.(".rename-input")) commitRename(e.target, false);
  setTimeout(flushPending, 0);
});
// Lyrics dropdowns remember their state through redraws; toggle events do not bubble, so listen while capturing.
$("list").addEventListener("toggle", e => {
  const d = e.target; if (!d.matches?.("details.card-lyrics")) return;
  if (d.open) ui.lyricsOpen.add(d.dataset.lyr); else ui.lyricsOpen.delete(d.dataset.lyr);
}, true);
$("detail").addEventListener("click", async e => {
  const s = BY[ui.open]; if (!s) return;
  if (e.target.closest("#detailBack")) {
    ui.open = null; renderList(); renderDetail();
    const row = $("list").querySelector(`[data-slug="${CSS.escape(s.slug)}"]`);
    if (row) { row.focus({preventScroll:true}); row.scrollIntoView({block:"nearest"}); }
    return;
  }
  const cur = version(s);
  const ver = e.target.closest("[data-ver]");
  if (ver) {
    if (!scopedVersions(s).some(v => v.stem === ver.dataset.ver)) return;
    state.pick[s.slug] = ver.dataset.ver;
    save(); renderDetail(); renderList(); return;
  }
  if (e.target.closest("#removeSessionVersion")) {
    const session = state.collections[ui.scope.slice(11)]; if (!session) return;
    session.members = session.members.filter(stem => stem !== cur.stem);
    save(); render(); toast("Removed from this session. The version and its score are kept."); return;
  }
  const st = e.target.closest("[data-status]");
  if (st) { const k = st.dataset.status; setRating(cur.stem, { status: rating(cur.stem).status === k ? null : k }); renderDetail(); rerenderKeepDetail(); return; }
  if (e.target.closest("#albumToggle")) {
    if (inAlbum(s.slug)) state.tracklist = state.tracklist.filter(x => x !== s.slug); else state.tracklist.push(s.slug);
    save(); renderDetail(); rerenderKeepDetail(); toast(inAlbum(s.slug) ? "Added to the "+(AUDIO_BOARD ? "tracklist" : "album") : "Removed from the "+(AUDIO_BOARD ? "tracklist" : "album")); return;
  }
  if (e.target.closest("#copyEdit")) { copyEdit(s, cur); return; }
  if (e.target.closest("#delMine")) {
    if (!confirm(`Delete "${cur.label || "this version"}"? Its score and notes go with it.`)) return;
    state.custom[s.slug] = (state.custom[s.slug] || []).filter(x => x.stem !== cur.stem);
    delete state.ratings[cur.stem]; delete state.pick[s.slug];
    for (const session of Object.values(state.collections)) session.members = session.members.filter(stem => stem !== cur.stem);
    save(); renderDetail(); renderList(); renderSummary(); toast("Deleted"); return;
  }
  const cp = e.target.closest("[data-copy]");
  if (cp) {
    const text = $("detail")._fields[cp.dataset.copy] || "";
    if (!text) return;
    if (await copyText(text)) {
      cp.classList.add("copied"); cp.textContent = "Copied ✓"; toast("Copied " + cp.dataset.copy);
      setTimeout(() => { if(cp.isConnected) { cp.classList.remove("copied"); cp.textContent = "Copy"; } },1400);
    } else toast("Copy failed. Select the text and copy it manually.");
  }
});
$("detail").addEventListener("change", e => {
  if (e.target.id !== "addSession") return;
  const s = BY[ui.open]; if (!s) return;
  const stem = version(s).stem, id = e.target.value;
  if (id === "new") { openSessionDialog(null, [stem]); return; }
  const session = state.collections[id]; if (!session) return;
  if (!session.members.includes(stem)) session.members.push(stem);
  save(); renderDetail(); toast("Added this version to " + session.name);
});
$("detail").addEventListener("input", e => {
  const s = BY[ui.open]; if (!s) return;
  const v = version(s), id = e.target.id;
  if (id === "note") { setRating(v.stem, { note: e.target.value }); return; }
  if (v.custom && ["edLabel","edTitle","edStyle","edExclude","edLyrics","edInstrumental"].includes(id)) {
    const val = e.target.value; v.suno = v.suno || {};
    if (id === "edLabel") v.label = val;
    if (id === "edTitle") { v.suno.title = v.title = val; $("detail").querySelector("h2").textContent = val || s.title; }
    if (id === "edStyle") v.suno.style = val;
    if (id === "edExclude") v.suno.exclude = val;
    if (id === "edLyrics") v.suno.lyrics = v.lyrics = val;
    if (id === "edInstrumental") v.suno.instrumental = val;
    save(); refreshCopyButtons(v);
    if (id === "edLabel") { updateChip(s, v); renderList(); }
  }
});
function updateChip(s, v) {
  const chip = $("detail").querySelector(`[data-ver="${CSS.escape(v.stem)}"]`);
  if (chip) chip.outerHTML = chipHtml(s, v, v);
}
$("tracks").onclick = e => {
  const tr = e.target.closest(".track"); if (!tr) return;
  const i = state.tracklist.indexOf(tr.dataset.slug);
  const mv = e.target.closest("[data-move]");
  if (mv) { const j = i + Number(mv.dataset.move); if (j < 0 || j >= state.tracklist.length) return; [state.tracklist[i], state.tracklist[j]] = [state.tracklist[j], state.tracklist[i]]; save(); render(); return; }
  if (e.target.closest("[data-remove]")) { state.tracklist.splice(i, 1); save(); render(); return; }
  ui.open = tr.dataset.slug; ui.view = "songs";
  if (!scopedVersions(BY[ui.open]).length) { ui.scope = "all"; saveView(); }
  render();
};
$("copyTracklist").onclick = async () => {
  const text = state.tracklist.filter(s => BY[s]).map((s, i) => `${i+1}. ${titleOf(BY[s], version(BY[s]))}`).join("\n");
  toast(await copyText(text) ? "Tracklist copied" : "Copy failed. Select and copy the text manually.");
};
$("clearAlbum").onclick = () => { if (state.tracklist.length && confirm("Clear the whole tracklist? Scores and notes stay.")) { state.tracklist = []; save(); render(); } };
$("exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify({ app:AUDIO_BOARD ? "audio-board" : "album-board", exported:new Date().toISOString(), ...state }, null, 2)], { type:"application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = (AUDIO_BOARD ? "audio-board-" : "lyric-board-") + new Date().toISOString().slice(0,10) + ".json"; a.click(); URL.revokeObjectURL(a.href);
};
$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || d.app !== (AUDIO_BOARD ? "audio-board" : "album-board")) throw new Error("not a "+BOARD_NAME+" export");
    state = migrate({ ratings: d.ratings || {}, tracklist: Array.isArray(d.tracklist) ? d.tracklist : [], pick: d.pick || {}, custom: d.custom || {}, collections:d.collections || {}, v: d.v, _sync:state._sync });
    save(); render(); toast("Imported");
  } catch (err) { toast("Import failed: " + err.message); }
  e.target.value = "";
};
// Anything typed into or toggled inside the list (score boxes, notes, disclosures, selects) must not be rebuilt under the user.
function editingDetail() { const a = document.activeElement; return !!a && ($("detail").contains(a) || $("list").contains(a)) && a.matches("input,textarea,select,summary"); }
function flushPending() {
  if (editingDetail()) return;
  if (pendingRemoteDetail) { pendingRemoteDetail = false; renderList(); renderDetail(); }
  else if (ui.stale) renderList();
}
function replaceSyncedState(next) {
  state = next; previousState = JSON.parse(JSON.stringify(state)); persist();
  if (ui.scope.startsWith("collection:") && !state.collections[ui.scope.slice(11)]) { ui.scope = "all"; saveView(); }
  renderChips(); renderSummary(); renderAlbum();
  if (editingDetail()) pendingRemoteDetail = true; else { renderList(); renderDetail(); pendingRemoteDetail = false; }
}
$("detail").addEventListener("focusout", () => setTimeout(flushPending, 0));
function selectSyncAccount(uid) {
  if (!state._sync.owner) {
    try {
      if (!localStorage.getItem(KEY + ".before-cloud-sync")) localStorage.setItem(KEY + ".before-cloud-sync", JSON.stringify(state));
    } catch (err) { throw Error("Local backup could not be saved. Export scores before enabling sync, then retry."); }
  }
  if (state._sync.owner && state._sync.owner !== uid) {
    // Keep this account's offline queue before showing another account's separate cache.
    if (!persist()) throw Error("Export a backup before switching accounts: local saving failed.");
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(KEY + ".account." + uid)); } catch (err) {}
    replaceSyncedState(AlbumSync.prepare(migrate(cached && cached._sync?.owner === uid ? cached : {})));
    ui.open = null; render();
  }
}
function syncStatus(text, failed = false) {
  $("syncStatus").textContent = text; $("syncStatus").classList.toggle("failed", failed);
  $("retrySyncBtn").hidden = !failed || !cloud;
}
let sessionDraft = null;
function currentScopeMembers() { return (AUDIO_BOARD ? SONGS.filter(matches) : SONGS).flatMap(s => scopedVersions(s).map(v => v.stem)); }
function renderSessionOptions() {
  const q = $("sessionSearch").value.trim().toLowerCase();
  $("sessionCount").textContent = sessionDraft.members.size + (AUDIO_BOARD ? " takes selected" : " versions selected");
  $("sessionVersionOptions").innerHTML = SONGS.map(s => {
    const versions = versionsOf(s).filter(v => !q || (s.title + " " + verLabel(v)).toLowerCase().includes(q));
    if (!versions.length) return "";
    return `<div class="session-song"><b>${esc(s.title)}</b>${versions.map(v => `<label class="session-option"><input type="checkbox" data-member="${esc(v.stem)}" ${sessionDraft.members.has(v.stem) ? 'checked' : ''}><span>${esc(verLabel(v))} · ${rating(v.stem).score ?? 'unrated'}</span></label>`).join("")}</div>`;
  }).join("");
}
function openSessionDialog(id = null, initial = null) {
  const session = id && state.collections[id];
  const members = session ? session.members : initial || (ui.scope !== "all" ? currentScopeMembers() : []);
  sessionDraft = {id:id || crypto.randomUUID(), editing:!!session, name:session?.name || "", base:new Set(members), members:new Set(members)};
  $("sessionDialogTitle").textContent = session ? "Manage custom session" : "New custom session";
  $("sessionName").value = session?.name || ""; $("sessionName").setCustomValidity(""); $("sessionSearch").value = "";
  $("deleteSession").classList.toggle("hidden", !session);
  $("seedCurrent").disabled = ui.scope === "all";
  $("seedTracklist").disabled = !state.tracklist.length;
  renderSessionOptions(); $("sessionDialog").showModal(); $("sessionName").focus();
}
$("newSession").onclick = () => openSessionDialog();
$("manageSession").onclick = () => openSessionDialog(ui.scope.slice(11));
$("sessionCancel").onclick = () => $("sessionDialog").close();
$("sessionSearch").oninput = renderSessionOptions;
$("sessionVersionOptions").onchange = e => {
  const stem = e.target.dataset.member; if (!stem) return;
  if (e.target.checked) sessionDraft.members.add(stem); else sessionDraft.members.delete(stem);
  $("sessionCount").textContent = sessionDraft.members.size + (AUDIO_BOARD ? " takes selected" : " versions selected");
};
$("seedCurrent").onclick = () => { currentScopeMembers().forEach(stem => sessionDraft.members.add(stem)); renderSessionOptions(); };
$("seedTracklist").onclick = () => {
  for (const slug of state.tracklist) {
    const s = BY[slug]; if (!s) continue;
    const picked = versionsOf(s).find(v => v.stem === state.pick[slug]);
    const bestVersion = versionsOf(s).slice().sort((a,b) => (rating(b.stem).score ?? -1) - (rating(a.stem).score ?? -1))[0];
    sessionDraft.members.add((picked || bestVersion).stem);
  }
  renderSessionOptions();
};
$("sessionForm").onsubmit = e => {
  e.preventDefault(); const name = $("sessionName").value.trim();
  if (!name) { $("sessionName").setCustomValidity("Give the session a name."); $("sessionName").reportValidity(); return; }
  const existing = state.collections[sessionDraft.id];
  if (sessionDraft.editing && !existing) { toast("This session was deleted on another device. Create a new session."); $("sessionDialog").close(); return; }
  const members = new Set(existing?.members || []);
  if (!sessionDraft.editing) sessionDraft.members.forEach(stem => members.add(stem));
  else {
    // Apply only the changes made in this dialog, preserving concurrent additions on another device.
    for (const stem of sessionDraft.base) if (!sessionDraft.members.has(stem)) members.delete(stem);
    for (const stem of sessionDraft.members) if (!sessionDraft.base.has(stem)) members.add(stem);
  }
  state.collections[sessionDraft.id] = {name:name === sessionDraft.name && existing ? existing.name : name, created:existing?.created || Date.now(), members:[...members].sort()};
  save(); $("sessionDialog").close(); ui.filter = "all"; ui.q = ""; $("q").value = ""; chooseScope("collection:" + sessionDraft.id); toast("Session saved");
};
$("sessionName").oninput = () => $("sessionName").setCustomValidity("");
$("deleteSession").onclick = () => {
  const session = state.collections[sessionDraft.id]; if (!session) return;
  if (!confirm(`Delete the custom session "${session.name}"? Songs, versions, scores and notes are kept.`)) return;
  delete state.collections[sessionDraft.id]; save(); $("sessionDialog").close(); chooseScope("all"); toast("Session deleted. Songs and scores are kept.");
};
function initAlbumSync() {
  if (typeof firebase === "undefined" || !firebase.auth || !firebase.database) {
    syncStatus("Saved on this device. Connect to the internet and reload to enable Google sign-in."); return;
  }
  try {
    const config = {
      apiKey:"AIzaSyDTcQiFsjhSzlsEl7uPJvTtsxp798XOqIQ",
      authDomain:"family-planner-ccafc.firebaseapp.com",
      databaseURL:"https://family-planner-ccafc-default-rtdb.firebaseio.com",
      projectId:"family-planner-ccafc"
    };
    if (!firebase.apps.length) firebase.initializeApp(config);
    cloud = AlbumSync.create({firebase, config, board:AUDIO_BOARD ? "audio" : "lyrics", read:() => state, replace:replaceSyncedState, selectAccount:selectSyncAccount, status:syncStatus,
      account:(user, busy) => {
        $("accountWho").textContent = user ? (user.email || user.displayName || "Google account") : "";
        $("signInBtn").hidden = !!user; $("signInBtn").disabled = busy; $("signInBtn").textContent = busy ? "Signing in…" : "Sign in with Google";
        $("signOutBtn").hidden = !user;
      }
    });
    $("signInBtn").onclick = () => cloud.signIn();
    $("signOutBtn").onclick = () => cloud.signOut();
    $("retrySyncBtn").onclick = () => cloud.retry();
  } catch (err) { syncStatus("Sync could not start. Your local scores are safe. Reload to retry.", true); }
}

function audioHtml(v) {
  const sourceLink = v.lyricSlug && v.lyricStem ? `<a class="btn small" href="../album-board/?song=${encodeURIComponent(v.lyricSlug)}&version=${encodeURIComponent(v.lyricStem)}">Open matching lyrics</a>` : '';
  return `<div class="meta">${esc(verLabel(v))}${v.voiceName ? "" : "<br>"+esc(voiceLabel(v))}<br>${esc(v.match)}${v.oldTitle && v.oldTitle !== v.title ? `<br>Previously: ${esc(v.oldTitle)}` : ''}</div>
    <div class="audio-controls"><a class="btn primary" id="openSuno" href="https://suno.com/song/${esc(v.stem)}" target="_blank" rel="noopener noreferrer">Open in Suno ↗</a><button class="btn small" data-copy="title">Copy title</button>${sourceLink}</div>
    ${v.audioUrl ? `<audio class="audio-player" controls preload="none" src="${esc(v.audioUrl)}"></audio>` : ''}
    <p class="meta" id="audioNotice">${v.audioUrl ? 'Play this take here or open it in Suno.' : 'Open this take in Suno to listen.'}</p>
    ${v.sources?.length ? `<details class="style" data-panel="source-audio"><summary>Source audio</summary>${v.sources.map(source=>`<p><a href="https://suno.com/song/${esc(source.id)}" target="_blank" rel="noopener noreferrer">${esc(source.title)}</a></p>`).join("")}</details>` : ""}
    ${v.source ? `<details class="style" data-panel="sbglp-source"><summary>SBGLP source</summary><p style="overflow-wrap:anywhere">${esc(v.source)}</p></details>` : ''}`;
}
function initializeBoard() {
  if (AUDIO_BOARD) {
    const picker = $('songFilter'), writer = $('writerFilter'), voice = $('voiceFilter');
    picker.innerHTML = '<option value="">All songs</option>'+[...new Set(SONGS.map(s=>s.baseTitle))].sort((a,b)=>a.localeCompare(b)).map(title=>`<option value="${esc(title)}">${esc(title)}</option>`).join('');
    voice.innerHTML = '<option value="">All voice settings</option>'+[...new Set(SONGS.map(s=>s.versions[0].voiceName).filter(Boolean))].sort().map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')+'<option value="none">No voice persona listed</option><option value="unknown">Voice not confirmed</option>';
    voice.onchange = e => { ui.voice=e.target.value; renderList(); };
    picker.onchange = e => { ui.song=e.target.value; renderList(); };
    writer.onchange = e => { ui.writer=e.target.value; renderList(); };
    if (ui.lyricSource) { ui.scope='all'; $('linkedLyrics').classList.remove('hidden'); }
    $('clearLinkedLyrics').onclick = () => { ui.lyricSource=''; $('linkedLyrics').classList.add('hidden'); history.replaceState(null,'',location.pathname); renderList(); };
  } else {
    const params = new URLSearchParams(location.search), song=BY[params.get('song')];
    const selected = song && song.versions.find(v=>v.stem===params.get('version'));
    if (selected) { ui.scope='all'; ui.open=song.slug; state.pick[song.slug]=selected.stem; }
  }
}

initializeBoard();
render();
initAlbumSync();
