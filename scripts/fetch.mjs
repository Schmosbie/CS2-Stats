// Holt deine CS2-Daten von der Leetify Public API und speichert sie in data/history.json.
//
// Aufruf:  node scripts/fetch.mjs
// Der API-Key kommt aus der Umgebungsvariable LEETIFY_API_KEY (in GitHub: Secret).
// Er wird nie in eine Datei geschrieben.
//
// Bei einem Fehler bleiben alle alten Daten erhalten. Es werden nur
// "lastAttempt" und "lastError" aktualisiert, und das Skript endet mit Fehlercode 1.

import { readFile, writeFile } from 'node:fs/promises';

const STEAM64_ID = process.env.STEAM64_ID || '76561198123315543';
const API_KEY = process.env.LEETIFY_API_KEY || '';
const BASE_URL = process.env.LEETIFY_BASE_URL || 'https://api-public.cs-prod.leetify.com';
const HISTORY_FILE = new URL('../data/history.json', import.meta.url);

const now = new Date().toISOString();

async function loadHistory() {
  try {
    return JSON.parse(await readFile(HISTORY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function saveHistory(history) {
  await writeFile(HISTORY_FILE, JSON.stringify(history, null, 1) + '\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ruft einen Endpunkt ab. Bei Rate-Limit (429) oder Serverfehler wird bis zu 3x neu versucht.
async function apiGet(path) {
  const headers = { Accept: 'application/json' };
  if (API_KEY) {
    headers['_leetify_key'] = API_KEY;
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(BASE_URL + path, { headers });
    if (res.ok) return res.json();

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 4) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * attempt;
      console.log(`HTTP ${res.status} bei ${path}, neuer Versuch in ${wait / 1000}s …`);
      await sleep(wait);
      continue;
    }
    const messages = {
      401: 'API-Key ungültig oder abgelaufen (HTTP 401). Neuen Key erstellen und das GitHub-Secret LEETIFY_API_KEY ersetzen.',
      403: 'Zugriff verweigert (HTTP 403). API-Key prüfen.',
      404: 'Profil nicht gefunden (HTTP 404). Ist das Leetify-Profil privat oder die Steam-ID falsch?',
      429: 'Rate-Limit erreicht (HTTP 429). Später erneut versuchen.',
    };
    throw new Error(messages[res.status] || `HTTP ${res.status} bei ${path}`);
  }
}

// Nur die Zahlenwerte eines Objekts behalten (reicht für alle Stats).
function numbersOnly(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

// Macht aus einem Match der API einen kompakten Eintrag nur mit deinen Werten.
function compactMatch(match) {
  const me = (match.stats || []).find((p) => String(p.steam64_id) === STEAM64_ID);
  if (!me) return null;
  const won = me.rounds_won > me.rounds_lost ? 1 : me.rounds_won < me.rounds_lost ? 0 : 0.5;
  return {
    id: match.id,
    date: match.finished_at,
    map: match.map_name,
    source: match.data_source,
    result: won === 1 ? 'W' : won === 0 ? 'L' : 'T',
    score: [me.rounds_won, me.rounds_lost],
    s: numbersOnly(me),
  };
}

async function main() {
  const history = await loadHistory();
  history.steam64_id = STEAM64_ID;
  history.snapshots ??= [];
  history.matches ??= {};
  history.lastAttempt = now;

  if (!API_KEY) console.log('Hinweis: Kein LEETIFY_API_KEY gesetzt, Abruf ohne Key (strengeres Rate-Limit).');

  try {
    const profile = await apiGet(`/v3/profile?steam64_id=${STEAM64_ID}`);
    if (!profile || typeof profile !== 'object' || !profile.rating) {
      throw new Error('Antwort der API ist unvollständig (kein "rating" im Profil).');
    }
    if (profile.privacy_mode && profile.privacy_mode !== 'public') {
      console.log(`Hinweis: privacy_mode = ${profile.privacy_mode}`);
    }
    const matchList = await apiGet(`/v3/profile/matches?steam64_id=${STEAM64_ID}`);
    const matches = Array.isArray(matchList) ? matchList : matchList.matches || matchList.data || [];

    // Matches über ihre ID sammeln – keine Duplikate.
    let added = 0;
    for (const m of matches) {
      const c = compactMatch(m);
      if (!c) continue;
      if (!history.matches[c.id]) added++;
      history.matches[c.id] = c;
    }

    // Snapshot des aktuellen Profils. Pro Tag gibt es höchstens einen Snapshot.
    const snapshot = {
      date: now,
      name: profile.name,
      privacy_mode: profile.privacy_mode,
      total_matches: profile.total_matches,
      winrate: profile.winrate,
      ranks: { ...numbersOnly(profile.ranks) },
      rating: numbersOnly(profile.rating),
      stats: numbersOnly(profile.stats),
      recent_matches: (profile.recent_matches || []).map((m) => ({
        id: m.id, date: m.finished_at, map: m.map_name, rank: m.rank, rank_type: m.rank_type,
        source: m.data_source, outcome: m.outcome,
      })),
    };
    const today = now.slice(0, 10);
    history.snapshots = history.snapshots.filter((s) => s.date.slice(0, 10) !== today);
    history.snapshots.push(snapshot);
    history.snapshots.sort((a, b) => a.date.localeCompare(b.date));

    // Welche Felder die API gerade liefert (hilft beim Hinzufügen neuer Stats).
    history.apiFields = {
      profile_rating: Object.keys(profile.rating || {}),
      profile_stats: Object.keys(profile.stats || {}),
      profile_ranks: Object.keys(profile.ranks || {}),
      match_player: Object.keys(matches[0]?.stats?.[0] || {}),
    };

    history.name = profile.name;
    history.lastSuccess = now;
    history.lastError = null;
    await saveHistory(history);
    console.log(`OK: Snapshot gespeichert, ${added} neue Matches (insgesamt ${Object.keys(history.matches).length}).`);
  } catch (err) {
    history.lastError = err.message;
    await saveHistory(history);
    console.error(`FEHLER: ${err.message}`);
    console.error('Die alten Daten bleiben erhalten.');
    process.exit(1);
  }
}

main();
