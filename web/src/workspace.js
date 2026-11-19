export const WORKSPACE_PRESETS = Object.freeze({
  glacier: { name: "Glacier", accent: "#8fb0f0", palette: "#10151c", wallpaper: "none", mode: "dark" },
  pulse: { name: "Pulse", accent: "#ff769c", palette: "#221320", wallpaper: "orbit", mode: "dark" },
  circuit: { name: "Circuit", accent: "#69e0b4", palette: "#10201d", wallpaper: "signal", mode: "dark" },
  ember: { name: "Ember", accent: "#ffb374", palette: "#231a16", wallpaper: "dunes", mode: "dark" },
  midnight: { name: "Midnight", accent: "#a7a6ff", palette: "#131425", wallpaper: "ridge", mode: "dark" },
  daybreak: { name: "Daybreak", accent: "#365f9d", palette: "#e1eafa", wallpaper: "ridge", mode: "light" }
});

export const GROUP_COLOURS = ["#8fb0f0", "#ff769c", "#69e0b4", "#ffb374", "#c49bf0", "#c4db79"];
export const validColour = value => /^#[0-9a-f]{6}$/i.test(value || "");
export const clampNumber = (value, min, max, fallback) => {
  const number = Number(value);
  return value != null && value !== "" && Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};
export const tabLayout = value => ["top", "left", "right"].includes(value) ? value : "top";
export const paneLayout = value => value === "stack" ? "stack" : "columns";
export const paneRatio = value => Math.round(clampNumber(value, 20, 80, 50));

// Pinned tabs stay first. Emit each group as a whole at its first occurrence.
export function arrangeTabs(tabs, groups) {
  const known = new Set(groups.map(group => group.id));
  const pinned = tabs.filter(tab => tab.pinned);
  const members = new Map();
  for (const tab of tabs) {
    if (tab.pinned || !known.has(tab.groupId)) continue;
    if (!members.has(tab.groupId)) members.set(tab.groupId, []);
    members.get(tab.groupId).push(tab);
  }
  const seen = new Set();
  const result = [...pinned];
  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (!members.has(tab.groupId)) result.push(tab);
    else if (!seen.has(tab.groupId)) {
      seen.add(tab.groupId);
      result.push(...members.get(tab.groupId));
    }
  }
  return result;
}
