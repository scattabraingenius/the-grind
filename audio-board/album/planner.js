"use strict";
if ("serviceWorker" in navigator) navigator.serviceWorker.register("../../service-worker.js").catch(() => {});
// Album Planner: Considered -> compare Sessions -> Albums. Reads Audio Board scores; writes only its own plan.
const KEY = "grind.planner.v1";
const AUDIO_KEY = "grind.audio.v1";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = prefix => prefix + "-" + crypto.randomUUID().slice(0, 8);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Catalogue: one entry per Suno take, keyed by its Suno UUID.
const TAKES = {};
for (const s of window.ALBUM_SONGS || []) { const v = s.versions[0]; TAKES[s.slug] = {...v, stem:s.slug, title:s.title, baseTitle:s.baseTitle || s.title}; }
const STATUS = {short:"Shortlist", maybe:"Maybe", cut:"Cut"};
const DEFAULT_ALBUMS = {debut:{name:"Album 1 · Debut", created:1, order:[], target:12}, second:{name:"Album 2", created:2, order:[], target:12}};

// ---------- state ----------
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && typeof s === "object") return PlannerSync.prepare(s); } catch (err) {}
  return PlannerSync.prepare(PlannerSync.empty());
}
let state = load(), previous = JSON.parse(JSON.stringify(state)), cloud = null;
let deviceId; try { deviceId = localStorage.getItem(KEY + ".device"); } catch (err) {}
if (!deviceId) { deviceId = crypto.randomUUID(); try { localStorage.setItem(KEY + ".device", deviceId); } catch (err) {} }
function loadAudioLocal(owner) {
  try { const s = JSON.parse(localStorage.getItem(owner ? AUDIO_KEY + ".account." + owner : AUDIO_KEY)); if (s && typeof s === "object") return s; } catch (err) {}
  return null;
}
let audio = loadAudioLocal() || {ratings:{}, tracklist:[], collections:{}};
function persist() {
  try {
    if (state._sync.owner) localStorage.setItem(KEY + ".account." + state._sync.owner, JSON.stringify(state));
    localStorage.setItem(KEY, JSON.stringify(state));
    $("saveStatus").classList.remove("failed"); $("saveStatus").textContent = "Saved on this device. Export plan keeps a separate backup.";
  } catch (err) { $("saveStatus").classList.add("failed"); $("saveStatus").textContent = "Changes could not be saved. Export a backup before closing."; }
}
function ensureAlbums() {
  // Fixed IDs so two devices' default albums merge rather than duplicate.
  if (!Object.keys(state.albums).length) for (const [id, a] of Object.entries(DEFAULT_ALBUMS)) state.albums[id] = JSON.parse(JSON.stringify(a));
}
function save() {
  state = PlannerSync.capture(previous, state, deviceId);
  previous = JSON.parse(JSON.stringify(state));
  persist(); if (cloud) cloud.changed(); render();
}
let undoSnap = null;
function snapshot() { const {_sync, ...rest} = state; undoSnap = JSON.parse(JSON.stringify(rest)); }
function undo() { if (!undoSnap) return; Object.assign(state, JSON.parse(JSON.stringify(undoSnap))); undoSnap = null; save(); toast("Restored"); }

// ---------- helpers ----------
let viewPrefs = {}; try { viewPrefs = JSON.parse(localStorage.getItem(KEY + ".view")) || {}; } catch (err) {}
const ui = {view:viewPrefs.view || "consider", q:"", sort:viewPrefs.sort || "title", dir:viewPrefs.dir || "", group:viewPrefs.group !== false, filter:viewPrefs.filter || "all", session:viewPrefs.session || "", album:viewPrefs.album || "debut", open:{}};
function saveView() { try { localStorage.setItem(KEY + ".view", JSON.stringify({view:ui.view, sort:ui.sort, dir:ui.dir, group:ui.group, filter:ui.filter, session:ui.session, album:ui.album})); } catch (err) {} }
const take = stem => TAKES[stem] || {stem, title:state.considered[stem]?.title || "Suno " + stem.slice(0, 8), baseTitle:state.considered[stem]?.title || "Not in catalogue", missing:true, writer:"", duration:0, createdAt:""};
const rating = stem => audio.ratings?.[stem] || {};
const dur = s => { s = Math.round(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const longDur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + "h " : "") + m + "m " + String(s % 60).padStart(2, "0") + "s"; };
const suno = stem => "https://suno.com/song/" + encodeURIComponent(stem);
const scoreClass = n => n == null ? "" : n >= 80 ? "hi" : n >= 50 ? "mid" : "";
function takeLabel(t) { return [t.type && t.type !== "Vocal" ? t.type : "", t.writer && t.writer !== "Unknown" ? t.writer : "", t.packetVersion ? "lyrics v" + t.packetVersion : "", t.take ? "take " + t.take : "", t.duration ? dur(t.duration) : ""].filter(Boolean).join(" · "); }
function sessionsOf(stem) { return Object.entries(state.sessions).filter(([, s]) => s.members.includes(stem)); }
function albumOf(stem) { return Object.entries(state.albums).find(([, a]) => a.order.includes(stem)); }
function stage(stem) {
  if (albumOf(stem)) return "album";
  const ss = sessionsOf(stem);
  if (ss.some(([, s]) => s.winner === stem)) return "winner";
  if (ss.some(([, s]) => s.winner && s.winner !== stem)) return "lost";
  if (ss.length) return "session";
  return "loose";
}
let toastTimer;
function toast(msg, withUndo = false) {
  $("toastText").textContent = msg; $("toastUndo").classList.toggle("hidden", !withUndo);
  $("toast").classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("on"), withUndo ? 6000 : 1600);
}
async function copyText(text) { try { await navigator.clipboard.writeText(text); return true; } catch (err) { return false; } }

// ---------- actions ----------
function consider(stems, origin) {
  let added = 0;
  for (const stem of stems) if (!state.considered[stem]) { state.considered[stem] = {added:Date.now(), ...(TAKES[stem] ? {} : {title:origin?.[stem] || ""})}; added++; }
  if (added) save();
  return added;
}
function removeTake(stem) {
  snapshot();
  delete state.considered[stem];
  for (const s of Object.values(state.sessions)) { s.members = s.members.filter(m => m !== stem); if (s.winner === stem) s.winner = null; }
  for (const a of Object.values(state.albums)) a.order = a.order.filter(m => m !== stem);
  save(); toast("Removed " + take(stem).title, true);
}
function newSession(name, stems) {
  const id = uid("s");
  state.sessions[id] = {name, created:Date.now(), winner:null, note:"", members:[...new Set(stems)]};
  for (const stem of stems) if (!state.considered[stem]) state.considered[stem] = {added:Date.now()};
  return id;
}
function placeOnAlbum(stem, albumId) {
  for (const a of Object.values(state.albums)) a.order = a.order.filter(m => m !== stem);
  state.albums[albumId].order.push(stem);
  if (!state.considered[stem]) state.considered[stem] = {added:Date.now()};
  save(); toast("Added to " + state.albums[albumId].name);
}
function pickWinner(sid, stem) {
  const s = state.sessions[sid]; s.winner = s.winner === stem ? null : stem;
  // A replaced winner leaves the album slot to the new winner.
  for (const a of Object.values(state.albums)) {
    const i = a.order.findIndex(m => s.members.includes(m) && m !== s.winner);
    if (i >= 0 && s.winner && !a.order.includes(s.winner)) a.order[i] = s.winner;
  }
  save();
}

// ---------- render ----------
function render() {
  ensureAlbums();
  for (const v of ["consider", "sessions", "albums"]) {
    $("view" + v[0].toUpperCase() + v.slice(1)).classList.toggle("hidden", ui.view !== v);
    $("tab" + {consider:"Consider", sessions:"Sessions", albums:"Albums"}[v]).setAttribute("aria-selected", ui.view === v);
  }
  renderSummary();
  if (ui.view === "consider") renderConsider();
  if (ui.view === "sessions") renderSessions();
  if (ui.view === "albums") renderAlbums();
}
function renderSummary() {
  const stems = Object.keys(state.considered), sessions = Object.values(state.sessions);
  const songs = new Set(stems.map(s => take(s).baseTitle)).size;
  const decided = sessions.filter(s => s.winner).length;
  const placed = Object.values(state.albums).reduce((n, a) => n + a.order.length, 0);
  $("summary").textContent = `${stems.length} takes considered · ${songs} songs · ${decided}/${sessions.length} sessions decided · ${placed} placed on albums`;
  $("countConsider").textContent = stems.length ? `(${stems.length})` : "";
  $("countSessions").textContent = sessions.length ? `(${decided}/${sessions.length})` : "";
  $("countAlbums").textContent = placed ? `(${placed})` : "";
  $("built").textContent = window.ALBUM_BUILT ? "Suno snapshot " + window.ALBUM_BUILT : "";
  const steps = [
    ["Add every take you're considering", stems.length > 0],
    ["Compare like-takes in sessions", sessions.length > 0],
    ["Pick a winner in each session", sessions.length > 0 && decided === sessions.length],
    ["Order the albums", placed > 0],
  ];
  $("flow").innerHTML = steps.map(([t, done], i) => `<li class="${done ? "done" : ""}"><b>${i + 1}</b> ${esc(t)}</li>`).join("");
}

const FILTERS = [["all", "All"], ["loose", "Not sorted yet"], ["session", "In a session"], ["winner", "Winners"], ["lost", "Lost a session"], ["album", "On an album"]];
const SORT_DIR = {title:"asc", score:"desc", newest:"desc", length:"desc"};
const sortDir = () => ui.dir || SORT_DIR[ui.sort];
function renderSortDir() { const down = sortDir() === "desc"; $("sortDir").textContent = down ? "↓ Desc" : "↑ Asc"; $("sortDir").setAttribute("aria-label", "Sort direction " + (down ? "descending" : "ascending")); }
function sortStems(stems) {
  const down = sortDir() === "desc", tie = (a, b) => take(a).title.localeCompare(take(b).title, undefined, {numeric:true});
  const key = {title:null, score:s => rating(s).score, newest:s => take(s).createdAt || null, length:s => take(s).duration || null}[ui.sort];
  return stems.slice().sort((a, b) => {
    if (!key) return down ? tie(b, a) : tie(a, b);
    const x = key(a), y = key(b);
    if (x == null || y == null) return (x == null) - (y == null) || tie(a, b); // missing values stay last
    const c = typeof x === "string" ? x.localeCompare(y) : x - y;
    return (down ? -c : c) || tie(a, b);
  });
}
function matchesQuery(stem) {
  if (!ui.q) return true;
  const t = take(stem), q = ui.q.toLowerCase();
  return [t.title, t.baseTitle, t.writer, t.lyrics, t.oldTitle, rating(stem).note].some(x => String(x || "").toLowerCase().includes(q));
}
function card(stem) {
  const t = take(stem), r = rating(stem), st = stage(stem), album = albumOf(stem), ss = sessionsOf(stem);
  const badges = [
    r.status ? `<span class="badge ${r.status}">${STATUS[r.status]}</span>` : "",
    ...ss.map(([id, s]) => `<button class="badge link ${s.winner === stem ? "win" : s.winner ? "lost" : ""}" data-goto-session="${esc(id)}" title="Open session">${s.winner === stem ? "★ " : ""}${esc(s.name)}</button>`),
    album ? `<button class="badge link placed" data-goto-album="${esc(album[0])}">${esc(album[1].name)} #${album[1].order.indexOf(stem) + 1}</button>` : "",
    t.missing ? `<span class="badge cut">not in snapshot</span>` : "",
  ].join("");
  return `<article class="card st-${st}" data-stem="${esc(stem)}">
    <div class="card-top"><span class="score ${scoreClass(r.score)}">${r.score ?? "–"}</span><div class="t"><b title="${esc(t.title)}">${esc(t.title)}</b><small>${esc(takeLabel(t)) || "&nbsp;"}</small></div></div>
    <div class="badges">${badges}</div>
    <div class="card-actions">
      <a class="btn small" href="${suno(stem)}" target="_blank" rel="noopener">▶ Suno</a>
      <button class="btn small" data-act="compare">Compare</button>
      <button class="btn small" data-act="album">${album ? "Move" : "+ Album"}</button>
      <button class="btn small danger" data-act="delete" aria-label="Delete ${esc(t.title)} from the list">Delete</button>
    </div>
  </article>`;
}
function renderConsider() {
  $("sort").value = ui.sort; renderSortDir();
  $("groupToggle").setAttribute("aria-pressed", ui.group);
  const all = Object.keys(state.considered);
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, k === "all" ? all.length : all.filter(s => stage(s) === k || (k === "session" && ["session", "winner", "lost"].includes(stage(s)))).length]));
  $("filterChips").innerHTML = FILTERS.map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${ui.filter === k}">${l} <small>${counts[k]}</small></button>`).join("");
  const stems = sortStems(all.filter(s => (ui.filter === "all" || stage(s) === ui.filter || (ui.filter === "session" && ["session", "winner", "lost"].includes(stage(s)))) && matchesQuery(s)));
  const box = $("considerList");
  if (!all.length) { box.innerHTML = `<div class="empty-note big"><b>Nothing considered yet.</b><br>Use <b>+ Add takes</b> to pull in the Audio Board session holding your album candidates, paste Suno links, or search the catalogue.</div>`; return; }
  if (!stems.length) { box.innerHTML = `<p class="empty-note">No takes match.</p>`; return; }
  if (!ui.group) { box.innerHTML = `<div class="cards">${stems.map(card).join("")}</div>`; return; }
  const groups = new Map();
  for (const s of stems) { const g = take(s).baseTitle; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }
  box.innerHTML = [...groups].map(([name, list]) => {
    const multi = list.length > 1, inOne = multi && Object.entries(state.sessions).find(([, s]) => list.every(m => s.members.includes(m)));
    return `<section class="group"><header><h3>${esc(name)} <small>${list.length} take${list.length > 1 ? "s" : ""}</small></h3>${multi && !inOne ? `<button class="btn small" data-compare-group="${esc(name)}">Compare all ${list.length}</button>` : inOne ? `<button class="btn small" data-goto-session="${esc(inOne[0])}">Open session</button>` : ""}</header><div class="cards">${list.map(card).join("")}</div></section>`;
  }).join("");
}

function renderSessions() {
  const entries = Object.entries(state.sessions).sort(([, a], [, b]) => (!!a.winner - !!b.winner) || a.name.localeCompare(b.name));
  if (ui.session && !state.sessions[ui.session]) ui.session = "";
  $("sessionList").innerHTML = (entries.length ? entries.map(([id, s]) => {
    const w = s.winner ? take(s.winner) : null;
    return `<button class="session-row${ui.session === id ? " active" : ""}${s.winner ? " decided" : ""}" data-session="${esc(id)}"><b>${esc(s.name)}</b><small>${s.members.length} takes · ${w ? "★ " + esc(w.title) : "no winner yet"}</small></button>`;
  }).join("") : `<p class="empty-note">No sessions yet. Hit <b>Compare</b> on a take, or <b>Auto-build sessions</b> on the Considered page.</p>`) + `<button class="btn small" id="newEmptySession">+ New session</button>`;
  const d = $("sessionDetail"), s = state.sessions[ui.session];
  if (!s) { d.className = "detail empty"; d.innerHTML = "Pick a session to compare its takes and choose a winner."; return; }
  d.className = "detail";
  const albums = Object.entries(state.albums);
  const placed = s.winner && albumOf(s.winner);
  const scored = s.members.filter(m => rating(m).score != null);
  const top = scored.length ? scored.reduce((a, b) => rating(b).score > rating(a).score ? b : a) : null;
  d.innerHTML = `<button class="btn small detail-back" data-back>← Sessions</button>
    <div class="field-head"><input class="title-edit" id="sessionName" value="${esc(s.name)}" aria-label="Session name"><button class="btn small danger" id="deleteSession">Delete session</button></div>
    <p class="meta">${s.members.length} takes. ${s.winner ? `Winner: <b>${esc(take(s.winner).title)}</b>${placed ? ` · on ${esc(placed[1].name)} #${placed[1].order.indexOf(s.winner) + 1}` : ""}` : "Listen, then pick a winner."}${top && !s.winner ? ` Highest Audio Board score: ${esc(take(top).title)} (${rating(top).score}).` : ""}</p>
    ${s.winner && !placed ? `<div class="scope-tools">Send winner to ${albums.map(([id, a]) => `<button class="btn small primary" data-place="${esc(id)}">${esc(a.name)}</button>`).join("")}</div>` : ""}
    ${s.winner && s.members.length > 1 ? `<div class="scope-tools"><button class="btn small" id="dropLosers">Drop the other ${s.members.length - 1} from Considered</button></div>` : ""}
    <div class="compare-grid">${s.members.map(m => {
      const t = take(m), r = rating(m), win = s.winner === m;
      return `<article class="compare-card${win ? " winner" : s.winner ? " loser" : ""}" data-stem="${esc(m)}">
        <div class="card-top"><span class="score ${scoreClass(r.score)}">${r.score ?? "–"}</span><div class="t"><b>${esc(t.title)}</b><small>${esc(takeLabel(t))}</small></div></div>
        ${r.status ? `<span class="badge ${r.status}">${STATUS[r.status]}</span>` : ""}
        ${r.note ? `<p class="note">“${esc(r.note)}”</p>` : ""}
        <div class="card-actions">
          <a class="btn small" href="${suno(m)}" target="_blank" rel="noopener">▶ Suno</a>
          <a class="btn small" href="../?take=${encodeURIComponent(m)}" target="_blank" rel="noopener">Score it</a>
          <button class="btn small ${win ? "primary" : ""}" data-win="${esc(m)}" aria-pressed="${win}">${win ? "★ Winner" : "Pick winner"}</button>
          <button class="btn small" data-unsession="${esc(m)}">Remove</button>
        </div>
        ${t.lyrics ? `<details class="style"><summary>Lyrics</summary><pre class="lyrics">${esc(t.lyrics)}</pre></details>` : ""}
        ${t.suno?.style ? `<details class="style"><summary>Style</summary><p>${esc(t.suno.style)}</p></details>` : ""}
      </article>`;
    }).join("")}</div>
    <label class="sub" for="sessionNote">Session notes</label>
    <textarea id="sessionNote" placeholder="Why this one won, what to fix, which verse hits harder…">${esc(s.note || "")}</textarea>
    <div class="scope-tools"><button class="btn small" id="sessionAddMore">+ Add considered takes</button></div>
    <div id="sessionAdder" class="session-options hidden"></div>`;
}

function renderAlbums() {
  const albums = Object.entries(state.albums).sort(([, a], [, b]) => a.created - b.created);
  if (!state.albums[ui.album]) ui.album = albums[0][0];
  $("albumChips").innerHTML = albums.map(([id, a]) => `<button class="chip" data-album="${esc(id)}" aria-pressed="${ui.album === id}">${esc(a.name)} <small>${a.order.length}</small></button>`).join("") + `<button class="chip" id="newAlbum">+ Album</button>`;
  const a = state.albums[ui.album], total = a.order.reduce((n, s) => n + (take(s).duration || 0), 0);
  $("albumHead").innerHTML = `<div class="field-head"><input class="title-edit" id="albumName" value="${esc(a.name)}" aria-label="Album name">
      <span class="tools-inline"><label class="meta">Target <input type="number" id="albumTarget" min="1" max="40" value="${a.target || 12}"> tracks</label>
      <button class="btn small" id="copyAlbum">Copy tracklist</button>${albums.length > 1 ? `<button class="btn small danger" id="deleteAlbum">Delete album</button>` : ""}</span></div>
    <div class="runtime"><b>${a.order.length}</b> / ${a.target || 12} tracks · <b>${longDur(total)}</b> runtime<div class="bar"><span style="width:${Math.min(100, a.order.length / (a.target || 12) * 100)}%"></span></div></div>`;
  const others = albums.filter(([id]) => id !== ui.album);
  $("albumTracks").innerHTML = a.order.length ? a.order.map((stem, i) => {
    const t = take(stem), r = rating(stem);
    return `<li class="track" draggable="true" data-stem="${esc(stem)}"><span class="grip" aria-hidden="true">⋮⋮</span><span class="n">${i + 1}</span>
      <span class="score ${scoreClass(r.score)}">${r.score ?? "–"}</span>
      <div class="t"><b>${esc(t.baseTitle)}</b><small>${esc(t.title)} · ${esc(takeLabel(t))}</small></div>
      <div class="ctl"><a class="btn small" href="${suno(stem)}" target="_blank" rel="noopener" aria-label="Play on Suno">▶</a><button class="btn small" data-move="-1" aria-label="Move up">↑</button><button class="btn small" data-move="1" aria-label="Move down">↓</button>
      ${others.map(([id, o]) => `<button class="btn small" data-to-album="${esc(id)}" title="Move to ${esc(o.name)}">→ ${esc(o.name.split(" ·")[0])}</button>`).join("")}
      <button class="btn small" data-unplace aria-label="Take off this album">✕</button></div></li>`;
  }).join("") : `<li class="empty-note">No tracks yet. Place session winners or single takes from below.</li>`;
  const pool = Object.keys(state.considered).filter(s => ["winner", "loose"].includes(stage(s)));
  const sortedPool = pool.sort((x, y) => (stage(x) === "winner" ? 0 : 1) - (stage(y) === "winner" ? 0 : 1) || (rating(y).score ?? -1) - (rating(x).score ?? -1));
  $("pool").innerHTML = sortedPool.length ? `<div class="pool">${sortedPool.map(stem => {
    const t = take(stem), r = rating(stem), w = stage(stem) === "winner";
    return `<div class="pool-row" data-stem="${esc(stem)}"><span class="score ${scoreClass(r.score)}">${r.score ?? "–"}</span><div class="t"><b>${w ? "★ " : ""}${esc(t.title)}</b><small>${w ? "session winner" : "not compared"} · ${esc(takeLabel(t))}</small></div><button class="btn small primary" data-place="${esc(ui.album)}">+ ${esc(a.name.split(" ·")[0])}</button></div>`;
  }).join("")}</div>` : `<p class="empty-note">Nothing waiting. Pick winners in Sessions to fill this.</p>`;
  renderMissing(a, albums);
}
function renderMissing(a, albums) {
  const items = [];
  const target = a.target || 12, total = a.order.reduce((n, s) => n + (take(s).duration || 0), 0);
  if (a.order.length < target) items.push(["warn", `${target - a.order.length} more track${target - a.order.length > 1 ? "s" : ""} to reach ${target}.`]);
  if (a.order.length > target) items.push(["warn", `${a.order.length - target} over the ${target}-track target.`]);
  if (a.order.length && total < 35 * 60) items.push(["info", `Runtime ${longDur(total)}. Most full-length rap albums land between 40 and 60 minutes.`]);
  if (total > 70 * 60) items.push(["warn", `Runtime ${longDur(total)} runs long. Consider moving tracks to the second album.`]);
  const titles = new Map(); for (const s of a.order) { const b = take(s).baseTitle; titles.set(b, (titles.get(b) || 0) + 1); }
  for (const [b, n] of titles) if (n > 1) items.push(["bad", `“${b}” is on here ${n} times.`]);
  const unscored = a.order.filter(s => rating(s).score == null);
  if (unscored.length) items.push(["info", `${unscored.length} track${unscored.length > 1 ? "s have" : " has"} no Audio Board score: ${unscored.map(s => take(s).title).join(", ")}.`]);
  const cut = a.order.filter(s => rating(s).status === "cut");
  if (cut.length) items.push(["bad", `Marked Cut in Audio Board: ${cut.map(s => take(s).title).join(", ")}.`]);
  const nonVocal = a.order.filter(s => take(s).type && take(s).type !== "Vocal");
  if (nonVocal.length) items.push(["warn", `Not a vocal take: ${nonVocal.map(s => take(s).title + " (" + take(s).type + ")").join(", ")}.`]);
  const writers = {}; for (const s of a.order) { const w = take(s).writer || "Unknown"; writers[w] = (writers[w] || 0) + 1; }
  const open = Object.entries(state.sessions).filter(([, s]) => !s.winner);
  const loose = Object.keys(state.considered).filter(s => stage(s) === "loose");
  const winners = Object.keys(state.considered).filter(s => stage(s) === "winner");
  // Same song placed on two albums is a planning gap too.
  const where = new Map(); for (const [id, al] of albums) for (const s of al.order) { const b = take(s).baseTitle; if (!where.has(b)) where.set(b, new Set()); where.get(b).add(id); }
  const split = [...where].filter(([, ids]) => ids.size > 1).map(([b]) => b);
  $("missing").innerHTML = `<h3>What's missing</h3>
    <ul class="checks">${items.length ? items.map(([k, t]) => `<li class="${k}">${esc(t)}</li>`).join("") : `<li class="ok">Track count, runtime and scores look complete for this album.</li>`}</ul>
    <h3>Whole plan</h3>
    <ul class="checks">
      <li class="${open.length ? "warn" : "ok"}">${open.length ? `${open.length} session${open.length > 1 ? "s" : ""} without a winner: ${open.map(([id, s]) => `<button class="linkish" data-goto-session="${esc(id)}">${esc(s.name)}</button>`).join(", ")}` : "Every session has a winner."}</li>
      <li class="${winners.length ? "warn" : "ok"}">${winners.length ? `${winners.length} winner${winners.length > 1 ? "s" : ""} not placed on an album yet.` : "Every winner is placed."}</li>
      <li class="${loose.length ? "info" : "ok"}">${loose.length ? `${loose.length} considered take${loose.length > 1 ? "s" : ""} not compared or placed.` : "Nothing left unsorted."}</li>
      ${split.length ? `<li class="bad">On more than one album: ${esc(split.join(", "))}.</li>` : ""}
    </ul>
    ${a.order.length ? `<h3>Writer mix</h3><p class="meta">${Object.entries(writers).map(([w, n]) => `${esc(w)} ${n}`).join(" · ")}</p>` : ""}`;
}

// ---------- dialogs ----------
function openImport() {
  const sources = [["tracklist", "Audio Board tracklist", audio.tracklist || []], ...Object.entries(audio.collections || {}).map(([id, c]) => ["c:" + id, c.name, c.members || []])];
  $("importSources").innerHTML = sources.map(([id, name, stems]) => {
    const fresh = stems.filter(s => !state.considered[s]).length;
    return `<div class="import-row"><div class="t"><b>${esc(name)}</b><small>${stems.length} takes · ${fresh} new${stems.some(s => !TAKES[s]) ? ` · ${stems.filter(s => !TAKES[s]).length} newer than this snapshot` : ""}</small></div><button class="btn small primary" data-import="${esc(id)}" ${fresh ? "" : "disabled"}>Add ${fresh}</button></div>`;
  }).join("") + (sources.length === 1 && !audio.tracklist?.length ? `<p class="meta">No Audio Board sessions found on this device. Sign in above so the planner can read your synced Audio Board data.</p>` : "");
  $("importDialog").dataset.sources = JSON.stringify(Object.fromEntries(sources.map(([id, , stems]) => [id, stems])));
  renderCatalog(); $("importDialog").showModal();
}
function renderCatalog() {
  const q = $("catalogSearch").value.trim().toLowerCase(), all = $("catalogAll").checked;
  const list = Object.values(TAKES).filter(t => (all || t.type === "Vocal") && (!q || [t.title, t.baseTitle, t.writer, t.lyrics].some(x => String(x || "").toLowerCase().includes(q))))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, {numeric:true})).slice(0, 200);
  $("catalogResults").innerHTML = list.map(t => `<label class="session-option"><input type="checkbox" data-cat="${esc(t.stem)}" ${state.considered[t.stem] ? "checked" : ""}><span><b>${esc(t.title)}</b> · ${esc(takeLabel(t))}</span></label>`).join("") || `<p class="meta">No matches.</p>`;
}
function openCompare(stem) {
  const t = take(stem), same = Object.keys(state.considered).filter(s => s !== stem && take(s).baseTitle === t.baseTitle);
  const existing = Object.entries(state.sessions).filter(([, s]) => !s.members.includes(stem))
    .sort(([, a], [, b]) => (b.name === t.baseTitle) - (a.name === t.baseTitle) || a.name.localeCompare(b.name));
  const mine = sessionsOf(stem);
  $("compareTitle").textContent = "Compare " + t.title;
  $("compareBody").innerHTML = `
    ${mine.length ? `<p class="meta">Already in: ${mine.map(([id, s]) => `<button class="linkish" data-goto-session="${esc(id)}">${esc(s.name)}</button>`).join(", ")}</p>` : ""}
    <h3 class="sub">New session</h3>
    <input type="text" id="compareName" value="${esc(t.baseTitle)}" aria-label="Session name">
    ${same.length ? `<label class="inline"><input type="checkbox" id="compareSame" checked> also add the other ${same.length} considered take${same.length > 1 ? "s" : ""} of “${esc(t.baseTitle)}”</label>` : ""}
    <div class="scope-tools"><button class="btn primary" id="compareCreate">Start session</button></div>
    ${existing.length ? `<h3 class="sub">Or add to a session</h3><div class="session-options">${existing.map(([id, s]) => `<button class="session-row" data-add-to="${esc(id)}"><b>${esc(s.name)}</b><small>${s.members.length} takes${s.winner ? " · has a winner" : ""}</small></button>`).join("")}</div>` : ""}`;
  $("compareDialog").dataset.stem = stem;
  $("compareDialog").showModal();
}
function openAlbumPicker(stem) {
  const albums = Object.entries(state.albums).sort(([, a], [, b]) => a.created - b.created), here = albumOf(stem);
  $("compareTitle").textContent = (here ? "Move " : "Place ") + take(stem).title;
  $("compareBody").innerHTML = `<div class="session-options">${albums.map(([id, a]) => `<button class="session-row" data-place-dialog="${esc(id)}" ${here?.[0] === id ? "disabled" : ""}><b>${esc(a.name)}</b><small>${a.order.length} tracks${here?.[0] === id ? " · already here" : ""}</small></button>`).join("")}</div>
    ${here ? `<div class="scope-tools"><button class="btn small" data-unplace-dialog>Take it off ${esc(here[1].name)}</button></div>` : ""}`;
  $("compareDialog").dataset.stem = stem; $("compareDialog").showModal();
}

// ---------- events ----------
document.querySelector(".tabs").onclick = e => { const b = e.target.closest("[data-view]"); if (!b) return; ui.view = b.dataset.view; saveView(); render(); };
$("q").oninput = e => { ui.q = e.target.value.trim(); renderConsider(); };
$("sort").onchange = e => { ui.sort = e.target.value; ui.dir = ""; saveView(); renderConsider(); };
$("sortDir").onclick = () => { ui.dir = sortDir() === "desc" ? "asc" : "desc"; saveView(); renderConsider(); };
$("groupToggle").onclick = () => { ui.group = !ui.group; saveView(); renderConsider(); };
$("filterChips").onclick = e => { const b = e.target.closest("[data-f]"); if (b) { ui.filter = b.dataset.f; saveView(); renderConsider(); } };
$("toastUndo").onclick = undo;
function gotoSession(id) { ui.view = "sessions"; ui.session = id; saveView(); render(); if (innerWidth < 820) $("sessionDetail").scrollIntoView(); }
document.addEventListener("click", e => {
  const s = e.target.closest("[data-goto-session]"); if (s) { document.querySelectorAll("dialog[open]").forEach(d => d.close()); gotoSession(s.dataset.gotoSession); return; }
  const a = e.target.closest("[data-goto-album]"); if (a) { ui.view = "albums"; ui.album = a.dataset.gotoAlbum; saveView(); render(); }
});
$("considerList").onclick = e => {
  const g = e.target.closest("[data-compare-group]");
  if (g) { const stems = Object.keys(state.considered).filter(s => take(s).baseTitle === g.dataset.compareGroup); const id = newSession(g.dataset.compareGroup, stems); save(); toast("Session started: " + g.dataset.compareGroup); gotoSession(id); return; }
  const b = e.target.closest("[data-act]"); if (!b) return;
  const stem = b.closest("[data-stem]").dataset.stem;
  if (b.dataset.act === "delete") removeTake(stem);
  if (b.dataset.act === "compare") openCompare(stem);
  if (b.dataset.act === "album") openAlbumPicker(stem);
};
$("autoGroup").onclick = () => {
  const groups = new Map();
  for (const s of Object.keys(state.considered)) { if (sessionsOf(s).length || albumOf(s)) continue; const b = take(s).baseTitle; if (!groups.has(b)) groups.set(b, []); groups.get(b).push(s); }
  const multi = [...groups].filter(([, l]) => l.length > 1);
  if (!multi.length) { toast("No unsorted songs with two or more takes"); return; }
  if (!confirm(`Create ${multi.length} compare sessions, one per song with 2+ unsorted takes?\n\n${multi.map(([b, l]) => `${b} (${l.length})`).join("\n")}`)) return;
  snapshot(); for (const [b, l] of multi) newSession(b, l); save();
  toast(`${multi.length} sessions created`, true); ui.view = "sessions"; saveView(); render();
};
$("importOpen").onclick = openImport;
$("importClose").onclick = () => $("importDialog").close();
$("importSources").onclick = e => {
  const b = e.target.closest("[data-import]"); if (!b) return;
  const stems = JSON.parse($("importDialog").dataset.sources)[b.dataset.import] || [];
  const n = consider(stems); toast(`Added ${n} take${n === 1 ? "" : "s"}`); openImport();
};
$("pasteAdd").onclick = () => {
  const ids = [...new Set(($("pasteIds").value.match(UUID) || []).map(x => x.toLowerCase()))];
  const n = consider(ids), unknown = ids.filter(id => !TAKES[id]).length;
  $("pasteNote").textContent = `${ids.length} IDs found, ${n} added${unknown ? `, ${unknown} newer than this catalogue snapshot (they get a Suno link and a placeholder title)` : ""}.`;
  if (n) $("pasteIds").value = "";
};
$("catalogSearch").oninput = renderCatalog;
$("catalogAll").onchange = renderCatalog;
$("catalogResults").onchange = e => {
  const c = e.target.closest("[data-cat]"); if (!c) return;
  if (c.checked) consider([c.dataset.cat]); else if (state.considered[c.dataset.cat]) removeTake(c.dataset.cat);
};
$("compareCancel").onclick = () => $("compareDialog").close();
$("compareBody").onclick = e => {
  const stem = $("compareDialog").dataset.stem;
  if (e.target.closest("#compareCreate")) {
    const name = $("compareName").value.trim() || take(stem).baseTitle;
    const stems = [stem, ...($("compareSame")?.checked ? Object.keys(state.considered).filter(s => s !== stem && take(s).baseTitle === take(stem).baseTitle) : [])];
    const id = newSession(name, stems); save(); $("compareDialog").close(); toast("Session started: " + name); gotoSession(id); return;
  }
  const add = e.target.closest("[data-add-to]");
  if (add) { const s = state.sessions[add.dataset.addTo]; s.members = [...new Set([...s.members, stem])]; save(); $("compareDialog").close(); toast("Added to " + s.name); return; }
  const place = e.target.closest("[data-place-dialog]");
  if (place) { $("compareDialog").close(); placeOnAlbum(stem, place.dataset.placeDialog); return; }
  if (e.target.closest("[data-unplace-dialog]")) { for (const al of Object.values(state.albums)) al.order = al.order.filter(m => m !== stem); save(); $("compareDialog").close(); }
};

$("sessionList").onclick = e => {
  if (e.target.closest("#newEmptySession")) { const name = prompt("Session name"); if (name?.trim()) { const id = newSession(name.trim(), []); save(); gotoSession(id); } return; }
  const b = e.target.closest("[data-session]"); if (b) gotoSession(b.dataset.session);
};
$("sessionDetail").onclick = e => {
  const s = state.sessions[ui.session]; if (!s) return;
  if (e.target.closest("[data-back]")) { ui.session = ""; saveView(); renderSessions(); $("sessionList").scrollIntoView(); return; }
  const w = e.target.closest("[data-win]"); if (w) { pickWinner(ui.session, w.dataset.win); return; }
  const u = e.target.closest("[data-unsession]"); if (u) { s.members = s.members.filter(m => m !== u.dataset.unsession); if (s.winner === u.dataset.unsession) s.winner = null; save(); return; }
  const p = e.target.closest("[data-place]"); if (p) { placeOnAlbum(s.winner, p.dataset.place); return; }
  if (e.target.closest("#deleteSession")) { if (!confirm(`Delete session “${s.name}”? Its takes stay in Considered.`)) return; snapshot(); delete state.sessions[ui.session]; ui.session = ""; save(); toast("Session deleted", true); return; }
  if (e.target.closest("#dropLosers")) { snapshot(); const losers = s.members.filter(m => m !== s.winner); for (const m of losers) { delete state.considered[m]; for (const o of Object.values(state.sessions)) if (o !== s) o.members = o.members.filter(x => x !== m); for (const al of Object.values(state.albums)) al.order = al.order.filter(x => x !== m); } s.members = [s.winner]; save(); toast(`Dropped ${losers.length}`, true); return; }
  if (e.target.closest("#sessionAddMore")) {
    const box = $("sessionAdder"); box.classList.toggle("hidden");
    const options = Object.keys(state.considered).filter(m => !s.members.includes(m)).sort((a, b) => take(a).title.localeCompare(take(b).title, undefined, {numeric:true}));
    box.innerHTML = options.map(m => `<label class="session-option"><input type="checkbox" data-add-member="${esc(m)}"><span>${esc(take(m).title)} · ${esc(takeLabel(take(m)))}</span></label>`).join("") || `<p class="meta">Every considered take is already here.</p>`;
  }
};
$("sessionDetail").onchange = e => {
  const s = state.sessions[ui.session]; if (!s) return;
  const m = e.target.closest("[data-add-member]"); if (m && m.checked) { s.members = [...new Set([...s.members, m.dataset.addMember])]; save(); }
};
$("sessionDetail").addEventListener("change", e => {
  const s = state.sessions[ui.session]; if (!s) return;
  if (e.target.id === "sessionName" && e.target.value.trim()) { s.name = e.target.value.trim(); save(); }
  if (e.target.id === "sessionNote") { s.note = e.target.value; save(); }
});

$("albumChips").onclick = e => {
  if (e.target.closest("#newAlbum")) { const name = prompt("Album name", "Album " + (Object.keys(state.albums).length + 1)); if (name?.trim()) { const id = uid("a"); state.albums[id] = {name:name.trim(), created:Date.now(), order:[], target:12}; ui.album = id; saveView(); save(); } return; }
  const b = e.target.closest("[data-album]"); if (b) { ui.album = b.dataset.album; saveView(); renderAlbums(); }
};
$("albumHead").onclick = async e => {
  const a = state.albums[ui.album];
  if (e.target.closest("#copyAlbum")) toast(await copyText(a.name + "\n" + a.order.map((s, i) => `${i + 1}. ${take(s).baseTitle} (${take(s).title}, ${dur(take(s).duration)})`).join("\n")) ? "Tracklist copied" : "Copy failed");
  if (e.target.closest("#deleteAlbum")) { if (!confirm(`Delete “${a.name}”? Its tracks go back to Ready to place.`)) return; snapshot(); delete state.albums[ui.album]; ui.album = ""; save(); toast("Album deleted", true); }
};
$("albumHead").addEventListener("change", e => {
  const a = state.albums[ui.album];
  if (e.target.id === "albumName" && e.target.value.trim()) { a.name = e.target.value.trim(); save(); }
  if (e.target.id === "albumTarget") { a.target = Math.max(1, Math.min(40, Number(e.target.value) || 12)); save(); }
});
$("albumTracks").onclick = e => {
  const li = e.target.closest("[data-stem]"); if (!li) return;
  const a = state.albums[ui.album], i = a.order.indexOf(li.dataset.stem);
  const mv = e.target.closest("[data-move]");
  if (mv) { const j = i + Number(mv.dataset.move); if (j < 0 || j >= a.order.length) return; [a.order[i], a.order[j]] = [a.order[j], a.order[i]]; save(); return; }
  const to = e.target.closest("[data-to-album]"); if (to) { placeOnAlbum(li.dataset.stem, to.dataset.toAlbum); return; }
  if (e.target.closest("[data-unplace]")) { a.order.splice(i, 1); save(); }
};
let dragStem = null;
$("albumTracks").addEventListener("dragstart", e => { const li = e.target.closest("[data-stem]"); if (li) { dragStem = li.dataset.stem; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; } });
$("albumTracks").addEventListener("dragover", e => { if (dragStem) e.preventDefault(); });
$("albumTracks").addEventListener("drop", e => {
  e.preventDefault(); const li = e.target.closest("[data-stem]"), a = state.albums[ui.album];
  if (!dragStem || !li || li.dataset.stem === dragStem) return;
  const from = a.order.indexOf(dragStem); a.order.splice(from, 1);
  const rect = li.getBoundingClientRect(), to = a.order.indexOf(li.dataset.stem) + (e.clientY > rect.top + rect.height / 2 ? 1 : 0);
  a.order.splice(to, 0, dragStem); dragStem = null; save();
});
$("albumTracks").addEventListener("dragend", () => { dragStem = null; document.querySelectorAll(".dragging").forEach(x => x.classList.remove("dragging")); });
$("pool").onclick = e => { const b = e.target.closest("[data-place]"); if (b) placeOnAlbum(b.closest("[data-stem]").dataset.stem, b.dataset.place); };

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

// ---------- sync ----------
function syncStatus(text, failed = false) { $("syncStatus").textContent = text; $("syncStatus").classList.toggle("failed", failed); $("retrySyncBtn").hidden = !failed || !cloud; }
function initSync() {
  if (typeof firebase === "undefined" || !firebase.auth || !firebase.database) { syncStatus("Saved on this device. Account sync is unavailable offline."); return; }
  try {
    if (!firebase.apps.length) firebase.initializeApp({
      apiKey:"AIzaSyDTcQiFsjhSzlsEl7uPJvTtsxp798XOqIQ", authDomain:"family-planner-ccafc.firebaseapp.com",
      databaseURL:"https://family-planner-ccafc-default-rtdb.firebaseio.com", projectId:"family-planner-ccafc",
    });
    cloud = PlannerSync.create({firebase, AlbumSync, read:() => state,
      replace:next => { const editing = document.activeElement?.matches("textarea,input[type=text],input.title-edit"); state = next; previous = JSON.parse(JSON.stringify(state)); persist(); if (!editing) render(); else renderSummary(); },
      selectAccount:owner => {
        if (state._sync.owner === owner) return;
        let cached = null; try { cached = JSON.parse(localStorage.getItem(KEY + ".account." + owner)); } catch (err) {}
        // First sign-in on this device keeps the signed-out plan and merges it into the account.
        state = cached?._sync?.owner === owner ? PlannerSync.prepare(cached) : {...state, _sync:{...state._sync, owner}};
        previous = JSON.parse(JSON.stringify(state)); persist();
        const local = loadAudioLocal(owner); if (local) { audio = local; render(); }
      },
      status:syncStatus,
      account:(user, busy) => { $("accountWho").textContent = user ? (user.email || user.displayName || "") : ""; $("signInBtn").hidden = !!user || busy; $("signOutBtn").hidden = !user; },
      audio:next => { audio = next; render(); },
    });
    $("signInBtn").onclick = () => cloud.signIn();
    $("signOutBtn").onclick = () => cloud.signOut();
    $("retrySyncBtn").onclick = () => cloud.retry();
  } catch (err) { syncStatus("Account sync could not start. Your plan is saved on this device.", true); }
}

if (!Object.keys(state.albums).length) { ensureAlbums(); state = PlannerSync.capture(previous, state, deviceId); previous = JSON.parse(JSON.stringify(state)); persist(); }
render();
initSync();
window.addEventListener("storage", e => { if (e.key === AUDIO_KEY && !cloud) { audio = loadAudioLocal() || audio; render(); } });
