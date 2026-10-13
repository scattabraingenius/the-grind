"use strict";
// Album Planner. Score, Shortlist/Maybe and notes are Audio Board records (one score per take everywhere).
// Albums, Cut (per album), sessions, renames and the Delete tag are planner records.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("../../service-worker.js").catch(() => {});
const KEY = "grind.planner.v1";
const AUDIO_KEY = "grind.audio.v1";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone = v => JSON.parse(JSON.stringify(v));
const uid = prefix => prefix + "-" + crypto.randomUUID().slice(0, 8);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const TAKES = {};
for (const s of window.ALBUM_SONGS || []) TAKES[s.slug] = {...s.versions[0], stem:s.slug, title:s.title, baseTitle:s.baseTitle || s.title};
const DEFAULT_ALBUMS = {debut:{name:"Album 1 · Debut", created:1, order:[], cut:[], target:12}, second:{name:"Album 2", created:2, order:[], cut:[], target:12}};

// ---------- planner state ----------
function loadPlan() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && typeof s === "object") return PlannerSync.prepare(s); } catch (err) {}
  return PlannerSync.prepare(PlannerSync.empty());
}
let state = loadPlan(), previous = clone(state), cloud = null;
let deviceId; try { deviceId = localStorage.getItem(KEY + ".device"); } catch (err) {}
if (!deviceId) { deviceId = crypto.randomUUID(); try { localStorage.setItem(KEY + ".device", deviceId); } catch (err) {} }
function persist() {
  try {
    if (state._sync.owner) localStorage.setItem(KEY + ".account." + state._sync.owner, JSON.stringify(state));
    localStorage.setItem(KEY, JSON.stringify(state));
    $("saveStatus").classList.remove("failed"); $("saveStatus").textContent = "Saved on this device. Export plan keeps a separate backup.";
  } catch (err) { $("saveStatus").classList.add("failed"); $("saveStatus").textContent = "Changes could not be saved. Export a backup before closing."; }
}
function normalize() {
  if (!Object.keys(state.albums).length) for (const [id, a] of Object.entries(DEFAULT_ALBUMS)) state.albums[id] = clone(a);
  for (const a of Object.values(state.albums)) { a.order ||= []; a.cut ||= []; }
}
function save(rerender = true) {
  normalize();
  state = PlannerSync.capture(previous, state, deviceId); previous = clone(state);
  persist(); if (cloud) cloud.changed(); if (rerender) render();
}

// ---------- Audio Board state (scores, status, notes) ----------
const blankAudio = s => ({ratings:{}, tracklist:[], pick:{}, custom:{}, collections:{}, v:2, ...(s || {})});
function readAudio(key) { try { const s = JSON.parse(localStorage.getItem(key)); if (s && typeof s === "object") return s; } catch (err) {} return null; }
let audio = AlbumSync.prepare(blankAudio(readAudio(AUDIO_KEY))), audioPrev = clone(audio), audioCloud = null;
function persistAudio() {
  // Same keys Audio Board uses, so its next load starts from these scores too.
  try {
    if (audio._sync.owner) localStorage.setItem(AUDIO_KEY + ".account." + audio._sync.owner, JSON.stringify(audio));
    localStorage.setItem(AUDIO_KEY, JSON.stringify(audio));
  } catch (err) { $("saveStatus").classList.add("failed"); $("saveStatus").textContent = "Scores could not be saved on this device. Export Audio Board scores before closing."; }
}
const rating = stem => audio.ratings[stem] || {};
function setRating(stem, patch) {
  audio.ratings[stem] = {...rating(stem), ...patch, at:Date.now()};
  audio = AlbumSync.capture(audioPrev, audio, deviceId); audioPrev = clone(audio);
  persistAudio(); if (audioCloud) audioCloud.changed();
}

// ---------- undo ----------
let undoSnap = null;
function snapshot() { const {_sync, ...plan} = state; undoSnap = clone(plan); }
function undo() { if (!undoSnap) return; Object.assign(state, clone(undoSnap)); undoSnap = null; save(); toast("Restored"); }

// ---------- view prefs ----------
let viewPrefs = {}; try { viewPrefs = JSON.parse(localStorage.getItem(KEY + ".view")) || {}; } catch (err) {}
const ui = {view:["consider","sessions","albums","cleanup"].includes(viewPrefs.view) ? viewPrefs.view : "consider", q:"", sort:viewPrefs.sort || "title", dir:viewPrefs.dir || "", group:viewPrefs.group !== false, filter:viewPrefs.filter || "contenders", session:viewPrefs.session || "", album:viewPrefs.album || "debut", ssort:viewPrefs.ssort || "score", sdir:viewPrefs.sdir || ""};
function saveView() { try { localStorage.setItem(KEY + ".view", JSON.stringify({view:ui.view, sort:ui.sort, dir:ui.dir, group:ui.group, filter:ui.filter, session:ui.session, album:ui.album, ssort:ui.ssort, sdir:ui.sdir})); } catch (err) {} }

// ---------- helpers ----------
const take = stem => TAKES[stem] || {stem, title:"Suno " + stem.slice(0, 8), baseTitle:"Not in catalogue", missing:true, writer:"", duration:0, createdAt:""};
const item = stem => state.considered[stem] || {};
const live = () => Object.keys(state.considered).filter(s => !item(s).delDone);   // deleted on Suno = gone from the plan
const album = () => state.albums[ui.album];
const isCut = (stem, id = ui.album) => !!state.albums[id]?.cut?.includes(stem);
const tagged = stem => !!item(stem).del && !item(stem).delDone;
const albumOf = stem => Object.entries(state.albums).find(([, a]) => a.order.includes(stem));
const sessionsOf = stem => Object.entries(state.sessions).filter(([, s]) => s.members.includes(stem));
const shortName = a => a.name.split(" ·")[0];
function nameOf(stem) { const i = item(stem); return i.name || take(stem).title; }
function nameHtml(stem) {
  const i = item(stem), t = take(stem);
  return i.name && i.name !== t.title && !i.renameDone ? `${esc(i.name)} <span class="old">[${esc(t.title)}]</span>` : esc(nameOf(stem));
}
const dur = s => { s = Math.round(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const longDur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + "h " : "") + m + "m " + String(s % 60).padStart(2, "0") + "s"; };
const lyricSearch = title => String(title || "").replace(/^[A-Z]-\s+/, "").replace(/(\s+(v\d+|\d+|misc|-\s*\w+))+$/i, "").trim();
const lyricHref = stem => { const t = take(stem); return t.lyricSlug && t.lyricStem ? `../../album-board/?song=${encodeURIComponent(t.lyricSlug)}&version=${encodeURIComponent(t.lyricStem)}` : `../../album-board/?q=${encodeURIComponent(lyricSearch(t.baseTitle))}`; };
const suno = stem => "https://suno.com/song/" + encodeURIComponent(stem);
const scoreClass = n => n == null ? "" : n >= 80 ? "hi" : n >= 50 ? "mid" : "";
function takeLabel(t) { return [t.type && t.type !== "Vocal" ? t.type : "", t.writer && t.writer !== "Unknown" ? t.writer : "", t.packetVersion ? "lyrics v" + t.packetVersion : "", t.take ? "take " + t.take : "", t.duration ? dur(t.duration) : ""].filter(Boolean).join(" · "); }
let toastTimer;
function toast(msg, withUndo = false) {
  $("toastText").textContent = msg; $("toastUndo").classList.toggle("hidden", !withUndo);
  $("toast").classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("on"), withUndo ? 6000 : 1600);
}
async function copyText(text) { try { await navigator.clipboard.writeText(text); return true; } catch (err) { return false; } }

// ---------- actions ----------
function consider(stems) {
  let added = 0;
  for (const stem of stems) if (!state.considered[stem]) { state.considered[stem] = {added:Date.now()}; added++; }
  if (added) save();
  return added;
}
function newAlbum() {
  const name = prompt("New album name", "Album " + (Object.keys(state.albums).length + 1));
  if (!name?.trim()) return null;
  const id = uid("a"); state.albums[id] = {name:name.trim(), created:Date.now(), order:[], cut:[], target:12};
  return id;
}
function placeOnAlbum(stem, albumId) {
  const target = state.albums[albumId]; if (!target) return;
  for (const a of Object.values(state.albums)) a.order = a.order.filter(m => m !== stem);
  target.order.push(stem); target.cut = target.cut.filter(m => m !== stem);
  if (!state.considered[stem]) state.considered[stem] = {added:Date.now()};
  save(); toast(`${nameOf(stem)} → ${target.name} #${target.order.length}`);
}
function toggleOnAlbum(stem) {
  const a = album();
  if (a.order.includes(stem)) { a.order = a.order.filter(m => m !== stem); save(); toast("Taken off " + a.name); }
  else placeOnAlbum(stem, ui.album);
}
function toggleCut(stem) {
  const a = album(); snapshot();
  if (isCut(stem)) { a.cut = a.cut.filter(m => m !== stem); save(); toast("Back in contention for " + a.name); return; }
  a.cut.push(stem); a.order = a.order.filter(m => m !== stem);
  save(); toast(`Cut from ${a.name}`, true);
}
function toggleDelete(stem) {
  const i = state.considered[stem]; snapshot();
  if (i.del) { delete i.del; save(); toast("Delete tag removed"); return; }
  i.del = true; for (const a of Object.values(state.albums)) a.order = a.order.filter(m => m !== stem);
  save(); toast("Tagged to delete on Suno. It's on the Suno cleanup list.", true);
}
function rename(stem) {
  const i = state.considered[stem], t = take(stem);
  const next = prompt(`Rename "${t.title}" in the planner.\nThe Suno title stays in brackets until you mark it renamed. Leave empty to undo.`, i.name || t.title);
  if (next == null) return;
  const v = next.trim();
  if (!v || v === t.title) { delete i.name; delete i.renameDone; } else { i.name = v; delete i.renameDone; }
  save();
}
function newSession(name, stems) {
  const id = uid("s");
  state.sessions[id] = {name, created:Date.now(), note:"", members:[...new Set(stems)]};
  for (const stem of stems) if (!state.considered[stem]) state.considered[stem] = {added:Date.now()};
  return id;
}

// ---------- the take card (Considered and Sessions use the same one) ----------
function card(stem, opts = {}) {
  const t = take(stem), r = rating(stem), a = album(), placed = albumOf(stem), cut = isCut(stem), del = tagged(stem);
  const others = Object.entries(state.albums).filter(([id]) => id !== ui.album).sort(([, x], [, y]) => x.created - y.created);
  const badges = [
    placed ? `<button class="badge link placed" data-goto-album="${esc(placed[0])}">${esc(placed[1].name)} #${placed[1].order.indexOf(stem) + 1}</button>` : "",
    cut ? `<span class="badge cut">cut from ${esc(shortName(a))}</span>` : "",
    del ? `<span class="badge del">delete</span>` : "",
    r.status === "cut" ? `<span class="badge cut">Audio Board: cut</span>` : "",
    ...(opts.inSession ? [] : sessionsOf(stem).map(([id, s]) => `<button class="badge link" data-goto-session="${esc(id)}">${esc(s.name)}</button>`)),
    t.missing ? `<span class="badge cut">not in snapshot</span>` : "",
  ].join("");
  const onThis = a.order.includes(stem);
  return `<article class="card${cut ? " is-cut" : ""}${del ? " is-del" : ""}${onThis ? " on-album" : ""}" data-stem="${esc(stem)}">
    <div class="card-top">
      <input class="score-in ${scoreClass(r.score)}" type="number" min="0" max="100" step="1" inputmode="numeric" value="${r.score ?? ""}" placeholder="–" aria-label="Score for ${esc(nameOf(stem))}, 0 to 100">
      <div class="t"><b title="${esc(t.title)}">${nameHtml(stem)}</b><small>${esc(takeLabel(t)) || "&nbsp;"}</small></div>
      <button class="icon-btn" data-act="rename" title="Rename in planner" aria-label="Rename ${esc(nameOf(stem))}">✎</button>
    </div>
    <div class="status-row">
      <button class="btn small s-short" data-act="short" aria-pressed="${r.status === "short"}">Shortlist</button>
      <button class="btn small s-maybe" data-act="maybe" aria-pressed="${r.status === "maybe"}">Maybe</button>
    </div>
    <div class="link-row">
      <a class="btn small" href="${suno(stem)}" target="_blank" rel="noopener">▶ Suno</a>
      <a class="btn small" href="${lyricHref(stem)}" target="_blank" rel="noopener" title="${t.lyricStem ? "Open the matching lyric version" : "No exact lyric match; searches Lyric Board for this song"}">${t.lyricStem ? "Lyrics ↗" : "Find lyrics ↗"}</a>
      <a class="btn small" href="../?take=${encodeURIComponent(stem)}" target="_blank" rel="noopener">Audio Board ↗</a>
    </div>
    <textarea class="note" rows="1" placeholder="Notes" aria-label="Notes for ${esc(nameOf(stem))}">${esc(r.note || "")}</textarea>
    <div class="badges">${badges}</div>
    <div class="card-actions">
      <button class="btn small ${onThis ? "primary" : ""}" data-act="add" aria-pressed="${onThis}">${onThis ? "✓ On " : "+ "}${esc(shortName(a))}</button>
      <select class="add-to" aria-label="Add to another album"><option value="">Add to…</option>${others.map(([id, o]) => `<option value="${esc(id)}">${esc(o.name)}${o.order.includes(stem) ? " ✓" : ""}</option>`).join("")}<option value="__new">+ New album…</option></select>
      ${opts.inSession ? "" : `<button class="btn small" data-act="compare">Compare</button>`}
      <button class="btn small" data-act="cut" aria-pressed="${cut}">${cut ? "Uncut" : "Cut"}</button>
      <button class="btn small danger" data-act="delete" aria-pressed="${del}">${del ? "Undelete" : "Delete"}</button>
    </div>
  </article>`;
}

// ---------- render ----------
let pendingRender = false;
const editing = () => document.activeElement?.matches?.(".score-in, .note, #sessionNote, .title-edit, #albumTarget, select");
// Replace a dropdown's options only when they actually change.
function setOptions(el, html) { if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; } }
function requestRender() { if (editing()) pendingRender = true; else render(); }
document.addEventListener("focusout", () => setTimeout(() => { if (pendingRender && !editing()) { pendingRender = false; render(); } }, 150));
function render() {
  normalize();
  if (!state.albums[ui.album]) ui.album = Object.entries(state.albums).sort(([, a], [, b]) => a.created - b.created)[0][0];
  const views = {consider:"Consider", sessions:"Sessions", albums:"Albums", cleanup:"Cleanup"};
  for (const [v, n] of Object.entries(views)) { $("view" + n).classList.toggle("hidden", ui.view !== v); $("tab" + n).setAttribute("aria-selected", ui.view === v); }
  renderTarget(); renderSummary();
  ({consider:renderConsider, sessions:renderSessions, albums:renderAlbums, cleanup:renderCleanup})[ui.view]();
  document.querySelectorAll("textarea.note").forEach(fit);
}
function renderTarget() {
  const albums = Object.entries(state.albums).sort(([, a], [, b]) => a.created - b.created), a = album();
  setOptions($("targetAlbum"), albums.map(([id, x]) => `<option value="${esc(id)}">${esc(x.name)}</option>`).join("") + `<option value="__new">+ New album…</option>`);
  $("targetAlbum").value = ui.album;
  const total = a.order.reduce((n, s) => n + (take(s).duration || 0), 0);
  $("targetStats").textContent = `${a.order.length}/${a.target || 12} tracks · ${longDur(total)} · ${a.cut.length} cut`;
}
function renderSummary() {
  const stems = live(), a = album();
  const contenders = stems.filter(s => !isCut(s) && !tagged(s)).length;
  const cleanup = stems.filter(tagged).length + stems.filter(s => item(s).name && !item(s).renameDone).length;
  $("summary").textContent = `${stems.length} takes · ${new Set(stems.map(s => take(s).baseTitle)).size} songs · ${contenders} still in contention for ${a.name}`;
  $("countConsider").textContent = stems.length ? `(${stems.length})` : "";
  $("countSessions").textContent = Object.keys(state.sessions).length ? `(${Object.keys(state.sessions).length})` : "";
  $("countAlbums").textContent = `(${a.order.length})`;
  $("countCleanup").textContent = cleanup ? `(${cleanup})` : "";
  $("built").textContent = window.ALBUM_BUILT ? "Suno snapshot " + window.ALBUM_BUILT : "";
}

// Shared by Considered and Sessions. Each sort has a natural direction; the toggle flips it.
const SORTS = {title:["Title","asc"], score:["Rating","desc"], newest:["Date","desc"], status:["Status","asc"], length:["Length","desc"], writer:["Writer","asc"]};
// Status order: on the album you're building, Shortlist, Maybe, unmarked, Audio Board cut.
const statusRank = s => album().order.includes(s) ? 0 : ({short:1, maybe:2, cut:4}[rating(s).status] ?? 3);
const SORT_KEYS = {title:null, score:s => rating(s).score ?? null, newest:s => take(s).createdAt || null, status:statusRank, length:s => take(s).duration || null, writer:s => take(s).writer && take(s).writer !== "Unknown" ? take(s).writer : null};
const dirOf = (sort, dir) => dir || SORTS[sort]?.[1] || "asc";
const sortDir = () => dirOf(ui.sort, ui.dir);
function sortStems(stems, sort = ui.sort, dir = sortDir()) {
  const down = dir === "desc", tie = (a, b) => nameOf(a).localeCompare(nameOf(b), undefined, {numeric:true});
  const key = SORT_KEYS[sort];
  return stems.slice().sort((a, b) => {
    if (!key) return down ? tie(b, a) : tie(a, b);
    const x = key(a), y = key(b);
    if (x == null || y == null) return (x == null) - (y == null) || tie(a, b); // missing values stay last
    const c = typeof x === "string" ? x.localeCompare(y) : x - y;
    return (down ? -c : c) || tie(a, b);
  });
}
const sortOptions = cur => Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}"${cur && k === cur ? " selected" : ""}>Sort: ${l.toLowerCase()}</option>`).join("");
const dirLabel = dir => dir === "desc" ? "↓ Desc" : "↑ Asc";
function filters() {
  const a = album(), n = shortName(a);
  return [
    ["contenders", "In contention", s => !isCut(s) && !tagged(s)],
    ["short", "Shortlist", s => rating(s).status === "short"],
    ["maybe", "Maybe", s => rating(s).status === "maybe"],
    ["unscored", "Unscored", s => rating(s).score == null && !isCut(s) && !tagged(s)],
    ["on", "On " + n, s => a.order.includes(s)],
    ["unplaced", "Not on an album", s => !albumOf(s) && !isCut(s) && !tagged(s)],
    ["cut", "Cut from " + n, s => isCut(s)],
    ["del", "Tagged delete", s => tagged(s)],
    ["all", "Everything", () => true],
  ];
}
function matchesQuery(stem) {
  if (!ui.q) return true;
  const t = take(stem), q = ui.q.toLowerCase();
  return [nameOf(stem), t.title, t.baseTitle, t.writer, t.lyrics, t.oldTitle, rating(stem).note].some(x => String(x || "").toLowerCase().includes(q));
}
function renderConsider() {
  setOptions($("sort"), sortOptions()); $("sort").value = ui.sort;
  $("sortDir").textContent = dirLabel(sortDir()); $("sortDir").setAttribute("aria-label", "Sort direction " + (sortDir() === "desc" ? "descending" : "ascending"));
  $("groupToggle").setAttribute("aria-pressed", ui.group);
  const all = live(), fs = filters();
  if (!fs.some(([k]) => k === ui.filter)) ui.filter = "contenders";
  $("filterChips").innerHTML = fs.map(([k, l, f]) => `<button class="chip" data-f="${k}" aria-pressed="${ui.filter === k}">${esc(l)} <small>${all.filter(f).length}</small></button>`).join("");
  const test = fs.find(([k]) => k === ui.filter)[2];
  const stems = sortStems(all.filter(s => test(s) && matchesQuery(s)));
  const box = $("considerList");
  if (!all.length) { box.innerHTML = `<div class="empty-note big"><b>Nothing considered yet.</b><br>Use <b>+ Add takes</b> to pull in the Audio Board session holding your album candidates, paste Suno links, or search the catalogue.</div>`; return; }
  if (!stems.length) { box.innerHTML = `<p class="empty-note">No takes match.</p>`; return; }
  if (!ui.group) { box.innerHTML = `<div class="cards">${stems.map(s => card(s)).join("")}</div>`; return; }
  const groups = new Map();
  for (const s of stems) { const g = take(s).baseTitle; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }
  box.innerHTML = [...groups].map(([name, list]) => {
    const inOne = list.length > 1 && Object.entries(state.sessions).find(([, s]) => list.every(m => s.members.includes(m)));
    return `<section class="group"><header><h3>${esc(name)} <small>${list.length} take${list.length > 1 ? "s" : ""}</small></h3>${list.length > 1 && !inOne ? `<button class="btn small" data-compare-group="${esc(name)}">Compare all ${list.length}</button>` : inOne ? `<button class="btn small" data-goto-session="${esc(inOne[0])}">Open session</button>` : ""}</header><div class="cards">${list.map(s => card(s)).join("")}</div></section>`;
  }).join("");
}

function sessionStats(s) {
  const members = s.members.filter(m => !item(m).delDone), a = album();
  return {members, on:members.filter(m => a.order.includes(m)).length, cut:members.filter(m => isCut(m)).length, open:members.filter(m => !isCut(m) && !tagged(m) && !a.order.includes(m)).length};
}
function renderSessions() {
  const a = album();
  const entries = Object.entries(state.sessions).map(([id, s]) => [id, s, sessionStats(s)])
    .sort(([, x, sx], [, y, sy]) => (!!sx.on - !!sy.on) || x.name.localeCompare(y.name));
  if (ui.session && !state.sessions[ui.session]) ui.session = "";
  $("sessionList").innerHTML = (entries.length ? entries.map(([id, s, st]) => `<button class="session-row${ui.session === id ? " active" : ""}${st.on ? " decided" : ""}" data-session="${esc(id)}"><b>${esc(s.name)}</b><small>${st.members.length} takes${st.on ? ` · ${st.on} on ${esc(shortName(a))}` : ""}${st.cut ? ` · ${st.cut} cut` : ""}${st.open && !st.on ? ` · ${st.open} open` : ""}</small></button>`).join("")
    : `<p class="empty-note">No sessions yet. Hit <b>Compare</b> on a take, or <b>Auto-build sessions</b> on Considered.</p>`) + `<button class="btn small" id="newEmptySession">+ New session</button>`;
  const d = $("sessionDetail"), s = state.sessions[ui.session];
  if (!s) { d.className = "detail empty"; d.innerHTML = "Pick a session to compare its takes."; return; }
  const st = sessionStats(s);
  // Contenders first; cut and delete-tagged takes sink to the bottom, dimmed.
  const sdir = dirOf(ui.ssort, ui.sdir), sorted = sortStems(st.members, ui.ssort, sdir);
  const order = [...sorted.filter(m => !isCut(m) && !tagged(m)), ...sorted.filter(m => isCut(m) || tagged(m))];
  d.className = "detail";
  d.innerHTML = `<button class="btn small detail-back" data-back>← Sessions</button>
    <div class="field-head"><input class="title-edit" id="sessionName" value="${esc(s.name)}" aria-label="Session name"><button class="btn small danger" id="deleteSession">Delete session</button></div>
    <p class="meta">${st.members.length} takes for <b>${esc(a.name)}</b> · ${st.on} on it · ${st.cut} cut · ${st.open} still open.</p>
    <div class="tools session-sort"><select id="sessionSort" aria-label="Sort takes in this session">${sortOptions(ui.ssort)}</select><button class="btn small" id="sessionSortDir" aria-label="Sort direction ${sdir === "desc" ? "descending" : "ascending"}">${dirLabel(sdir)}</button><span class="meta">Cut and delete-tagged takes stay at the bottom.</span></div>
    <div class="compare-grid">${order.map(m => card(m, {inSession:true})).join("") || `<p class="empty-note">No takes in this session.</p>`}</div>
    <label class="sub" for="sessionNote">Session notes</label>
    <textarea id="sessionNote" placeholder="Which verse hits harder, what to fix…">${esc(s.note || "")}</textarea>
    <div class="scope-tools"><button class="btn small" id="sessionAddMore">+ Add considered takes</button></div>
    <div id="sessionAdder" class="session-options hidden"></div>`;
}

function renderAlbums() {
  const albums = Object.entries(state.albums).sort(([, a], [, b]) => a.created - b.created), a = album();
  const total = a.order.reduce((n, s) => n + (take(s).duration || 0), 0);
  $("albumHead").innerHTML = `<div class="field-head"><input class="title-edit" id="albumName" value="${esc(a.name)}" aria-label="Album name">
      <span class="tools-inline"><label class="meta">Target <input type="number" id="albumTarget" min="1" max="40" value="${a.target || 12}"> tracks</label>
      <button class="btn small" id="copyAlbum">Copy tracklist</button>${albums.length > 1 ? `<button class="btn small danger" id="deleteAlbum">Delete album</button>` : ""}</span></div>
    <div class="runtime"><b>${a.order.length}</b> / ${a.target || 12} tracks · <b>${longDur(total)}</b> runtime<div class="bar"><span style="width:${Math.min(100, a.order.length / (a.target || 12) * 100)}%"></span></div></div>`;
  const others = albums.filter(([id]) => id !== ui.album);
  $("albumTracks").innerHTML = a.order.length ? a.order.map((stem, i) => {
    const t = take(stem), r = rating(stem);
    return `<li class="track" draggable="true" data-stem="${esc(stem)}"><span class="grip" aria-hidden="true">⋮⋮</span><span class="n">${i + 1}</span>
      <input class="score-in ${scoreClass(r.score)}" type="number" min="0" max="100" inputmode="numeric" value="${r.score ?? ""}" placeholder="–" aria-label="Score">
      <div class="t"><b>${nameHtml(stem)}</b><small>${esc(takeLabel(t))}${r.note ? " · " + esc(r.note.slice(0, 80)) : ""}</small></div>
      <div class="ctl"><a class="btn small" href="${suno(stem)}" target="_blank" rel="noopener" aria-label="Play on Suno">▶</a><button class="btn small" data-move="-1" aria-label="Move up">↑</button><button class="btn small" data-move="1" aria-label="Move down">↓</button>
      ${others.length ? `<select class="add-to" aria-label="Move to another album"><option value="">Move to…</option>${others.map(([id, o]) => `<option value="${esc(id)}">${esc(o.name)}</option>`).join("")}</select>` : ""}
      <button class="btn small" data-unplace aria-label="Take off this album">✕</button></div></li>`;
  }).join("") : `<li class="empty-note">No tracks yet. Use <b>+ ${esc(shortName(a))}</b> on any take, or place from below.</li>`;
  const pool = live().filter(s => ["short", "maybe"].includes(rating(s).status) && !albumOf(s) && !isCut(s) && !tagged(s))
    .sort((x, y) => (rating(x).status === "short" ? 0 : 1) - (rating(y).status === "short" ? 0 : 1) || (rating(y).score ?? -1) - (rating(x).score ?? -1));
  $("pool").innerHTML = pool.length ? `<div class="pool">${pool.map(stem => {
    const t = take(stem), r = rating(stem);
    return `<div class="pool-row" data-stem="${esc(stem)}"><span class="score ${scoreClass(r.score)}">${r.score ?? "–"}</span><div class="t"><b>${nameHtml(stem)}</b><small>${r.status === "short" ? "Shortlist" : "Maybe"} · ${esc(takeLabel(t))}</small></div><button class="btn small primary" data-place="${esc(ui.album)}">+ ${esc(shortName(a))}</button></div>`;
  }).join("")}</div>` : `<p class="empty-note">Nothing waiting. Mark takes Shortlist or Maybe to see them here.</p>`;
  renderMissing(a, albums);
}
function renderMissing(a, albums) {
  const items = [], target = a.target || 12, total = a.order.reduce((n, s) => n + (take(s).duration || 0), 0);
  if (a.order.length < target) items.push(["warn", `${target - a.order.length} more track${target - a.order.length > 1 ? "s" : ""} to reach ${target}.`]);
  if (a.order.length > target) items.push(["warn", `${a.order.length - target} over the ${target}-track target.`]);
  if (a.order.length && total < 35 * 60) items.push(["info", `Runtime ${longDur(total)}. Most full-length rap albums land between 40 and 60 minutes.`]);
  if (total > 70 * 60) items.push(["warn", `Runtime ${longDur(total)} runs long. Consider moving tracks to another album.`]);
  const titles = new Map(); for (const s of a.order) { const b = take(s).baseTitle; titles.set(b, (titles.get(b) || 0) + 1); }
  for (const [b, n] of titles) if (n > 1) items.push(["bad", `"${b}" is on here ${n} times.`]);
  const unscored = a.order.filter(s => rating(s).score == null);
  if (unscored.length) items.push(["info", `No score yet: ${unscored.map(nameOf).join(", ")}.`]);
  const nonVocal = a.order.filter(s => take(s).type && take(s).type !== "Vocal");
  if (nonVocal.length) items.push(["warn", `Not a vocal take: ${nonVocal.map(s => nameOf(s) + " (" + take(s).type + ")").join(", ")}.`]);
  const open = Object.entries(state.sessions).map(([id, s]) => [id, s, sessionStats(s)]).filter(([, , st]) => !st.on && st.open);
  const short = live().filter(s => rating(s).status === "short" && !albumOf(s) && !isCut(s) && !tagged(s));
  const unscoredAll = live().filter(s => rating(s).score == null && !isCut(s) && !tagged(s));
  const where = new Map(); for (const [id, al] of albums) for (const s of al.order) { const b = take(s).baseTitle; if (!where.has(b)) where.set(b, new Set()); where.get(b).add(id); }
  const split = [...where].filter(([, ids]) => ids.size > 1).map(([b]) => b);
  const writers = {}; for (const s of a.order) { const w = take(s).writer || "Unknown"; writers[w] = (writers[w] || 0) + 1; }
  $("missing").innerHTML = `<h3>What's missing</h3>
    <ul class="checks">${items.length ? items.map(([k, t]) => `<li class="${k}">${esc(t)}</li>`).join("") : `<li class="ok">Track count, runtime and scores look complete.</li>`}</ul>
    <h3>Still to decide</h3>
    <ul class="checks">
      <li class="${open.length ? "warn" : "ok"}">${open.length ? `${open.length} session${open.length > 1 ? "s have" : " has"} nothing on ${esc(shortName(a))} and nothing ruled out yet: ${open.map(([id, s]) => `<button class="linkish" data-goto-session="${esc(id)}">${esc(s.name)}</button>`).join(", ")}` : "Every session is either on the album or cut."}</li>
      <li class="${short.length ? "warn" : "ok"}">${short.length ? `${short.length} Shortlist take${short.length > 1 ? "s" : ""} not on any album.` : "Every Shortlist take is placed."}</li>
      <li class="${unscoredAll.length ? "info" : "ok"}">${unscoredAll.length ? `${unscoredAll.length} contender${unscoredAll.length > 1 ? "s" : ""} not scored yet.` : "Every contender is scored."}</li>
      ${split.length ? `<li class="bad">Same song on more than one album: ${esc(split.join(", "))}.</li>` : ""}
    </ul>
    ${a.order.length ? `<h3>Writer mix</h3><p class="meta">${Object.entries(writers).map(([w, n]) => `${esc(w)} ${n}`).join(" · ")}</p>` : ""}`;
}

function renderCleanup() {
  const all = Object.keys(state.considered);
  const dels = all.filter(s => item(s).del).sort((a, b) => !!item(a).delDone - !!item(b).delDone || nameOf(a).localeCompare(nameOf(b)));
  const renames = all.filter(s => item(s).name).sort((a, b) => !!item(a).renameDone - !!item(b).renameDone || take(a).title.localeCompare(take(b).title));
  const delTodo = dels.filter(s => !item(s).delDone), renTodo = renames.filter(s => !item(s).renameDone);
  $("cleanup").innerHTML = `<div class="cleanup-grid">
    <section><div class="field-head"><h3>Delete on Suno <small>${delTodo.length} to do</small></h3>${delTodo.length ? `<button class="btn small" id="copyDeletes">Copy links</button>` : ""}</div>
      <p class="meta">Tick a take once it's deleted on Suno. Ticked takes leave the planner; untick to bring one back.</p>
      ${dels.length ? dels.map(s => `<label class="clean-row${item(s).delDone ? " done" : ""}" data-stem="${esc(s)}"><input type="checkbox" data-del-done ${item(s).delDone ? "checked" : ""}><span class="t"><b>${esc(take(s).title)}</b><small>${esc(takeLabel(take(s)))}</small></span><a class="btn small" href="${suno(s)}" target="_blank" rel="noopener">Open on Suno</a></label>`).join("") : `<p class="empty-note">Nothing tagged. Use <b>Delete</b> on a take.</p>`}
    </section>
    <section><div class="field-head"><h3>Rename on Suno <small>${renTodo.length} to do</small></h3></div>
      <p class="meta">Copy the new name, rename on Suno, then tick it. The bracketed old name disappears once ticked.</p>
      ${renames.length ? renames.map(s => `<div class="clean-row${item(s).renameDone ? " done" : ""}" data-stem="${esc(s)}"><input type="checkbox" data-rename-done ${item(s).renameDone ? "checked" : ""} aria-label="Renamed on Suno"><span class="t"><b>${esc(item(s).name)}</b><small>was ${esc(take(s).title)}</small></span><button class="btn small" data-copy-name>Copy name</button><a class="btn small" href="${suno(s)}" target="_blank" rel="noopener">Open on Suno</a></div>`).join("") : `<p class="empty-note">No renames yet. Use ✎ on a take.</p>`}
    </section></div>`;
}

// ---------- dialogs ----------
function openImport() {
  const sources = [["tracklist", "Audio Board tracklist", audio.tracklist || []], ...Object.entries(audio.collections || {}).map(([id, c]) => ["c:" + id, c.name, c.members || []])];
  $("importSources").innerHTML = sources.map(([id, name, stems]) => {
    const fresh = stems.filter(s => !state.considered[s]).length, newer = stems.filter(s => !TAKES[s]).length;
    return `<div class="import-row"><div class="t"><b>${esc(name)}</b><small>${stems.length} takes · ${fresh} new${newer ? ` · ${newer} newer than this snapshot` : ""}</small></div><button class="btn small primary" data-import="${esc(id)}" ${fresh ? "" : "disabled"}>Add ${fresh}</button></div>`;
  }).join("") + (sources.length === 1 && !audio.tracklist?.length ? `<p class="meta">No Audio Board sessions found on this device. Sign in above so the planner can read your synced Audio Board data.</p>` : "");
  $("importDialog").dataset.sources = JSON.stringify(Object.fromEntries(sources.map(([id, , stems]) => [id, stems])));
  renderCatalog(); $("importDialog").showModal();
}
function renderCatalog() {
  const q = $("catalogSearch").value.trim().toLowerCase(), all = $("catalogAll").checked;
  const list = Object.values(TAKES).filter(t => (all || t.type === "Vocal") && (!q || [t.title, t.baseTitle, t.writer, t.lyrics].some(x => String(x || "").toLowerCase().includes(q))))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, {numeric:true})).slice(0, 200);
  $("catalogResults").innerHTML = list.map(t => `<label class="session-option"><input type="checkbox" data-cat="${esc(t.stem)}" ${state.considered[t.stem] ? "checked disabled" : ""}><span><b>${esc(t.title)}</b> · ${esc(takeLabel(t))}</span></label>`).join("") || `<p class="meta">No matches.</p>`;
}
function openCompare(stem) {
  const t = take(stem), same = live().filter(s => s !== stem && take(s).baseTitle === t.baseTitle);
  const existing = Object.entries(state.sessions).filter(([, s]) => !s.members.includes(stem))
    .sort(([, a], [, b]) => (b.name === t.baseTitle) - (a.name === t.baseTitle) || a.name.localeCompare(b.name));
  const mine = sessionsOf(stem);
  $("compareTitle").textContent = "Compare " + nameOf(stem);
  $("compareBody").innerHTML = `
    ${mine.length ? `<p class="meta">Already in: ${mine.map(([id, s]) => `<button class="linkish" data-goto-session="${esc(id)}">${esc(s.name)}</button>`).join(", ")}</p>` : ""}
    <h3 class="sub">New session</h3>
    <input type="text" id="compareName" value="${esc(t.baseTitle)}" aria-label="Session name">
    ${same.length ? `<label class="inline"><input type="checkbox" id="compareSame" checked> also add the other ${same.length} take${same.length > 1 ? "s" : ""} of "${esc(t.baseTitle)}"</label>` : ""}
    <div class="scope-tools"><button class="btn primary" id="compareCreate">Start session</button></div>
    ${existing.length ? `<h3 class="sub">Or add to a session</h3><div class="session-options">${existing.map(([id, s]) => `<button class="session-row" data-add-to="${esc(id)}"><b>${esc(s.name)}</b><small>${s.members.length} takes</small></button>`).join("")}</div>` : ""}`;
  $("compareDialog").dataset.stem = stem;
  $("compareDialog").showModal();
}

// ---------- events ----------
document.querySelector(".tabs").onclick = e => { const b = e.target.closest("[data-view]"); if (!b) return; ui.view = b.dataset.view; saveView(); render(); };
$("targetAlbum").onchange = e => {
  if (e.target.value === "__new") { const id = newAlbum(); if (id) { ui.album = id; saveView(); save(); } else render(); return; }
  ui.album = e.target.value; saveView(); render();
};
$("q").oninput = e => { ui.q = e.target.value.trim(); renderConsider(); };
$("sort").onchange = e => { ui.sort = e.target.value; ui.dir = ""; saveView(); renderConsider(); };
$("sortDir").onclick = () => { ui.dir = sortDir() === "desc" ? "asc" : "desc"; saveView(); renderConsider(); };
$("groupToggle").onclick = () => { ui.group = !ui.group; saveView(); renderConsider(); };
$("filterChips").onclick = e => { const b = e.target.closest("[data-f]"); if (b) { ui.filter = b.dataset.f; saveView(); renderConsider(); } };
$("toastUndo").onclick = undo;
function gotoSession(id) { ui.view = "sessions"; ui.session = id; saveView(); render(); if (innerWidth < 820) $("sessionDetail").scrollIntoView(); }

// Every take control works the same wherever the card appears.
document.addEventListener("click", e => {
  const gs = e.target.closest("[data-goto-session]"); if (gs) { document.querySelectorAll("dialog[open]").forEach(d => d.close()); gotoSession(gs.dataset.gotoSession); return; }
  const ga = e.target.closest("[data-goto-album]"); if (ga) { ui.view = "albums"; ui.album = ga.dataset.gotoAlbum; saveView(); render(); return; }
  const b = e.target.closest(".card [data-act]"); if (!b) return;
  const stem = b.closest("[data-stem]").dataset.stem, act = b.dataset.act;
  if (act === "short" || act === "maybe") { setRating(stem, {status:rating(stem).status === act ? null : act}); render(); }
  if (act === "add") toggleOnAlbum(stem);
  if (act === "cut") toggleCut(stem);
  if (act === "delete") toggleDelete(stem);
  if (act === "rename") rename(stem);
  if (act === "compare") openCompare(stem);
});
document.addEventListener("change", e => {
  const sel = e.target.closest("select.add-to"); if (!sel || !sel.value) return;
  const stem = sel.closest("[data-stem]").dataset.stem;
  let id = sel.value; if (id === "__new") { id = newAlbum(); if (!id) { sel.value = ""; return; } }
  placeOnAlbum(stem, id);
});
// Score box: commit on change, Enter jumps to the next take's box.
function commitScore(input) {
  const stem = input.closest("[data-stem]").dataset.stem, raw = input.value.trim();
  const n = raw === "" ? null : Math.max(0, Math.min(100, Math.round(Number(raw))));
  if (raw !== "" && !Number.isFinite(Number(raw))) { input.value = rating(stem).score ?? ""; return; }
  input.value = n ?? "";
  if ((rating(stem).score ?? null) === n) return;
  setRating(stem, {score:n});
  document.querySelectorAll(`[data-stem="${CSS.escape(stem)}"] .score-in`).forEach(x => { x.value = n ?? ""; x.className = "score-in " + scoreClass(n); });
}
document.addEventListener("change", e => { if (e.target.matches(".score-in")) commitScore(e.target); });
document.addEventListener("keydown", e => {
  if (!e.target.matches?.(".score-in") || e.key !== "Enter") return;
  e.preventDefault(); commitScore(e.target);
  const boxes = [...document.querySelectorAll(".score-in")], next = boxes[boxes.indexOf(e.target) + (e.shiftKey ? -1 : 1)];
  if (next) { next.focus(); next.select(); next.scrollIntoView({block:"nearest"}); } else e.target.blur();
});
// Notes save as you type (debounced) into the Audio Board note.
function fit(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, document.activeElement === t ? 600 : 120) + "px"; }
const noteTimers = {};
document.addEventListener("input", e => {
  if (!e.target.matches("textarea.note")) return;
  const t = e.target, stem = t.closest("[data-stem]").dataset.stem; fit(t);
  clearTimeout(noteTimers[stem]); noteTimers[stem] = setTimeout(() => setRating(stem, {note:t.value}), 400);
});
document.addEventListener("focusin", e => { if (e.target.matches?.("textarea.note")) fit(e.target); });
document.addEventListener("focusout", e => {
  if (!e.target.matches?.("textarea.note")) return;
  const stem = e.target.closest("[data-stem]").dataset.stem;
  if (noteTimers[stem]) { clearTimeout(noteTimers[stem]); delete noteTimers[stem]; if ((rating(stem).note || "") !== e.target.value) setRating(stem, {note:e.target.value}); }
  setTimeout(() => fit(e.target), 0);
});

$("considerList").addEventListener("click", e => {
  const g = e.target.closest("[data-compare-group]"); if (!g) return;
  const stems = live().filter(s => take(s).baseTitle === g.dataset.compareGroup);
  const id = newSession(g.dataset.compareGroup, stems); save(); toast("Session started: " + g.dataset.compareGroup); gotoSession(id);
});
$("autoGroup").onclick = () => {
  const groups = new Map();
  for (const s of live()) { if (sessionsOf(s).length) continue; const b = take(s).baseTitle; if (!groups.has(b)) groups.set(b, []); groups.get(b).push(s); }
  const multi = [...groups].filter(([, l]) => l.length > 1);
  if (!multi.length) { toast("No songs with two or more takes outside a session"); return; }
  if (!confirm(`Create ${multi.length} compare sessions, one per song with 2+ takes not in a session yet?\n\n${multi.map(([b, l]) => `${b} (${l.length})`).join("\n")}`)) return;
  snapshot(); for (const [b, l] of multi) newSession(b, l); save();
  toast(`${multi.length} sessions created`, true); ui.view = "sessions"; saveView(); render();
};
$("importOpen").onclick = openImport;
$("importClose").onclick = () => $("importDialog").close();
$("importSources").onclick = e => {
  const b = e.target.closest("[data-import]"); if (!b) return;
  const n = consider(JSON.parse($("importDialog").dataset.sources)[b.dataset.import] || []); toast(`Added ${n} take${n === 1 ? "" : "s"}`); openImport();
};
$("pasteAdd").onclick = () => {
  const ids = [...new Set(($("pasteIds").value.match(UUID) || []).map(x => x.toLowerCase()))];
  const n = consider(ids), unknown = ids.filter(id => !TAKES[id]).length;
  $("pasteNote").textContent = `${ids.length} IDs found, ${n} added${unknown ? `, ${unknown} newer than this catalogue snapshot (Suno link and placeholder title until the catalogue is rebuilt)` : ""}.`;
  if (n) $("pasteIds").value = "";
};
$("catalogSearch").oninput = renderCatalog;
$("catalogAll").onchange = renderCatalog;
$("catalogResults").onchange = e => { const c = e.target.closest("[data-cat]"); if (c?.checked) { consider([c.dataset.cat]); c.disabled = true; } };
$("compareCancel").onclick = () => $("compareDialog").close();
$("compareBody").onclick = e => {
  const stem = $("compareDialog").dataset.stem;
  if (e.target.closest("#compareCreate")) {
    const name = $("compareName").value.trim() || take(stem).baseTitle;
    const stems = [stem, ...($("compareSame")?.checked ? live().filter(s => s !== stem && take(s).baseTitle === take(stem).baseTitle) : [])];
    const id = newSession(name, stems); save(); $("compareDialog").close(); toast("Session started: " + name); gotoSession(id); return;
  }
  const add = e.target.closest("[data-add-to]");
  if (add) { const s = state.sessions[add.dataset.addTo]; s.members = [...new Set([...s.members, stem])]; save(); $("compareDialog").close(); toast("Added to " + s.name); }
};

$("sessionList").onclick = e => {
  if (e.target.closest("#newEmptySession")) { const name = prompt("Session name"); if (name?.trim()) { const id = newSession(name.trim(), []); save(); gotoSession(id); } return; }
  const b = e.target.closest("[data-session]"); if (b) gotoSession(b.dataset.session);
};
$("sessionDetail").addEventListener("click", e => {
  const s = state.sessions[ui.session]; if (!s) return;
  if (e.target.closest("[data-back]")) { ui.session = ""; saveView(); renderSessions(); $("sessionList").scrollIntoView(); return; }
  if (e.target.closest("#sessionSortDir")) { ui.sdir = dirOf(ui.ssort, ui.sdir) === "desc" ? "asc" : "desc"; saveView(); renderSessions(); return; }
  if (e.target.closest("#deleteSession")) { if (!confirm(`Delete session "${s.name}"? Its takes stay in the planner.`)) return; snapshot(); delete state.sessions[ui.session]; ui.session = ""; save(); toast("Session deleted", true); return; }
  if (e.target.closest("#sessionAddMore")) {
    const box = $("sessionAdder"); box.classList.toggle("hidden");
    const options = live().filter(m => !s.members.includes(m)).sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, {numeric:true}));
    box.innerHTML = options.map(m => `<label class="session-option"><input type="checkbox" data-add-member="${esc(m)}"><span>${esc(nameOf(m))} · ${esc(takeLabel(take(m)))}</span></label>`).join("") || `<p class="meta">Every considered take is already here.</p>`;
  }
});
$("sessionDetail").addEventListener("change", e => {
  const s = state.sessions[ui.session]; if (!s) return;
  if (e.target.id === "sessionSort") { ui.ssort = e.target.value; ui.sdir = ""; saveView(); renderSessions(); return; }
  const m = e.target.closest("[data-add-member]"); if (m?.checked) { s.members = [...new Set([...s.members, m.dataset.addMember])]; save(); return; }
  if (e.target.id === "sessionName" && e.target.value.trim()) { s.name = e.target.value.trim(); save(false); renderSummary(); }
  if (e.target.id === "sessionNote") { s.note = e.target.value; save(false); }
});

$("albumHead").addEventListener("click", async e => {
  const a = album();
  if (e.target.closest("#copyAlbum")) toast(await copyText(a.name + "\n" + a.order.map((s, i) => `${i + 1}. ${nameOf(s)} (${take(s).title}, ${dur(take(s).duration)})`).join("\n")) ? "Tracklist copied" : "Copy failed");
  if (e.target.closest("#deleteAlbum")) { if (!confirm(`Delete "${a.name}"? Its tracks stay in the planner.`)) return; snapshot(); delete state.albums[ui.album]; ui.album = ""; save(); toast("Album deleted", true); }
});
$("albumHead").addEventListener("change", e => {
  const a = album();
  if (e.target.id === "albumName" && e.target.value.trim()) { a.name = e.target.value.trim(); save(); }
  if (e.target.id === "albumTarget") { a.target = Math.max(1, Math.min(40, Number(e.target.value) || 12)); save(); }
});
$("albumTracks").addEventListener("click", e => {
  const li = e.target.closest("[data-stem]"); if (!li) return;
  const a = album(), i = a.order.indexOf(li.dataset.stem);
  const mv = e.target.closest("[data-move]");
  if (mv) { const j = i + Number(mv.dataset.move); if (j < 0 || j >= a.order.length) return; [a.order[i], a.order[j]] = [a.order[j], a.order[i]]; save(); return; }
  if (e.target.closest("[data-unplace]")) { a.order.splice(i, 1); save(); }
});
let dragStem = null;
$("albumTracks").addEventListener("dragstart", e => { if (e.target.matches?.("input,select")) return; const li = e.target.closest("[data-stem]"); if (li) { dragStem = li.dataset.stem; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; } });
$("albumTracks").addEventListener("dragover", e => { if (dragStem) e.preventDefault(); });
$("albumTracks").addEventListener("drop", e => {
  e.preventDefault(); const li = e.target.closest("[data-stem]"), a = album();
  if (!dragStem || !li || li.dataset.stem === dragStem) return;
  a.order.splice(a.order.indexOf(dragStem), 1);
  const rect = li.getBoundingClientRect(), to = a.order.indexOf(li.dataset.stem) + (e.clientY > rect.top + rect.height / 2 ? 1 : 0);
  a.order.splice(to, 0, dragStem); dragStem = null; save();
});
$("albumTracks").addEventListener("dragend", () => { dragStem = null; document.querySelectorAll(".dragging").forEach(x => x.classList.remove("dragging")); });
$("pool").addEventListener("click", e => { const b = e.target.closest("[data-place]"); if (b) placeOnAlbum(b.closest("[data-stem]").dataset.stem, b.dataset.place); });

$("cleanup").addEventListener("change", e => {
  const row = e.target.closest("[data-stem]"); if (!row) return; const i = state.considered[row.dataset.stem];
  if (e.target.matches("[data-del-done]")) {
    if (e.target.checked) { i.delDone = Date.now(); for (const s of Object.values(state.sessions)) s.members = s.members.filter(m => m !== row.dataset.stem); for (const a of Object.values(state.albums)) { a.order = a.order.filter(m => m !== row.dataset.stem); a.cut = a.cut.filter(m => m !== row.dataset.stem); } }
    else delete i.delDone;
    save();
  }
  if (e.target.matches("[data-rename-done]")) { if (e.target.checked) i.renameDone = Date.now(); else delete i.renameDone; save(); }
});
$("cleanup").addEventListener("click", async e => {
  if (e.target.closest("#copyDeletes")) { const list = Object.keys(state.considered).filter(tagged).map(s => `${take(s).title}  ${suno(s)}`).join("\n"); toast(await copyText(list) ? "Delete list copied" : "Copy failed"); }
  const c = e.target.closest("[data-copy-name]"); if (c) toast(await copyText(item(c.closest("[data-stem]").dataset.stem).name) ? "Name copied" : "Copy failed");
});

$("exportBtn").onclick = () => {
  const {_sync, ...plan} = state;
  const blob = new Blob([JSON.stringify({app:"album-planner", exported:new Date().toISOString(), ...plan}, null, 2)], {type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "album-plan-" + new Date().toISOString().slice(0, 10) + ".json"; a.click(); URL.revokeObjectURL(a.href);
};
$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (d?.app !== "album-planner") throw Error("not an Album Planner export");
    snapshot(); state.considered = d.considered || {}; state.sessions = d.sessions || {}; state.albums = d.albums || {}; save(); toast("Imported", true);
  } catch (err) { toast("Import failed: " + err.message); }
  e.target.value = "";
};

// ---------- sync: planner records + Audio Board scores, one sign-in ----------
const sync = {plan:{text:"", failed:false}, audio:{text:"", failed:false}};
function showStatus() {
  const p = sync.plan, a = sync.audio;
  const text = p.failed ? p.text : a.failed ? "Scores: " + a.text : /Saving/.test(a.text) && !/Saving/.test(p.text) ? a.text : p.text;
  $("syncStatus").textContent = text; $("syncStatus").classList.toggle("failed", p.failed || a.failed);
  $("retrySyncBtn").hidden = !(p.failed || a.failed) || !cloud;
}
const account = (user, busy) => { $("accountWho").textContent = user ? (user.email || user.displayName || "") : ""; $("signInBtn").hidden = !!user || busy; $("signOutBtn").hidden = !user; };
function initSync() {
  if (typeof firebase === "undefined" || !firebase.auth || !firebase.database) { sync.plan = {text:"Saved on this device. Connect to the internet and reload to sign in."}; showStatus(); return; }
  try {
    if (!firebase.apps.length) firebase.initializeApp({apiKey:"AIzaSyDTcQiFsjhSzlsEl7uPJvTtsxp798XOqIQ", authDomain:"family-planner-ccafc.firebaseapp.com", databaseURL:"https://family-planner-ccafc-default-rtdb.firebaseio.com", projectId:"family-planner-ccafc"});
    cloud = PlannerSync.create({firebase, read:() => state,
      replace:next => { state = next; previous = clone(state); persist(); requestRender(); },
      selectAccount:owner => {
        if (state._sync.owner === owner) return;
        let cached = null; try { cached = JSON.parse(localStorage.getItem(KEY + ".account." + owner)); } catch (err) {}
        // First sign-in keeps the signed-out plan and merges it into the account.
        state = cached?._sync?.owner === owner ? PlannerSync.prepare(cached) : state._sync.owner ? PlannerSync.prepare(PlannerSync.empty()) : state;
        previous = clone(state); persist();
      },
      status:(text, failed = false) => { sync.plan = {text, failed}; showStatus(); }, account});
    audioCloud = AlbumSync.create({firebase, board:"audio", read:() => audio,
      replace:next => { audio = next; audioPrev = clone(audio); persistAudio(); requestRender(); },
      selectAccount:owner => {
        if (audio._sync.owner === owner) return;
        const cached = readAudio(AUDIO_KEY + ".account." + owner);
        audio = cached?._sync?.owner === owner ? AlbumSync.prepare(blankAudio(cached)) : audio._sync.owner ? AlbumSync.prepare(blankAudio()) : audio;
        audioPrev = clone(audio); persistAudio();
      },
      status:(text, failed = false) => { sync.audio = {text, failed}; showStatus(); }, account});
    $("signInBtn").onclick = () => cloud.signIn();
    $("signOutBtn").onclick = () => cloud.signOut();
    $("retrySyncBtn").onclick = () => { cloud.retry(); audioCloud.retry(); };
  } catch (err) { sync.plan = {text:"Account sync could not start. Your plan is saved on this device.", failed:true}; showStatus(); }
}

if (!Object.keys(state.albums).length || Object.values(state.albums).some(a => !a.cut)) save(false);
render();
initSync();
// Signed out, pick up scores another tab (Audio Board) saved on this device.
window.addEventListener("storage", e => { if (e.key === AUDIO_KEY && !audio._sync.owner) { const s = readAudio(AUDIO_KEY); if (s) { audio = AlbumSync.prepare(blankAudio(s)); audioPrev = clone(audio); requestRender(); } } });
