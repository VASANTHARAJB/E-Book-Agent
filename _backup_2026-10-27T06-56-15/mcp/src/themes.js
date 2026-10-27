// Style kits: a palette + fonts + art motif that make every book from the same kit look like one designed family.
// Colors are 6-digit hex without "#".

export const STYLE_KITS = {
  "focus-navy": {
    label: "Focus Navy (navy + gold)",
    primary: "14213D",
    accent: "E0A31F",
    coverTop: "16264A",
    coverBottom: "0D1730",
    headFont: "Calibri",
    bodyFont: "Cambria",
    coverArt: "rings",
    bannerArt: "cards",
  },
  "calm-forest": {
    label: "Calm Forest (deep green + sand)",
    primary: "1B4332",
    accent: "D4A24C",
    coverTop: "22543F",
    coverBottom: "10291E",
    headFont: "Calibri",
    bodyFont: "Cambria",
    coverArt: "dots",
    bannerArt: "dots",
  },
  "bold-plum": {
    label: "Bold Plum (plum + coral)",
    primary: "3A1F3D",
    accent: "F07167",
    coverTop: "4A2750",
    coverBottom: "26122A",
    headFont: "Calibri",
    bodyFont: "Cambria",
    coverArt: "arcs",
    bannerArt: "rings",
  },
};

export const KIT_IDS = Object.keys(STYLE_KITS);
export const DEFAULT_KIT = "focus-navy";

export function getKit(id) {
  return STYLE_KITS[id] || STYLE_KITS[DEFAULT_KIT];
}
