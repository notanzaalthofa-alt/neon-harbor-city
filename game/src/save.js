// Neon Harbor — save and load. One small JSON object in localStorage holds the
// player's cash, finished missions and best wanted level, so quitting mid-story
// and coming back keeps the progress. Nothing here ever touches the network.
import { SAVE_KEY } from './config.js';

export function defaultSave() {
  return {
    cash: 200,
    missionsDone: [],
    bestWanted: 0,
    gamesPlayed: 0,
    savedAt: Date.now(),
  };
}

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    return { ...defaultSave(), ...parsed, missionsDone: Array.isArray(parsed.missionsDone) ? parsed.missionsDone : [] };
  } catch {
    return defaultSave();
  }
}

export function storeSave(save) {
  try {
    const copy = { ...save, savedAt: Date.now() };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(copy));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // A browser that blocks storage simply plays without saving.
  }
}
