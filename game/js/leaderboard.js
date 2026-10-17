// Per-track leaderboard of named best laps (stored in the browser's localStorage).
const STORAGE_KEY = 'espracer.leaderboard.v1';
export const BOARD_SIZE = 10;
export const NAME_MAX = 16;

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

let boards = load();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
  } catch {
    // Storage blocked (private mode): the leaderboard simply won't persist.
  }
}

// Entries for one track, fastest first: { name, lapMs, mode, date }.
export function topTimes(trackId) {
  return boards[trackId] ?? [];
}

// 1-based place a lap would take on the board, or 0 if it is too slow to make it.
export function rankFor(trackId, lapMs) {
  if (lapMs == null || !Number.isFinite(lapMs)) return 0;
  const list = topTimes(trackId);
  const i = list.findIndex((e) => lapMs < e.lapMs);
  const rank = (i < 0 ? list.length : i) + 1;
  return rank <= BOARD_SIZE ? rank : 0;
}

// Adds a named lap and returns its place (0 if it did not make the board).
export function addEntry(trackId, { name, lapMs, mode }) {
  const rank = rankFor(trackId, lapMs);
  if (!rank) return 0;
  const list = [...topTimes(trackId)];
  list.splice(rank - 1, 0, { name, lapMs, mode, date: Date.now() });
  boards[trackId] = list.slice(0, BOARD_SIZE);
  save();
  return rank;
}

export function clearLeaderboard() {
  boards = {};
  save();
}

// Trims, drops control characters and caps the length of a typed name or gamer tag.
export function cleanName(raw) {
  return String(raw).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}
