"use strict";
/* The Grind dashboard: clock, month calendar, weather, and CodexBar usage.

   Usage is written by scripts/usage-feed/push_usage.py on the Mac into a secret gist (one file,
   usage.json). FEED_GIST is that gist's id; ?feed=<url> overrides it for testing. The gist only
   holds percentages, reset times and plan names, because anyone with this page's source can read it. */
const FEED_USER = "scattabraingenius";
const FEED_GIST = "994158e57243b2b3faa16adc029f0e0d";
const FEED_FILE = "usage.json";
const FEED_POLL_MS = 2 * 60 * 1000;
const FEED_STALE_MS = 30 * 60 * 1000;   // the Mac pushes at least every 15 minutes while awake
const STORE_KEY = "grind.dashboard.v1";

if ("serviceWorker" in navigator) navigator.serviceWorker.register("../service-worker.js").catch(() => {});

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const prefs = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch {} };

/* ---------------- clock + calendar ---------------- */
let calDay = "";
function tickClock(){
  const now = new Date();
  const [hm, ampm] = now.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"}).split(" ");
  $("clockTime").innerHTML = esc(hm) + (ampm ? `<span class="ampm">${esc(ampm)}</span>` : "");
  $("clockDate").textContent = now.toLocaleDateString([], {weekday:"long", month:"long", day:"numeric"});
  const day = now.toDateString();
  if(day !== calDay){ calDay = day; renderCalendar(now); }
}
function renderCalendar(now){
  $("calMonth").textContent = now.toLocaleDateString([], {month:"long", year:"numeric"});
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  let html = ["S","M","T","W","T","F","S"].map(d => `<div class="dow">${d}</div>`).join("");
  for(let i = 0; i < 42; i++){
    const d = new Date(start); d.setDate(start.getDate() + i);
    if(i === 35 && d.getMonth() !== now.getMonth()) break;   // drop an all-next-month last row
    const cls = d.getMonth() !== now.getMonth() ? " out" : d.toDateString() === now.toDateString() ? " today" : "";
    html += `<div class="d${cls}">${d.getDate()}</div>`;
  }
  $("calGrid").innerHTML = html;
}

/* ---------------- weather (Open-Meteo, no key) ---------------- */
const WMO = [[0,"☀️","Clear"],[1,"🌤️","Mostly clear"],[2,"⛅","Partly cloudy"],[3,"☁️","Cloudy"],[45,"🌫️","Fog"],[48,"🌫️","Fog"],
  [51,"🌦️","Drizzle"],[53,"🌦️","Drizzle"],[55,"🌧️","Drizzle"],[56,"🌧️","Freezing drizzle"],[57,"🌧️","Freezing drizzle"],
  [61,"🌧️","Light rain"],[63,"🌧️","Rain"],[65,"🌧️","Heavy rain"],[66,"🌨️","Freezing rain"],[67,"🌨️","Freezing rain"],
  [71,"🌨️","Light snow"],[73,"🌨️","Snow"],[75,"❄️","Heavy snow"],[77,"🌨️","Snow grains"],[80,"🌦️","Showers"],[81,"🌧️","Showers"],
  [82,"⛈️","Heavy showers"],[85,"🌨️","Snow showers"],[86,"🌨️","Snow showers"],[95,"⛈️","Thunderstorm"],[96,"⛈️","Thunderstorm"],[99,"⛈️","Thunderstorm"]];
const wmo = code => { const m = WMO.find(w => w[0] === code) || [0,"🌡️","—"]; return {icon:m[1], text:m[2]}; };
const units = () => prefs.units === "c" ? "c" : "f";

function weatherSetup(msg){
  $("wxPlace").textContent = "Weather";
  $("wxBody").innerHTML = `<div class="wx-setup">${msg ? `<span>${esc(msg)}</span>` : ""}
    <button type="button" id="wxLocate">Use my location</button>
    <input id="wxCity" type="search" placeholder="or type a city" aria-label="City">
  </div>`;
  $("wxLocate").onclick = () => navigator.geolocation.getCurrentPosition(
    pos => { prefs.place = {name:"My location", lat:+pos.coords.latitude.toFixed(3), lon:+pos.coords.longitude.toFixed(3)}; savePrefs(); loadWeather(); },
    () => weatherSetup("Location was blocked."), {timeout:10000});
  $("wxCity").onkeydown = async e => {
    if(e.key !== "Enter" || !e.target.value.trim()) return;
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(e.target.value.trim())}`).then(r => r.json());
      const g = r.results && r.results[0];
      if(!g) return weatherSetup("No city by that name.");
      prefs.place = {name:g.name, lat:g.latitude, lon:g.longitude}; savePrefs(); loadWeather();
    } catch { weatherSetup("Could not reach the weather service."); }
  };
}
async function loadWeather(){
  $("wxUnits").textContent = units() === "c" ? "°C" : "°F";
  const p = prefs.place;
  if(!p) return weatherSetup();
  try {
    const q = new URLSearchParams({latitude:p.lat, longitude:p.lon, timezone:"auto", forecast_days:"5",
      current:"temperature_2m,weather_code", daily:"weather_code,temperature_2m_max,temperature_2m_min",
      temperature_unit: units() === "c" ? "celsius" : "fahrenheit"});
    const w = await fetch("https://api.open-meteo.com/v1/forecast?" + q).then(r => { if(!r.ok) throw 0; return r.json(); });
    const now = wmo(w.current.weather_code), d = w.daily, r = Math.round;
    $("wxPlace").innerHTML = `${esc(p.name)} <button type="button" class="chip" id="wxChange" title="Change place">Change</button>`;
    $("wxChange").onclick = () => { delete prefs.place; savePrefs(); weatherSetup(); };
    $("wxBody").innerHTML = `<div class="wx-now"><div class="wx-temp">${r(w.current.temperature_2m)}°</div>
        <div class="wx-icon" aria-hidden="true">${now.icon}</div>
        <div><div class="wx-cond">${now.text}</div><div class="wx-hilo">H ${r(d.temperature_2m_max[0])}° · L ${r(d.temperature_2m_min[0])}°</div></div></div>
      <div class="wx-days">${d.time.map((t, i) => { const c = wmo(d.weather_code[i]);
        const name = i ? new Date(t + "T12:00").toLocaleDateString([], {weekday:"short"}) : "Today";
        return `<div><div class="day">${name}</div><div class="ic" title="${c.text}">${c.icon}</div><div>${r(d.temperature_2m_max[i])}° <span class="lo">${r(d.temperature_2m_min[i])}°</span></div></div>`; }).join("")}</div>`;
  } catch { $("wxBody").innerHTML = `<div class="empty">Weather is unavailable right now.</div>`; }
}
$("wxUnits").onclick = () => { prefs.units = units() === "c" ? "f" : "c"; savePrefs(); loadWeather(); };

/* ---------------- usage feed ---------------- */
const PROVIDER_COLOR = {claude:"var(--claude)", codex:"var(--codex)"};
let feed = null, feedError = "";

function feedUrls(){
  const override = new URLSearchParams(location.search).get("feed");
  if(override) return [{url:override, raw:true}];
  if(!FEED_GIST) return [];
  // The API answers fresh data; a browser revalidation that comes back 304 does not use up the
  // 60-an-hour anonymous limit. The raw file is the fallback when the limit is hit anyway.
  return [{url:`https://api.github.com/gists/${FEED_GIST}`},
          {url:`https://gist.githubusercontent.com/${FEED_USER}/${FEED_GIST}/raw/${FEED_FILE}?t=${Date.now()}`, raw:true}];
}
async function loadFeed(){
  const urls = feedUrls();
  if(!urls.length){ feedError = "setup"; return renderUsage(); }
  for(const {url, raw} of urls){
    try {
      const r = await fetch(url, {cache:"no-cache"});
      if(!r.ok) throw new Error(r.status);
      const body = await r.json();
      feed = raw ? body : JSON.parse(body.files[FEED_FILE].content);
      feedError = "";
      return renderUsage();
    } catch(e) { feedError = "unreachable"; }
  }
  renderUsage();
}

function fmtLeft(ms){
  if(ms <= 0) return "now";
  const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
}
function fmtAgo(ms){ const m = Math.round(ms / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${fmtLeft(ms)} ago`; }

/* Expected use so far if spending evenly across the window. */
function expectedUsed(win, now){
  const end = Date.parse(win.resetsAt), span = win.windowMinutes * 60000;
  return Math.max(0, Math.min(100, 100 * (1 - (end - now) / span)));
}
function paceOf(win, now){
  const exp = win.pace?.expectedUsedPercent ?? Math.round(expectedUsed(win, now));
  const delta = win.pace?.deltaPercent ?? (win.usedPercent - exp);
  if(win.pace && win.pace.willLastToReset === false) return {cls:"bad", text:"⚠ Runs out before reset", exp};
  if(delta <= -3) return {cls:"good", text:`▼ ${-delta}% in reserve`, exp};
  if(delta >= 3) return {cls:"warn", text:`▲ ${delta}% over pace`, exp};
  return {cls:"", text:"● On pace", exp};
}

function usageCard(el, p, now){
  const id = el.dataset.provider, name = id === "claude" ? "Claude" : "Codex";
  el.style.setProperty("--pc", PROVIDER_COLOR[id]);
  const head = plan => `<div class="prov"><span class="prov-dot"></span><span class="prov-name">${name}</span>${plan ? `<span class="prov-plan">${esc(plan)}</span>` : ""}</div>`;
  if(feedError === "setup"){ el.innerHTML = head() + `<div class="empty">The usage feed is not connected yet. On the Mac, run <code>scripts/usage-feed/install.sh</code>, then put the gist id in <code>dashboard/dashboard.js</code>.</div>`; return; }
  if(!p){ el.innerHTML = head() + `<div class="empty">${feedError ? "Could not load the usage feed." : "Loading…"}</div>`; return; }
  if(p.error){ el.innerHTML = head() + `<div class="empty">CodexBar could not read ${name}: ${esc(p.error)}</div>`; return; }
  let html = head(p.plan);
  for(const w of p.windows){
    const pace = paceOf(w, now), resetMs = Date.parse(w.resetsAt) - now;
    html += `<div class="win">
      <div class="win-top"><span class="win-label">${esc(w.label)}</span><span class="win-pct">${w.usedPercent}% <small>used</small></span></div>
      <div class="bar" role="img" aria-label="${w.usedPercent}% used, ${pace.exp}% expected by now">
        <div class="bar-fill" style="width:${Math.min(100, w.usedPercent)}%"></div>
        <div class="bar-pace" style="left:calc(${pace.exp}% - 1px)" title="Even pace: ${pace.exp}% by now"></div></div>
      <div class="win-meta"><span class="pace ${pace.cls}">${pace.text}</span><span>Resets in ${fmtLeft(resetMs)}</span></div>
    </div>`;
  }
  const extras = [];
  if(p.resetCredits) extras.push(`${p.resetCredits.available} free reset${p.resetCredits.available === 1 ? "" : "s"} · next expires in ${fmtLeft(Date.parse(p.resetCredits.nextExpiresAt) - now)}`);
  if(p.extra) extras.push(`Extra usage: ${p.extra.used} of ${p.extra.limit} ${esc(p.extra.currencyCode)}`);
  if(extras.length) html += `<div class="extra">${extras.join("<br>")}</div>`;
  el.innerHTML = html;
}

/* ---------------- burn-down ---------------- */
const W = 320, H = 150, PL = 28, PR = 8, PT = 8, PB = 20;

/* "% left" samples inside this window, ending with the live value. */
function windowPoints(p, w, history, now){
  const end = Date.parse(w.resetsAt), start = end - w.windowMinutes * 60000;
  const pts = history.filter(h => { const t = Date.parse(h.t); return t >= start && t <= now && h.u[p.id]?.[w.key] != null; })
                     .map(h => ({t:Date.parse(h.t), left:100 - h.u[p.id][w.key]}));
  pts.push({t:now, left:100 - w.usedPercent});
  return pts;
}

function burnChart(p, w, pts, now){
  const end = Date.parse(w.resetsAt), start = end - w.windowMinutes * 60000;
  const x = t => PL + (t - start) / (end - start) * (W - PL - PR);
  const y = left => PT + (100 - left) / 100 * (H - PT - PB);
  const weekly = w.windowMinutes >= 1440;
  const ticks = [];
  const tickFmt = t => weekly ? new Date(t).toLocaleDateString([], {weekday:"short"}) : new Date(t).toLocaleTimeString([], {hour:"numeric"});
  for(let i = 0; i <= 4; i++){ const t = start + (end - start) * i / 4; ticks.push(`<text class="axis" x="${x(t)}" y="${H - 5}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}">${i === 4 ? "reset" : tickFmt(t)}</text>`); }
  const grid = [0, 50, 100].map(v => `<line class="grid-line" x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${PL - 5}" y="${y(v) + 3}" text-anchor="end">${v}%</text>`).join("");
  // Usage only moves up between samples, so draw steps rather than slopes.
  let d = `M${x(pts[0].t)},${y(pts[0].left)}`;
  for(let i = 1; i < pts.length; i++) d += ` H${x(pts[i].t)} V${y(pts[i].left)}`;
  const last = pts[pts.length - 1];
  const area = `${d} V${y(0)} H${x(pts[0].t)} Z`;
  const pace = paceOf(w, now);
  const label = `${p.name} ${w.label}: ${last.left}% left, ${fmtLeft(end - now)} until reset. ${pace.text.slice(2)}.`;
  const rows = pts.map(q => `<tr><td>${new Date(q.t).toLocaleString()}</td><td>${q.left}% left</td></tr>`).join("");
  return `<div class="chart" style="--pc:${PROVIDER_COLOR[p.id]}" data-start="${start}" data-end="${end}">
    <div class="chart-head"><b>${esc(p.name)} · ${esc(w.label)}</b><span class="pace ${pace.cls}">${last.left}% left</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      ${grid}${ticks.join("")}
      <line class="pace-line" x1="${x(start)}" y1="${y(100)}" x2="${x(end)}" y2="${y(0)}"/>
      <path class="used-area" d="${area}"/><path class="used-line" d="${d}"/>
      <circle class="now-dot" cx="${x(last.t)}" cy="${y(last.left)}" r="4"/>
      ${pts.length < 3 ? `<text class="hint" x="${x(last.t) > W / 2 ? x(last.t) - 8 : x(last.t) + 8}" y="${y(last.left) + (last.left > 80 ? 16 : -8)}" text-anchor="${x(last.t) > W / 2 ? "end" : "start"}">history builds as the feed runs</text>` : ""}
      <line class="xhair" y1="${PT}" y2="${H - PB}" visibility="hidden"/>
    </svg>
    <div class="tip" hidden></div>
    <div class="legend"><span><i></i>% left</span><span><i class="dash"></i>even pace</span></div>
    <div class="sr"><table><caption>${esc(label)}</caption>${rows}</table></div>
  </div>`;
}

function wireChart(el, pts, w){
  const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), hair = el.querySelector(".xhair");
  const start = +el.dataset.start, end = +el.dataset.end;
  const toT = px => start + (px - PL) / (W - PL - PR) * (end - start);
  svg.addEventListener("pointermove", e => {
    const box = svg.getBoundingClientRect(), vx = (e.clientX - box.left) / box.width * W;
    const t = toT(vx);
    if(t < start || t > Math.max(...pts.map(q => q.t))) return hide();
    let q = pts[0]; for(const c of pts) if(c.t <= t) q = c;   // the step that covers this moment
    const even = Math.max(0, Math.round(100 - expectedUsed(w, t)));
    hair.setAttribute("x1", vx); hair.setAttribute("x2", vx); hair.setAttribute("visibility", "visible");
    tip.hidden = false; tip.style.left = (vx / W * 100) + "%"; tip.style.top = "38px";
    tip.textContent = `${new Date(t).toLocaleString([], {weekday:"short", hour:"numeric", minute:"2-digit"})} · ${q.left}% left (pace ${even}%)`;
  });
  const hide = () => { tip.hidden = true; hair.setAttribute("visibility", "hidden"); };
  svg.addEventListener("pointerleave", hide);
}

function renderUsage(){
  const now = Date.now();
  const byId = Object.fromEntries((feed?.providers || []).map(p => [p.id, p]));
  document.querySelectorAll(".usage").forEach(el => usageCard(el, byId[el.dataset.provider], now));

  const age = feed?.checkedAt ? now - Date.parse(feed.checkedAt) : null;
  $("feedAge").textContent = age == null ? "" : age > FEED_STALE_MS ? `Last update ${fmtAgo(age)}. Is the Mac asleep?` : `Updated ${fmtAgo(age)}`;
  $("feedAge").classList.toggle("pace", age > FEED_STALE_MS); $("feedAge").classList.toggle("warn", age > FEED_STALE_MS);

  const row = $("burnRow"), charts = [];
  for(const id of ["claude", "codex"]){ const p = byId[id]; if(p && !p.error) for(const w of p.windows) charts.push([p, w]); }
  if(!charts.length){ row.innerHTML = `<div class="empty">${feedError === "setup" ? "Charts appear once the usage feed is connected." : feedError ? "Could not load the usage feed." : "Loading…"}</div>`; return; }
  const history = feed.history || [];
  const series = charts.map(([p, w]) => windowPoints(p, w, history, now));
  row.innerHTML = charts.map(([p, w], i) => burnChart(p, w, series[i], now)).join("");
  row.querySelectorAll(".chart").forEach((el, i) => wireChart(el, series[i], charts[i][1]));
}

/* ---------------- start ---------------- */
tickClock(); setInterval(tickClock, 1000);
loadWeather(); setInterval(loadWeather, 30 * 60 * 1000);
loadFeed(); setInterval(loadFeed, FEED_POLL_MS);
setInterval(renderUsage, 60 * 1000);   // keep "resets in" and the now-dot moving between fetches
document.addEventListener("visibilitychange", () => { if(!document.hidden){ loadFeed(); tickClock(); } });
