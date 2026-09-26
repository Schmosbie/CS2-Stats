// CS2-Stats-Seite: liest data/history.json, data/stats.json und data/tips.json
// und baut daraus die 5 Reiter. Kein Build-Schritt nötig.

const DAY = 24 * 60 * 60 * 1000;
const RECENT_N = 10; // "Aktuelle Form" = die letzten 10 Matches (Tipps-Reiter)

let H;      // history.json
let STATS;  // stats.json -> stats
let TIPS;   // tips.json
let MATCHES = []; // alle Matches, alt -> neu
let REF;    // Zeitpunkt des letzten erfolgreichen Updates (Ende von "diese Woche")
const charts = [];

// ---------- Hilfsfunktionen ----------

const $ = (id) => document.getElementById(id);
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const std = (arr) => {
  const m = mean(arr);
  return arr.length > 1 ? Math.sqrt(mean(arr.map((v) => (v - m) ** 2))) : null;
};
const fmtDate = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtShort = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function mapName(raw) {
  const n = String(raw || '?').replace(/^(de|cs|ar)_/, '');
  return n.charAt(0).toUpperCase() + n.slice(1);
}

// ---------- Werte aus Matches ----------

// Wert eines Stats für ein einzelnes Match (oder null).
function matchValue(stat, m) {
  const src = stat.match;
  if (typeof src === 'string') return isNum(m.s[src]) ? m.s[src] : null;
  if (src.type === 'winrate') return m.result === 'W' ? 1 : m.result === 'L' ? 0 : 0.5;
  const num = m.s[src.num], den = m.s[src.den];
  return isNum(num) && isNum(den) && den > 0 ? num / den : null;
}

// Wert eines Stats über mehrere Matches (Durchschnitt bzw. Summe/Summe).
function aggregate(stat, list) {
  const src = stat.match;
  if (typeof src === 'object' && src.num) {
    let num = 0, den = 0;
    for (const m of list) {
      if (isNum(m.s[src.num]) && isNum(m.s[src.den])) { num += m.s[src.num]; den += m.s[src.den]; }
    }
    return den > 0 ? num / den : null;
  }
  return mean(list.map((m) => matchValue(stat, m)).filter(isNum));
}

// Matches im Fenster "k Wochen vor dem letzten Update" (k=0: letzte 7 Tage).
function weekMatches(k) {
  const end = REF - k * 7 * DAY, start = end - 7 * DAY;
  return MATCHES.filter((m) => { const t = Date.parse(m.date); return t > start && t <= end; });
}

// ---------- Einheiten ----------
// Die API liefert manche Werte als Anteil (0.42), andere als Prozent (42).
// Das wird pro Stat anhand der echten Werte erkannt.
function scaleFor(format, values) {
  const max = Math.max(0, ...values.filter(isNum).map(Math.abs));
  if (format === 'pct') return max <= 1 ? 100 : 1;
  if (format === 'ms') return max > 0 && max < 10 ? 1000 : 1;
  if (format === 'rating') return max > 0 && max < 1.5 ? 100 : 1;
  return 1;
}

function fmt(stat, v, { delta = false } = {}) {
  if (!isNum(v)) return '–';
  const sign = delta && v > 0 ? '+' : '';
  switch (stat.format) {
    case 'int': return sign + Math.round(v).toLocaleString('de-DE');
    case 'pct': return sign + v.toFixed(1).replace('.', ',') + (delta ? ' %-Pkt.' : ' %');
    case 'ms': return sign + Math.round(v) + ' ms';
    case 'sec': return sign + v.toFixed(2).replace('.', ',') + ' s';
    case 'deg': return sign + v.toFixed(1).replace('.', ',') + '°';
    case 'rating': return (v > 0 ? '+' : '') + v.toFixed(2).replace('.', ',');
    case 'dec2': return sign + v.toFixed(2).replace('.', ',');
    default: return sign + v.toFixed(1).replace('.', ',');
  }
}

// ---------- Auswertung eines Stats ----------
// Ergebnis: aktueller Wert, Vorwoche, Verlauf, Profilwert von Leetify usw.
const cache = {};
function evalStat(key) {
  if (cache[key]) return cache[key];
  const stat = STATS[key];
  const r = { key, stat, series: [], current: null, previous: null, z: null, profileValue: null };

  if (stat.profile) {
    const snaps = H.snapshots.map((s) => ({ date: s.date, v: get(s, stat.profile) })).filter((p) => isNum(p.v));
    const sc = scaleFor(stat.format, snaps.map((p) => p.v));
    snaps.forEach((p) => (p.v *= sc));
    r.snapSeries = snaps;
    r.profileValue = snaps.length ? snaps[snaps.length - 1].v : null;
  }

  if (stat.match && MATCHES.length) {
    // Verlauf: ein Punkt pro Woche, aus den Matches berechnet.
    const perMatch = MATCHES.map((m) => matchValue(stat, m)).filter(isNum);
    // Selbst berechnete Anteile (Summe/Summe, Winrate) sind immer 0–1.
    const computed = typeof stat.match === 'object';
    const sc = computed ? (stat.format === 'pct' ? 100 : 1) : scaleFor(stat.format, perMatch);
    r.scale = sc;
    r.spread = (std(perMatch) || 0) * sc;
    const weeks = Math.min(104, Math.ceil((REF - Date.parse(MATCHES[0].date)) / (7 * DAY)));
    for (let k = weeks; k >= 0; k--) {
      const list = weekMatches(k);
      const v = aggregate(stat, list);
      r.series.push({ date: REF - (k + 1) * 7 * DAY, v: isNum(v) ? v * sc : null, n: list.length });
    }
    const cur = r.series[r.series.length - 1], prev = r.series[r.series.length - 2];
    r.current = cur?.v ?? null; r.nCur = cur?.n ?? 0;
    r.previous = prev?.v ?? null; r.nPrev = prev?.n ?? 0;
    r.source = 'match';
  } else if (r.snapSeries) {
    // Nur Leetify-Profilwert vorhanden: Verlauf aus den wöchentlichen Snapshots.
    const s = r.snapSeries;
    r.series = s.map((p) => ({ date: Date.parse(p.date), v: p.v }));
    r.current = r.profileValue;
    const last = s.length ? Date.parse(s[s.length - 1].date) : 0;
    const older = s.filter((p) => Date.parse(p.date) <= last - 5 * DAY);
    r.previous = older.length ? older[older.length - 1].v : null;
    r.source = 'profile';
  }

  if (isNum(r.current) && isNum(r.previous)) {
    r.delta = r.current - r.previous;
    const dir = stat.better === 'low' ? -1 : 1;
    // "z" = Veränderung im Verhältnis zu deiner normalen Schwankung von Match zu Match.
    if (r.source === 'match' && r.spread > 0) r.z = (dir * r.delta) / r.spread;
  }
  return (cache[key] = r);
}

// Pfeil + Veränderung. Grün = besser, rot = schlechter (bei "better: low" umgekehrt).
function deltaHtml(r) {
  if (!isNum(r.delta)) {
    return `<span class="delta flat">${r.source === 'profile' ? 'noch kein Vorwochen-Wert' : 'kein Vergleich (keine Matches)'}</span>`;
  }
  const dir = r.stat.better === 'low' ? -1 : 1;
  const good = dir * r.delta > 0, same = Math.abs(r.delta) < 1e-9;
  const cls = same ? 'flat' : good ? 'up' : 'down';
  const arrow = same ? '●' : r.delta > 0 ? '▲' : '▼';
  return `<span class="delta ${cls}" title="Veränderung zur Vorwoche">${arrow} ${fmt(r.stat, r.delta, { delta: true })}</span>`;
}

// ---------- Diagramme ----------

function lineChart(canvas, r, color) {
  const pts = r.series;
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: pts.map((p) => fmtShort(p.date)),
      datasets: [{
        data: pts.map((p) => p.v),
        borderColor: color, backgroundColor: color,
        borderWidth: 2, pointRadius: pts.length > 20 ? 2 : 4, pointHoverRadius: 6,
        tension: 0.25, spanGaps: true,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const p = pts[items[0].dataIndex];
              return r.source === 'match' ? `Woche ab ${fmtDate(p.date)}` : `Snapshot ${fmtDate(p.date)}`;
            },
            label: (item) => {
              const p = pts[item.dataIndex];
              return ` ${fmt(r.stat, p.v)}` + (p.n != null ? ` (${p.n} Matches)` : '');
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 } },
        y: { grid: { color: 'rgba(255,255,255,.06)' }, ticks: { maxTicksLimit: 5 } },
      },
    },
  });
  charts.push(chart);
}

function chartCard(key, color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()) {
  const r = evalStat(key);
  const card = document.createElement('div');
  card.className = 'chart-card';
  const valid = r.series.filter((p) => isNum(p.v)).length;
  const profileLine = r.source === 'match' && isNum(r.profileValue)
    ? `<div class="leetify-val">Leetify-Profilwert: ${fmt(r.stat, r.profileValue)}</div>` : '';
  const sourceLine = r.source === 'profile' ? 'Leetify-Profilwert, Verlauf aus wöchentlichen Snapshots' : (r.stat.desc || '');
  card.innerHTML = `
    <header><h3>${esc(r.stat.label)}</h3>${deltaHtml(r)}</header>
    <div class="big">${fmt(r.stat, r.current)}</div>
    ${profileLine}
    <div class="desc">${esc(sourceLine)}${r.stat.better === 'low' ? ' · niedriger ist besser' : ''}</div>
    ${valid >= 2 ? '<div class="canvas-box"><canvas></canvas></div>'
      : `<div class="empty">${r.source === 'profile' ? 'Der Verlauf startet mit dem nächsten wöchentlichen Update.' : 'Noch zu wenig Daten für einen Verlauf.'}</div>`}`;
  if (valid >= 2) requestAnimationFrame(() => lineChart(card.querySelector('canvas'), r, color));
  return card;
}

// ---------- Reiter 1: Übersicht ----------

function renderOverview(cfg) {
  const kpis = $('kpis');
  for (const key of cfg.overview) {
    const r = evalStat(key);
    const sub = r.source === 'match' ? `${r.nCur} Matches (letzte 7 Tage)` : r.source === 'profile' ? 'aktueller Stand' : 'keine Daten';
    kpis.insertAdjacentHTML('beforeend', `
      <div class="kpi">
        <div class="label">${esc(r.stat.label)}</div>
        <div class="value">${fmt(r.stat, r.current)}</div>
        ${deltaHtml(r)}
        <div class="sub">${sub}</div>
      </div>`);
  }

  // Besser / schlechter diese Woche
  const all = Object.keys(STATS).map(evalStat).filter((r) => isNum(r.z) && r.nCur > 0 && r.nPrev > 0);
  const better = all.filter((r) => r.z > 0.15).sort((a, b) => b.z - a.z).slice(0, 4);
  const worse = all.filter((r) => r.z < -0.15).sort((a, b) => a.z - b.z).slice(0, 4);
  const li = (r) => `<li>${esc(r.stat.label)}: ${fmt(r.stat, r.previous)} → <b>${fmt(r.stat, r.current)}</b></li>`;
  const cur = weekMatches(0).length, prev = weekMatches(1).length;
  let body;
  if (!cur || !prev) {
    body = `<p class="note">Für einen Wochenvergleich brauchst du Matches in beiden Wochen (letzte 7 Tage: ${cur}, Woche davor: ${prev}).</p>`;
  } else {
    body = `<div class="summary-cols">
      <div><h3 class="good">▲ Besser bei</h3>${better.length ? `<ul>${better.map(li).join('')}</ul>` : '<p class="note">Keine deutliche Verbesserung.</p>'}</div>
      <div><h3 class="bad">▼ Schlechter bei</h3>${worse.length ? `<ul>${worse.map(li).join('')}</ul>` : '<p class="note">Nichts ist deutlich schlechter geworden.</p>'}</div>
    </div>`;
  }
  $('summary').innerHTML = `<h2>Diese Woche</h2>
    <p class="note">Letzte 7 Tage (${cur} Matches) im Vergleich zur Woche davor (${prev} Matches). Gezeigt werden die deutlichsten Veränderungen,
    gemessen an deiner normalen Schwankung von Match zu Match.</p>${body}`;

  // Letzte Matches
  const S = (k) => STATS[k];
  const rows = MATCHES.slice(-10).reverse().map((m) => {
    const hs = m.s.total_kills > 0 ? (m.s.total_hs_kills / m.s.total_kills) * 100 : null;
    const adr = m.s.rounds_count > 0 ? m.s.total_damage / m.s.rounds_count : null;
    const rating = isNum(m.s.leetify_rating) ? m.s.leetify_rating * (evalStat('leetify').scale || 1) : null;
    return `<tr><td>${fmtDate(m.date)}</td><td>${esc(mapName(m.map))}</td>
      <td class="res ${m.result}">${{ W: 'Sieg', L: 'Niederlage', T: 'Unentsch.' }[m.result]}</td>
      <td class="num">${m.score.join(':')}</td>
      <td class="num">${m.s.total_kills ?? '–'}/${m.s.total_deaths ?? '–'}/${m.s.total_assists ?? '–'}</td>
      <td class="num">${fmt(S('adr'), adr)}</td><td class="num">${fmt(S('hs'), hs)}</td>
      <td class="num">${fmt(S('leetify'), rating)}</td></tr>`;
  });
  $('recent-matches').innerHTML = rows.length
    ? `<thead><tr><th>Datum</th><th>Map</th><th>Ergebnis</th><th class="num">Score</th><th class="num">K/D/A</th>
       <th class="num">ADR</th><th class="num">HS %</th><th class="num">Rating</th></tr></thead><tbody>${rows.join('')}</tbody>`
    : '<tr><td>Noch keine Matches gespeichert.</td></tr>';
}

// ---------- Reiter 2: Kernwerte ----------

function renderCore() {
  const box = $('core-charts');
  const colors = { ct_rating: '--ct' };
  const css = getComputedStyle(document.documentElement);
  for (const [key, stat] of Object.entries(STATS)) {
    if (stat.group !== 'core') continue;
    box.appendChild(chartCard(key, css.getPropertyValue(colors[key] || '--accent').trim()));
  }
  const first = H.snapshots[0];
  $('core-note').textContent =
    'Aim, Positioning, Utility, Clutch und Opening liefert Leetify nur als aktuellen Profilwert. Ihr Verlauf entsteht aus den wöchentlichen Snapshots' +
    (first ? ` (erster Snapshot: ${fmtDate(first.date)})` : '') +
    '. CT- und T-Rating werden zusätzlich pro Woche aus deinen Matches berechnet.';
}

// ---------- Reiter 3: Detail-Stats ----------

function renderDetails() {
  const groups = { aim: 'Aim', utility: 'Utility', teamplay: 'Teamplay', positioning: 'Positioning' };
  const box = $('detail-groups');
  for (const [g, title] of Object.entries(groups)) {
    const keys = Object.keys(STATS).filter((k) => STATS[k].group === g);
    if (!keys.length) continue;
    box.insertAdjacentHTML('beforeend', `<h2 class="group-title">${title}</h2>`);
    const grid = document.createElement('div');
    grid.className = 'charts';
    keys.forEach((k) => grid.appendChild(chartCard(k)));
    box.appendChild(grid);
  }
}

// ---------- Reiter 4: Maps ----------

function renderMaps() {
  const byMap = {};
  for (const m of MATCHES) (byMap[m.map] ??= []).push(m);
  const S = (k) => STATS[k];
  const val = (k, list) => {
    const v = aggregate(S(k), list);
    return isNum(v) ? v * (evalStat(k).scale || 1) : null;
  };
  const cards = Object.entries(byMap).sort((a, b) => b[1].length - a[1].length).map(([map, list]) => {
    const w = list.filter((m) => m.result === 'W').length, l = list.filter((m) => m.result === 'L').length;
    const wr = val('winrate', list);
    return `<div class="map-card">
      <h3>${esc(mapName(map))}</h3>
      <div class="count">${list.length} Matches · ${w} S / ${l} N${list.length - w - l ? ` / ${list.length - w - l} U` : ''}</div>
      <div class="winbar" title="Winrate"><div style="width:${wr ?? 0}%"></div></div>
      <div class="map-stats">
        <span>Winrate</span><b>${fmt(S('winrate'), wr)}</b>
        <span>K/D</span><b>${fmt(S('kd'), val('kd', list))}</b>
        <span>ADR</span><b>${fmt(S('adr'), val('adr', list))}</b>
        <span>HS %</span><b>${fmt(S('hs'), val('hs', list))}</b>
        <span>Leetify-Rating</span><b>${fmt(S('leetify'), val('leetify', list))}</b>
        <span>Trade-Kills</span><b>${fmt(S('trade_kills'), val('trade_kills', list))}</b>
      </div>
    </div>`;
  });
  $('map-grid').innerHTML = cards.join('') || '<p class="note">Noch keine Matches gespeichert.</p>';
}

// ---------- Reiter 5: Tipps ----------

function tipCard(r, why) {
  const tips = (TIPS[r.key] || TIPS._default || []).slice(0, 3);
  return `<div class="tip">
    <h3>${esc(r.stat.label)}</h3>
    <div class="why">${why}</div>
    <ol>${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
  </div>`;
}

function renderTips() {
  const matchStats = Object.keys(STATS).filter((k) => STATS[k].match).map(evalStat).filter((r) => r.spread > 0);

  // 1) Schwächste Werte: aktuelle Form (letzte 10 Matches) im Vergleich zu deinem Durchschnitt.
  const recent = MATCHES.slice(-RECENT_N);
  const weak = matchStats.map((r) => {
    const cur = aggregate(r.stat, recent), avg = aggregate(r.stat, MATCHES);
    if (!isNum(cur) || !isNum(avg)) return null;
    const dir = r.stat.better === 'low' ? -1 : 1;
    return { r, cur: cur * r.scale, avg: avg * r.scale, z: (dir * (cur - avg) * r.scale) / r.spread };
  }).filter(Boolean).sort((a, b) => a.z - b.z).slice(0, 3);

  $('tips-weak').innerHTML = MATCHES.length < RECENT_N * 2
    ? `<p class="note">Dafür brauche ich mindestens ${RECENT_N * 2} gespeicherte Matches (aktuell: ${MATCHES.length}).</p>`
    : weak.map(({ r, cur, avg, z }) => tipCard(r,
      `Letzte ${RECENT_N} Matches: <b>${fmt(r.stat, cur)}</b> · dein Durchschnitt: ${fmt(r.stat, avg)}` +
      (z >= 0 ? ' (sogar etwas besser als dein Schnitt, aber relativ gesehen dein schwächster Bereich)' : ''))).join('');

  // 2) Am stärksten gefallen: letzte 7 Tage vs. Woche davor.
  //    Zu wenig Matches (< 2 pro Woche)? Dann letzte 5 vs. die 5 davor.
  const weekly = weekMatches(0).length >= 2 && weekMatches(1).length >= 2;
  let label, drops;
  if (weekly) {
    label = 'letzte 7 Tage vs. Woche davor';
    drops = matchStats.filter((r) => isNum(r.z)).map((r) => ({ r, a: r.previous, b: r.current, z: r.z }));
  } else {
    label = 'letzte 5 Matches vs. die 5 davor (zu wenig Matches für einen Wochenvergleich)';
    const a = MATCHES.slice(-10, -5), b = MATCHES.slice(-5);
    drops = a.length === 5 ? matchStats.map((r) => {
      const va = aggregate(r.stat, a), vb = aggregate(r.stat, b);
      if (!isNum(va) || !isNum(vb)) return null;
      const dir = r.stat.better === 'low' ? -1 : 1;
      return { r, a: va * r.scale, b: vb * r.scale, z: (dir * (vb - va) * r.scale) / r.spread };
    }).filter(Boolean) : [];
  }
  drops = drops.filter((d) => d.z < -0.1).sort((x, y) => x.z - y.z).slice(0, 3);
  $('tips-drop').innerHTML = drops.length
    ? drops.map(({ r, a, b }) => tipCard(r, `${label}: ${fmt(r.stat, a)} → <b>${fmt(r.stat, b)}</b>`)).join('')
    : '<p class="note">Kein Wert ist deutlich gefallen. 👍</p>';

  $('tips-note').innerHTML =
    'Womit wird verglichen? Die Leetify-API liefert keine Vergleichswerte (z. B. für deinen Rang). ' +
    'Deshalb vergleicht diese Seite mit <b>deinem eigenen Durchschnitt</b> über alle gespeicherten Matches. ' +
    '„Schwach“ heißt also: deine aktuelle Form liegt am weitesten unter deinem eigenen Normalwert, gemessen an deiner üblichen Schwankung. ' +
    'Werte, die es nur als Leetify-Profilwert gibt (z. B. Opening-Duelle), fließen hier nicht ein. Sie stehen im Reiter Detail-Stats.';
}

// ---------- Kopfzeile, Reiter-Umschaltung, Start ----------

function renderHeader() {
  if (H.name) $('player-name').textContent = H.name;
  $('leetify-profile').href = `https://leetify.com/app/profile/${H.steam64_id}`;
  $('updated').textContent = H.lastSuccess
    ? `Letztes erfolgreiches Update: ${new Date(H.lastSuccess).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} · ${MATCHES.length} Matches gespeichert`
    : 'Noch kein erfolgreiches Update';
  const banner = $('error-banner');
  if (!H.lastSuccess) {
    banner.hidden = false;
    banner.textContent = 'Noch keine Daten. Starte das Update in GitHub unter Actions → „Stats aktualisieren“ → „Run workflow“ (siehe README).';
  } else if (H.lastError && H.lastAttempt > H.lastSuccess) {
    banner.hidden = false;
    banner.textContent = `Das letzte Update am ${fmtDate(H.lastAttempt)} ist fehlgeschlagen: ${H.lastError} Angezeigt werden die Daten vom ${fmtDate(H.lastSuccess)}.`;
  } else if (Date.now() - Date.parse(H.lastSuccess) > 10 * DAY) {
    banner.hidden = false;
    banner.textContent = `Die Daten sind älter als 10 Tage (Stand ${fmtDate(H.lastSuccess)}). Läuft die GitHub Action noch? Siehe README.`;
  }
}

function setupTabs() {
  const buttons = document.querySelectorAll('.tabs button');
  const show = (name) => {
    buttons.forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((t) => (t.hidden = t.id !== `tab-${name}`));
    charts.forEach((c) => c.resize());
    try { localStorage.setItem('tab', name); } catch {}
  };
  buttons.forEach((b) => b.addEventListener('click', () => { show(b.dataset.tab); history.replaceState(null, '', `#${b.dataset.tab}`); }));
  let start = location.hash.slice(1);
  try { start ||= localStorage.getItem('tab'); } catch {}
  if (start && document.getElementById(`tab-${start}`)) show(start);
}

async function main() {
  const load = (f) => fetch(f, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(f); return r.json(); });
  let cfg;
  try {
    [H, cfg, TIPS] = await Promise.all([load('data/history.json'), load('data/stats.json'), load('data/tips.json')]);
  } catch (e) {
    $('updated').textContent = `Daten konnten nicht geladen werden (${e.message}).`;
    return;
  }
  STATS = cfg.stats;
  H.snapshots ||= [];
  MATCHES = Object.values(H.matches || {}).filter((m) => m.date).sort((a, b) => a.date.localeCompare(b.date));
  REF = Date.parse(H.lastSuccess) || Date.now();

  Chart.defaults.color = '#8b95a5';
  Chart.defaults.borderColor = '#2a3342';
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';

  renderHeader();
  setupTabs();
  renderOverview(cfg);
  renderCore();
  renderDetails();
  renderMaps();
  renderTips();
}

main();
