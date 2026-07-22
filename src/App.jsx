import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Search, Plus, Share2, Edit3, Clock, X, Check, Trash2, Car, Tag, ChevronDown, ChevronRight, Copy, Filter, History, Package, Download } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// BNCHR+ Tire Purchase System
// Single-file React app, now backed by Supabase (Postgres) for persistence.
// Data lives in the `tires` table; the in-memory SEED below is kept only as a
// fallback if the database is unreachable.
// ─────────────────────────────────────────────────────────────────────────────

// ── Supabase backend ─────────────────────────────────────────────────────────
const SUPABASE_URL = "https://itpghtviyotueqpspxun.supabase.co";
const SUPABASE_KEY = "sb_publishable_OhL-LX-sjKOo97uFoN7oMQ_G3j579PE";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Shared team password (light gate for internal use)
const APP_PASSWORD = "bnchr901";

// Map a database row → the app's in-memory tire shape
function rowToTire(r) {
  const now = new Date().toISOString();
  return {
    id: r.id,
    brand: r.brand,
    pattern: r.pattern || "",
    type: r.type || "Normal",
    width: r.width, aspect: r.aspect, structure: r.structure || "R", rim: r.rim,
    loadIndex: r.load_index || "", speedRating: r.speed_rating || "",
    country: r.country || "", year: r.year || "", supplier: r.supplier || "",
    sku: r.sku || "",
    cost: round3(Number(r.cost) || 0), price: round3(Number(r.price) || 0),
    category: detectCategory(r.brand),
    notes: r.notes || "",
    inStock: !!r.in_stock,
    _availableAt: r.in_stock ? (r.availability_checked_at || null) : null,
    history: [{ ts: r.created_at || now, cost: round3(Number(r.cost) || 0), price: round3(Number(r.price) || 0), note: "Loaded" }],
  };
}

// Map an in-memory tire → database columns (only real columns; strips app-only fields)
function tireToRow(t) {
  return {
    brand: t.brand, pattern: t.pattern || null, type: t.type || "Normal",
    width: t.width || null, aspect: t.aspect || null, structure: t.structure || "R", rim: t.rim || null,
    load_index: t.loadIndex || null, speed_rating: t.speedRating || null,
    country: t.country || null, year: t.year || null, supplier: t.supplier || null,
    sku: t.sku || null,
    cost: (t.cost === "" || t.cost == null) ? null : Number(t.cost),
    price: (t.price === "" || t.price == null) ? null : Number(t.price),
    notes: t.notes || null,
    in_stock: !!t.inStock,
  };
}

// Is this id a database UUID (already persisted) vs a local temp id ("t_xxxx")?
function isDbId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(id);
}

// ── Brand → Category mapping (auto-detect) ───────────────────────────────────
const CATEGORY = {
  TP: { key: "TP", en: "Top Performance", ar: "أعلى أداء", margin: 0.35, color: "#C9A84C", soft: "#FBF4DF" },
  PC: { key: "PC", en: "Premium Comfort", ar: "جودة وسعر", margin: 0.30, color: "#1D5C3A", soft: "#E7F2EB" },
  SV: { key: "SV", en: "Smart Value", ar: "جودة وسعر", margin: 0.28, color: "#1A4F8A", soft: "#E7EFFA" },
  SE: { key: "SE", en: "Safe Economy", ar: "اقتصادي آمن", margin: 0.25, color: "#6B6B6B", soft: "#F0F0EC" },
};
const CATEGORY_ORDER = ["TP", "PC", "SV", "SE"];

const BRAND_CATEGORY = {
  // Top Performance
  michelin: "TP", pirelli: "TP", continental: "TP", "bf goodrich": "TP", bfgoodrich: "TP", bfg: "TP", goodyear: "TP",
  // Premium Comfort
  bridgestone: "PC", yokohama: "PC", dunlop: "PC", hankook: "PC", cooper: "PC", toyo: "PC", sumitomo: "PC", firestone: "PC", firestones: "PC",
  // Smart Value
  kumho: "SV", marshal: "SV", marshall: "SV", nexen: "SV", falken: "SV", roadstone: "SV", nankang: "SV",
  maxxis: "SV", matrax: "SV", armstrong: "SV", accelera: "SV", laufenn: "SV", landspider: "SV", giti: "SV",
  // Safe Economy — Chinese / unknown (default fallback handled in code)
  wideway: "SE", roadx: "SE", rovelo: "SE", habilead: "SE", sailun: "SE",
  blackhawk: "SE", roadcruzza: "SE", zmax: "SE", antares: "SE", maxtrek: "SE",
  kapsen: "SE", farroad: "SE", annaite: "SE", luxxon: "SE", fullrun: "SE",
  roadking: "SE", kinforest: "SE", powerway: "SE", marvelous: "SE",
  triangle: "SE", doublestar: "SE", linglong: "SE", aoteli: "SE", goform: "SE",
  comforser: "SE", haida: "SE", joyroad: "SE",
};

function detectCategory(brand) {
  if (!brand) return "SE";
  const b = brand.trim().toLowerCase();
  if (BRAND_CATEGORY[b]) return BRAND_CATEGORY[b];
  // partial match
  for (const key of Object.keys(BRAND_CATEGORY)) {
    if (b.includes(key) || key.includes(b)) return BRAND_CATEGORY[key];
  }
  return "SE"; // unknown brands default to Safe Economy (Chinese)
}

// ── Country flags ─────────────────────────────────────────────────────────────
const COUNTRIES = {
  Germany: "🇩🇪", Japan: "🇯🇵", France: "🇫🇷", "USA": "🇺🇸", Italy: "🇮🇹",
  "South Korea": "🇰🇷", China: "🇨🇳", Thailand: "🇹🇭", Spain: "🇪🇸",
  Indonesia: "🇮🇩", Turkey: "🇹🇷", Taiwan: "🇹🇼", Vietnam: "🇻🇳", India: "🇮🇳",
  Brazil: "🇧🇷", Poland: "🇵🇱", "Czech Republic": "🇨🇿", Hungary: "🇭🇺",
  Romania: "🇷🇴", UK: "🇬🇧", Mexico: "🇲🇽",
};

// Arabic country names (for the Arabic quote)
const COUNTRIES_AR = {
  Germany: "ألمانيا", Japan: "اليابان", France: "فرنسا", "USA": "أمريكا", Italy: "إيطاليا",
  "South Korea": "كوريا", China: "الصين", Thailand: "تايلاند", Spain: "إسبانيا",
  Indonesia: "إندونيسيا", Turkey: "تركيا", Taiwan: "تايوان", Vietnam: "فيتنام", India: "الهند",
  Brazil: "البرازيل", Poland: "بولندا", "Czech Republic": "التشيك", Hungary: "المجر",
  Romania: "رومانيا", UK: "بريطانيا", Mexico: "المكسيك",
};

// Brand → home/primary manufacturing country (default origin; editable per tire).
// Note: a brand may produce in several plants — this is the brand's primary origin,
// not a guarantee of where a specific tire was made. Verify via DOT code for premium quotes.
const BRAND_COUNTRY = {
  michelin: "France", pirelli: "Italy", continental: "Germany",
  "bf goodrich": "USA", bfgoodrich: "USA", bfg: "USA", goodyear: "USA",
  bridgestone: "Japan", yokohama: "Japan", dunlop: "Japan", hankook: "South Korea",
  cooper: "USA", toyo: "Japan", sumitomo: "Japan", firestone: "USA", firestones: "USA",
  kumho: "South Korea", marshal: "South Korea", marshall: "South Korea", nexen: "South Korea",
  falken: "Japan", roadstone: "South Korea", nankang: "Taiwan", maxxis: "Taiwan",
  matrax: "Spain", armstrong: "Thailand", accelera: "Indonesia", laufenn: "South Korea",
  landspider: "China", giti: "China",
};
function countryForBrand(brand) {
  if (!brand) return "";
  const b = brand.trim().toLowerCase();
  if (BRAND_COUNTRY[b]) return BRAND_COUNTRY[b];
  for (const key of Object.keys(BRAND_COUNTRY)) {
    if (b.includes(key) || key.includes(b)) return BRAND_COUNTRY[key];
  }
  // Unknown brand → defaults to Safe Economy (Chinese) per category rules
  return detectCategory(brand) === "SE" ? "China" : "";
}

// ── Supplier inference (from BNCHR+ purchase history) ─────────────────────────
// brand (lowercase) → ordered list of suppliers, most-frequent first
const BRAND_SUPPLIER = {
  yokohama: ["Abbas Ghuloom"], dunlop: ["Abbas Ghuloom"],
  kumho: ["Abulhassan", "Abbas Ghuloom"], roadx: ["Abbas Ghuloom", "Abulhassan"],
  habilead: ["Abbas Ghuloom", "Al-Ghannam"], farroad: ["Abbas Ghuloom"],
  rockblade: ["Abbas Ghuloom"], rovelo: ["Abbas Ghuloom"], mayrun: ["Abbas Ghuloom"],
  general: ["Abbas Ghuloom"], maxtrek: ["Abulhassan"],
  nexen: ["Al-Ghannam"], falken: ["Al-Ghannam"], frienza: ["Al-Ghannam"],
  blackhawk: ["Al-Ghannam"], goodride: ["Al-Ghannam"],
  kinforest: ["Alghanim"], wideway: ["JMTC", "Alghanim"],
  toyo: ["Almailem"], goodyear: ["Almailem"], continental: ["Almailem"],
  hankook: ["Almailem"], giti: ["Almailem"],
  pirelli: ["Behbehani (Pirelli)"], bridgestone: ["Bridgestone Dealer"],
  blackbear: ["Formula Tyres"], rydanz: ["Formula Tyres"], matrax: ["Formula Tyres"],
  marshal: ["JMTC"], nankang: ["JMTC"], annaite: ["JMTC"], roadcruzza: ["JMTC"],
  lanvigator: ["JMTC"], armstrong: ["JMTC"],
  bfgoodrich: ["Kuwait Automotive", "Formula Tyres"], michelin: ["Kuwait Automotive"],
};
function supplierForBrand(brand) {
  if (!brand) return "";
  const b = brand.trim().toLowerCase();
  if (BRAND_SUPPLIER[b]) return BRAND_SUPPLIER[b][0];
  for (const key of Object.keys(BRAND_SUPPLIER)) {
    if (b.includes(key) || key.includes(b)) return BRAND_SUPPLIER[key][0];
  }
  return "";
}

// ── Pattern → brand prediction ────────────────────────────────────────────────
// Known signature patterns that identify a brand even if the brand name is absent.
const PATTERN_BRAND = {
  "pzero": "Pirelli", "p zero": "Pirelli", "pz4": "Pirelli", "cinturato": "Pirelli", "scorpion": "Pirelli",
  "ko2": "BFGoodrich", "ko3": "BFGoodrich", "t/a": "BFGoodrich", "trail terrain": "BFGoodrich", "all terrain": "BFGoodrich",
  "at52": "Kumho", "crugen": "Kumho", "ecsta": "Kumho", "solus": "Kumho", "hp71": "Kumho", "ht51": "Marshal",
  "pilot sport": "Michelin", "ps4": "Michelin", "ps5": "Michelin", "primacy": "Michelin", "latitude": "Michelin", "crossclimate": "Michelin", "ltx": "Michelin", "defender": "Michelin",
  "potenza": "Bridgestone", "turanza": "Bridgestone", "dueler": "Bridgestone", "alenza": "Bridgestone", "blizzak": "Bridgestone",
  "advan": "Yokohama", "geolandar": "Yokohama", "bluearth": "Yokohama", "parada": "Yokohama",
  "sp sport": "Dunlop", "grandtrek": "Dunlop", "sport maxx": "Dunlop",
  "ventus": "Hankook", "dynapro": "Hankook", "kinergy": "Hankook",
  "contisport": "Continental", "premiumcontact": "Continental", "crosscontact": "Continental", "ecocontact": "Continental",
  "proxes": "Toyo", "open country": "Toyo", "celsius": "Toyo",
  "azenis": "Falken", "wildpeak": "Falken", "ziex": "Falken",
  "roadian": "Nexen", "nfera": "Nexen", "n'fera": "Nexen", "cp672": "Nexen",
  "eagle": "Goodyear", "wrangler": "Goodyear", "efficientgrip": "Goodyear",
};
function brandFromPattern(text) {
  if (!text) return "";
  const t = text.toLowerCase();
  for (const key of Object.keys(PATTERN_BRAND)) {
    if (t.includes(key)) return PATTERN_BRAND[key];
  }
  return "";
}

// ── Tire OE / special markings knowledge base ─────────────────────────────────
// code → { meaning, note }. Used to auto-annotate tires from supplier text and
// to power the markings reference shown during search.
const TIRE_MARKINGS = {
  // Mercedes-Benz
  "MO": { meaning: "Mercedes-Benz OE", brands: "Michelin, Continental, Pirelli, Bridgestone, Dunlop, Hankook" },
  "MO1": { meaning: "Mercedes-Benz (specific OE)", brands: "Michelin" },
  "MOE": { meaning: "Mercedes-Benz Extended (runflat)", brands: "Continental, Michelin, Pirelli" },
  "MO-S": { meaning: "Mercedes-Benz Sport / AMG OE", brands: "various" },
  // BMW
  "★": { meaning: "BMW / MINI OE", brands: "Michelin, Pirelli, Bridgestone, Continental, Dunlop, Hankook, Goodyear" },
  "*": { meaning: "BMW / MINI OE", brands: "various" },
  // Porsche (N-spec)
  "N0": { meaning: "Porsche OE approved (spec 0)", brands: "Michelin, Pirelli, Continental, Bridgestone" },
  "N1": { meaning: "Porsche OE approved (spec 1)", brands: "various" },
  "N2": { meaning: "Porsche OE approved (spec 2)", brands: "various" },
  "N3": { meaning: "Porsche OE approved (spec 3)", brands: "various" },
  "N4": { meaning: "Porsche OE approved (spec 4)", brands: "various" },
  "N5": { meaning: "Porsche OE approved (spec 5)", brands: "various" },
  "N6": { meaning: "Porsche OE approved (spec 6)", brands: "various" },
  // Audi
  "AO": { meaning: "Audi OE", brands: "Michelin, Continental, Pirelli, Bridgestone, Dunlop, Hankook" },
  "AO1": { meaning: "Audi (specific OE)", brands: "various" },
  "RO1": { meaning: "Audi Quattro / RS OE", brands: "various" },
  // Other OEMs
  "AR": { meaning: "Alfa Romeo OE", brands: "Pirelli" },
  "J": { meaning: "Jaguar OE", brands: "Pirelli, Dunlop" },
  "JLR": { meaning: "Jaguar Land Rover OE", brands: "various" },
  "LR": { meaning: "Land Rover OE", brands: "various" },
  "L": { meaning: "Lamborghini OE", brands: "Pirelli" },
  "F": { meaning: "Ferrari OE", brands: "Michelin, Pirelli, Bridgestone" },
  "VO": { meaning: "Volkswagen / electric OE", brands: "various" },
  "B": { meaning: "Bentley OE", brands: "Pirelli, Michelin" },
  "GOE": { meaning: "General Motors OE", brands: "various" },
  // Runflat technologies
  "ZP": { meaning: "Michelin Zero Pressure (runflat)", brands: "Michelin" },
  "ZPS": { meaning: "Michelin Zero Pressure System (runflat)", brands: "Michelin" },
  "RFT": { meaning: "Run-Flat Tire", brands: "Bridgestone, others" },
  "ROF": { meaning: "Run On Flat (runflat)", brands: "Dunlop, Goodyear, Bridgestone" },
  "RF": { meaning: "Run-Flat", brands: "various" },
  "SSR": { meaning: "Self-Supporting Runflat", brands: "Continental" },
  "DSST": { meaning: "Dunlop Self-Supporting Technology (runflat)", brands: "Dunlop" },
  "HRS": { meaning: "Hankook Runflat System", brands: "Hankook" },
  "EMT": { meaning: "Extended Mobility Technology (runflat)", brands: "Goodyear" },
  "RSC": { meaning: "RunFlat System Component (BMW)", brands: "Bridgestone, Pirelli, Dunlop" },
  "NO": { meaning: "No marking / non-OE (supplier shorthand)", brands: "various" },
  // Construction / sidewall
  "OWL": { meaning: "Outlined White Letters (sidewall lettering)", brands: "BFGoodrich, others" },
  "RWL": { meaning: "Raised White Letters", brands: "various" },
  "BSW": { meaning: "Black Sidewall", brands: "various" },
  "XL": { meaning: "Extra Load (reinforced)", brands: "all" },
  "RF-XL": { meaning: "Reinforced Extra Load", brands: "all" },
  "C": { meaning: "Commercial / reinforced ply", brands: "all" },
  "LT": { meaning: "Light Truck", brands: "all" },
  // Weather
  "M+S": { meaning: "Mud & Snow", brands: "all" },
  "3PMSF": { meaning: "3-Peak Mountain Snowflake (severe snow)", brands: "all" },
};
// Scan supplier text for markings → return array of {code, meaning}
function detectMarkings(text) {
  if (!text) return [];
  const found = [];
  const seen = new Set();
  const upper = " " + text.toUpperCase().replace(/\*/g, " ★ ") + " ";
  for (const code of Object.keys(TIRE_MARKINGS)) {
    if (code === "NO" || code === "*") continue; // skip noisy shorthands
    const c = code.toUpperCase();
    // word-boundary-ish match
    const re = new RegExp(`(?:^|[\\s\\-\\(])${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[\\s\\-\\)])`);
    if (re.test(upper) && !seen.has(code)) { found.push({ code, ...TIRE_MARKINGS[code] }); seen.add(code); }
  }
  return found;
}
function markingsNote(text) {
  const m = detectMarkings(text);
  if (!m.length) return "";
  return m.map(x => `${x.code} — ${x.meaning}`).join(" · ");
}


// Country names suppliers use → our country keys
const COUNTRY_ALIASES = {
  korea: "South Korea", "south korea": "South Korea", japan: "Japan", vietnam: "Vietnam",
  china: "China", thailand: "Thailand", indonesia: "Indonesia", taiwan: "Taiwan",
  france: "France", germany: "Germany", italy: "Italy", usa: "USA", us: "USA",
  spain: "Spain", turkey: "Turkey", india: "India",
};

// Known brand tokens for parsing (longest first so multi-word matches win)
const KNOWN_BRANDS = ["BFGoodrich","BF Goodrich","Bridgestone","Continental","Goodyear","Michelin","Pirelli","Yokohama","Hankook","Sumitomo","Dunlop","Falken","Nexen","Kumho","Marshal","Roadstone","Nankang","Maxxis","Matrax","Armstrong","Accelera","Laufenn","Landspider","Cooper","Toyo","Giti","Wideway","RoadX","Roadx","Rovelo","Habilead","Sailun","Blackhawk","Blackbear","Roadcruzza","ZMAX","Antares","Maxtrek","Kapsen","Farroad","Annaite","Luxxon","Fullrun","Roadking","Kinforest","Triangle","Frienza","Rockblade","Mayrun","Lanvigator","General","Goodride","Rydanz","Winrun"];

const KNOWN_SUPPLIERS = ["Abbas Ghuloom","Abulhassan","Al-Ghannam","Alghanim","Almailem","Behbehani (Pirelli)","Bridgestone Dealer","Formula Tyres","JMTC","Kuwait Automotive"];

// Canonical brand spellings (deduped, official capitalization)
const CANON_BRANDS = ["BFGoodrich","Bridgestone","Continental","Goodyear","Michelin","Pirelli","Yokohama","Hankook","Sumitomo","Dunlop","Falken","Nexen","Kumho","Marshal","Roadstone","Nankang","Maxxis","Matrax","Armstrong","Accelera","Laufenn","Landspider","Cooper","Toyo","Giti","Wideway","RoadX","Rovelo","Habilead","Sailun","Blackhawk","Blackbear","Roadcruzza","ZMAX","Antares","Maxtrek","Kapsen","Farroad","Annaite","Luxxon","Fullrun","Roadking","Kinforest","Triangle","Frienza","Rockblade","Mayrun","Lanvigator","General","Goodride","Rydanz","Winrun"];

// Levenshtein distance (small, for conservative typo matching)
function levenshtein(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99; // early out — too different
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
  return dp[m][n];
}

// Normalize a typed pattern against existing catalog patterns FOR THAT BRAND.
// Returns { value, original, corrected, suggestions }
const CORE_PATTERNS = {
  pirelli: ["P ZERO", "P ZERO PZ4", "P ZERO PZ5", "P ZERO AS", "P ZERO AS Plus 3", "P ZERO Corsa", "P ZERO Corsa PZC4", "P ZERO E", "P ZERO R", "P ZERO Rosso", "P ZERO Trofeo R", "P ZERO Trofeo RS", "Cinturato P1", "Cinturato P7", "Cinturato P7 C2", "Cinturato All Season SF2", "Cinturato All Season SF3", "Scorpion", "Scorpion Verde", "Scorpion Summer 3", "Scorpion ATR", "Scorpion Verde All Season", "Scorpion Zero All Season", "Scorpion All Season SF2", "Scorpion XTM AT", "Powergy", "Powergy 2", "P7 AS Plus 3"],
  michelin: ["Pilot Sport 4", "Pilot Sport 4 S", "Pilot Sport 4 SUV", "Pilot Sport 5", "Pilot Sport Cup 2", "Pilot Sport Cup 2 R", "Pilot Super Sport", "Pilot Sport A/S 3+", "Pilot Sport All Season 4", "Pilot Sport EV", "Pilot Alpin 5", "Primacy 4", "Primacy 5", "Primacy Tour A/S", "Primacy All Season", "e.Primacy", "Latitude Sport 3", "Latitude Tour HP", "CrossClimate 2", "CrossClimate SUV", "Defender2", "Defender LTX M/S 2", "Defender T + H", "LTX A/T2", "LTX M/S2"],
  bfgoodrich: ["All-Terrain T/A KO2", "All-Terrain T/A KO3", "Trail-Terrain T/A", "Mud-Terrain T/A KM3", "HD-Terrain T/A KT", "g-Force COMP-2 A/S", "Advantage Control", "Advantage T/A Sport"],
  kumho: ["Ecsta PS91", "Ecsta PS71", "Ecsta PS31", "Ecsta V720", "Ecsta HS51", "Ecsta X3", "Ecsta PA51", "Ecsta PA31", "Solus TA71", "Solus TA31", "Solus TA11", "Solus KL21 eco", "Sense KR26", "ecowing ES31", "ecowing ES01", "Crugen HP71", "Crugen HT51", "Crugen HP91", "Road Venture AT52", "Road Venture AT51", "Road Venture MT51", "Road Venture MT71", "Road Venture APT KL51", "Portran KC53", "WinterCraft WP72", "WinterCraft WP71"],
  bridgestone: ["Potenza Sport", "Potenza S007", "Potenza S005", "Potenza S001", "Potenza RE003 Adrenalin", "Potenza RE050A", "Potenza RE71RS", "Potenza Race", "Turanza 6", "Turanza T005", "Turanza T001", "Turanza ER300", "Turanza EverDrive", "Alenza 001", "Alenza Sport A/S", "Alenza A/S 02", "Dueler H/P Sport", "Dueler H/T 684", "Dueler H/T 840", "Dueler A/T 001", "Dueler A/T 002", "Dueler M/T 674", "Ecopia EP150", "Ecopia EP300"],
  dunlop: ["SP Sport Maxx", "SP Sport Maxx GT", "SP Sport Maxx RT2", "SP Sport Maxx TT", "SP Sport Maxx 050", "SP Sport Maxx 060", "Direzza DZ102", "Sport Maxx RT2 SUV", "SP Sport FM800", "SP Sport LM705", "Grandtrek AT5", "Grandtrek AT25", "Grandtrek PT3", "Grandtrek PT30", "Grandtrek MT2", "SP Sport 01", "SP QuattroMaxx"],
  yokohama: ["Advan Sport V107", "Advan Sport V105", "Advan Sport V103", "Advan Sport A/S+", "Advan Neova AD09", "Advan Neova AD08R", "Advan Fleva V701", "Advan A052", "Geolandar A/T G015", "Geolandar A/T4 G018", "Geolandar X-AT", "Geolandar M/T G003", "Geolandar H/T G056", "Geolandar H/T4 G062", "Geolandar X-CV G057", "Geolandar CV G058", "Parada Spec-X", "BluEarth-GT AE51", "BluEarth-XT AE61", "BluEarth-4S AW21", "Avid Ascend LX"],
  nexen: ["N'Fera Sport", "N'Fera Sport R", "N'Fera SU1", "N'Fera AU7", "N'Fera SUR4G", "N'Priz S", "N'Priz AH5", "N'Priz AH8", "N'Priz RH7", "N5000 Platinum", "N'Blue 4 Season 2", "Roadian GTX", "Roadian HP", "Roadian HTX2", "Roadian HTX RH5", "Roadian ATX", "Roadian AT Pro RA8", "Roadian MT", "Roadian MTX", "Roadian CT8 HL"],
  falken: ["Azenis FK510", "Azenis FK460 A/S", "Azenis RT660+", "Azenis RT615K+", "Ziex ZE960 A/S", "Ziex CT60 A/S", "Sincera SN250 A/S", "Wildpeak A/T4W", "Wildpeak A/T3W", "Wildpeak A/T Trail", "Wildpeak H/T02", "Wildpeak M/T", "Wildpeak R/T"],
  goodyear: ["Eagle F1 Asymmetric 6", "Eagle F1 Asymmetric 5", "Eagle F1 Asymmetric 3", "Eagle F1 Asymmetric 3 SUV", "Eagle F1 Asymmetric All-Season", "Eagle F1 SuperSport", "Eagle F1 All Season", "Eagle Sport All-Season", "Eagle Exhilarate", "EfficientGrip Performance 2", "EfficientGrip 2 SUV", "Assurance WeatherReady 2", "Assurance MaxLife", "Assurance ComfortDrive", "Wrangler All-Terrain Adventure", "Wrangler DuraTrac RT", "Wrangler Workhorse AT", "Wrangler Territory AT", "Wrangler MT/R", "Vector 4Seasons Gen-3"],
  continental: ["ExtremeContact DWS06 Plus", "ExtremeContact Sport 02", "SportContact 7", "SportContact 6", "PremiumContact 7", "PremiumContact 6", "ProContact TX", "ProContact GX", "ProContact RX", "PureContact LS", "TrueContact Tour 54", "CrossContact LX25", "CrossContact RX", "CrossContact LX Sport", "TerrainContact A/T", "TerrainContact H/T", "EcoContact 6", "UltraContact UC7", "VikingContact 7"],
  toyo: ["Proxes Sport", "Proxes Sport 2", "Proxes Sport A/S+", "Proxes Sport SUV", "Proxes R888R", "Proxes R1R", "Proxes 4 Plus", "Proxes ST III", "Proxes A40", "Open Country A/T III", "Open Country R/T Trail", "Open Country R/T", "Open Country M/T", "Open Country H/T II", "Open Country Q/T", "Open Country U/T", "Celsius II", "Celsius Sport", "Extensa A/S II", "Extensa HP II"],
  marshal: ["MU12", "MU19", "Matrac MU11", "KR21", "KR201", "Crugen HP91", "Crugen KL51", "Road Venture APT KL51", "Road Venture AT51", "Road Venture MT51", "Steel Radial 857"],
  nankang: ["NS-2", "NS-20", "NS-25", "NS-2R", "AS-1", "AS-2+", "Sportnex AR-1", "Sportnex CR-S", "CR-S V2", "SP-9 Cross Sport", "SP-7", "SP-5", "N-607+", "CX668", "N889 Mudstar M/T", "FT-7 A/T", "Toursport NS"],
  roadstone: ["Eurovis Sport 04", "Eurovis HP02", "N'Fera SU1", "N'Fera RU1", "N'Fera RU5", "N'Fera AU7", "N'Priz AH5", "N'Priz AH8", "N'Priz 4S", "N5000 Plus", "N8000", "NBlue HD Plus", "Roadian HP", "Roadian HTX RH5", "Roadian AT Pro RA8", "Roadian CT8", "Roadian MTX", "Classe Premiere CP672"],
  kinforest: ["KF550", "KF660", "KF880", "KF717 SUV H/T", "KF7", "Pentium", "Sky-X", "Wildclaw A/T", "Wellington Highlander WLK A/T", "Wellington XTR A/T", "Snow Force"],
  hankook: ["Ventus S1 evo3", "Ventus S1 evo3 SUV", "Ventus S1 AS", "Ventus S1 noble2", "Ventus evo", "Ventus Prime4", "Ventus RS4", "Kinergy GT", "Kinergy XP", "Kinergy 4S2", "Kinergy PT", "Dynapro HP2", "Dynapro HPX", "Dynapro HT2", "Dynapro evo AS", "Dynapro AT2", "Dynapro AT2 Xtreme", "Dynapro MT2", "iON evo", "iON evo AS SUV"],
  cooper: ["Zeon RS3-G1", "Zeon RS3-A", "CS5 Ultra Touring", "Endeavor", "Endeavor Plus", "ProControl", "Evolution Tour", "Discoverer AT3 4S", "Discoverer AT3 LT", "Discoverer AT3 XLT", "Discoverer Road+Trail AT", "Discoverer Rugged Trek", "Discoverer SRX", "Discoverer HT3", "Discoverer STT Pro", "Discoverer S/T Maxx", "Discoverer Enduramax"],
  general: ["G-MAX AS-07", "G-MAX AS-05", "G-MAX RS", "AltiMAX RT45", "AltiMAX RT43", "AltiMAX 365AW", "Grabber APT", "Grabber AT2", "Grabber ATX", "Grabber X3", "Grabber HTS60", "Grabber UHP"],
  wideway: ["Sportsway", "Sportway", "Superway", "Ecoway", "Maxway", "Autograceway HP", "Heroway"],
  roadx: ["RXMotion MX440", "RXMotion U11", "RXMotion 4S1", "RXMotion UHP AS", "RXMotion SUV UX01", "RXQuest AT QX12", "RXQuest HT HX01", "RXQuest RT", "RXFrost FX11"],
  matrax: ["Urcola+", "Urcola+ SUV", "Camarga", "Romero", "Miurra", "Domec", "Colmenar", "Veragua SV", "Veragua A/T", "Veragua ATX", "Veragua M/T", "Navarra R/T"],
};

// Manufacturer spec reference: brand → pattern → size → { load, speed, xl }
// Used to auto-fill load index & speed rating during entry. Sourced from manufacturer sites.
// Extend by adding more patterns/brands.
const TIRE_SPECS = {
  Kumho: {
  "Ecsta PA51": {
    "255/35R18": { load: "94", speed: "W", xl: true },
    "265/35R18": { load: "97", speed: "W", xl: true },
    "275/35R18": { load: "95", speed: "W" },
    "245/35R19": { load: "93", speed: "W", xl: true },
    "255/35R19": { load: "96", speed: "W", xl: true },
    "275/35R19": { load: "100", speed: "W", xl: true },
    "285/35R19": { load: "99", speed: "W" },
    "245/35R20": { load: "95", speed: "W", xl: true },
    "255/35R20": { load: "97", speed: "W", xl: true },
    "205/40R17": { load: "84", speed: "W", xl: true },
    "245/40R17": { load: "91", speed: "W" },
    "255/40R17": { load: "94", speed: "W" },
    "275/40R17": { load: "98", speed: "W" },
    "215/40R18": { load: "89", speed: "W", xl: true },
    "225/40R18": { load: "92", speed: "W", xl: true },
    "235/40R18": { load: "95", speed: "W", xl: true },
    "245/40R18": { load: "97", speed: "W", xl: true },
    "255/40R18": { load: "99", speed: "W", xl: true },
    "275/40R18": { load: "99", speed: "W" },
    "225/40R19": { load: "93", speed: "W", xl: true },
    "245/40R19": { load: "98", speed: "W", xl: true },
    "255/40R19": { load: "100", speed: "W", xl: true },
    "275/40R19": { load: "105", speed: "W", xl: true },
    "245/40R20": { load: "99", speed: "W", xl: true },
    "205/45R17": { load: "88", speed: "V", xl: true },
    "215/45R17": { load: "91", speed: "W", xl: true },
    "225/45R17": { load: "94", speed: "W", xl: true },
    "235/45R17": { load: "97", speed: "W", xl: true },
    "245/45R17": { load: "95", speed: "W" },
    "215/45R18": { load: "93", speed: "W", xl: true },
    "225/45R18": { load: "95", speed: "W", xl: true },
    "235/45R18": { load: "98", speed: "W", xl: true },
    "245/45R18": { load: "100", speed: "W", xl: true },
    "255/45R18": { load: "103", speed: "W", xl: true },
    "225/45R19": { load: "92", speed: "W" },
    "245/45R19": { load: "102", speed: "W", xl: true },
    "245/45R20": { load: "99", speed: "W" },
    "255/45R20": { load: "105", speed: "W", xl: true },
    "195/50R16": { load: "84", speed: "V" },
    "205/50R16": { load: "87", speed: "V" },
    "225/50R16": { load: "92", speed: "W" },
    "205/50R17": { load: "93", speed: "W", xl: true },
    "215/50R17": { load: "95", speed: "W", xl: true },
    "225/50R17": { load: "98", speed: "W", xl: true },
    "235/50R17": { load: "96", speed: "W" },
    "245/50R17": { load: "99", speed: "W" },
    "235/50R18": { load: "97", speed: "W" },
    "245/50R18": { load: "100", speed: "W" },
    "245/50R19": { load: "105", speed: "W", xl: true },
    "185/55R16": { load: "83", speed: "V" },
    "195/55R16": { load: "87", speed: "V" },
    "205/55R16": { load: "91", speed: "W" },
    "215/55R16": { load: "93", speed: "V" },
    "215/55R17": { load: "94", speed: "W" },
    "225/55R17": { load: "97", speed: "W" },
    "235/55R17": { load: "99", speed: "W" },
    "235/55R18": { load: "100", speed: "W" },
    "215/60R16": { load: "95", speed: "V" }
  },
  "Solus TA71": {
    "245/40R17": { load: "91", speed: "W" },
    "255/40R17": { load: "94", speed: "W" },
    "225/40R18": { load: "92", speed: "V", xl: true },
    "235/40R18": { load: "95", speed: "W", xl: true },
    "245/40R18": { load: "97", speed: "W", xl: true },
    "245/40R19": { load: "98", speed: "W", xl: true },
    "255/40R19": { load: "100", speed: "W", xl: true },
    "225/45R17": { load: "91", speed: "W" },
    "235/45R17": { load: "97", speed: "W", xl: true },
    "245/45R17": { load: "99", speed: "W", xl: true },
    "225/45R18": { load: "95", speed: "W", xl: true },
    "235/45R18": { load: "98", speed: "V", xl: true },
    "245/45R18": { load: "100", speed: "W", xl: true },
    "255/45R18": { load: "99", speed: "W" },
    "245/45R19": { load: "102", speed: "W", xl: true },
    "205/50R17": { load: "93", speed: "V", xl: true },
    "215/50R17": { load: "95", speed: "V", xl: true },
    "225/50R17": { load: "98", speed: "W", xl: true },
    "235/50R17": { load: "96", speed: "V" },
    "245/50R17": { load: "99", speed: "V" },
    "225/50R18": { load: "95", speed: "W" },
    "235/50R18": { load: "97", speed: "W" },
    "245/50R18": { load: "104", speed: "V", xl: true },
    "205/55R16": { load: "91", speed: "V" },
    "215/55R16": { load: "97", speed: "V", xl: true },
    "225/55R16": { load: "95", speed: "V" },
    "215/55R17": { load: "94", speed: "V" },
    "225/55R17": { load: "101", speed: "V", xl: true },
    "235/55R17": { load: "103", speed: "W", xl: true },
    "235/55R18": { load: "100", speed: "V" },
    "195/60R15": { load: "88", speed: "V" },
    "205/60R16": { load: "96", speed: "V", xl: true },
    "215/60R16": { load: "95", speed: "V" },
    "225/60R16": { load: "98", speed: "V" },
    "225/60R18": { load: "100", speed: "V" },
    "195/65R15": { load: "91", speed: "V" },
    "205/65R15": { load: "94", speed: "V" },
    "205/65R16": { load: "95", speed: "V" }
  },
  "Solus TA31": {
    "215/40R18": { load: "89", speed: "V", xl: true },
    "225/40R18": { load: "88", speed: "V" },
    "245/40R18": { load: "97", speed: "V", xl: true },
    "215/45R17": { load: "91", speed: "V", xl: true },
    "225/45R17": { load: "94", speed: "V", xl: true },
    "245/45R17": { load: "99", speed: "V", xl: true },
    "225/45R18": { load: "95", speed: "V", xl: true },
    "235/45R18": { load: "94", speed: "V" },
    "245/45R18": { load: "100", speed: "V", xl: true },
    "175/50R15": { load: "75", speed: "H" },
    "205/50R17": { load: "93", speed: "V", xl: true },
    "215/50R17": { load: "95", speed: "V", xl: true },
    "225/50R17": { load: "98", speed: "V", xl: true },
    "235/50R18": { load: "101", speed: "V", xl: true },
    "245/50R18": { load: "104", speed: "V", xl: true },
    "185/55R15": { load: "82", speed: "H" },
    "195/55R15": { load: "85", speed: "H" },
    "205/55R16": { load: "91", speed: "H" },
    "215/55R16": { load: "97", speed: "H", xl: true },
    "225/55R16": { load: "99", speed: "H", xl: true },
    "235/55R16": { load: "98", speed: "H" },
    "215/55R17": { load: "94", speed: "V" },
    "225/55R17": { load: "97", speed: "V" },
    "235/55R17": { load: "103", speed: "V", xl: true },
    "165/60R14": { load: "75", speed: "H" },
    "195/60R14": { load: "86", speed: "H" },
    "165/60R15": { load: "77", speed: "H" },
    "185/60R15": { load: "84", speed: "H" },
    "195/60R15": { load: "88", speed: "H" },
    "205/60R15": { load: "91", speed: "H" },
    "205/60R16": { load: "92", speed: "H" },
    "215/60R16": { load: "95", speed: "H" },
    "225/60R16": { load: "98", speed: "H" },
    "235/60R16": { load: "100", speed: "H" },
    "225/60R17": { load: "99", speed: "H" },
    "185/65R14": { load: "86", speed: "H" },
    "185/65R15": { load: "88", speed: "H" },
    "195/65R15": { load: "91", speed: "H" },
    "205/65R15": { load: "94", speed: "H" },
    "215/65R15": { load: "96", speed: "H" },
    "205/65R16": { load: "95", speed: "H" },
    "215/65R16": { load: "98", speed: "H" },
    "225/65R16": { load: "100", speed: "T" },
    "155/70R14": { load: "77", speed: "H" },
    "195/70R14": { load: "91", speed: "H" }
  },
  "Solus TA11": {
    "205/55R16": { load: "91", speed: "T" },
    "185/60R15": { load: "84", speed: "T" },
    "195/60R15": { load: "88", speed: "T" },
    "205/60R15": { load: "91", speed: "T" },
    "215/60R15": { load: "94", speed: "T" },
    "205/60R16": { load: "92", speed: "T" },
    "215/60R16": { load: "95", speed: "T" },
    "225/60R16": { load: "98", speed: "T" },
    "235/60R16": { load: "100", speed: "T" },
    "215/60R17": { load: "96", speed: "T" },
    "225/60R17": { load: "99", speed: "T" },
    "235/60R17": { load: "102", speed: "T" },
    "175/65R14": { load: "82", speed: "T" },
    "185/65R14": { load: "86", speed: "T" },
    "185/65R15": { load: "88", speed: "T" },
    "195/65R15": { load: "91", speed: "T" },
    "205/65R15": { load: "94", speed: "T" },
    "215/65R15": { load: "96", speed: "T" },
    "215/65R16": { load: "98", speed: "T" },
    "225/65R16": { load: "100", speed: "T" },
    "235/65R16": { load: "103", speed: "T" },
    "215/65R17": { load: "99", speed: "T" },
    "225/65R17": { load: "102", speed: "T" },
    "235/65R17": { load: "104", speed: "T" },
    "235/65R18": { load: "106", speed: "T" },
    "175/70R13": { load: "82", speed: "T" },
    "185/70R13": { load: "86", speed: "T" },
    "185/70R14": { load: "88", speed: "T" },
    "195/70R14": { load: "91", speed: "T" },
    "215/70R14": { load: "96", speed: "T" },
    "205/70R15": { load: "96", speed: "T" },
    "215/70R15": { load: "98", speed: "T" },
    "225/70R15": { load: "100", speed: "T" },
    "235/70R15": { load: "103", speed: "T" },
    "215/70R16": { load: "100", speed: "T" },
    "225/70R16": { load: "103", speed: "T" },
    "235/70R16": { load: "106", speed: "T" },
    "195/75R14": { load: "92", speed: "T" },
    "205/75R14": { load: "95", speed: "T" },
    "205/75R15": { load: "97", speed: "T" },
    "215/75R15": { load: "100", speed: "T" },
    "225/75R15": { load: "102", speed: "T" },
    "235/75R15": { load: "105", speed: "T" },
    "155/80R13": { load: "79", speed: "T" }
  },
  "Sense KR26": {
    "175/50R15": { load: "75", speed: "H" },
    "225/50R17": { load: "94", speed: "H" },
    "195/55R15": { load: "85", speed: "H" },
    "205/55R16": { load: "91", speed: "H" },
    "215/55R16": { load: "93", speed: "H" },
    "225/55R16": { load: "95", speed: "H" },
    "215/55R17": { load: "94", speed: "H" },
    "225/55R17": { load: "97", speed: "H" },
    "235/55R17": { load: "99", speed: "H" },
    "175/60R13": { load: "77", speed: "H" },
    "165/60R14": { load: "75", speed: "H" },
    "185/60R14": { load: "82", speed: "H" },
    "195/60R14": { load: "86", speed: "H" },
    "185/60R15": { load: "84", speed: "H" },
    "195/60R15": { load: "88", speed: "H" },
    "205/60R15": { load: "91", speed: "H" },
    "195/60R16": { load: "89", speed: "H" },
    "205/60R16": { load: "92", speed: "H" },
    "215/60R16": { load: "95", speed: "H" },
    "225/60R16": { load: "98", speed: "H" },
    "155/65R13": { load: "73", speed: "H" },
    "165/65R13": { load: "77", speed: "H" },
    "155/65R14": { load: "75", speed: "H" },
    "175/65R14": { load: "82", speed: "H" },
    "185/65R14": { load: "86", speed: "H" },
    "175/65R15": { load: "84", speed: "H" },
    "185/65R15": { load: "88", speed: "H" },
    "195/65R15": { load: "91", speed: "H" },
    "205/65R15": { load: "94", speed: "H" },
    "215/65R15": { load: "96", speed: "H" },
    "205/65R16": { load: "95", speed: "H" },
    "215/65R16": { load: "98", speed: "H" },
    "225/65R16": { load: "100", speed: "H" },
    "225/65R17": { load: "102", speed: "H" },
    "155/70R13": { load: "75", speed: "H" },
    "165/70R13": { load: "79", speed: "T" },
    "175/70R13": { load: "82", speed: "H" },
    "165/70R14": { load: "81", speed: "T" },
    "175/70R14": { load: "84", speed: "T" },
    "185/70R14": { load: "88", speed: "T" },
    "195/70R14": { load: "91", speed: "H" },
    "205/70R15": { load: "96", speed: "T" },
    "215/70R15": { load: "98", speed: "T" },
    "205/75R15": { load: "97", speed: "T" },
    "145/80R13": { load: "75", speed: "T" },
    "155/80R13": { load: "79", speed: "T" }
  },
  "Ecsta PS91": {
    "255/30R19": { load: "91", speed: "Y", xl: true },
    "265/30R19": { load: "93", speed: "Y", xl: true },
    "275/30R19": { load: "96", speed: "Y", xl: true },
    "285/30R19": { load: "98", speed: "Y", xl: true },
    "295/30R19": { load: "100", speed: "Y", xl: true },
    "305/30R19": { load: "102", speed: "Y", xl: true },
    "295/30R20": { load: "101", speed: "Y", xl: true },
    "245/35R18": { load: "92", speed: "Y", xl: true },
    "255/35R18": { load: "94", speed: "Y", xl: true },
    "265/35R18": { load: "97", speed: "Y", xl: true },
    "275/35R18": { load: "99", speed: "Y", xl: true },
    "225/35R19": { load: "88", speed: "Y", xl: true },
    "235/35R19": { load: "91", speed: "Y", xl: true },
    "245/35R19": { load: "93", speed: "Y", xl: true },
    "255/35R19": { load: "96", speed: "Y", xl: true },
    "265/35R19": { load: "98", speed: "Y", xl: true },
    "275/35R19": { load: "100", speed: "Y", xl: true },
    "285/35R19": { load: "103", speed: "Y", xl: true },
    "245/35R20": { load: "95", speed: "Y", xl: true },
    "255/35R20": { load: "97", speed: "Y", xl: true },
    "265/35R20": { load: "99", speed: "Y", xl: true },
    "275/35R20": { load: "102", speed: "Y", xl: true },
    "285/35R20": { load: "104", speed: "Y", xl: true },
    "295/35R20": { load: "105", speed: "Y", xl: true },
    "225/40R18": { load: "92", speed: "Y", xl: true },
    "235/40R18": { load: "95", speed: "Y", xl: true },
    "245/40R18": { load: "97", speed: "Y", xl: true },
    "255/40R18": { load: "99", speed: "Y", xl: true },
    "265/40R18": { load: "101", speed: "Y", xl: true },
    "275/40R18": { load: "103", speed: "Y", xl: true },
    "225/40R19": { load: "93", speed: "Y", xl: true },
    "245/40R19": { load: "98", speed: "Y", xl: true },
    "255/40R19": { load: "100", speed: "Y", xl: true },
    "275/40R19": { load: "105", speed: "Y", xl: true },
    "285/40R19": { load: "107", speed: "Y", xl: true },
    "255/40R20": { load: "101", speed: "Y", xl: true },
    "275/40R20": { load: "106", speed: "Y", xl: true },
    "225/45R18": { load: "95", speed: "Y", xl: true },
    "245/45R18": { load: "100", speed: "Y", xl: true },
    "245/45R19": { load: "102", speed: "Y", xl: true },
    "255/45R19": { load: "104", speed: "Y", xl: true },
    "245/45R20": { load: "103", speed: "Y", xl: true }
  },
  "Road Venture AT52": {
    "215/75R15": { load: "106", speed: "R" },
    "235/75R15": { load: "109", speed: "T" },
    "225/75R16": { load: "115", speed: "S" },
    "235/70R16": { load: "106", speed: "T" },
    "235/85R16": { load: "120", speed: "S" },
    "245/70R16": { load: "111", speed: "T" },
    "245/75R16": { load: "120", speed: "S" },
    "255/70R16": { load: "111", speed: "T" },
    "265/70R16": { load: "112", speed: "T" },
    "265/75R16": { load: "123", speed: "R" },
    "285/75R16": { load: "126", speed: "R" },
    "225/70R17": { load: "108", speed: "S" },
    "235/65R17": { load: "108", speed: "T" },
    "235/80R17": { load: "120", speed: "R" },
    "245/70R17": { load: "119", speed: "S" },
    "245/75R17": { load: "121", speed: "S" },
    "265/65R17": { load: "112", speed: "T" },
    "265/70R17": { load: "121", speed: "S" },
    "275/70R17": { load: "121", speed: "R" },
    "285/70R17": { load: "121", speed: "R" },
    "315/70R17": { load: "121", speed: "S" },
    "255/60R18": { load: "112", speed: "T" },
    "265/60R18": { load: "110", speed: "T" },
    "265/65R18": { load: "114", speed: "T" },
    "265/70R18": { load: "124", speed: "S" },
    "275/65R18": { load: "123", speed: "S" },
    "275/70R18": { load: "125", speed: "S" },
    "285/60R18": { load: "118", speed: "S" },
    "285/65R18": { load: "125", speed: "S" },
    "295/70R18": { load: "129", speed: "S" },
    "275/55R20": { load: "120", speed: "S" },
    "275/60R20": { load: "115", speed: "T" },
    "275/65R20": { load: "126", speed: "S" },
    "285/55R20": { load: "122", speed: "R" },
    "285/60R20": { load: "125", speed: "S" },
    "305/55R20": { load: "121", speed: "S" }
  },
  "Solus KL21 eco": {
    "275/45R19": { load: "108", speed: "V", xl: true },
    "285/45R19": { load: "107", speed: "V" },
    "235/50R19": { load: "99", speed: "H" },
    "255/50R19": { load: "107", speed: "V", xl: true },
    "245/50R20": { load: "102", speed: "V" },
    "255/50R20": { load: "109", speed: "V", xl: true },
    "265/50R20": { load: "107", speed: "V" },
    "225/55R18": { load: "98", speed: "H" },
    "235/55R18": { load: "104", speed: "V", xl: true },
    "255/55R18": { load: "109", speed: "V", xl: true },
    "235/55R19": { load: "105", speed: "V", xl: true },
    "245/55R19": { load: "103", speed: "H" },
    "255/55R19": { load: "111", speed: "V", xl: true },
    "275/55R19": { load: "111", speed: "V" },
    "215/60R17": { load: "96", speed: "H" },
    "225/60R17": { load: "99", speed: "H" },
    "235/60R17": { load: "102", speed: "T" },
    "255/60R17": { load: "106", speed: "V" },
    "235/60R18": { load: "103", speed: "H" },
    "245/60R18": { load: "105", speed: "H" },
    "265/60R18": { load: "110", speed: "V" },
    "275/60R18": { load: "113", speed: "V" },
    "255/60R19": { load: "108", speed: "H" },
    "215/65R16": { load: "98", speed: "H" },
    "235/65R16": { load: "103", speed: "T" },
    "225/65R17": { load: "102", speed: "H" },
    "235/65R17": { load: "103", speed: "T" },
    "245/65R17": { load: "107", speed: "H" },
    "235/65R18": { load: "106", speed: "T" },
    "245/65R18": { load: "110", speed: "H" },
    "255/65R18": { load: "109", speed: "H" },
    "275/65R18": { load: "114", speed: "T" },
    "215/70R16": { load: "100", speed: "H" },
    "235/70R16": { load: "104", speed: "T" },
    "265/70R18": { load: "114", speed: "T" }
  },
  "Ecsta X3": {
    "255/30R22": { load: "95", speed: "W", xl: true },
    "315/35R20": { load: "106", speed: "W" },
    "285/35R22": { load: "106", speed: "W", xl: true },
    "275/40R20": { load: "106", speed: "Y", xl: true },
    "275/45R19": { load: "108", speed: "Y", xl: true },
    "285/45R19": { load: "107", speed: "W" },
    "275/45R20": { load: "110", speed: "Y", xl: true },
    "235/50R18": { load: "97", speed: "V" },
    "255/50R19": { load: "103", speed: "W" },
    "225/55R17": { load: "97", speed: "W" },
    "255/55R18": { load: "109", speed: "W", xl: true },
    "285/55R18": { load: "113", speed: "V" },
    "255/55R19": { load: "111", speed: "V", xl: true },
    "235/60R16": { load: "100", speed: "H" },
    "255/60R17": { load: "106", speed: "H" },
    "255/60R18": { load: "108", speed: "V" },
    "265/60R18": { load: "100", speed: "V" },
    "255/65R16": { load: "109", speed: "V" },
    "255/65R17": { load: "110", speed: "V" },
    "235/70R16": { load: "106", speed: "H" },
    "245/70R16": { load: "107", speed: "H" },
    "265/70R16": { load: "112", speed: "V" }
  },
  "Road Venture AT51": {
    "275/55R20": { load: "111", speed: "T" },
    "285/55R20": { load: "122", speed: "R" },
    "275/60R20": { load: "114", speed: "T" },
    "235/65R17": { load: "104", speed: "T" },
    "245/65R17": { load: "105", speed: "T" },
    "265/65R17": { load: "110", speed: "T" },
    "275/65R18": { load: "114", speed: "T" },
    "285/65R18": { load: "125", speed: "R" },
    "275/65R20": { load: "126", speed: "R" },
    "235/70R16": { load: "104", speed: "T" },
    "245/70R16": { load: "106", speed: "T" },
    "265/70R16": { load: "111", speed: "T" },
    "305/70R16": { load: "124", speed: "R" },
    "245/70R17": { load: "108", speed: "T" },
    "255/70R17": { load: "110", speed: "T" },
    "265/70R17": { load: "113", speed: "T" },
    "275/70R17": { load: "114", speed: "R" },
    "285/70R17": { load: "121", speed: "R" },
    "315/70R17": { load: "121", speed: "R" },
    "265/70R18": { load: "114", speed: "T" },
    "275/70R18": { load: "125", speed: "R" },
    "215/75R15": { load: "106", speed: "R" },
    "235/75R15": { load: "108", speed: "T", xl: true },
    "225/75R16": { load: "115", speed: "R" },
    "245/75R16": { load: "109", speed: "T" },
    "265/75R16": { load: "114", speed: "T" },
    "285/75R16": { load: "126", speed: "R" },
    "315/75R16": { load: "121", speed: "R" },
    "245/75R17": { load: "121", speed: "R" },
    "235/80R17": { load: "120", speed: "R" },
    "215/85R16": { load: "115", speed: "R" },
    "235/85R16": { load: "120", speed: "R" }
  },
  "Crugen HP91": {
    "315/35R20": { load: "110", speed: "Y", xl: true },
    "295/35R21": { load: "107", speed: "Y", xl: true },
    "275/40R20": { load: "106", speed: "Y", xl: true },
    "235/45R19": { load: "95", speed: "W" },
    "275/45R19": { load: "108", speed: "Y", xl: true },
    "285/45R19": { load: "107", speed: "W" },
    "255/45R20": { load: "105", speed: "W", xl: true },
    "275/45R20": { load: "110", speed: "Y", xl: true },
    "235/50R18": { load: "97", speed: "W" },
    "255/50R19": { load: "103", speed: "W" },
    "265/50R19": { load: "110", speed: "Y", xl: true },
    "265/50R20": { load: "111", speed: "V", xl: true },
    "225/55R17": { load: "97", speed: "W" },
    "235/55R17": { load: "99", speed: "V" },
    "225/55R18": { load: "98", speed: "V" },
    "255/55R18": { load: "109", speed: "W", xl: true },
    "285/55R18": { load: "113", speed: "V" },
    "235/55R19": { load: "101", speed: "V" },
    "255/55R19": { load: "111", speed: "V", xl: true },
    "255/60R17": { load: "106", speed: "V" },
    "235/60R18": { load: "107", speed: "V", xl: true },
    "265/60R18": { load: "110", speed: "V" },
    "285/60R18": { load: "116", speed: "V" },
    "235/65R17": { load: "104", speed: "V" },
    "255/65R17": { load: "110", speed: "V" },
    "265/65R17": { load: "112", speed: "V" },
    "285/65R17": { load: "116", speed: "H" },
    "265/70R16": { load: "112", speed: "V" }
  },
  "Road Venture MT51": {
    "195/70R15": { load: "100", speed: "R" },
    "205/70R15": { load: "104", speed: "S" },
    "245/70R16": { load: "117", speed: "Q" },
    "255/70R16": { load: "115", speed: "Q" },
    "265/70R16": { load: "117", speed: "Q" },
    "225/70R17": { load: "110", speed: "Q" },
    "245/70R17": { load: "119", speed: "Q" },
    "265/70R17": { load: "121", speed: "Q" },
    "235/75R15": { load: "104", speed: "Q" },
    "225/75R16": { load: "115", speed: "Q" },
    "245/75R16": { load: "120", speed: "N" },
    "265/75R16": { load: "123", speed: "Q" },
    "285/75R16": { load: "126", speed: "Q" },
    "195/80R15": { load: "107", speed: "R" },
    "32X11.5R15": { load: "113", speed: "Q" },
    "33X12.5R15": { load: "108", speed: "Q" }
  },
  "Portran KC53": {
    "195/65R16": { load: "104", speed: "T" },
    "215/65R16": { load: "109", speed: "T" },
    "195/70R15": { load: "104", speed: "R" },
    "205/70R15": { load: "106", speed: "R" },
    "215/70R15": { load: "109", speed: "T" },
    "225/70R15": { load: "112", speed: "R" },
    "215/70R16": { load: "108", speed: "T" },
    "195/75R16": { load: "107", speed: "T" },
    "215/75R16": { load: "116", speed: "R" },
    "195/80R15": { load: "107", speed: "R" }
  },
  "Crugen HP71": {
    "255/60R15": { load: "102", speed: "V" },
    "275/60R15": { load: "107", speed: "V" },
    "295/50R15": { load: "108", speed: "H" },
    "215/70R16": { load: "100", speed: "H" },
    "225/70R16": { load: "103", speed: "H" },
    "235/60R16": { load: "100", speed: "V" },
    "235/70R16": { load: "109", speed: "H", xl: true },
    "255/65R16": { load: "109", speed: "V" },
    "225/60R17": { load: "99", speed: "V" },
    "225/65R17": { load: "102", speed: "V" },
    "235/55R17": { load: "103", speed: "V", xl: true },
    "235/60R17": { load: "102", speed: "V" },
    "235/65R17": { load: "104", speed: "V" },
    "265/65R17": { load: "112", speed: "H" },
    "225/55R18": { load: "98", speed: "V" },
    "225/60R18": { load: "104", speed: "V", xl: true },
    "235/55R18": { load: "104", speed: "V", xl: true },
    "235/60R18": { load: "107", speed: "V", xl: true },
    "235/65R18": { load: "110", speed: "V", xl: true },
    "245/60R18": { load: "105", speed: "V" },
    "255/55R18": { load: "109", speed: "V", xl: true },
    "255/60R18": { load: "108", speed: "V" },
    "265/60R18": { load: "110", speed: "V" },
    "225/55R19": { load: "99", speed: "V" },
    "235/45R19": { load: "95", speed: "H" },
    "235/50R19": { load: "99", speed: "H" },
    "235/55R19": { load: "101", speed: "V" },
    "245/45R19": { load: "98", speed: "H" },
    "245/50R19": { load: "105", speed: "V", xl: true },
    "245/55R19": { load: "103", speed: "H" },
    "255/50R19": { load: "107", speed: "V", xl: true },
    "255/55R19": { load: "111", speed: "V", xl: true },
    "255/60R19": { load: "113", speed: "V", xl: true },
    "265/50R19": { load: "110", speed: "V", xl: true },
    "265/55R19": { load: "109", speed: "V" },
    "275/55R19": { load: "111", speed: "H" },
    "235/55R20": { load: "102", speed: "H" },
    "245/45R20": { load: "103", speed: "V", xl: true },
    "245/50R20": { load: "102", speed: "V" },
    "255/45R20": { load: "105", speed: "V", xl: true },
    "255/50R20": { load: "109", speed: "V", xl: true },
    "255/55R20": { load: "110", speed: "H", xl: true },
    "265/45R20": { load: "108", speed: "W", xl: true },
    "265/50R20": { load: "111", speed: "V", xl: true },
    "275/40R20": { load: "106", speed: "W", xl: true },
    "275/45R20": { load: "110", speed: "V", xl: true },
    "275/50R20": { load: "109", speed: "H" },
    "285/50R20": { load: "116", speed: "V", xl: true },
    "295/40R21": { load: "111", speed: "W", xl: true },
    "265/35R22": { load: "102", speed: "W", xl: true },
    "265/40R22": { load: "106", speed: "W", xl: true },
    "285/45R22": { load: "114", speed: "H", xl: true }
  },
  "Crugen HT51": {
    "215/70R15": { load: "98", speed: "T" },
    "225/70R15": { load: "100", speed: "T" },
    "235/75R15": { load: "109", speed: "T", xl: true },
    "215/65R16": { load: "102", speed: "T", xl: true },
    "215/70R16": { load: "99", speed: "T" },
    "225/70R16": { load: "103", speed: "T" },
    "225/75R16": { load: "104", speed: "T" },
    "235/60R16": { load: "104", speed: "T", xl: true },
    "235/70R16": { load: "106", speed: "T" },
    "235/75R16": { load: "106", speed: "T" },
    "235/85R16": { load: "120", speed: "R" },
    "245/70R16": { load: "111", speed: "T", xl: true },
    "245/75R16": { load: "120", speed: "Q" },
    "255/70R16": { load: "111", speed: "T" },
    "265/70R16": { load: "117", speed: "Q" },
    "265/75R16": { load: "123", speed: "R" },
    "275/70R16": { load: "114", speed: "T" },
    "225/65R17": { load: "102", speed: "T" },
    "235/60R17": { load: "102", speed: "T" },
    "235/65R17": { load: "104", speed: "T" },
    "245/65R17": { load: "111", speed: "T", xl: true },
    "245/70R17": { load: "119", speed: "S" },
    "255/65R17": { load: "110", speed: "T" },
    "255/70R17": { load: "112", speed: "T" },
    "265/65R17": { load: "112", speed: "T" },
    "265/70R17": { load: "121", speed: "S" },
    "235/60R18": { load: "103", speed: "H" },
    "245/60R18": { load: "105", speed: "T" },
    "255/60R18": { load: "112", speed: "H" },
    "265/60R18": { load: "110", speed: "T" },
    "265/65R18": { load: "112", speed: "T" },
    "245/55R19": { load: "103", speed: "T" },
    "265/50R20": { load: "111", speed: "T" },
    "275/60R20": { load: "114", speed: "T" },
    "275/65R20": { load: "126", speed: "R" }
  }
  },
};

// Look up official load/speed for a brand+pattern+size. Returns { load, speed, xl } or null.
function lookupSpec(brand, pattern, width, aspect, rim) {
  if (!brand || !width || !aspect || !rim) return null;
  const bKey = Object.keys(TIRE_SPECS).find(b => b.toLowerCase() === brand.toLowerCase());
  if (!bKey) return null;
  const patterns = TIRE_SPECS[bKey];
  const pKey = Object.keys(patterns).find(p => p.toLowerCase() === (pattern || "").toLowerCase());
  if (!pKey) return null;
  const sizeKey = `${width}/${aspect}R${rim}`;
  return patterns[pKey][sizeKey] || null;
}

// All known patterns for a brand: catalog (from SEED) + core list, deduped (case-insensitive)
function patternsForBrand(brand) {
  const key = (brand || "").toLowerCase();
  const fromCatalog = (typeof SEED_PATTERNS_BY_BRAND !== "undefined" && SEED_PATTERNS_BY_BRAND[key]) || [];
  const fromCore = CORE_PATTERNS[key] || [];
  const seen = new Set();
  const out = [];
  for (const p of [...fromCatalog, ...fromCore]) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(p);
  }
  return out.sort();
}

function normalizePattern(input, brand, catalogPatterns) {
  const raw = (input || "").trim();
  if (!raw) return { value: "", original: raw, corrected: false, suggestions: [] };
  const pats = (catalogPatterns && catalogPatterns.length) ? catalogPatterns : (CORE_PATTERNS[(brand || "").toLowerCase()] || []);
  if (!pats.length) return { value: raw, original: raw, corrected: false, suggestions: [] };
  const lc = raw.toLowerCase();
  const rawNoSpace = lc.replace(/[\s\-]/g, "");

  // 1) exact case-insensitive match → snap to catalog's spelling
  const exact = pats.find(p => p.toLowerCase() === lc);
  if (exact) {
    const fam = pats.filter(p => p !== exact && p.toLowerCase().startsWith(exact.toLowerCase() + " "));
    return { value: exact, original: raw, corrected: false, suggestions: fam.slice(0, 6) };
  }
  // 2) space-insensitive exact (e.g. "pzero" === "P ZERO" without spaces)
  const noSpaceExact = pats.find(p => p.toLowerCase().replace(/[\s\-]/g, "") === rawNoSpace);
  if (noSpaceExact) {
    const fam = pats.filter(p => p !== noSpaceExact && p.toLowerCase().startsWith(noSpaceExact.toLowerCase() + " "));
    return { value: noSpaceExact, original: raw, corrected: true, suggestions: fam.slice(0, 6) };
  }
  // 3) prefix family (typed a base that starts several patterns, e.g. "Scorpion")
  const prefixFam = pats.filter(p => p.toLowerCase().startsWith(lc + " "));
  if (prefixFam.length > 0) {
    const titledBase = raw.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    return { value: titledBase, original: raw, corrected: titledBase !== raw, suggestions: prefixFam.slice(0, 6) };
  }

  // 4) Score every pattern by the BEST match among: whole, space-stripped whole, and each word.
  //    This catches typed tokens that appear *inside* a longer pattern (e.g. "at52" in "Road Venture AT52").
  let best = null, bestScore = 99, bestExactWord = false;
  for (const p of pats) {
    const pl = p.toLowerCase();
    const candidates = [pl, pl.replace(/[\s\-]/g, "")];
    let wordHit = false;
    for (const w of pl.split(/[\s\-\/]+/)) {
      candidates.push(w);
      if (w === lc || w.replace(/[\s\-]/g, "") === rawNoSpace) wordHit = true;
    }
    let d = 99;
    for (const c of candidates) {
      d = Math.min(d, levenshtein(rawNoSpace, c.replace(/[\s\-]/g, "")), levenshtein(lc, c));
    }
    // prefer an exact word hit strongly
    const score = wordHit ? -1 : d;
    if (score < bestScore) { bestScore = score; best = p; bestExactWord = wordHit; }
  }
  if (best && (bestExactWord || bestScore <= 2)) {
    // family suggestions: patterns that share the matched root word
    const rootWord = best.split(/[\s\-\/]+/).find(w => w.toLowerCase() === lc || w.toLowerCase().replace(/[\s\-]/g, "") === rawNoSpace);
    let fam = [];
    if (rootWord) {
      fam = pats.filter(p => p !== best && new RegExp(`\\b${rootWord}\\b`, "i").test(p));
    } else {
      const baseTwo = best.split(" ").slice(0, 2).join(" ");
      fam = pats.filter(p => p !== best && p.toLowerCase().startsWith(baseTwo.toLowerCase()));
    }
    return { value: best, original: raw, corrected: best.toLowerCase() !== lc, suggestions: fam.slice(0, 6) };
  }
  // 4) no match → keep as typed
  return { value: raw, original: raw, corrected: false, suggestions: [] };
}

// Normalize a typed brand → { value, original, corrected }
// 1) exact (case-insensitive) match → snap to official spelling, silent
// 2) conservative typo (edit distance ≤2, and length ≥4) → suggest correction (flagged)
// 3) otherwise → keep as typed (Title Case), treated as new brand
function normalizeBrand(input) {
  const raw = (input || "").trim();
  if (!raw) return { value: "", original: raw, corrected: false };
  // exact case-insensitive match
  const exact = CANON_BRANDS.find(b => b.toLowerCase() === raw.toLowerCase());
  if (exact) return { value: exact, original: raw, corrected: false };
  // also handle the "BF Goodrich" alias
  if (raw.toLowerCase().replace(/\s/g, "") === "bfgoodrich") return { value: "BFGoodrich", original: raw, corrected: false };
  // conservative typo match (only for inputs of decent length)
  if (raw.length >= 4) {
    let best = null, bestD = 3;
    for (const b of CANON_BRANDS) {
      const d = levenshtein(raw, b);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best && bestD <= 2) return { value: best, original: raw, corrected: true };
  }
  // unknown → keep as typed, Title Case
  const titled = raw.charAt(0).toUpperCase() + raw.slice(1);
  return { value: titled, original: raw, corrected: false };
}

// current year + last 2
const YEAR_OPTIONS = (() => { const y = new Date().getFullYear(); return [String(y), String(y - 1), String(y - 2)]; })();

// Parse a supplier quote (free text) into tire draft rows.
function parseSupplierQuote(text) {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const drafts = [];
  let currentSize = null;       // last seen size on its own / in F:/R: header
  let position = "";            // 'front' | 'rear' | ''

  for (let raw of lines) {
    let line = raw.replace(/\*/g, " ").trim();
    if (!line) continue;

    // Position + size headers: "F: 245/35R20", "R: 305/30R20"
    const posMatch = line.match(/^([FR])\s*:/i);
    if (posMatch) position = /f/i.test(posMatch[1]) ? "front" : "rear";

    // any size in the line
    const sz = parseSize(line);
    if (sz) currentSize = sz;

    // brand detection
    let brand = "";
    for (const b of KNOWN_BRANDS) {
      if (new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(line)) { brand = b; break; }
    }
    // fallback: predict brand from pattern/keywords if not found
    if (!brand) brand = brandFromPattern(line);
    // normalize a couple
    if (/^roadx$/i.test(brand)) brand = "RoadX";
    if (/^bf goodrich$/i.test(brand)) brand = "BFGoodrich";

    // skip pure header lines with no brand and no price
    const priceNums = (line.match(/\d+(?:\.\d+)?/g) || []).map(Number);

    // cost/price number: look for a number near 'kd' or a standalone price-like number
    let amount = null;
    const kdMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:kd|د\.?ك)/i);
    if (kdMatch) amount = Number(kdMatch[1]);
    else {
      // a number that isn't a year, load index, or size component
      const candidates = priceNums.filter(n => n >= 20 && n <= 900 && !(n >= 2018 && n <= 2030));
      if (candidates.length) amount = candidates[0];
    }

    // year
    const yearMatch = line.match(/\b(20[12]\d)\b/);
    const year = yearMatch ? yearMatch[1] : "";

    // country
    let country = "";
    for (const k of Object.keys(COUNTRY_ALIASES)) {
      if (new RegExp(`\\b${k}\\b`, "i").test(line)) { country = COUNTRY_ALIASES[k]; break; }
    }

    // speed rating like 91Y, 103Y
    const srMatch = line.match(/\b\d{2,3}([A-Z])\b/);
    const speedRating = srMatch ? srMatch[1] : "";

    // pattern: leftover capital tokens (best-effort) e.g. HT51, AT52, KO3, Pzero
    let pattern = "";
    const patMatch = line.match(/\b([A-Z]{2,}\d{1,3}[A-Z]?|[A-Z][a-z]+zero|AL\s?\w+|KO\d|AT\d{2}|HP\d{2}|HT\d{2})\b/);
    if (patMatch) pattern = patMatch[1];

    // Need at least a brand or a size+amount to make a row
    if (!brand && !(currentSize && amount)) continue;
    if (!brand && !amount) continue;

    drafts.push({
      brand: brand || "",
      size: currentSize,
      position,
      amountRaw: amount,        // as sent by supplier (cost OR list price)
      year, country, speedRating, pattern,
      markings: markingsNote(raw),
      sourceLine: raw,
    });
  }
  return drafts;
}


// ── Tire size parsing (smart) ────────────────────────────────────────────────
// Accepts: 265/65r18 · 265 65 18 · 2656518 · 265-65-18 · 265/65zr18 98y
function parseSize(input) {
  if (!input) return null;
  const s = input.trim().toUpperCase();
  // structure detection
  const struct = /ZR/.test(s) ? "ZR" : "R";
  // 0) FLOTATION sizes: 33x12.50R17 · 35X12.5R20 (diameter x section R rim)
  const f = s.match(/(\d{2})\s*[X×]\s*(\d{1,2}(?:\.\d{1,2})?)\s*Z?R?\s*(\d{2})/);
  if (f) return { width: f[1], aspect: f[2], rim: f[3], structure: struct, flotation: true };
  // 1) explicit separators: / space - or letters
  let m = s.match(/(\d{3})\s*[\/\s\-]\s*(\d{2})\s*(?:Z?R)?\s*[\/\s\-]?\s*(\d{2})/);
  if (m) return { width: m[1], aspect: m[2], rim: m[3], structure: struct };
  // 2) compact 7 digits: 2656518
  m = s.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (m) return { width: m[1], aspect: m[2], rim: m[3], structure: struct };
  // 3) width/aspectRrim with optional load+speed: 325/30ZR21 98Y
  m = s.match(/(\d{3})\/(\d{2})\s*Z?R?\s*(\d{2})/);
  if (m) return { width: m[1], aspect: m[2], rim: m[3], structure: struct };
  return null;
}

function sizeString(t) {
  const struct = t.structure || "R";
  const flo = t.flotation || (Number(t.width) > 0 && Number(t.width) < 100);
  let base = flo ? `${t.width}x${t.aspect}${struct}${t.rim}` : `${t.width}/${t.aspect}${struct}${t.rim}`;
  if (t.loadIndex || t.speedRating) base += ` ${t.loadIndex || ""}${t.speedRating || ""}`.trimEnd();
  return base;
}

function matchesSize(tire, parsed) {
  if (!parsed) return false;
  return tire.width === parsed.width && tire.aspect === parsed.aspect && tire.rim === parsed.rim;
}

// ── One-line tire description ─────────────────────────────────────────────────
function tireLine(t) {
  const cat = CATEGORY[t.category];
  const flag = t.country ? (COUNTRIES[t.country] || "") : "";
  const parts = [];
  parts.push(t.brand);
  if (t.pattern) parts.push(t.pattern);
  parts.push(sizeString(t));
  let line = parts.join(" ");
  const tail = [];
  if (flag || t.country) tail.push(`${flag} ${t.country}`.trim());
  if (t.year) tail.push(t.year);
  let result = line;
  if (tail.length) result += " - " + tail.join(" - ");
  return result;
}

// Brand + pattern only (no size) — for single-size lists where size is shown on top
function tireName(t) {
  const flag = t.country ? (COUNTRIES[t.country] || "") : "";
  let name = t.brand + (t.pattern ? " " + t.pattern : "");
  const tail = [];
  const ld = `${t.loadIndex || ""}${t.speedRating || ""}`.trim();
  if (ld) tail.push(ld);
  if (flag || t.country) tail.push(`${flag} ${t.country}`.trim());
  if (t.year) tail.push(t.year);
  return tail.length ? `${name} ${tail.join(" - ")}` : name;
}

// ── Storage layer (swappable) ─────────────────────────────────────────────────
// Uses in-memory state seeded with sample data. To integrate a backend, replace
// these four functions with API calls — the UI calls only these.
const SEED = [
  mkTire({ brand: "Pirelli", pattern: "Cinturato P1", width: "185", aspect: "60", structure: "R", rim: "15", cost: 35.0, price: 44, sku: "PI26781000125", loadIndex: "88", speedRating: "H", year: "2025", country: "Romania", supplier: "Behbehani (Pirelli)" }),
  mkTire({ brand: "Pirelli", pattern: "Cinturato P1", width: "185", aspect: "60", structure: "R", rim: "15", cost: 31.5, price: 40, sku: "PI26781000324", loadIndex: "88", speedRating: "H", year: "2025", country: "Romania", supplier: "Behbehani (Pirelli)" }),
  mkTire({ brand: "Pirelli", pattern: "Cinturato All Season SF 3", width: "195", aspect: "45", structure: "R", rim: "16", cost: 49.0, price: 62, sku: "PI21501000424", loadIndex: "84", speedRating: "V", year: "2025", country: "Brazil", supplier: "Behbehani (Pirelli)" }),
  mkTire({ brand: "Pirelli", pattern: "P ZERO PZ4", width: "205", aspect: "40", structure: "R", rim: "18", cost: 77.0, price: 97, sku: "PI31460000125", loadIndex: "86", speedRating: "W", year: "2025", country: "Romania", notes: "★ — BMW OE · RFT — Runflat", supplier: "Behbehani (Pirelli)" }),
  mkTire({ brand: "Pirelli", pattern: "P ZERO", width: "205", aspect: "40", structure: "ZR", rim: "18", cost: 70.0, price: 88, sku: "PI22073000225", loadIndex: "86", speedRating: "Y", year: "2025", country: "Romania", notes: "AR — Alfa Romeo OE", supplier: "Behbehani (Pirelli)" }),
  mkTire({ brand: "Pirelli", pattern: "Cinturato p7", width: "205", aspect: "45", structure: "R", rim: "17", cost: 70.0, price: 88, sku: "PI31459000125", loadIndex: "88", speedRating: "W", year: "2025", country: "Romania", notes: "★ — BMW OE · RFT — Runflat", supplier: "Behbehani (Pirelli)" }),
  mkTire({ brand: "Pirelli", pattern: "Cinturato p7", width: "205", aspect: "55", structure: "R", rim: "16", cost: 33.6, price: 42, sku: "PI23289000425", loadIndex: "91", speedRating: "V", year: "2025", country: "Romania", supplier: "Behbehani (Pirelli)" }),
  mkTire({ brand: "Pirelli", pattern: "Cinturato p7", width: "205", aspect: "55", structure: "R", rim: "16", cost: 42.0, price: 53, sku: "PI20402000125", loadIndex: "91", speedRating: "W", year: "2025", country: "Romania", notes: "RFT — Runflat", supplier: "Behbehani (Pirelli)" }),
  mkTire({ brand: "Pirelli", pattern: "Cinturato p7", width: "205", aspect: "55", structure: "R", rim: "17", cost: 52.5, price: 66, sku: "PI36441000225", loadIndex: "91", speedRating: "W", year: "2025", country: "Romania", notes: "MO — Mercedes-Benz OE", supplier: "Behbehani (Pirelli)" }),
  mkTire({ brand: "Pirelli", pattern: "Cinturato p7", width: "205", aspect: "55", structure: "R", rim: "17", cost: 63.0, price: 79, sku: "PI35411000125", loadIndex: "91", speedRating: "W", year: "2025", country: "Romania", notes: "MOE — Mercedes runflat · RFT — Runflat", supplier: "Behbehani (Pirelli)" }),
  ];

// Static pattern list per brand, computed once from SEED — reliable fallback
// independent of React state, so pattern normalization always has data.
const SEED_PATTERNS_BY_BRAND = (() => {
  const map = {};
  for (const t of SEED) {
    if (!t.pattern) continue;
    const b = (t.brand || "").toLowerCase();
    if (!map[b]) map[b] = new Set();
    map[b].add(t.pattern);
  }
  const out = {};
  Object.keys(map).forEach(b => { out[b] = [...map[b]]; });
  return out;
})();

function mkTire(d) {
  const category = detectCategory(d.brand);
  const now = new Date().toISOString();
  return {
    id: "t_" + Math.random().toString(36).slice(2, 10),
    brand: d.brand, pattern: d.pattern || "", type: d.type || "Normal",
    width: d.width, aspect: d.aspect, structure: d.structure || "R", rim: d.rim,
    loadIndex: d.loadIndex || "", speedRating: d.speedRating || "",
    country: d.country || countryForBrand(d.brand), year: d.year || "", supplier: d.supplier || "",
    sku: d.sku || "",
    cost: round3(Number(d.cost) || 0), price: round3(Number(d.price) || 0),
    category, notes: d.notes || "", inStock: false,
    history: [{ ts: now, cost: round3(Number(d.cost) || 0), price: round3(Number(d.price) || 0), note: "Created" }],
  };
}

// ── Car database (sample — extend freely) ─────────────────────────────────────
const CAR_DB = {
  "2011 porsche 911 carrera": [
    { label: 'Option 1 — 18"', sizes: ["235/40ZR18", "265/40ZR18"] },
    { label: 'Option 2 — 19"', sizes: ["235/35ZR19", "295/30ZR19"] },
  ],
  "2020 mercedes g63": [
    { label: 'Standard — 20"', sizes: ["275/50R20"] },
    { label: 'AMG — 22"', sizes: ["295/40R22"] },
  ],
  "2022 range rover sport": [
    { label: 'Standard — 21"', sizes: ["275/45R21"] },
    { label: 'Off-road — 20"', sizes: ["275/55R20"] },
  ],
  "2021 toyota land cruiser": [
    { label: 'Standard — 18"', sizes: ["265/65R18"] },
    { label: 'GR — 20"', sizes: ["265/55R20"] },
  ],
  "2019 nissan patrol": [
    { label: 'Standard — 18"', sizes: ["275/70R18"] },
    { label: 'Nismo — 22"', sizes: ["285/45R22"] },
  ],
};

// Labor rates by quantity. Standard vs center-lock (torque wrench).
const LABOR = {
  standard: { 1: 15, 2: 15, 3: 20, 4: 20, 5: 25 },
  centerlock: { 1: 25, 2: 25, 3: 40, 4: 40 }, // no 5 — center-lock cars have no spare
};
function laborFor(qty, centerlock) {
  const table = centerlock ? LABOR.centerlock : LABOR.standard;
  return table[qty] ?? table[4];
}

// ── Auto-pricing (purchaser's formula) ────────────────────────────────────────
// For brands WITHOUT agreed supplier pricing (China / Kumho / etc.).
// Margin (KD) is chosen by category + rim size, then:  price = roundUp((cost + margin) / 0.9)
// The /0.9 embeds the ~10% installment buffer (Tabby/Taly).
function marginFor(category, rim) {
  const r = parseInt(rim, 10) || 0;
  if (category === "SE") {
    // Economy Safe (China): 7–9
    if (r <= 16) return 7;
    if (r <= 19) return 8;
    return 9;
  }
  // PC / SV / TP : Smart Value, Premium Comfort, Top Performance — 7–12
  if (r <= 15) return 7;
  if (r <= 18) return 8;   // R18 = 8 (matches Kumho example: (40+8)/0.9 → 54)
  if (r <= 20) return 9;
  if (r <= 21) return 10;
  return 12;
}
// Auto price from cost + margin, rounded UP to whole KD
function autoPrice(cost, margin) {
  const c = Number(cost) || 0, m = Number(margin) || 0;
  if (c <= 0) return 0;
  return Math.ceil((c + m) / 0.9);
}

// ── Agreed-brand pricing (Michelin / Pirelli) ────────────────────────────────
// When the purchaser enters a COST (not list price) for an agreed brand, price is
// derived from a margin % off the list-price discount structure:
//   Michelin (year-dependent): 2024 → 20%, 2025 → 13%, 2026 → 17%
//   Pirelli (any year): 13%
// marginKD = round(cost × marginPct); price = roundUp(cost + marginKD).
function agreedMarginPct(brand, supplier, year) {
  const hay = `${brand || ""} ${supplier || ""}`;
  if (/pirelli/i.test(hay)) return 0.13;
  if (/michelin|bfgoodrich|bf goodrich/i.test(hay)) {
    const y = String(year || new Date().getFullYear());
    if (y === "2024") return 0.20;
    if (y === "2025") return 0.13;
    if (y === "2026") return 0.17;
    // default to current year's bracket when year missing/other
    const cy = String(new Date().getFullYear());
    return cy === "2024" ? 0.20 : cy === "2025" ? 0.13 : 0.17;
  }
  return null;
}
function agreedPrice(cost, brand, supplier, year) {
  const c = Number(cost) || 0;
  if (c <= 0) return 0;
  const pct = agreedMarginPct(brand, supplier, year);
  if (pct == null) return 0;
  const withMargin = c + c * pct;   // cost + margin (decimal kept)
  // Pirelli adds a 10% installment charge on top (÷0.9), like the standard formula.
  // Michelin's % already accounts for installment, so no extra buffer.
  const isPirelli = /pirelli/i.test(`${brand || ""} ${supplier || ""}`);
  const final = isPirelli ? withMargin / 0.9 : withMargin;
  return Math.ceil(final);           // round only the final price up
}

// ── UNIFIED PRICING (single source of truth for all entry modes) ─────────────
// Given a tire-like object {brand, supplier, category, rim, year, cost}, returns
// the auto price using the correct rule: agreed brands (Michelin/Pirelli) use the
// discount-based margin %, everyone else uses (cost + size-margin KD) ÷ 0.9.
function computeTirePrice(t) {
  const cost = Number(t.cost) || 0;
  if (cost <= 0) return 0;
  if (isAgreedPricing(t)) {
    return agreedPrice(cost, t.brand, t.supplier, t.year);
  }
  const cat = t.category || detectCategory(t.brand);
  return autoPrice(cost, autoMargin(cat, t.rim));
}
// A human-readable description of how the price was derived (for the pricing note).
function pricingExplain(t) {
  const cost = Number(t.cost) || 0;
  if (isAgreedPricing(t)) {
    const pct = agreedMarginPct(t.brand, t.supplier, t.year);
    const isPir = /pirelli/i.test(`${t.brand || ""} ${t.supplier || ""}`);
    const label = isPir ? "Pirelli" : "Michelin";
    const yr = isPir ? "" : ` · ${t.year || "current year"}`;
    const inst = isPir ? " + 10% installment" : "";
    return `${label} agreed pricing — ${Math.round((pct || 0) * 100)}% margin${inst}${yr}`;
  }
  const cat = t.category || detectCategory(t.brand);
  const m = t.rim ? autoMargin(cat, t.rim) : null;
  return m != null
    ? `Formula: (cost + ${m} KD) ÷ 0.9, rounded up`
    : `Formula: (cost + margin) ÷ 0.9`;
}

// ── Auto-margin rules (for brands without agreed supplier pricing) ────────────
// Margin in KD by category group + rim size. Price = roundUp((cost + margin) / 0.9),
// where /0.9 embeds the 10% installment buffer. SE = China economy rules;
// PC/SV/TP = the 7–12 rules.
function autoMargin(category, rim) {
  const r = parseInt(rim, 10) || 0;
  if (category === "SE") {
    // Economy Safe (China): 7–9
    if (r <= 16) return 7;
    if (r <= 19) return 8;
    return 9;
  }
  // PC / SV / TP : 7–12
  if (r <= 15) return 7;
  if (r <= 18) return 8;   // R18 = 8 (matches purchaser's Kumho example)
  if (r <= 20) return 9;
  if (r === 21) return 10;
  return 12; // R22+
}

// ── Cash discount ─────────────────────────────────────────────────────────────
// Tires from the Michelin distributor have no installment buffer baked into their
// price, so the cash discount must NOT apply to them (it would eat real margin).
// We key off the supplier, so Michelin, BFGoodrich, etc. from that distributor are
// all protected — even brands added later.
function isMichelinSupplier(t) {
  return /michelin/i.test(t.supplier || "");
}
// Suppliers/brands with agreed/fixed pricing (Michelin distributor, Pirelli distributor) —
// their prices come from the uploaded supplier lists, so the auto-margin formula
// should not be imposed on them. We check BOTH brand and supplier, because when adding
// manually the supplier may be the distributor name (e.g. "Kuwait Automotive") that
// doesn't contain the brand word.
function isAgreedPricing(t) {
  const hay = `${t.brand || ""} ${t.supplier || ""}`;
  return /michelin|bfgoodrich|bf goodrich|pirelli/i.test(hay);
}
// Effective price for a tire given the active cash-discount level (0, 6, or 10).
// Excluded suppliers (Michelin) always return the full price.
// Discounted prices are rounded UP to the nearest whole KD (never undercharge).
function effectivePrice(t, cashPct) {
  if (!cashPct || isMichelinSupplier(t)) return round3(t.price);
  return Math.ceil(t.price * (1 - cashPct / 100));
}

// Round to max 3 decimals, trimming trailing zeros (51.5 → 51.5, 51.499999 → 51.5, 48 → 48)
function round3(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

// ── Availability freshness (3 tiers) ──────────────────────────────────────────
// green 0-7 days · grey 8-15 days (aging) · red 16+ days (urgent)
const FRESH_GREEN = 7;
const FRESH_GREY = 15;
function daysSince(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
}
// returns 'green' | 'grey' | 'red' | null
function freshnessTier(ts) {
  const d = daysSince(ts);
  if (d === null) return null;
  if (d <= FRESH_GREEN) return "green";
  if (d <= FRESH_GREY) return "grey";
  return "red";
}
const FRESH_COLOR = { green: "#1D7A45", grey: "#8A8A7A", red: "#C0392B" };
function freshnessLabel(ts) {
  const d = daysSince(ts);
  if (d === null) return "";
  const ago = d === 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
  const tier = freshnessTier(ts);
  if (tier === "green") return `Confirmed ${ago}`;
  if (tier === "grey") return `Aging · ${ago}`;
  return `Check now · ${ago}`;
}
function isStale(ts) {
  const t = freshnessTier(ts);
  return t === "grey" || t === "red";
}

// ── Profit tiers (by KD amount per tire — amount is the key signal, not margin %) ──
function profitTier(profitKd) {
  if (profitKd >= 11) return { bg: "#E7EFFA", fg: "#1A4F8A", label: "high" };   // blue — push
  if (profitKd >= 7) return { bg: "#FBF4DF", fg: "#8A6A00", label: "mid" };      // yellow
  return { bg: "#F0F0EC", fg: "#777", label: "low" };                            // grey
}

// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  // ── Auth gate ──────────────────────────────────────────────────────────────
  const [authed, setAuthed] = useState(() => {
    try { return sessionStorage.getItem("bnchr_auth") === "ok"; } catch { return false; }
  });

  if (!authed) return <Login onPass={() => setAuthed(true)} />;
  return <MainApp />;
}

// ── Login screen ──────────────────────────────────────────────────────────────
function Login({ onPass }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);

  const submit = () => {
    if (pw === APP_PASSWORD) {
      try { sessionStorage.setItem("bnchr_auth", "ok"); } catch {}
      onPass();
    } else {
      setErr(true);
    }
  };

  return (
    <div style={S.loginWrap}>
      <style>{CSS}</style>
      <div style={S.loginCard}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 3, justifyContent: "center" }}>
          <span style={{ ...S.logoMark, color: "#0F2419" }}>BNCHR+</span>
          <span style={{ ...S.logoReg, color: "#C9A84C" }}>®</span>
        </div>
        <div style={S.loginSub}>Tire Purchase System</div>
        <input
          type="password"
          value={pw}
          autoFocus
          onChange={e => { setPw(e.target.value); setErr(false); }}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="Team password"
          style={{ ...S.loginInput, ...(err ? { borderColor: "#C0392B" } : {}) }}
        />
        {err && <div style={S.loginErr}>Incorrect password</div>}
        <button onClick={submit} style={S.loginBtn}>Enter</button>
      </div>
    </div>
  );
}

function MainApp() {
  const [tires, setTiresRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState("search"); // search | add | catalog
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  // Load all tires from Supabase on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Page through all rows (Supabase caps at 1000 per request)
        let all = [], from = 0, page = 1000;
        while (true) {
          const { data, error } = await supabase
            .from("tires").select("*").order("brand").range(from, from + page - 1);
          if (error) throw error;
          all = all.concat(data);
          if (data.length < page) break;
          from += page;
        }
        if (!cancelled) { setTiresRaw(all.map(rowToTire)); setLoading(false); }
      } catch (e) {
        if (!cancelled) { setLoadError(e.message || "Failed to load"); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Wrapped setter: applies the update locally, then syncs the diff to Supabase.
  const tiresRef = React.useRef(tires);
  useEffect(() => { tiresRef.current = tires; }, [tires]);

  const setTires = useCallback((updater) => {
    const prev = tiresRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    tiresRef.current = next;          // keep ref in sync immediately
    setTiresRaw(next);                // update React state
    syncToDb(prev, next, showToast);  // sync to DB as a real side-effect (outside updater)
  }, [showToast]);

  if (loading) {
    return (
      <div style={S.loginWrap}>
        <style>{CSS}</style>
        <div style={{ textAlign: "center", color: "#0F2419" }}>
          <div style={{ ...S.logoMark, color: "#0F2419", fontSize: 28 }}>BNCHR+</div>
          <div style={{ marginTop: 12, color: "#6B6B6B", fontSize: 14 }}>Loading catalog…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.app}>
      <style>{CSS}</style>
      <header style={S.header}>
        <div style={S.headerInner}>
          <div style={S.logo}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 3 }}>
              <span style={S.logoMark}>BNCHR+</span>
              <span style={S.logoReg}>®</span>
            </div>
            <span style={S.logoSub}>Tire Purchase System</span>
          </div>
          <nav style={S.nav}>
            <NavBtn active={tab === "search"} onClick={() => setTab("search")} icon={<Search size={16} />} label="Search & Quote" />
            <NavBtn active={tab === "add"} onClick={() => setTab("add")} icon={<Plus size={16} />} label="Add Tire" />
            <NavBtn active={tab === "catalog"} onClick={() => setTab("catalog")} icon={<Package size={16} />} label={`Catalog (${tires.length})`} />
            <NavBtn active={tab === "services"} onClick={() => setTab("services")} icon={<Tag size={16} />} label="Services" />
            <NavBtn active={tab === "svcquote"} onClick={() => setTab("svcquote")} icon={<Share2 size={16} />} label="Service Quote" />
          </nav>
        </div>
      </header>

      {loadError && (
        <div style={S.dbErrorBar}>
          ⚠️ Could not reach the database: {loadError}. Changes may not be saved — please refresh.
        </div>
      )}

      <main style={S.main}>
        {tab === "search" && <SearchView tires={tires} setTires={setTires} showToast={showToast} />}
        {tab === "add" && <AddView tires={tires} setTires={setTires} showToast={showToast} onDone={() => setTab("catalog")} />}
        {tab === "catalog" && <CatalogView tires={tires} setTires={setTires} showToast={showToast} />}
        {tab === "services" && <ServicesCatalogView showToast={showToast} />}
        {tab === "svcquote" && <ServiceQuoteView showToast={showToast} />}
      </main>

      {toast && <div style={S.toast}><Check size={16} /> {toast}</div>}
    </div>
  );
}

// ── DB sync: diff previous vs next tire arrays, push changes to Supabase ───────
async function syncToDb(prev, next, showToast) {
  try {
    const prevById = new Map(prev.map(t => [t.id, t]));
    const nextById = new Map(next.map(t => [t.id, t]));

    // INSERTS: tires in next with a local temp id (not yet in DB)
    const inserts = next.filter(t => !isDbId(t.id));
    // DELETES: ids in prev (that were DB rows) missing from next
    const deletes = prev.filter(t => isDbId(t.id) && !nextById.has(t.id));
    // UPDATES: DB rows present in both, with changed fields
    const updates = next.filter(t => {
      if (!isDbId(t.id)) return false;
      const p = prevById.get(t.id);
      if (!p) return false;
      return JSON.stringify(tireToRow(p)) !== JSON.stringify(tireToRow(t))
          || p._availableAt !== t._availableAt
          || !!p.inStock !== !!t.inStock;
    });

    for (const t of inserts) {
      const { data, error } = await supabase.from("tires").insert(tireToRow(t)).select().single();
      if (error) throw error;
      // swap temp id → real DB id in place (next render will reconcile)
      t.id = data.id;
    }
    for (const t of updates) {
      const row = tireToRow(t);
      // Stamp confirmation date when in stock; clear it when out of stock
      row.availability_checked_at = t.inStock ? (t._availableAt || new Date().toISOString()) : null;
      row.updated_at = new Date().toISOString();
      const { error } = await supabase.from("tires").update(row).eq("id", t.id);
      if (error) throw error;
    }
    for (const t of deletes) {
      const { error } = await supabase.from("tires").delete().eq("id", t.id);
      if (error) throw error;
    }
  } catch (e) {
    if (showToast) showToast("⚠️ Save failed — check connection");
    console.error("Supabase sync error:", e);
  }
}

function NavBtn({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick} className="navbtn" style={{ ...S.navBtn, ...(active ? S.navBtnActive : {}) }}>
      {icon}<span>{label}</span>
    </button>
  );
}

// ── SEARCH VIEW ───────────────────────────────────────────────────────────────
function SearchView({ tires, setTires, showToast }) {
  const [mode, setMode] = useState("size"); // size | car
  const [sizeA, setSizeA] = useState("");
  const [sizeB, setSizeB] = useState("");
  const [useTwoSizes, setUseTwoSizes] = useState(false);
  const [carQuery, setCarQuery] = useState("");
  const [carFilter, setCarFilter] = useState(null);
  const [selected, setSelected] = useState({}); // id -> bool (for sharing)
  const [editing, setEditing] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [qty, setQty] = useState(4); // tires customer needs
  const [centerlock, setCenterlock] = useState(false);
  const [cashPct, setCashPct] = useState(0); // cash discount: 0 (off) | 6 | 10
  const [breakdown, setBreakdown] = useState(false); // show per-tire price detail
  const [lang, setLang] = useState("ar"); // quote language: 'ar' default | 'en'
  const [history, setHistory] = useState(() => {
    // Restore recent searches from this device (per-device, last 8)
    try {
      const raw = localStorage.getItem("bnchr_search_history");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [sortBy, setSortBy] = useState("price"); // 'price' | 'profit'
  const [sortDir, setSortDir] = useState("asc"); // 'asc' (low→high, default) | 'desc' (high→low)
  const [availFilter, setAvailFilter] = useState("available"); // 'available' | 'out' | 'all'
  const [typeFilter, setTypeFilter] = useState("all"); // 'all' | 'offroad' | 'normal'
  const [showMarkings, setShowMarkings] = useState(false);
  const [showSug, setShowSug] = useState(false); // size autocomplete dropdown
  const [focusField, setFocusField] = useState(null); // 'A' | 'B' | null

  // Catalog size index — unique sizes that actually exist, with counts (for smart typing)
  const catalogSizes = useMemo(() => {
    const map = {};
    for (const t of tires) {
      const key = `${t.width}/${t.aspect}${t.structure}${t.rim}`;
      if (!map[key]) map[key] = { label: key, width: t.width, aspect: t.aspect, rim: t.rim, count: 0 };
      map[key].count++;
    }
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [tires]);

  // record a search into history (dedupe, keep last 8)
  const pushHistory = (entry) => {
    setHistory(prev => {
      const next = [entry, ...prev.filter(h => h.value !== entry.value || h.mode !== entry.mode)];
      return next.slice(0, 8);
    });
  };

  // Persist search history to this device whenever it changes
  useEffect(() => {
    try { localStorage.setItem("bnchr_search_history", JSON.stringify(history)); } catch {}
  }, [history]);

  const parsedA = useMemo(() => parseSize(sizeA), [sizeA]);
  const parsedB = useMemo(() => parseSize(sizeB), [sizeB]);

  // car lookup
  const carMatch = useMemo(() => {
    const q = carQuery.trim().toLowerCase();
    if (!q) return null;
    const key = Object.keys(CAR_DB).find(k => k.includes(q) || q.includes(k));
    return key ? { key, options: CAR_DB[key] } : null;
  }, [carQuery]);

  // Determine active search sizes
  const activeSizes = useMemo(() => {
    if (mode === "car" && carMatch) {
      let opts = carMatch.options;
      if (carFilter != null) opts = [carMatch.options[carFilter]];
      const sizes = opts.flatMap(o => o.sizes).map(parseSize).filter(Boolean);
      return sizes;
    }
    const arr = [];
    if (parsedA) arr.push(parsedA);
    if (useTwoSizes && parsedB) arr.push(parsedB);
    return arr;
  }, [mode, carMatch, carFilter, parsedA, parsedB, useTwoSizes]);

  // Results grouped by size then category
  const results = useMemo(() => {
    if (!activeSizes.length) return [];
    const dir = sortDir === "asc" ? 1 : -1; // desc = high→low
    return activeSizes.map(sz => {
      let matched = tires.filter(t => matchesSize(t, sz));
      // Availability filter (default: available only) — uses inStock (source of truth)
      if (availFilter === "available") matched = matched.filter(t => t.inStock);
      else if (availFilter === "out") matched = matched.filter(t => !t.inStock);
      if (typeFilter === "offroad") matched = matched.filter(t => t.type === "Off-Road");
      else if (typeFilter === "normal") matched = matched.filter(t => t.type !== "Off-Road");
      const byCat = {};
      for (const c of CATEGORY_ORDER) {
        const items = matched.filter(t => t.category === c);
        if (items.length) {
          items.sort(sortBy === "profit"
            ? (a, b) => dir * ((b.price - b.cost) - (a.price - a.cost))
            : (a, b) => dir * (b.price - a.price));
          byCat[c] = items;
        }
      }
      const szLabel = Number(sz.width) < 100 ? `${sz.width}x${sz.aspect}${sz.structure}${sz.rim}` : `${sz.width}/${sz.aspect}${sz.structure}${sz.rim}`;       return { size: sz, label: szLabel, byCat, count: matched.length };
    });
  }, [activeSizes, tires, sortBy, sortDir, availFilter, typeFilter]);

  // Counts for the availability filter chips (within current size results, before avail filter)
  const availCounts = useMemo(() => {
    let all = 0, avail = 0;
    for (const sz of activeSizes) {
      for (const t of tires) {
        if (matchesSize(t, sz)) {
          all++;
          if (t.inStock) avail++;
        }
      }
    }
    return { all, avail, out: all - avail };
  }, [activeSizes, tires]);

  const toggleSelect = (id) => setSelected(p => ({ ...p, [id]: !p[id] }));

  // Size autocomplete suggestions — catalog sizes matching what's typed in the focused field
  const typedRaw = focusField === "B" ? sizeB : sizeA;
  const suggestions = useMemo(() => {
    const q = (typedRaw || "").replace(/[^0-9]/g, ""); // digits only for matching
    if (!q) return catalogSizes.slice(0, 6); // show top sizes when empty+focused
    return catalogSizes
      .filter(s => `${s.width}${s.aspect}${s.rim}`.startsWith(q) || `${s.width}${s.aspect}`.startsWith(q) || s.width.startsWith(q))
      .slice(0, 6);
  }, [typedRaw, catalogSizes]);

  // Record into history when a valid size search yields a definite size (debounced via results)
  useEffect(() => {
    if (mode === "size" && parsedA) {
      const label = useTwoSizes && parsedB
        ? `${parsedA.width}/${parsedA.aspect}${parsedA.structure}${parsedA.rim} + ${parsedB.width}/${parsedB.aspect}${parsedB.structure}${parsedB.rim}`
        : `${parsedA.width}/${parsedA.aspect}${parsedA.structure}${parsedA.rim}`;
      const t = setTimeout(() => pushHistory({ mode: "size", value: label, sizeA, sizeB: useTwoSizes ? sizeB : "", two: useTwoSizes }), 1200);
      return () => clearTimeout(t);
    }
  }, [parsedA, parsedB, useTwoSizes]); // eslint-disable-line

  useEffect(() => {
    if (mode === "car" && carMatch) {
      const t = setTimeout(() => pushHistory({ mode: "car", value: carMatch.key, carQuery: carMatch.key }), 1200);
      return () => clearTimeout(t);
    }
  }, [carMatch]); // eslint-disable-line

  const applyHistory = (h) => {
    if (h.mode === "size") {
      setMode("size");
      setSizeA(h.sizeA);
      setUseTwoSizes(h.two);
      setSizeB(h.sizeB || "");
    } else {
      setMode("car");
      setCarQuery(h.carQuery);
      setCarFilter(null);
    }
    setShowSug(false);
  };

  const pickSuggestion = (s) => {
    if (focusField === "B") setSizeB(s.label); else setSizeA(s.label);
    setShowSug(false);
  };

  const isStaggered = results.length === 2;
  const shareText = useMemo(
    () => buildShareText(results, null, selected, { qty, centerlock, staggered: isStaggered, breakdown, lang, cashPct }),
    [results, selected, qty, centerlock, isStaggered, breakdown, lang, cashPct]
  );
  const hasShareable = results.some(r => Object.values(r.byCat).flat().some(t => t.inStock && selected[t.id]));
  const selectedCount = useMemo(() => {
    const ids = new Set();
    results.forEach(r => Object.values(r.byCat).flat().forEach(t => {
      if (t.inStock && selected[t.id]) ids.add(t.id);
    }));
    return ids.size;
  }, [results, selected]);
// ── Quote log: customer mobile (mandatory) + agent, saved when Copy is pressed ──
  const [quoteMobile, setQuoteMobile] = useState("");
  const [quoteAgent, setQuoteAgent] = useState(() => { try { return localStorage.getItem("bnchr_agent") || ""; } catch { return ""; } });
  const pickAgent = (a) => { setQuoteAgent(a); try { localStorage.setItem("bnchr_agent", a); } catch {} };
  const saveQuoteLog = () => {
    const mobile = quoteMobile.trim();
    if (!mobile) return { ok: false, msg: "Enter customer mobile first" };
    if (!quoteAgent) return { ok: false, msg: "Select your name (agent) first" };
    const seen = new Set(); const qlines = [];
    results.forEach((r, ri) => Object.values(r.byCat).flat().forEach(t => {
      if (t.inStock && selected[t.id] && !seen.has(t.id)) {
        seen.add(t.id);
        qlines.push({ tire_id: t.id, brand: t.brand, pattern: t.pattern || "", size: r.label, year: t.year || "", price: t.price, position: isStaggered ? (ri === 0 ? "front" : "rear") : null });
      }
    }));
    if (!qlines.length) return { ok: false, msg: "No tires selected" };
    const row = { customer_mobile: mobile, agent: quoteAgent, qty: isStaggered ? 4 : qty, staggered: isStaggered, centerlock, cash_pct: cashPct, lang, lines: qlines, quote_text: shareText };
    try { supabase.from("quotes").insert(row).then(() => {}); } catch (e) {}
    return { ok: true };
  };
  const saveEdit = (updated) => {
    setTires(prev => prev.map(t => {
      if (t.id !== updated.id) return t;
      const changed = t.cost !== updated.cost || t.price !== updated.price;
      const history = changed
        ? [...t.history, { ts: new Date().toISOString(), cost: updated.cost, price: updated.price, note: "Edited" }]
        : t.history;
      return { ...updated, category: detectCategory(updated.brand), history };
    }));
    setEditing(null);
    showToast("Tire updated");
  };

  return (
    <div>
      {/* (Availability re-check is now handled by the purchaser in the Catalog) */}

      {/* Search controls */}
      <div style={S.card}>
        <div style={S.modeRow}>
          <button onClick={() => setMode("size")} className="seg" style={{ ...S.seg, ...(mode === "size" ? S.segOn : {}) }}>
            <Tag size={15} /> By Size
          </button>
          <button onClick={() => setMode("car")} className="seg" style={{ ...S.seg, ...(mode === "car" ? S.segOn : {}) }}>
            <Car size={15} /> By Car
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={() => setShowMarkings(true)} className="seg" style={{ ...S.seg, fontSize: 12 }} title="OE & runflat markings reference">
            🏷 Markings
          </button>
        </div>

        {mode === "size" ? (
          <div>
            <label style={S.label}>Tire size</label>
            <div style={{ position: "relative" }}>
              <input
                autoFocus value={sizeA}
                onChange={e => { setSizeA(e.target.value); setShowSug(true); }}
                onFocus={() => { setFocusField("A"); setShowSug(true); }}
                onBlur={() => setTimeout(() => setShowSug(false), 150)}
                placeholder="265/65r18  ·  265 65 18  ·  2656518  ·  265-65-18"
                style={S.input} className="inp"
              />
              {showSug && focusField === "A" && suggestions.length > 0 && (
                <div style={S.sugBox}>
                  {suggestions.map(s => (
                    <button key={s.label} className="sugitem" style={S.sugItem}
                      onMouseDown={() => pickSuggestion(s)}>
                      <span style={S.sugSize}>{s.label}</span>
                      <span style={S.sugCount}>{s.count} tire{s.count !== 1 ? "s" : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {parsedA && <div style={S.parsed}>Width {parsedA.width} · Aspect {parsedA.aspect} · Rim {parsedA.rim}"</div>}

            <label className="chk" style={S.chkRow}>
              <input type="checkbox" checked={useTwoSizes} onChange={e => setUseTwoSizes(e.target.checked)} />
              <span>Staggered fitment — add a second size (front/rear differ)</span>
            </label>

            {useTwoSizes && (
              <div style={{ marginTop: 10, position: "relative" }}>
                <label style={S.label}>Second size (rear)</label>
                <input value={sizeB}
                  onChange={e => { setSizeB(e.target.value); setShowSug(true); }}
                  onFocus={() => { setFocusField("B"); setShowSug(true); }}
                  onBlur={() => setTimeout(() => setShowSug(false), 150)}
                  placeholder="295/30zr19" style={S.input} className="inp" />
                {showSug && focusField === "B" && suggestions.length > 0 && (
                  <div style={S.sugBox}>
                    {suggestions.map(s => (
                      <button key={s.label} className="sugitem" style={S.sugItem}
                        onMouseDown={() => pickSuggestion(s)}>
                        <span style={S.sugSize}>{s.label}</span>
                        <span style={S.sugCount}>{s.count} tire{s.count !== 1 ? "s" : ""}</span>
                      </button>
                    ))}
                  </div>
                )}
                {parsedB && <div style={S.parsed}>Width {parsedB.width} · Aspect {parsedB.aspect} · Rim {parsedB.rim}"</div>}
              </div>
            )}

            {history.length > 0 && (
              <div style={S.histWrap}>
                <span style={S.histLabel}>Recent</span>
                <div style={S.histChips}>
                  {history.map((h, i) => (
                    <button key={i} className="histchip" style={S.histChip} onClick={() => applyHistory(h)}>
                      {h.mode === "car" ? <Car size={12} /> : <Tag size={12} />} {h.value}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <label style={S.label}>Car (year + make + model)</label>
            <input
              autoFocus value={carQuery} onChange={e => { setCarQuery(e.target.value); setCarFilter(null); }}
              placeholder="2011 porsche 911 carrera"
              style={S.input} className="inp"
            />
            {carQuery && !carMatch && <div style={S.parsedMuted}>No match yet — try "2011 porsche 911 carrera" or "2020 mercedes g63"</div>}
            {carMatch && (
              <div style={S.carOpts}>
                <button onClick={() => setCarFilter(null)} style={{ ...S.carChip, ...(carFilter === null ? S.carChipOn : {}) }}>All sizes</button>
                {carMatch.options.map((o, i) => (
                  <button key={i} onClick={() => setCarFilter(i)} style={{ ...S.carChip, ...(carFilter === i ? S.carChipOn : {}) }}>
                    {o.label} · {o.sizes.join(" / ")}
                  </button>
                ))}
              </div>
            )}
            {history.length > 0 && (
              <div style={S.histWrap}>
                <span style={S.histLabel}>Recent</span>
                <div style={S.histChips}>
                  {history.map((h, i) => (
                    <button key={i} className="histchip" style={S.histChip} onClick={() => applyHistory(h)}>
                      {h.mode === "car" ? <Car size={12} /> : <Tag size={12} />} {h.value}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Availability filter bar (above results) */}
      {activeSizes.length > 0 && (
        <div style={S.availFilterBar}>
          <button onClick={() => setAvailFilter("available")} className="availfilterbtn"
            style={{ ...S.availFilterBtn, ...(availFilter === "available" ? S.availFilterBtnOn : {}) }}>
            Available ({availCounts.avail})
          </button>
          <button onClick={() => setAvailFilter("out")} className="availfilterbtn"
            style={{ ...S.availFilterBtn, ...(availFilter === "out" ? S.availFilterBtnOn : {}) }}>
            Out of Stock ({availCounts.out})
          </button>
          <button onClick={() => setAvailFilter("all")} className="availfilterbtn"
            style={{ ...S.availFilterBtn, ...(availFilter === "all" ? S.availFilterBtnOn : {}) }}>
            All ({availCounts.all})
          </button>
          <span style={{ width: 1, alignSelf: "stretch", background: "#E2E2DA", margin: "0 4px" }} />
          <button onClick={() => setTypeFilter(typeFilter === "offroad" ? "all" : "offroad")} className="availfilterbtn"
            style={{ ...S.availFilterBtn, ...(typeFilter === "offroad" ? S.availFilterBtnOn : {}) }}>
            🏔 Off-Road
          </button>
          <button onClick={() => setTypeFilter(typeFilter === "normal" ? "all" : "normal")} className="availfilterbtn"
            style={{ ...S.availFilterBtn, ...(typeFilter === "normal" ? S.availFilterBtnOn : {}) }}>
            Road
          </button>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && results.map((r, idx) => (
        <div key={idx} style={S.card}>
          <div style={S.sizeHeader}>
            <span style={S.sizeHeaderLabel}>{r.label}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {idx === 0 && (
                <div style={S.sortWrap}>
                  <span style={S.sortLabel}>Sort:</span>
                  <button onClick={() => setSortBy("price")} className="sortbtn"
                    style={{ ...S.sortBtn, ...(sortBy === "price" ? S.sortBtnOn : {}) }}>Price</button>
                  <button onClick={() => setSortBy("profit")} className="sortbtn"
                    style={{ ...S.sortBtn, ...(sortBy === "profit" ? S.sortBtnOn : {}) }}>Profit</button>
                  <button onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")} className="sortbtn"
                    style={{ ...S.sortBtn, ...S.sortDirBtn }}
                    title={sortDir === "desc" ? "High to Low (tap for Low to High)" : "Low to High (tap for High to Low)"}>
                    {sortDir === "desc" ? "↓ High–Low" : "↑ Low–High"}
                  </button>
                </div>
              )}
              <span style={S.sizeHeaderCount}>{r.count} tire{r.count !== 1 ? "s" : ""}{availFilter !== "all" ? " shown" : " in catalog"}</span>
            </div>
          </div>
          {r.count === 0 && <div style={S.empty}>{availFilter === "available" ? "No available tires for this size. Switch to 'All' to see out-of-stock options, or add tires in the Add Tire tab." : "No tires in catalog for this size. Add them in the Add Tire tab."}</div>}
          {CATEGORY_ORDER.filter(c => r.byCat[c]).map(c => (
            <div key={c} style={{ marginTop: 14 }}>
              <div style={{ ...S.catTag, background: CATEGORY[c].soft, color: CATEGORY[c].color }}>
                <span style={{ ...S.catDot, background: CATEGORY[c].color }} />
                {CATEGORY[c].en} <span style={S.catAr}>{CATEGORY[c].ar}</span>
              </div>
              {r.byCat[c].map(t => (
                <TireRow
                  key={t.id} t={t}
                  available={t.inStock ? (t._availableAt ? new Date(t._availableAt).getTime() : Date.now()) : null}
                  selected={selected[t.id]}
                  onToggleSelect={() => toggleSelect(t.id)}
                  onHistory={() => setHistoryFor(t)}
                  cashPct={cashPct}
                />
              ))}
            </div>
          ))}
        </div>
      ))}

      {/* Empty states when a search was attempted but produced nothing */}
      {results.length === 0 && mode === "size" && sizeA.trim() !== "" && !parsedA && (
        <div style={S.card}><div style={S.empty}>That doesn't look like a valid tire size yet. Try a format like <b>265/65R18</b>, <b>265 65 18</b>, or <b>2656518</b>.</div></div>
      )}
      {results.length === 0 && mode === "car" && carQuery.trim() !== "" && !carMatch && (
        <div style={S.card}><div style={S.empty}>No match for "<b>{carQuery}</b>" in the car database yet. Try searching by tire size instead, or check the spelling.</div></div>
      )}

      {/* Share bar */}
      {hasShareable && (
        <ShareBar text={shareText} showToast={showToast}
          qty={qty} setQty={setQty} centerlock={centerlock} setCenterlock={setCenterlock}
          breakdown={breakdown} setBreakdown={setBreakdown}
          lang={lang} setLang={setLang}
          cashPct={cashPct} setCashPct={setCashPct}
          hasMichelinSelected={results.some(r => Object.values(r.byCat).flat().some(t => t.inStock && selected[t.id] && isMichelinSupplier(t)))}
          selectedCount={selectedCount}
          quoteMobile={quoteMobile} setQuoteMobile={setQuoteMobile}
          quoteAgent={quoteAgent} pickAgent={pickAgent} saveQuoteLog={saveQuoteLog}
          staggered={isStaggered} />
      )}

      {editing && <EditModal tire={editing} onClose={() => setEditing(null)} onSave={saveEdit} />}
      {historyFor && <HistoryModal tire={historyFor} onClose={() => setHistoryFor(null)} />}

      {showMarkings && (
        <div style={S.modalWrap} onClick={() => setShowMarkings(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.modalHead}>
              <h3 style={S.modalTitle}>Tire Markings Guide</h3>
              <button onClick={() => setShowMarkings(false)} className="iconbtn" style={S.iconBtn}><X size={18} /></button>
            </div>
            <p style={S.sub}>OE approval & runflat codes found on premium tire sidewalls. Useful when recommending OEM-spec tires.</p>
            {[
              ["OEM approval", ["MO", "MO1", "MOE", "★", "N0", "N1", "N2", "N3", "AO", "AO1", "RO1", "AR", "J", "JLR", "L", "F", "B", "VO"]],
              ["Runflat", ["ZP", "ZPS", "RFT", "ROF", "SSR", "DSST", "HRS", "EMT", "RSC", "RF"]],
              ["Sidewall / load", ["OWL", "RWL", "BSW", "XL", "LT", "C"]],
              ["Weather", ["M+S", "3PMSF"]],
            ].map(([group, codes]) => (
              <div key={group} style={{ marginTop: 14 }}>
                <div style={S.markGroup}>{group}</div>
                {codes.filter(c => TIRE_MARKINGS[c]).map(c => (
                  <div key={c} style={S.markRow}>
                    <span style={S.markCode}>{c}</span>
                    <div style={{ flex: 1 }}>
                      <div style={S.markMeaning}>{TIRE_MARKINGS[c].meaning}</div>
                      <div style={S.markBrands}>{TIRE_MARKINGS[c].brands}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TireRow({ t, available, selected, onToggleSelect, onHistory, cashPct = 0 }) {
  const effPrice = effectivePrice(t, cashPct);
  const discounted = effPrice !== round3(t.price);
  return (
    <div style={{ ...S.tireRow, ...(available ? S.tireRowAvail : {}) }}>
      <div style={S.tireMain}>
        {available && (
          <input type="checkbox" checked={!!selected} onChange={onToggleSelect} className="chk" style={{ marginRight: 10, marginTop: 3 }} />
        )}
        <div style={{ flex: 1 }}>
          <div style={S.tireLine}>{tireLine(t)}</div>
          {t.notes && <div style={S.markingNote}>🏷 {t.notes}</div>}
          <div style={S.tireMeta}>
            {discounted ? (
              <span style={S.priceTag}>
                <span style={{ textDecoration: "line-through", color: "#B0B0A8", fontWeight: 500, marginRight: 5 }}>{t.price}</span>
                {effPrice} KD
              </span>
            ) : (
              <span style={S.priceTag}>{t.price} KD</span>
            )}
            <span style={S.costTag}>cost {t.cost}</span>
            {(() => {
              const profit = round3(effPrice - t.cost);
              const margin = effPrice ? Math.round(profit / effPrice * 100) : 0;
              const tier = profitTier(profit);
              const loss = profit < 0;
              return (
                <span style={{ ...S.profitBadge, background: loss ? "#FBEAE8" : tier.bg, color: loss ? "#9B2C20" : tier.fg }}>
                  {loss ? "⚠ " : "+"}{profit} KD <span style={S.profitMargin}>· {margin}%</span>
                </span>
              );
            })()}
            {t.supplier && <span style={S.supplierTag}>{t.supplier}</span>}
            {t.type === "Off-Road" && <span style={S.offroadTag}>Off-Road</span>}
          </div>
        </div>
      </div>
      <div style={S.tireActions}>
        <div style={S.availWrap}>
          {(() => {
            const tier = available ? freshnessTier(available) : null;
            const badgeStyle = !available ? S.availOff
              : tier === "green" ? S.availOn
              : tier === "grey" ? S.availGrey
              : S.availStale;
            return (
              <span style={{ ...S.availBadgeRO, ...badgeStyle }}>
                {available ? <><Check size={13} /> Available</> : "Out of Stock"}
              </span>
            );
          })()}
          {available && (
            <span style={{ ...S.freshLabel, color: FRESH_COLOR[freshnessTier(available)] }}>
              {freshnessLabel(available)}
            </span>
          )}
        </div>
        <button onClick={onHistory} className="iconbtn" style={S.iconBtn} title="Price history"><History size={15} /></button>
      </div>
    </div>
  );
}

// Hardened clipboard copy — three strategies, never silent, reports the reason on failure.
async function bnchrCopy(text) {
  let lastErr = "";
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    }
    lastErr = "clipboard API unavailable";
  } catch (e) { lastErr = (e && (e.name || e.message)) || "clipboard blocked"; }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.top = "-9999px";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) return { ok: true };
    lastErr = lastErr || "execCommand refused";
  } catch (e) { lastErr = (e && (e.name || e.message)) || lastErr || "execCommand failed"; }
  return { ok: false, err: lastErr };
}

function ShareBar({ text, showToast, qty, setQty, centerlock, setCenterlock, breakdown, setBreakdown, lang, setLang, cashPct, setCashPct, hasMichelinSelected, selectedCount, staggered, quoteMobile, setQuoteMobile, quoteAgent, pickAgent, saveQuoteLog }) {
  const [open, setOpen] = useState(false);
  const copy = async () => {
    try {
      const gate = saveQuoteLog();
      if (!gate.ok) { showToast(gate.msg); return; }
      const r = await bnchrCopy(text);
      showToast(r.ok ? "Quote copied to clipboard" : `⚠ Copy blocked (${r.err}) — select the text and press Ctrl/Cmd+C`);
    } catch (e) { showToast(`⚠ Copy error: ${(e && e.message) || e}`); }
  };

  const qtyOptions = centerlock ? [1, 2, 3, 4] : [1, 2, 3, 4, 5];
  const labShown = laborFor(staggered ? 4 : qty, centerlock);

  useEffect(() => { if (centerlock && qty > 4) setQty(4); }, [centerlock]); // eslint-disable-line

  return (
    <>
      <div style={S.shareBar}>
{/* Row 0 — customer mobile (mandatory) + agent */}
<div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
  <input type="tel" value={quoteMobile} onChange={e => setQuoteMobile(e.target.value)}
    placeholder="Customer mobile *"
    style={{ flex: "1 1 150px", minWidth: 140, padding: "8px 10px", borderRadius: 8, fontSize: 16, outline: "none",
      border: quoteMobile.trim() ? "1.5px solid #2e7d32" : "1.5px solid #d32f2f" }} />
  {["Alaa", "Hussain"].map(a => (
    <button key={a} onClick={() => pickAgent(a)}
      style={{ padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13,
        border: quoteAgent === a ? "2px solid #2e7d32" : "1px solid #bbb",
        background: quoteAgent === a ? "#e8f5e9" : "#fff", color: quoteAgent === a ? "#2e7d32" : "#555" }}>
      {quoteAgent === a ? "✓ " : ""}{a}
    </button>
  ))}
</div>
{/* Row 1 — controls */}
        <div style={S.shareRow}>
          <div style={S.langWrap}>
            <button onClick={() => setLang("ar")} className="langbtn"
              style={{ ...S.langBtn, ...(lang === "ar" ? S.langBtnOn : {}) }}>عربي</button>
            <button onClick={() => setLang("en")} className="langbtn"
              style={{ ...S.langBtn, ...(lang === "en" ? S.langBtnOn : {}) }}>EN</button>
          </div>
          <div style={S.qtyWrap}>
            <span style={S.qtyLabel}>{staggered ? "Full set" : "Qty"}</span>
            {staggered ? (
              <span style={S.qtyFixed}>4 tires (2+2)</span>
            ) : (
              <div style={S.qtyBtns}>
                {qtyOptions.map(n => (
                  <button key={n} onClick={() => setQty(n)} className="qtybtn"
                    style={{ ...S.qtyBtn, ...(qty === n ? S.qtyBtnOn : {}) }}>{n}</button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setCenterlock(v => !v)} className="clbtn"
            style={{ ...S.clBtn, ...(centerlock ? S.clBtnOn : {}) }}
            title="Center-lock wheels (Porsche GT3 etc.) use torque-wrench labor rates">
            {centerlock ? <Check size={13} /> : null} Center-lock
          </button>
          <button onClick={() => setBreakdown(v => !v)} className="clbtn"
            style={{ ...S.clBtn, ...(breakdown ? S.clBtnOn : {}) }}
            title="Show per-tire price breakdown in the quote">
            {breakdown ? <Check size={13} /> : null} Show breakdown
          </button>
          <div style={S.cashWrap}>
            <span style={S.qtyLabel}>Cash disc.</span>
            <div style={S.qtyBtns}>
              {[0, 6, 10].map(p => (
                <button key={p} onClick={() => setCashPct(p)} className="qtybtn"
                  style={{ ...S.qtyBtn, ...(cashPct === p ? S.cashBtnOn : {}) }}
                  title={p === 0 ? "No cash discount" : `Drop price by ${p}% for cash payment`}>
                  {p === 0 ? "Off" : p + "%"}
                </button>
              ))}
            </div>
          </div>
          <span style={S.laborHint}>Labor: {labShown} KD</span>
        </div>
        {cashPct > 0 && hasMichelinSelected && (
          <div style={S.cashNote}>
            ⚠️ Cash discount excluded for Michelin-supplier tires (Michelin / BFGoodrich) — they have no installment buffer. Other brands discounted {cashPct}%.
          </div>
        )}
        {/* Row 2 — actions */}
        <div style={S.shareRow}>
          {selectedCount > 0 && (
            <span style={S.selCount}>{selectedCount} tire{selectedCount !== 1 ? "s" : ""} selected to share</span>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={() => setOpen(true)} className="ghost" style={S.previewBtn}><Search size={15} /> Preview</button>
          <button onClick={copy} className="primary" style={S.copyMain}><Copy size={16} /> Copy quote</button>
        </div>
      </div>
      {open && (
        <div style={S.modalWrap} onClick={() => setOpen(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.modalHead}>
              <h3 style={S.modalTitle}>Quote preview {staggered ? "· Staggered" : `· ${qty} tire${qty > 1 ? "s" : ""}`}{centerlock ? " · Center-lock" : ""}{breakdown ? " · Detailed" : ""}</h3>
              <button onClick={() => setOpen(false)} className="iconbtn" style={S.iconBtn}><X size={18} /></button>
            </div>
            <pre style={{ ...S.preview, direction: lang === "ar" ? "rtl" : "ltr", textAlign: lang === "ar" ? "right" : "left" }}>{text}</pre>
            <button onClick={copy} className="primary" style={{ ...S.copyMain, width: "100%", justifyContent: "center", marginTop: 12 }}><Copy size={16} /> Copy quote</button>
          </div>
        </div>
      )}
    </>
  );
}

// ── WhatsApp text builder ─────────────────────────────────────────────────────
// opts: { qty, centerlock, staggered }
function buildShareText(results, availability, selected, opts) {
  const { qty = 4, centerlock = false, staggered = false, breakdown = false, lang = "ar", cashPct = 0 } = opts || {};
  // Price each tire after any cash discount (Michelin-supplier tires are never discounted)
  const px = (t) => effectivePrice(t, cashPct);
  const LRM = "\u200E"; // left-to-right mark
  const RLM = "\u200F"; // right-to-left mark
  const ltr = (s) => LRM + s + LRM;
  const rtl = (s) => RLM + s + RLM;
  const RULE = "━━━━━━━━━━━━━━";
  const DOTS = "┄┄┄┄┄┄┄┄┄┄┄┄┄┄";
  const ar = lang === "ar";

  // Arabic category names
  const CAT_AR = { TP: "أعلى أداء", PC: "جودة وسعر", SV: "قيمة ذكية", SE: "اقتصادي آمن" };

  const isSel = (t) => t.inStock && selected[t.id];
  const lab = laborFor(staggered ? 4 : qty, centerlock);

  // Build the production line (only parts that exist). > stays in LTR layer.
  // EN: > Prod. 2025 / Italy 🇮🇹    AR: > الصنع: 2025 / إيطاليا 🇮🇹
  const prodLine = (t) => {
    const flag = t.country && COUNTRIES[t.country] ? COUNTRIES[t.country] : "";
    if (ar) {
      const yr = t.year ? ltr(String(t.year)) : "";
      const ctryName = t.country ? (COUNTRIES_AR[t.country] || t.country) : "";
      const ctry = ctryName ? `${rtl(ctryName)} ${flag}`.trim() : "";
      const parts = [yr, ctry].filter(Boolean);
      if (!parts.length) return "";
      return `> ${rtl("الصنع:")} ${parts.join(" / ")}\n`;
    }
    const yr = t.year ? `Prod. ${t.year}` : "";
    const ctry = t.country ? `${t.country} ${flag}`.trim() : "";
    const parts = [yr, ctry].filter(Boolean);
    if (!parts.length) return "";
    return `> ${ltr(parts.join(" / "))}\n`;
  };

  // ── Header ──
  let out;
  if (ar) {
    out = rtl("```عرض سعر بنجر بلاس```") + "\n\n";
  } else {
    out = LRM + ltr("```BNCHR+ Tire Quote```") + "\n\n";
  }

  // ── Size block ──
  if (ar) {
    out += `> ${rtl("المقاس:")}\n`;
    if (staggered && results.length === 2) {
      out += `> ${ltr(results[0].label)} ${rtl("أمامي")}\n> ${ltr(results[1].label)} ${rtl("خلفي")}\n\n`;
    } else if (results.length === 1) {
      out += `> ${ltr(results[0].label)}\n\n`;
    } else out += "\n";
  } else {
    out += `> Tire size:\n`;
    if (staggered && results.length === 2) {
      out += `> ${results[0].label} front\n> ${results[1].label} rear\n\n`;
    } else if (results.length === 1) {
      out += `> ${results[0].label}\n\n`;
    } else out += "\n";
  }
  out += RULE + "\n\n";

  const catBlocks = [];
  for (const c of CATEGORY_ORDER) {
    let block = "";

    if (staggered && results.length === 2) {
      const [front, rear] = results;
      const frontItems = (front.byCat[c] || []).filter(isSel);
      const rearItems = (rear.byCat[c] || []).filter(isSel);
      const keyOf = (t) => `${t.brand}||${t.pattern || ""}`;
      const rearMap = {};
      rearItems.forEach(t => { rearMap[keyOf(t)] = t; });
      // Primary: pair front+rear of the SAME brand+pattern (unchanged behavior)
      const usedRear = new Set();
      const pairs = [];
      for (const f of frontItems) {
        const r = rearMap[keyOf(f)];
        if (r && !usedRear.has(r.id)) { pairs.push({ f, r }); usedRear.add(r.id); }
      }
      // Fallback: any selected front/rear that didn't pair by exact pattern → pair them
      // (the mixed-pattern case — usually same brand, forced by availability).
      const leftoverFront = frontItems.filter(f => !pairs.some(p => p.f.id === f.id));
      const leftoverRear = rearItems.filter(r => !usedRear.has(r.id));
      if (leftoverFront.length && leftoverRear.length) {
        // Prefer matching within the same brand first, then whatever remains.
        const rearPool = [...leftoverRear];
        for (const f of leftoverFront) {
          let idx = rearPool.findIndex(r => r.brand === f.brand);
          if (idx === -1) idx = 0; // fall back to first available rear
          const r = rearPool.splice(idx, 1)[0];
          if (r) pairs.push({ f, r, mixed: true });
        }
      }
      pairs.sort((a, b) => px(b.f) - px(a.f));
      const lines = pairs.map(({ f, r, mixed }) => {
        const fP = px(f), rP = px(r);
        const frontTotal = round3(fP * 2);
        const rearTotal = round3(rP * 2);
        const tires = round3(frontTotal + rearTotal);
        const total = round3(tires + lab);
        const fName = f.brand + (f.pattern ? " " + f.pattern : "");
        const rName = r.brand + (r.pattern ? " " + r.pattern : "");
        // Same model front+rear → one name. Mixed → show both, labeled.
        const sameModel = !mixed && fName === rName;
        const pl = prodLine(f);
        if (ar) {
          const title = sameModel
            ? ltr(fName)
            : ltr(fName) + " " + rtl("(أمامي)") + "\n" + ltr(rName) + " " + rtl("(خلفي)");
          let s = `${title}\n${pl}` + rtl(`4 إطارات + خدمة المنازل`) + `\n*${ltr(total + " د.ك")}*`;
          if (breakdown) {
            s += "\n\n" + `> ${rtl("تفاصيل السعر:")}` + "\n" + `> ${rtl("2 أمامي:")} ${ltr(frontTotal + " د.ك")} ${rtl("(" + fP + " د.ك للواحد)")}` + "\n" + `> ${rtl("2 خلفي:")} ${ltr(rearTotal + " د.ك")} ${rtl("(" + rP + " د.ك للواحد)")}` + "\n" + `> ${rtl("خدمة المنازل:")} ${ltr(lab + " د.ك")}`;
          }
          return s;
        }
        const title = sameModel
          ? fName
          : `${fName} (front)\n${rName} (rear)`;
        let s = `${title}\n${pl}Set of 4 + home service\n*${total} KD*`;
        if (breakdown) {
          s += `\n\n> Price details:\n> 2x Front: ${frontTotal} KD (${fP} KD each)\n> 2x Rear: ${rearTotal} KD (${rP} KD each)\n> 1x Home service: ${lab} KD`;
        }
        return s;
      });
      if (lines.length) block = lines.join("\n\n");
    } else {
      const items = [];
      for (const r of results) items.push(...(r.byCat[c] || []).filter(isSel));
      items.sort((a, b) => px(b) - px(a));
      const lines = items.map(t => {
        const tP = px(t);
        const tires = round3(tP * qty);
        const total = round3(tires + lab);
        const name = t.brand + (t.pattern ? " " + t.pattern : "");
        const pl = prodLine(t);
        if (ar) {
          let s = `${ltr(name)}\n${pl}` + rtl(`${qty} ${qty > 2 ? "إطارات" : "إطار"} + خدمة المنازل`) + `\n*${ltr(total + " د.ك")}*`;
          if (breakdown) {
            s += "\n\n" + `> ${rtl("تفاصيل السعر:")}` + "\n" + `> ${rtl(qty + " إطارات:")} ${ltr(tires + " د.ك")} ${rtl("(" + tP + " د.ك للواحد)")}` + "\n" + `> ${rtl("خدمة المنازل:")} ${ltr(lab + " د.ك")}`;
          }
          return s;
        }
        let s = `${name}\n${pl}Set of ${qty} + home service\n*${total} KD*`;
        if (breakdown) {
          s += `\n\n> Price details:\n> ${qty}x Tires: ${tires} KD (${tP} KD each)\n> 1x Home service: ${lab} KD`;
        }
        return s;
      });
      if (lines.length) block = lines.join("\n\n");
    }

    if (block) {
      const header = ar
        ? `> ${rtl(CAT_AR[c])}`
        : `> ${CATEGORY[c].en.toUpperCase()}`;
      catBlocks.push(header + "\n\n" + block);
    }
  }

  out += catBlocks.join(`\n\n${DOTS}\n\n`) + "\n\n";
  out += RULE + "\n\n";

  // ── Footer ──
  if (ar) {
    if (centerlock) {
      out += `> ${rtl("✅ السعر شامل التركيب والميزان والترصيص وخدمة عزم القفل المركزي، مع كفالة التاير من الوكيل.")}`;
    } else {
      out += `> ${rtl("✅ السعر شامل التركيب والميزان والترصيص، مع كفالة التاير من الوكيل.")}`;
    }
  } else {
    if (centerlock) {
      out += `> ✅ Includes installation, balancing, center-lock torque service, and the tire distributor warranty.`;
    } else {
      out += `> ✅ Includes installation, balancing, and the tire distributor warranty.`;
    }
  }
  return out;
}

// ── Live profit indicator (shown while setting price in Add/Edit) ──────────────
function ProfitIndicator({ cost, price, category, tire, showNote = true }) {
  const c = Number(cost) || 0;
  const p = Number(price) || 0;
  if (!p) return null;
  const profit = round3(p - c);
  const margin = p ? Math.round(profit / p * 100) : 0;
  const setProfit = round3(profit * 4);
  const tier = profitTier(profit);
  const cat = CATEGORY[category];
  // Target = what the unified pricing formula would produce for this cost
  const target = (c && tire) ? computeTirePrice({ ...tire, cost: c }) : 0;
  const gap = target - p; // positive = priced below formula target

  return (
    <div style={{ ...S.profInd, borderColor: tier.fg }}>
      <div style={S.profIndRow}>
        <span style={{ ...S.profIndAmt, color: tier.fg, background: tier.bg }}>
          {profit >= 0 ? "+" : ""}{profit} KD/tire
        </span>
        <span style={S.profIndMargin}>{margin}% margin</span>
        <span style={{ ...S.profIndTier, color: tier.fg }}>● {tier.label}</span>
      </div>
      <div style={S.profIndRow2}>
        <span style={S.profIndSet}>+{setProfit} KD per set of 4</span>
        {c > 0 && target > 0 && (
          <span style={S.profIndTarget}>
            Formula price: {target} KD
            {gap > 0 ? ` · ${gap} KD below` : gap < 0 ? ` · ${-gap} KD above ✓` : " · on target ✓"}
          </span>
        )}
      </div>
      {showNote && tire && c > 0 && (
        <div style={S.profIndNote}>{pricingExplain({ ...tire, cost: c })}</div>
      )}
    </div>
  );
}

// ── ADD VIEW ──────────────────────────────────────────────────────────────────
function AddView({ tires = [], setTires, showToast, onDone }) {
  const empty = { brand: "", pattern: "", type: "Normal", width: "", aspect: "", structure: "R", rim: "", loadIndex: "", speedRating: "", country: "", year: "", supplier: "", cost: "", price: "", notes: "" };
  const [f, setF] = useState(empty);
  const [autoFill, setAutoFill] = useState(true); // cost change → auto price from formula
  const [mode, setMode] = useState("quick"); // 'quick' | 'smart' | 'manual'
  const [pasteText, setPasteText] = useState("");
  const [quickText, setQuickText] = useState("");
  const [behbehaniOld, setBehbehaniOld] = useState(false); // 35% vs 30% (auto from 2024 detection)
  const [drafts, setDrafts] = useState([]); // parsed preview rows
  const [dupWarn, setDupWarn] = useState(0); // count of duplicates pending confirmation

  const category = detectCategory(f.brand);
  const cat = CATEGORY[category];

  // ── History lookups (for suggesting gaps in Quick Entry) ──
  // most common value of `field` for a given brand (+optional pattern), from catalog
  const histValue = (brand, pattern, field) => {
    if (!brand) return "";
    const b = brand.toLowerCase();
    const matches = tires.filter(t => t.brand.toLowerCase() === b && (!pattern || (t.pattern || "").toLowerCase() === pattern.toLowerCase()));
    const pool = matches.length ? matches : tires.filter(t => t.brand.toLowerCase() === b);
    const counts = {};
    pool.forEach(t => { const v = t[field]; if (v) counts[v] = (counts[v] || 0) + 1; });
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : "";
  };
  // patterns that exist in catalog, grouped by brand (for pattern matching/suggestions)
  const patternsByBrand = useMemo(() => {
    const map = {};
    tires.forEach(t => {
      if (!t.pattern) return;
      const b = t.brand.toLowerCase();
      if (!map[b]) map[b] = new Set();
      map[b].add(t.pattern);
    });
    const out = {};
    Object.keys(map).forEach(b => { out[b] = [...map[b]]; });
    return out;
  }, [tires]);

  // suggested price from category margin on cost
  // (price suggestions now use the autoPrice formula directly)

  // ── Pattern normalization (brand-aware) ──
  // Returns { value, original, corrected, suggestions[] }
  // 1) exact case-insensitive match to a catalog pattern for this brand → snap silently
  // 2) close typo (edit distance ≤2) → auto-correct + flag, plus related-family suggestions
  // 3) no match → keep as typed, but still offer suggestions if any look related
  const normalizePattern = (brand, raw) => {
    const input = (raw || "").trim();
    if (!input) return { value: "", original: input, corrected: false, suggestions: [] };
    // catalog patterns for this brand (with their canonical catalog spelling + frequency)
    const b = (brand || "").toLowerCase();
    const counts = {};
    tires.forEach(t => {
      if (b && t.brand.toLowerCase() !== b) return;
      const p = (t.pattern || "").trim();
      if (p) counts[p] = (counts[p] || 0) + 1;
    });
    const known = Object.keys(counts);
    if (!known.length) return { value: input, original: input, corrected: false, suggestions: [] };

    // 1) exact case-insensitive match → snap to catalog spelling
    const exact = known.find(p => p.toLowerCase() === input.toLowerCase());
    if (exact) return { value: exact, original: input, corrected: false, suggestions: relatedPatterns(exact, known, counts) };

    // 2) typo match — closest by edit distance
    let best = null, bestD = 99;
    for (const p of known) {
      const d = levenshtein(input, p);
      if (d < bestD) { bestD = d; best = p; }
    }
    // also try matching against the first word (e.g. "pzer" vs "P ZERO" → match base "P ZERO")
    const corrected = best && bestD <= 2;
    const value = corrected ? best : input;
    return {
      value,
      original: input,
      corrected,
      suggestions: relatedPatterns(value, known, counts, input),
    };
  };
  // patterns in the same family (share the base name), ranked, excluding the chosen value
  const relatedPatterns = (chosen, known, counts, typed) => {
    // family key: if the first word is very short (e.g. "P"), use first two words ("P ZERO")
    const famKey = (p) => {
      const w = (p || "").toLowerCase().split(/\s+/);
      return (w[0] && w[0].length <= 2 && w[1]) ? `${w[0]} ${w[1]}` : (w[0] || "");
    };
    const key = famKey(chosen || typed || "");
    if (!key || key.length < 2) return [];
    return known
      .filter(p => p.toLowerCase() !== (chosen || "").toLowerCase() && famKey(p) === key)
      .sort((a, b) => counts[b] - counts[a])
      .slice(0, 4);
  };

  // ── Quick Entry parse (size on its own line, then Brand/Pattern/Load/Speed/Country/Cost/Price) ──
  const runQuickParse = () => {
    const lines = quickText.split(/\n+/).map(l => l.trim()).filter(Boolean);
    let curSize = null;
    const rows = [];
    for (const line of lines) {
      // size line? (has slash but parses as a size and has no other slash-fields beyond size)
      const asSize = parseSize(line);
      const slashParts = line.split("/").map(s => s.trim());
      // treat as size header if it parses as a size AND isn't a 5+ field tire line
      if (asSize && slashParts.length <= 3 && !/[a-z]{3,}/i.test(line.replace(/r|zr/i, ""))) {
        curSize = asSize; continue;
      }
      // also allow a bare size like "265/65r18" (letters only in R/ZR)
      if (asSize && /^\d{3}\s*\/\s*\d{2}\s*z?r?\s*\d{2}/i.test(line)) {
        curSize = asSize; continue;
      }
      // otherwise it's a tire line split by "/"
      const p = line.split("/").map(s => s.trim());
      if (p.length < 1 || !p[0]) continue;
      const [brandRaw = "", patternRaw = "", loadIndex = "", speedRatingRaw = "", country = "", year = "", cost = "", price = ""] = p;
      // normalize brand (silent capitalization, flagged typo correction)
      const bn = normalizeBrand(brandRaw);
      const brand = bn.value;
      // normalize pattern (brand-aware: snap to catalog spelling, correct typos, suggest family)
      const bkey = brand.toLowerCase();
      const brandPats = (patternsByBrand[bkey] && patternsByBrand[bkey].length)
        ? patternsByBrand[bkey]
        : (SEED_PATTERNS_BY_BRAND[bkey] || []);
      const pn = normalizePattern(patternRaw, brand, brandPats);
      // safety: pattern must never equal the brand name (guards against any mapping slip)
      let pattern = pn.value;
      if (pattern && pattern.toLowerCase() === brand.toLowerCase()) pattern = patternRaw;
      const speedRating = speedRatingRaw.toUpperCase(); // speed ratings always uppercase
      const ccat = detectCategory(brand);
      let countryFinal = country ? (COUNTRY_ALIASES[country.toLowerCase()] || country) : (histValue(brand, pattern, "country") || countryForBrand(brand));
      const yearFinal = year || String(new Date().getFullYear());
      // manufacturer spec lookup (exact load/speed for this brand+pattern+size)
      const spec = lookupSpec(brand, pattern, curSize?.width, curSize?.aspect, curSize?.rim);
      const loadFinal = loadIndex || (spec && spec.load) || histValue(brand, pattern, "loadIndex");
      const speedFinal = speedRating || (spec && spec.speed) || histValue(brand, pattern, "speedRating");
      // Price: explicit value wins; otherwise the unified pricing brain decides
      // (agreed brands → discount margin; others → formula).
      let priceFinal;
      if (price) {
        priceFinal = price;
      } else if (cost) {
        priceFinal = String(computeTirePrice({
          brand, supplier: supplierForBrand(brand), category: ccat, rim: curSize?.rim, year: yearFinal, cost,
        }));
      } else {
        priceFinal = "";
      }
      rows.push({
        brand, pattern,
        brandOriginal: bn.original, brandCorrected: bn.corrected,
        patternOriginal: pn.original, patternCorrected: pn.corrected, patternSuggestions: pn.suggestions,
        width: curSize?.width || "", aspect: curSize?.aspect || "", structure: curSize?.structure || "R", rim: curSize?.rim || "",
        loadIndex: loadFinal, speedRating: speedFinal, country: countryFinal,
        year: yearFinal, supplier: supplierForBrand(brand),
        cost: cost || "", price: priceFinal,
        category: ccat,
        type: /scorpion|terrain|at\d|ko\d|off|mt\b/i.test(pattern + " " + brand) ? "Off-Road" : "Normal",
        notes: "",
        // track which fields were auto-suggested (for highlighting)
        _suggested: {
          loadIndex: !loadIndex && !!loadFinal,
          speedRating: !speedRating && !!speedFinal,
          country: !country && !!countryFinal,
          year: !year,
          price: false,
        },
        sourceLine: line,
      });
    }
    if (!rows.length) { showToast("No tires found — check the format"); return; }
    setDrafts(rows);
  };

  // ── Smart Fill parse ──
  const runParse = () => {
    const parsed = parseSupplierQuote(pasteText);
    if (!parsed.length) { showToast("Couldn't find tires in that text"); return; }
    const rows = parsed.map(d => {
      const brand = d.brand;
      const ccat = detectCategory(brand);
      const supplier = supplierForBrand(brand);
      const isBehbehani = /behbehani/i.test(supplier);
      // Behbehani sends List Price → apply discount (35% if 2024 in line, else 30%)
      let cost = d.amountRaw || 0;
      if (isBehbehani && d.amountRaw) {
        const disc = (d.year === "2024" || behbehaniOld) ? 0.35 : 0.30;
        cost = round3(d.amountRaw * (1 - disc));
      }
      const agreedBrand = isAgreedPricing({ brand, supplier });
      // Agreed brands: if a list price was sent use it; otherwise the unified brain.
      const price = (agreedBrand && d.amountRaw)
        ? round3(d.amountRaw)
        : computeTirePrice({ brand, supplier, category: ccat, rim: d.size?.rim, year: d.year, cost });
      const country = d.country || countryForBrand(brand);
      return {
        brand,
        pattern: d.pattern || "",
        type: /at\d|ko\d|terrain|off|mt\b/i.test(d.sourceLine) ? "Off-Road" : "Normal",
        width: d.size?.width || "", aspect: d.size?.aspect || "", structure: d.size?.structure || "R", rim: d.size?.rim || "",
        loadIndex: "", speedRating: d.speedRating || "",
        country, year: d.year || "", supplier,
        cost, price,
        category: ccat,
        notes: d.markings || "",
        sourceLine: d.sourceLine,
        listPrice: isBehbehani ? d.amountRaw : null,
      };
    });
    setDrafts(rows);
  };

  const updateDraft = (i, key, val) => {
    setDrafts(prev => prev.map((d, idx) => {
      if (idx !== i) return d;
      const next = { ...d, [key]: val };
      if (key === "brand") {
        next.category = detectCategory(val);
        next.supplier = supplierForBrand(val) || d.supplier;
        // if user set it back to their original (or edited manually), stop flagging as corrected
        if (val === d.brandOriginal) next.brandCorrected = false;
      }
      if (key === "pattern") {
        // user picked a suggestion or edited → clear the correction flag & suggestions
        next.patternCorrected = false;
        next.patternSuggestions = [];
      }
      if (key === "pattern") {
        // once the user picks a suggestion or reverts, clear the flag and suggestions
        next.patternCorrected = false;
        next.patternSuggestions = [];
      }
      if (key === "cost") {
        next.cost = val;
        if (autoFill && val) {
          next.price = computeTirePrice({ brand: next.brand, supplier: next.supplier, category: detectCategory(next.brand), rim: next.rim, year: next.year, cost: val });
        } else if (!val) {
          next.price = 0;
        }
      }
      // user edited a field → it's no longer an auto-suggestion
      if (d._suggested && d._suggested[key]) next._suggested = { ...d._suggested, [key]: false };
      return next;
    }));
  };
  const removeDraft = (i) => setDrafts(prev => prev.filter((_, idx) => idx !== i));

  // Duplicate check: same brand + size + pattern already in catalog
  const isDup = (d) => tires.some(t =>
    t.brand.toLowerCase() === (d.brand || "").toLowerCase() &&
    t.width === d.width && t.aspect === d.aspect && t.rim === d.rim &&
    (t.pattern || "").toLowerCase() === (d.pattern || "").toLowerCase()
  );

  const addAllDrafts = (force = false) => {
    const valid = drafts.filter(d => d.brand && d.width && d.aspect && d.rim && d.cost);
    if (!valid.length) { showToast("Each tire needs a brand, size and cost — check the highlighted rows"); return; }
    const dups = valid.filter(isDup);
    if (dups.length && !force) {
      setDupWarn(dups.length);
      return;
    }
    setTires(prev => [...valid.map(d => mkTire(d)), ...prev]);
    showToast(`Added ${valid.length} tire${valid.length !== 1 ? "s" : ""} to catalog`);
    setDrafts([]); setPasteText(""); setQuickText(""); setDupWarn(0);
    onDone?.();
  };

  // auto price (manual mode) — unified pricing brain
  useEffect(() => {
    if (autoFill && f.cost) {
      const p = computeTirePrice({ brand: f.brand, supplier: f.supplier, category, rim: f.rim, year: f.year, cost: f.cost });
      setF(prev => ({ ...prev, price: String(p) }));
    }
  }, [f.cost, f.rim, f.supplier, f.brand, f.year, autoFill, category]); // eslint-disable-line

  // auto-fill load/speed from manufacturer spec when brand+pattern+size are known and fields are empty
  useEffect(() => {
    const spec = lookupSpec(f.brand, f.pattern, f.width, f.aspect, f.rim);
    if (spec) {
      setF(prev => ({
        ...prev,
        loadIndex: prev.loadIndex || spec.load,
        speedRating: prev.speedRating || spec.speed,
      }));
    }
  }, [f.brand, f.pattern, f.width, f.aspect, f.rim]); // eslint-disable-line

  const set = (k) => (e) => setF(prev => ({ ...prev, [k]: e.target.value }));
  const sizePreview = (f.width && f.aspect && f.rim)
    ? sizeString({ width: f.width, aspect: f.aspect, structure: f.structure, rim: f.rim, loadIndex: f.loadIndex, speedRating: f.speedRating })
    : "—";

  const linePreview = (f.brand && f.width && f.aspect && f.rim)
    ? tireLine({ ...f, category })
    : "Fill brand and size to preview";

  const submit = (force = false) => {
    if (!f.brand || !f.width || !f.aspect || !f.rim || !f.cost) {
      showToast("Brand, size and cost are required"); return;
    }
    if (isDup(f) && !force) {
      setDupWarn(-1); // -1 = manual single dup
      return;
    }
    setTires(prev => [mkTire(f), ...prev]);
    showToast("Tire added to catalog");
    setF(empty); setDupWarn(0);
    onDone?.();
  };

  return (
    <div style={S.card}>
      <h2 style={S.h2}>Add tires to catalog</h2>

      {/* Mode toggle */}
      <div style={S.modeRow}>
        <button onClick={() => setMode("quick")} className="seg" style={{ ...S.seg, ...(mode === "quick" ? S.segOn : {}) }}>
          ⚡ Quick Entry
        </button>
        <button onClick={() => setMode("smart")} className="seg" style={{ ...S.seg, ...(mode === "smart" ? S.segOn : {}) }}>
          ✨ Smart Fill
        </button>
        <button onClick={() => setMode("manual")} className="seg" style={{ ...S.seg, ...(mode === "manual" ? S.segOn : {}) }}>
          <Plus size={15} /> Manual
        </button>
      </div>

      {mode === "quick" ? (
        <div>
          <p style={S.sub}>Type the size on its own line, then one tire per line separated by <b>/</b>:<br/>
            <span style={S.quickFormat}>Brand / Pattern / Load / Speed / Country / Year / Cost / Price</span><br/>
            <b>Skip a field?</b> Leave it empty between slashes — e.g. <span style={S.quickInline}>Pirelli / Scorpion / / H / USA / 2025 / 70</span> skips Load.
            Trailing fields can just be dropped. Cost is required; everything else fills from history (or current year / suggested price) if blank.</p>
          <textarea
            value={quickText} onChange={e => setQuickText(e.target.value)}
            placeholder={"265/65r18\n\nPirelli / Scorpion / 114 / H / USA / 2025 / 70 / 100\nKumho / AT52 / 116 / R / Korea / 2026 / 45\nMichelin / LTX / 120 / S / / / 88"}
            style={{ ...S.input, minHeight: 150, resize: "vertical", fontFamily: "monospace", fontSize: 13, lineHeight: 1.6 }} className="inp" />
          {quickText.trim() && <QuickHelper text={quickText} />}
          <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={runQuickParse} className="primary" style={S.waBtn}>⚡ Build preview</button>
            {drafts.length > 0 && <span style={{ fontSize: 13, color: "#666", fontWeight: 600 }}>{drafts.length} tire{drafts.length !== 1 ? "s" : ""} ready</span>}
          </div>
          {drafts.length > 0 && <DraftPreview drafts={drafts} updateDraft={updateDraft} removeDraft={removeDraft} addAllDrafts={addAllDrafts} setDrafts={setDrafts} dupWarn={dupWarn} clearDup={() => setDupWarn(0)} showSuggested />}
        </div>
      ) : mode === "smart" ? (
        <div>
          <p style={S.sub}>Paste a supplier's reply (from WhatsApp). The system detects brand, size, cost, year & country, infers the supplier, and applies your margin. Review and edit before adding.</p>
          <textarea
            value={pasteText} onChange={e => setPasteText(e.target.value)}
            placeholder={"Paste supplier reply here, e.g.\n\nF: 245/35R20\nFront 91Y Pzero 155 kd 2025\nR: 305/30R20\nRear 103Y Pzero 210 kd 2025"}
            style={{ ...S.input, minHeight: 120, resize: "vertical", fontFamily: "monospace", fontSize: 13 }} className="inp" />
          <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={runParse} className="primary" style={S.waBtn}>✨ Parse quote</button>
            {drafts.length > 0 && <span style={{ fontSize: 13, color: "#666", fontWeight: 600 }}>{drafts.length} tire{drafts.length !== 1 ? "s" : ""} detected</span>}
          </div>

          {drafts.length > 0 && <DraftPreview drafts={drafts} updateDraft={updateDraft} removeDraft={removeDraft} addAllDrafts={addAllDrafts} setDrafts={setDrafts} dupWarn={dupWarn} clearDup={() => setDupWarn(0)} hint="Review each row — edit any field, remove unwanted rows, then add all. Behbehani list prices are auto-discounted (30%, or 35% for 2024 stock)." />}
        </div>
      ) : (
      <div>
      <p style={S.sub}>Enter cost — price auto-calculates from the pricing formula (cost + size-based margin ÷ 0.9). Michelin, BFGoodrich and Pirelli keep their supplier price. You can always edit the price.</p>

      {/* live preview */}
      <div style={{ ...S.previewLine, borderColor: cat.color }}>
        <div style={{ ...S.catTag, background: cat.soft, color: cat.color, display: "inline-flex", marginBottom: 8 }}>
          <span style={{ ...S.catDot, background: cat.color }} />{cat.en} <span style={S.catAr}>{cat.ar}</span>
        </div>
        <div style={S.previewText}>{linePreview}{f.price ? `  —  ${f.price} KD` : ""}</div>
        <div style={S.previewSize}>Size: {sizePreview}</div>
      </div>

      <div style={S.grid}>
        <Field label="Brand *"><input style={S.input} className="inp" value={f.brand} onChange={set("brand")} placeholder="Pirelli" list="brands" />
          <datalist id="brands">{Object.keys(BRAND_CATEGORY).map(b => <option key={b} value={b.replace(/\b\w/g, c => c.toUpperCase())} />)}</datalist>
        </Field>
        <Field label="Pattern (optional)">
          <input style={S.input} className="inp" value={f.pattern} onChange={set("pattern")} placeholder="PZ4 Trofeo" list="addPatternList" />
          <datalist id="addPatternList">
            {patternsForBrand(f.brand).map(p => <option key={p} value={p} />)}
          </datalist>
        </Field>
        <Field label="Type"><select style={S.input} className="inp" value={f.type} onChange={set("type")}><option>Normal</option><option>Off-Road</option></select></Field>

        <Field label="Width"><input style={S.input} className="inp" value={f.width} onChange={set("width")} placeholder="325" inputMode="numeric" /></Field>
        <Field label="Aspect ratio"><input style={S.input} className="inp" value={f.aspect} onChange={set("aspect")} placeholder="30" inputMode="numeric" /></Field>
        <Field label="Structure"><select style={S.input} className="inp" value={f.structure} onChange={set("structure")}><option>R</option><option>ZR</option></select></Field>
        <Field label="Rim size"><input style={S.input} className="inp" value={f.rim} onChange={set("rim")} placeholder="21" inputMode="numeric" /></Field>
        <Field label="Load index (optional)"><input style={S.input} className="inp" value={f.loadIndex} onChange={set("loadIndex")} placeholder="98" /></Field>
        <Field label="Speed rating (optional)"><input style={S.input} className="inp" value={f.speedRating} onChange={set("speedRating")} placeholder="Y" /></Field>

        <Field label="Production country (optional)">
          <select style={S.input} className="inp" value={f.country} onChange={set("country")}>
            <option value="">—</option>
            {Object.keys(COUNTRIES).map(c => <option key={c} value={c}>{COUNTRIES[c]} {c}</option>)}
          </select>
        </Field>
        <Field label="Production year"><input style={S.input} className="inp" value={f.year} onChange={set("year")} placeholder="2026" inputMode="numeric" list="years" />
          <datalist id="years">{YEAR_OPTIONS.map(y => <option key={y} value={y} />)}</datalist>
        </Field>
        <Field label="Supplier (optional)"><input style={S.input} className="inp" value={f.supplier} onChange={set("supplier")} placeholder="Abbas Ghuloom" list="suppliers" />
          <datalist id="suppliers">{KNOWN_SUPPLIERS.map(s => <option key={s} value={s} />)}</datalist>
        </Field>

        <Field label="Cost / unit (KD) *"><input style={S.input} className="inp" value={f.cost} onChange={set("cost")} placeholder="180" inputMode="decimal" /></Field>
        <Field label={`Price / unit (KD)${autoFill ? " — auto, editable" : ""}`}>
          <input style={{ ...S.input, ...(autoFill ? S.inputAuto : {}) }} className="inp" value={f.price} onChange={set("price")} placeholder="250" inputMode="decimal" />
        </Field>
      </div>

      <label className="chk" style={S.chkRow}>
        <input type="checkbox" checked={autoFill} onChange={e => setAutoFill(e.target.checked)} />
        <span>
          {isAgreedPricing(f)
            ? `Auto-price for ${/pirelli/i.test(`${f.brand} ${f.supplier}`) ? "Pirelli" : "Michelin"} (${Math.round(agreedMarginPct(f.brand, f.supplier, f.year) * 100)}% margin${/michelin|bfgoodrich/i.test(`${f.brand} ${f.supplier}`) ? `, ${f.year || "current year"}` : ""}) — you can still edit`
            : `Auto-price from formula (cost + ${f.rim ? autoMargin(category, f.rim) : "margin"} KD) ÷ 0.9 — you can still edit the price`}
        </span>
      </label>

      <ProfitIndicator cost={f.cost} price={f.price} category={category} tire={{ brand: f.brand, supplier: f.supplier, category, rim: f.rim, year: f.year }} />

      <Field label="Notes (optional)"><textarea style={{ ...S.input, minHeight: 60, resize: "vertical" }} className="inp" value={f.notes} onChange={set("notes")} /></Field>

      {dupWarn === -1 && (
        <div style={{ ...S.dupBanner, marginTop: 14 }}>
          <span>⚠️ This tire may already be in the catalog. Add it anyway?</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setDupWarn(0)} className="ghost" style={S.dupCancelBtn}>Cancel</button>
            <button onClick={() => submit(true)} className="primary" style={S.dupAddBtn}>Add anyway</button>
          </div>
        </div>
      )}
      <button onClick={() => submit(false)} className="primary" style={{ ...S.waBtn, marginTop: 16 }}><Plus size={16} /> Add to catalog</button>
      </div>
      )}
    </div>
  );
}

function QuickHelper({ text }) {
  const FIELDS = ["Brand", "Pattern", "Load", "Speed", "Country", "Year", "Cost", "Price"];
  // take the last non-empty, non-size line as the one being typed
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  let last = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const isSize = /^\d{3}\s*\/\s*\d{2}\s*z?r?\s*\d{2}/i.test(lines[i]) && lines[i].split("/").length <= 3;
    if (!isSize) { last = lines[i]; break; }
  }
  if (!last || !last.includes("/")) return null;
  const parts = last.split("/").map(s => s.trim());
  return (
    <div style={S.qHelp}>
      <span style={S.qHelpLabel}>Reading last line as:</span>
      <div style={S.qHelpRow}>
        {FIELDS.map((f, i) => {
          if (i >= parts.length) return null;
          const val = parts[i];
          const empty = !val;
          return (
            <span key={f} style={S.qHelpChip}>
              <span style={S.qHelpField}>{f}</span>
              <span style={{ ...S.qHelpVal, ...(empty ? { color: "#C9A84C", fontStyle: "italic" } : {}) }}>{empty ? "(skip→fill)" : val}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function DraftPreview({ drafts, updateDraft, removeDraft, addAllDrafts, setDrafts, hint, showSuggested, dupWarn, clearDup }) {
  const countryNames = Object.keys(COUNTRIES);
  return (
    <div style={{ marginTop: 18 }}>
      {hint && <div style={S.draftHint}>{hint}</div>}
      {showSuggested && <div style={S.draftHint}>Fields shown in <span style={{ color: "#1A4F8A", fontWeight: 700 }}>blue</span> were auto-suggested from history — check them before adding.</div>}
      {drafts.map((d, i) => {
        const dcat = CATEGORY[d.category];
        const profit = round3((Number(d.price) || 0) - (Number(d.cost) || 0));
        const margin = Number(d.price) ? Math.round(profit / Number(d.price) * 100) : 0;
        const tier = profitTier(profit);
        const sug = d._suggested || {};
        return (
          <div key={i} style={S.draftCard}>
            <div style={S.draftTop}>
              <span style={{ ...S.catMini, background: dcat.soft, color: dcat.color }}>{dcat.en}</span>
              <span style={S.draftSrc}>{d.sourceLine}</span>
              <button onClick={() => removeDraft(i)} className="iconbtn" style={{ ...S.iconBtn, marginLeft: "auto", width: 28, height: 28 }}><X size={14} /></button>
            </div>
            <div style={S.draftGrid}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <DraftField label="Brand" value={d.brand} onChange={v => updateDraft(i, "brand", v)} options={[...new Set(KNOWN_BRANDS)]} />
                {d.brandCorrected && d.brandOriginal && d.brand !== d.brandOriginal && (
                  <button onClick={() => updateDraft(i, "brand", d.brandOriginal)} style={S.brandFix}
                    title="Click to keep your original spelling as a new brand">
                    “{d.brandOriginal}” → {d.brand} · keep mine
                  </button>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <DraftField label="Pattern" value={d.pattern} onChange={v => updateDraft(i, "pattern", v)} options={patternsForBrand(d.brand)} />
                  {d.patternCorrected && d.patternOriginal && d.pattern !== d.patternOriginal && (
                    <button onClick={() => updateDraft(i, "pattern", d.patternOriginal)} style={S.brandFix}
                      title="Click to keep your original spelling">
                      “{d.patternOriginal}” → {d.pattern} · keep mine
                    </button>
                  )}
                  {d.patternSuggestions && d.patternSuggestions.length > 0 && (
                    <div style={S.patSugWrap}>
                      <span style={S.patSugLabel}>Did you mean:</span>
                      {d.patternSuggestions.map(s => (
                        <button key={s} onClick={() => updateDraft(i, "pattern", s)} style={S.patSugChip}>{s}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <DraftField label="Type" value={d.type} onChange={v => updateDraft(i, "type", v)} options={["Normal", "Off-Road"]} w={92} />
              <DraftField label="Width" value={d.width} onChange={v => updateDraft(i, "width", v)} w={62} />
              <DraftField label="Aspect" value={d.aspect} onChange={v => updateDraft(i, "aspect", v)} w={62} />
              <DraftField label="Rim" value={d.rim} onChange={v => updateDraft(i, "rim", v)} w={56} />
              <DraftField label="Load" value={d.loadIndex} onChange={v => updateDraft(i, "loadIndex", v)} w={56} suggested={sug.loadIndex} />
              <DraftField label="Speed" value={d.speedRating} onChange={v => updateDraft(i, "speedRating", v)} w={56} suggested={sug.speedRating} />
              {d.year !== undefined && <DraftField label="Year" value={d.year} onChange={v => updateDraft(i, "year", v)} options={YEAR_OPTIONS} w={72} />}
              <DraftField label="Country" value={d.country} onChange={v => updateDraft(i, "country", v)} options={countryNames} suggested={sug.country} />
              <DraftField label="Supplier" value={d.supplier} onChange={v => updateDraft(i, "supplier", v)} options={KNOWN_SUPPLIERS} w={140} />
              <DraftField label={d.listPrice ? `Cost (list ${d.listPrice})` : "Cost"} value={d.cost} onChange={v => updateDraft(i, "cost", v)} w={d.listPrice ? 130 : 70} />
              <DraftField label="Price" value={d.price} onChange={v => updateDraft(i, "price", v)} w={70} suggested={sug.price} />
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={S.draftLabel}>Profit</label>
                <span style={{ ...S.profitBadge, background: tier.bg, color: tier.fg, padding: "7px 10px" }}>+{profit} · {margin}%</span>
                <span style={S.draftSetGain}>+{round3(profit * 4)} / set of 4</span>
              </div>
            </div>
            {Number(d.cost) > 0 && Number(d.price) > 0 && (
              <div style={S.draftPriceNote}>💡 {pricingExplain({ brand: d.brand, supplier: d.supplier, category: d.category, rim: d.rim, year: d.year, cost: d.cost })}</div>
            )}
            <div style={{ marginTop: 8 }}>
              <DraftField label={d.notes ? "Notes · marking detected ✓" : "Notes"} value={d.notes} onChange={v => updateDraft(i, "notes", v)} w={"100%"} />
            </div>
          </div>
        );
      })}
      {dupWarn > 0 && (
        <div style={S.dupBanner}>
          <span>⚠️ {dupWarn} of these may already be in the catalog. Add them anyway?</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={clearDup} className="ghost" style={S.dupCancelBtn}>Cancel</button>
            <button onClick={() => addAllDrafts(true)} className="primary" style={S.dupAddBtn}>Add anyway</button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button onClick={() => setDrafts([])} className="ghost" style={{ ...S.copyBtn, justifyContent: "center" }}>Clear</button>
        <button onClick={() => addAllDrafts(false)} className="primary" style={{ ...S.waBtn, flex: 1, justifyContent: "center" }}>
          <Check size={16} /> Add {drafts.filter(d => d.brand && d.width && d.cost).length} tires to catalog
        </button>
      </div>
    </div>
  );
}

function DraftField({ label, value, onChange, w, options, suggested }) {
  const [open, setOpen] = React.useState(false);
  const [hoverIdx, setHoverIdx] = React.useState(-1);
  const wrapRef = React.useRef(null);

  // close on outside click
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const val = value || "";
  // filter options by what's typed (but if exact match, show all so they can browse siblings)
  const filtered = (options || []).filter(o => {
    if (!val) return true;
    const lo = o.toLowerCase(), lv = val.toLowerCase();
    return lo.includes(lv) || lo.replace(/[\s\-]/g, "").includes(lv.replace(/[\s\-]/g, ""));
  });
  const list = filtered.length ? filtered : (options || []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, position: "relative" }} ref={wrapRef}>
      <label style={{ ...S.draftLabel, ...(suggested ? { color: "#1A4F8A" } : {}) }}>{label}{suggested ? " ·sug" : ""}</label>
      <input value={val} onChange={e => { onChange(e.target.value); if (options) setOpen(true); }}
        onFocus={() => options && setOpen(true)}
        onKeyDown={e => {
          if (!options) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHoverIdx(i => Math.min(i + 1, list.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHoverIdx(i => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && open && hoverIdx >= 0) { e.preventDefault(); onChange(list[hoverIdx]); setOpen(false); }
          else if (e.key === "Escape") setOpen(false);
        }}
        style={{ ...S.draftInput, width: w || 110, ...(suggested ? { borderColor: "#1A4F8A", background: "#F2F7FC", color: "#1A4F8A", fontWeight: 700 } : {}) }} className="inp" />
      {options && open && list.length > 0 && (
        <div style={S.ddPanel}>
          {list.map((o, idx) => (
            <div key={o}
              onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false); }}
              onMouseEnter={() => setHoverIdx(idx)}
              style={{ ...S.ddItem, ...(idx === hoverIdx ? S.ddItemHover : {}), ...(o === val ? S.ddItemActive : {}) }}>
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return <div><label style={S.label}>{label}</label>{children}</div>;
}

// ── CATALOG VIEW ──────────────────────────────────────────────────────────────
function BulkEditModal({ tires, onClose, onSave }) {
  // Two modes: "pricing" (year/cost/margin/price — fast) and "full" (pattern/load/
  // speed/country/notes — for backfilling missing data). Same rows, different columns.
  const [mode, setMode] = useState("pricing");
  const [rows, setRows] = useState(() =>
    tires
      .slice()
      .sort((a, b) => a.price - b.price) // low → high, matching Search & Quote
      .map(t => {
        const agreed = isAgreedPricing(t);
        const margin = autoMargin(t.category, t.rim);
        // Unified pricing on open so margin & price always match.
        const price = computeTirePrice(t);
        return {
          id: t.id,
          brand: t.brand,
          label: `${t.brand}${t.pattern ? " " + t.pattern : ""}`,
          pattern: t.pattern || "",
          type: t.type || "Normal",
          supplier: t.supplier || "",
          structure: t.structure || "R",
          sku: t.sku || "",
          loadIndex: t.loadIndex || "",
          speedRating: t.speedRating || "",
          notes: t.notes || "",
          country: t.country || "", category: t.category, rim: t.rim,
          year: t.year || "",
          cost: t.cost,
          margin,                       // suggested margin (non-agreed)
          price,                        // formula price
          priceEdited: false,           // shown as auto for all
          agreed,                       // agreed-pricing brand
          useFormula: true,             // all rows compute on cost change
        };
      })
  );

  const update = (id, field, value) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const nr = { ...r, [field]: value };
      if ((field === "cost" || field === "margin") && nr.useFormula) {
        nr.price = nr.agreed
          ? computeTirePrice(nr)
          : autoPrice(nr.cost, nr.margin);
        nr.priceEdited = false;
      }
      if (field === "price") nr.priceEdited = true;
      return nr;
    }));
  };

  // Toggle the formula on for an agreed-pricing row (purchaser opts in)
  const applyFormula = (id) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const price = autoPrice(r.cost, r.margin);
      return { ...r, useFormula: true, price, priceEdited: false };
    }));
  };

  const profitOf = (r) => round3((Number(r.price) || 0) - (Number(r.cost) || 0));
  const marginPctOf = (r) => {
    const p = Number(r.price) || 0;
    return p ? Math.round(profitOf(r) / p * 100) : 0;
  };

  // Size-only label (no load/speed) for assurance: e.g. "275/60R20"
  const t0 = tires[0];
  const sizeLabel = t0 ? `${t0.width}/${t0.aspect}${t0.structure || "R"}${t0.rim}` : "";

  return (
    <div style={S.modalWrap} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 860, width: "96vw" }} onClick={e => e.stopPropagation()}>
        <div style={S.modalHead}>
          <div>
            <h3 style={S.modalTitle}>Quick edit</h3>
            {sizeLabel && <div style={S.bulkSizeLabel}>{sizeLabel} · {rows.length} tire{rows.length !== 1 ? "s" : ""}</div>}
          </div>
          <button onClick={onClose} className="iconbtn" style={S.iconBtn}><X size={18} /></button>
        </div>

        {/* Mode toggle */}
        <div style={S.bulkModeWrap}>
          <button onClick={() => setMode("pricing")} style={{ ...S.bulkModeBtn, ...(mode === "pricing" ? S.bulkModeBtnOn : {}) }}>Pricing</button>
          <button onClick={() => setMode("full")} style={{ ...S.bulkModeBtn, ...(mode === "full" ? S.bulkModeBtnOn : {}) }}>Full edit</button>
        </div>

        <p style={S.sub}>
          {mode === "pricing"
            ? 'Price auto-calculates as (cost + margin) ÷ 0.9, rounded up. Michelin/BFGoodrich/Pirelli keep their supplier price — tap "Apply formula" to override.'
            : "Fill in or correct pattern, load index, speed rating, country and notes. Useful when data is missing."}
        </p>

        <div style={{ ...S.bulkTableWrap, ...(mode === "full" ? { overflowX: "auto" } : {}) }}>
          {mode === "pricing" ? (
            <>
              <div style={{ ...S.bulkRow, ...S.bulkHeadRow }}>
                <span style={{ flex: 2 }}>Tire</span>
                <span style={S.bulkCol}>Year</span>
                <span style={S.bulkCol}>Cost</span>
                <span style={S.bulkCol}>Margin</span>
                <span style={S.bulkCol}>Price</span>
                <span style={{ ...S.bulkCol, flex: 1.3 }}>Profit / %</span>
              </div>
              {rows.map(r => {
                const profit = profitOf(r);
                const loss = profit < 0;
                const formulaOff = r.agreed && !r.useFormula;
                return (
                  <div key={r.id} style={S.bulkRow}>
                    <div style={{ flex: 2, minWidth: 0 }}>
                      <div style={S.bulkTireName}>{r.label}</div>
                      <div style={S.bulkTireSub}>
                        {r.country || "—"} · R{r.rim}
                        {r.agreed && <span style={S.agreedTag}>agreed price</span>}
                      </div>
                    </div>
                    <input style={S.bulkInput} value={r.year} onChange={e => update(r.id, "year", e.target.value)} placeholder="Year" />
                    <input style={S.bulkInput} type="number" value={r.cost} onChange={e => update(r.id, "cost", e.target.value)} />
                    {formulaOff ? (
                      <button style={{ ...S.bulkInput, ...S.applyFormulaBtn }} onClick={() => applyFormula(r.id)} title="Override the supplier price using cost + margin formula">
                        Apply formula
                      </button>
                    ) : (
                      <input style={{ ...S.bulkInput, ...S.bulkMargin }} type="number" value={r.margin} onChange={e => update(r.id, "margin", e.target.value)} />
                    )}
                    <input style={{ ...S.bulkInput, ...(r.priceEdited ? {} : S.bulkAuto) }} type="number" value={r.price} onChange={e => update(r.id, "price", e.target.value)} title={r.priceEdited ? "Set price" : "Auto from cost + margin"} />
                    <span style={{ ...S.bulkCol, flex: 1.3, justifyContent: "flex-start" }}>
                      <span style={{ ...S.bulkProfit, color: loss ? "#C0392B" : "#1D7A45" }}>
                        {loss ? "⚠ " : "+"}{profit} KD
                      </span>
                      <span style={S.bulkPct}>· {marginPctOf(r)}%</span>
                    </span>
                  </div>
                );
              })}
            </>
          ) : (
            <div style={{ minWidth: 920 }}>
              <div style={{ ...S.bulkRow, ...S.bulkHeadRow }}>
                <span style={{ flex: 1.3 }}>Tire</span>
                <span style={{ flex: 1.5 }}>Pattern</span>
                <span style={S.bulkCol}>Type</span>
                <span style={S.bulkCol}>Struct</span>
                <span style={S.bulkCol}>Load</span>
                <span style={S.bulkCol}>Speed</span>
                <span style={{ flex: 1.1 }}>Country</span>
                <span style={{ flex: 1.4 }}>Supplier</span>
                <span style={{ flex: 1.2 }}>SKU</span>
                <span style={{ flex: 1.8 }}>Notes / markings</span>
              </div>
              {rows.map(r => (
                <div key={r.id} style={S.bulkRow}>
                  <div style={{ flex: 1.3, minWidth: 0 }}>
                    <div style={S.bulkTireName}>{r.brand}</div>
                    <div style={S.bulkTireSub}>R{r.rim}</div>
                  </div>
                  <input style={{ ...S.bulkInput, flex: 1.5 }} value={r.pattern} onChange={e => update(r.id, "pattern", e.target.value)} placeholder="Pattern" />
                  <select style={S.bulkInput} value={r.type} onChange={e => update(r.id, "type", e.target.value)}>
                    <option>Normal</option><option>Off-Road</option>
                  </select>
                  <select style={S.bulkInput} value={r.structure} onChange={e => update(r.id, "structure", e.target.value)}>
                    <option>R</option><option>ZR</option>
                  </select>
                  <input style={S.bulkInput} value={r.loadIndex} onChange={e => update(r.id, "loadIndex", e.target.value)} placeholder="Load" />
                  <input style={S.bulkInput} value={r.speedRating} onChange={e => update(r.id, "speedRating", e.target.value)} placeholder="Spd" />
                  <select style={{ ...S.bulkInput, flex: 1.1 }} value={r.country} onChange={e => update(r.id, "country", e.target.value)}>
                    <option value="">—</option>
                    {Object.keys(COUNTRIES).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input style={{ ...S.bulkInput, flex: 1.4 }} value={r.supplier} onChange={e => update(r.id, "supplier", e.target.value)} placeholder="Supplier" />
                  <input style={{ ...S.bulkInput, flex: 1.2 }} value={r.sku} onChange={e => update(r.id, "sku", e.target.value)} placeholder="SKU" />
                  <input style={{ ...S.bulkInput, flex: 1.8 }} value={r.notes} onChange={e => update(r.id, "notes", e.target.value)} placeholder="e.g. Porsche (N0), XL" />
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 9, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={S.cancelBtn}>Cancel</button>
          <button onClick={() => onSave(rows)} style={S.saveAllBtn}><Check size={15} /> Save all</button>
        </div>
      </div>
    </div>
  );
}

function CatalogView({ tires, setTires, showToast }) {
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [editing, setEditing] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null); // tire pending delete confirmation
  const [bulkSize, setBulkSize] = useState(null);      // size key for bulk edit, or null
  const [catSortBy, setCatSortBy] = useState("price"); // 'price' | 'profit' | 'newest'
  const [catSortDir, setCatSortDir] = useState("desc"); // 'desc' (high→low, default) | 'asc'
  // Catalog search history (per-device, last 8, separate from Search & Quote)
  const [catHistory, setCatHistory] = useState(() => {
    try {
      const raw = localStorage.getItem("bnchr_catalog_history");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const pushCatHistory = (term) => {
    const v = (term || "").trim();
    if (!v) return;
    setCatHistory(prev => {
      const next = [v, ...prev.filter(h => h.toLowerCase() !== v.toLowerCase())];
      return next.slice(0, 8);
    });
  };
  useEffect(() => {
    try { localStorage.setItem("bnchr_catalog_history", JSON.stringify(catHistory)); } catch {}
  }, [catHistory]);
  // Record a search after the user pauses typing (debounced)
  useEffect(() => {
    if (!q.trim()) return;
    const t = setTimeout(() => pushCatHistory(q), 1200);
    return () => clearTimeout(t);
  }, [q]);
  const [fType, setFType] = useState("");      // "" | Normal | Off-Road
  const [fProfit, setFProfit] = useState("");  // "" | high | mid | low
  const [fRim, setFRim] = useState("");        // "" | "18" ...
  const [fSupplier, setFSupplier] = useState(""); // "" | supplier name
  const [fStale, setFStale] = useState(false); // (availability lives in search tab; kept for future)

  // Unique rims & suppliers for filter options
  const rimOptions = useMemo(() => [...new Set(tires.map(t => t.rim))].sort((a, b) => Number(a) - Number(b)), [tires]);
  const supplierOptions = useMemo(() => [...new Set(tires.map(t => t.supplier).filter(Boolean))].sort(), [tires]);

  const activeFilterCount = [fType, fProfit, fRim, fSupplier].filter(Boolean).length;
  const clearFilters = () => { setFType(""); setFProfit(""); setFRim(""); setFSupplier(""); };

  const parsed = parseSize(q);
  const filtered = useMemo(() => {
    let base = tires.filter(t => !catFilter || t.category === catFilter);

    // advanced filters
    if (fType) base = base.filter(t => t.type === fType);
    if (fRim) base = base.filter(t => t.rim === fRim);
    if (fSupplier) base = base.filter(t => t.supplier === fSupplier);
    if (fProfit) base = base.filter(t => profitTier(round3(t.price - t.cost)).label === fProfit);

    // Apply search, then sort by chosen direction
    const lastActivity = (t) => {
      // most recent history timestamp = when it was added or last edited
      if (t.history && t.history.length) {
        return Math.max(...t.history.map(h => new Date(h.ts).getTime() || 0));
      }
      return t._availableAt ? new Date(t._availableAt).getTime() : 0;
    };
    const sortFn = (arr) => {
      const dir = catSortDir === "asc" ? 1 : -1;
      if (catSortBy === "newest") {
        // newest first when desc (default), oldest first when asc
        return [...arr].sort((a, b) => dir * (lastActivity(b) - lastActivity(a)) * -1);
      }
      return [...arr].sort((a, b) =>
        catSortBy === "profit"
          ? dir * ((a.price - a.cost) - (b.price - b.cost))
          : dir * (a.price - b.price));
    };

    if (!q.trim()) return sortFn(base);

    // Full size match first (265/65r18, 2656518, etc.)
    if (parsed) {
      const exact = base.filter(t => matchesSize(t, parsed));
      if (exact.length) return sortFn(exact);
    }

    // Multi-term: every term must match somewhere (brand, pattern, supplier, size, country, dims)
    const terms = q.toLowerCase().split(/[\s,]+/).filter(Boolean);
    return sortFn(base.filter(t => {
      const hay = `${t.brand} ${t.pattern} ${t.supplier} ${t.country} ${sizeString(t)} ${t.width} ${t.aspect} ${t.rim} ${t.type} ${t.sku || ""}`.toLowerCase();
      return terms.every(term => {
        // pure number term → match width/aspect/rim as whole tokens, else substring
        if (/^\d{2,3}$/.test(term)) {
          return t.width === term || t.aspect === term || t.rim === term || hay.includes(term);
        }
        return hay.includes(term);
      });
    }));
  }, [tires, q, parsed, catFilter, fType, fProfit, fRim, fSupplier, catSortBy, catSortDir]);

  // Smart-typing suggestions for the catalog (brands + sizes that match)
  const sugg = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term || parsed) return [];
    const lastTerm = term.split(/[\s,]+/).pop();
    if (!lastTerm || lastTerm.length < 2) return [];
    const brands = [...new Set(tires.map(t => t.brand))]
      .filter(b => b.toLowerCase().includes(lastTerm))
      .slice(0, 5)
      .map(b => ({ type: "brand", label: b }));
    return brands;
  }, [q, tires, parsed]);

  const del = (id) => { setTires(prev => prev.filter(t => t.id !== id)); showToast("Tire removed"); };
  const confirmDelete = () => {
    if (confirmDel) { del(confirmDel.id); setConfirmDel(null); }
  };

  // Duplicate a tire (e.g. same tire from a different country) — copy comes in OUT of stock
  const duplicateTire = (t) => {
    const copy = {
      ...t,
      id: "t_" + Math.random().toString(36).slice(2, 10), // temp id → DB insert on sync
      inStock: false,
      _availableAt: null,
      history: [{ ts: new Date().toISOString(), cost: t.cost, price: t.price, note: "Duplicated" }],
    };
    setTires(prev => {
      // insert the copy right after the original
      const idx = prev.findIndex(x => x.id === t.id);
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    setEditing(copy); // open the edit box on the new copy so the purchaser can adjust it
  };

  // Save all bulk edits at once
  const saveBulk = (rows) => {
    const byId = new Map(rows.map(r => [r.id, r]));
    setTires(prev => prev.map(t => {
      const r = byId.get(t.id);
      if (!r) return t;
      const newCost = Number(r.cost) || 0;
      const newPrice = Number(r.price) || 0;
      // detect any change across pricing + full-edit fields
      const priceChanged = t.cost !== newCost || t.price !== newPrice;
      const fieldsChanged = (t.year || "") !== (r.year || "")
        || (t.pattern || "") !== (r.pattern || "")
        || (t.type || "") !== (r.type || "")
        || (t.supplier || "") !== (r.supplier || "")
        || (t.structure || "") !== (r.structure || "")
        || (t.sku || "") !== (r.sku || "")
        || (t.loadIndex || "") !== (r.loadIndex || "")
        || (t.speedRating || "") !== (r.speedRating || "")
        || (t.country || "") !== (r.country || "")
        || (t.notes || "") !== (r.notes || "");
      if (!priceChanged && !fieldsChanged) return t;
      const history = priceChanged
        ? [...t.history, { ts: new Date().toISOString(), cost: newCost, price: newPrice, note: "Bulk edit" }]
        : [...t.history, { ts: new Date().toISOString(), cost: t.cost, price: t.price, note: "Bulk edit (details)" }];
      return {
        ...t,
        year: r.year,
        cost: newCost,
        price: newPrice,
        pattern: r.pattern,
        type: r.type,
        supplier: r.supplier,
        structure: r.structure,
        sku: r.sku,
        loadIndex: r.loadIndex,
        speedRating: r.speedRating,
        country: r.country,
        notes: r.notes,
        history,
      };
    }));
    setBulkSize(null);
    showToast("Changes saved");
  };

  // ── Export (current filtered view) ──
const exportRows = () => filtered.map(t => {
    const profit = round3(t.price - t.cost);
    const margin = t.price ? Math.round(profit / t.price * 100) : 0;
    return {
      Brand: t.brand, Pattern: t.pattern || "", Category: CATEGORY[t.category].en,
      Type: t.type, Size: sizeString(t), Width: t.width, Aspect: t.aspect,
      Structure: t.structure, Rim: t.rim, LoadIndex: t.loadIndex || "", SpeedRating: t.speedRating || "",
      "Markings / OEM": t.notes || "",
      Country: t.country || "", Year: t.year || "", Supplier: t.supplier || "", SKU: t.sku || "",
      Cost: t.cost, Price: t.price, Profit: profit, Margin: margin + "%",
      Availability: t.inStock ? "In Stock" : "Out of Stock",
      "Availability Confirmed": t._availableAt ? new Date(t._availableAt).toISOString().slice(0, 10) : "",
    };
  });

  const downloadFile = (content, filename, mime) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const stamp = () => new Date().toISOString().slice(0, 10);

  const exportCSV = () => {
    const rows = exportRows();
    if (!rows.length) { showToast("Nothing to export"); return; }
    const headers = Object.keys(rows[0]);
    const esc = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = "\uFEFF" + [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))].join("\n");
    downloadFile(csv, `BNCHR_catalog_${stamp()}.csv`, "text/csv;charset=utf-8;");
    showToast(`Exported ${rows.length} tires (CSV)`);
  };
  const saveEdit = (updated) => {
    setTires(prev => prev.map(t => {
      if (t.id !== updated.id) return t;
      const changed = t.cost !== updated.cost || t.price !== updated.price;
      const history = changed ? [...t.history, { ts: new Date().toISOString(), cost: updated.cost, price: updated.price, note: "Edited" }] : t.history;
      return { ...updated, category: detectCategory(updated.brand), history };
    }));
    setEditing(null); showToast("Tire updated");
  };

  // Purchaser toggles in-stock status (confirming resets the freshness clock)
  const toggleStock = (tire) => {
    const turningOn = !tire.inStock;
    const stamp = new Date().toISOString();
    setTires(prev => prev.map(t =>
      t.id === tire.id
        ? { ...t, inStock: turningOn, _availableAt: turningOn ? stamp : null }
        : t
    ));
    showToast(turningOn ? "Marked in stock" : "Marked out of stock");
  };

  return (
    <div>
      <div style={S.card}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
            <Search size={16} style={S.searchIcon} />
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Try: michelin 18 · 265 65 18 · pirelli off-road · behbehani"
              style={{ ...S.input, paddingLeft: 38 }} className="inp" />
            {sugg.length > 0 && (
              <div style={S.sugBox}>
                {sugg.map(s => (
                  <button key={s.label} className="sugitem" style={S.sugItem}
                    onMouseDown={() => {
                      const parts = q.split(/[\s,]+/);
                      parts[parts.length - 1] = s.label;
                      setQ(parts.join(" ") + " ");
                    }}>
                    <span style={S.sugSize}>{s.label}</span>
                    <span style={S.sugCount}>{tires.filter(t => t.brand === s.label).length} tires</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button onClick={() => setCatFilter("")} style={{ ...S.filterChip, ...(catFilter === "" ? S.filterChipOn : {}) }}>All</button>
            {CATEGORY_ORDER.map(c => (
              <button key={c} onClick={() => setCatFilter(c)} style={{ ...S.filterChip, ...(catFilter === c ? { ...S.filterChipOn, background: CATEGORY[c].color, borderColor: CATEGORY[c].color } : {}) }}>
                {CATEGORY[c].en.split(" ")[0]}
              </button>
            ))}
            <button onClick={() => setShowFilters(true)} className="filterChip"
              style={{ ...S.filterChip, ...(activeFilterCount ? S.filterChipOn : {}), display: "flex", alignItems: "center", gap: 5 }}>
              <Filter size={13} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </button>
          </div>
        </div>
        {catHistory.length > 0 && !q.trim() && (
          <div style={S.catHistoryWrap}>
            <History size={13} style={{ color: "#999", flexShrink: 0 }} />
            {catHistory.map((h, i) => (
              <button key={i} onClick={() => setQ(h)} className="histchip" style={S.histChip}>{h}</button>
            ))}
          </div>
        )}
      </div>

      <div style={S.card}>
        <div style={{ ...S.catalogHead, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>{filtered.length} tire{filtered.length !== 1 ? "s" : ""}</span>
            <div style={S.sortWrap}>
              <span style={S.sortLabel}>Sort:</span>
              <button onClick={() => setCatSortBy("price")} className="sortbtn"
                style={{ ...S.sortBtn, ...(catSortBy === "price" ? S.sortBtnOn : {}) }}>Price</button>
              <button onClick={() => setCatSortBy("profit")} className="sortbtn"
                style={{ ...S.sortBtn, ...(catSortBy === "profit" ? S.sortBtnOn : {}) }}>Profit</button>
              <button onClick={() => setCatSortBy("newest")} className="sortbtn"
                style={{ ...S.sortBtn, ...(catSortBy === "newest" ? S.sortBtnOn : {}) }}>Newest</button>
              <button onClick={() => setCatSortDir(d => d === "desc" ? "asc" : "desc")} className="sortbtn"
                style={{ ...S.sortBtn, ...S.sortDirBtn }}
                title={catSortBy === "newest"
                  ? (catSortDir === "desc" ? "Newest first (tap for oldest first)" : "Oldest first (tap for newest first)")
                  : (catSortDir === "desc" ? "High to Low (tap for Low to High)" : "Low to High (tap for High to Low)")}>
                {catSortBy === "newest"
                  ? (catSortDir === "desc" ? "↓ Newest" : "↑ Oldest")
                  : (catSortDir === "desc" ? "↓ High–Low" : "↑ Low–High")}
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 7 }}>
            {parsed && filtered.length > 0 && (
              <button onClick={() => setBulkSize(filtered.map(t => t.id))} className="ghost" style={S.bulkBtn}
                title="Quick-edit year, cost & price for all tires of this size">
                <Edit3 size={14} /> Quick edit all
              </button>
            )}
            <button onClick={exportCSV} className="ghost" style={S.dlBtn} title="Download current view as CSV">
              <Download size={14} /> Download CSV
            </button>
          </div>
        </div>
        {filtered.map(t => {
          const ts = t._availableAt ? new Date(t._availableAt).getTime() : null;
          const inStock = !!t.inStock;
          const tier = freshnessTier(ts);
          return (
          <div key={t.id} style={S.catalogRow}>
            <div style={{ flex: 1 }}>
              <div style={S.tireLine}>{tireLine(t)}</div>
              {t.notes && <div style={S.markingNote}>🏷 {t.notes}</div>}
              <div style={S.tireMeta}>
                <span style={{ ...S.catMini, background: CATEGORY[t.category].soft, color: CATEGORY[t.category].color }}>{CATEGORY[t.category].en}</span>
                <span style={S.priceTag}>{t.price} KD</span>
                <span style={S.costTag}>cost {t.cost}</span>
                {(() => {
                  const profit = round3(t.price - t.cost);
                  const margin = t.price ? Math.round(profit / t.price * 100) : 0;
                  const ptier = profitTier(profit);
                  return (
                    <span style={{ ...S.profitBadge, background: ptier.bg, color: ptier.fg }}>
                      +{profit} KD <span style={S.profitMargin}>· {margin}%</span>
                    </span>
                  );
                })()}
                {t.supplier && <span style={S.supplierTag}>{t.supplier}</span>}
                {t.sku && <span style={S.skuTag}>SKU {t.sku}</span>}
              </div>
            </div>
            <div style={S.tireActions}>
              <button onClick={() => toggleStock(t)} className="availbtn"
                style={{ ...S.catStockBtn, ...(inStock ? { background: tier ? FRESH_COLOR[tier] : "#1D7A45", borderColor: tier ? FRESH_COLOR[tier] : "#1D7A45", color: "#fff" } : {}) }}
                title={inStock ? (freshnessLabel(ts) || "In stock") + " — tap to mark out of stock" : "Out of stock — tap to mark available"}>
                {inStock ? <><Check size={13} /> {freshnessLabel(ts) || "In Stock"}</> : "Out of Stock"}
              </button>
              <button onClick={() => setHistoryFor(t)} className="iconbtn" style={S.iconBtn} title="Price history"><History size={15} /></button>
              <button onClick={() => duplicateTire(t)} className="iconbtn" style={S.iconBtn} title="Duplicate (e.g. another country)"><Copy size={15} /></button>
              <button onClick={() => setEditing(t)} className="iconbtn" style={S.iconBtn} title="Edit"><Edit3 size={15} /></button>
              <button onClick={() => setConfirmDel(t)} className="iconbtn" style={{ ...S.iconBtn, color: "#C0392B" }} title="Delete"><Trash2 size={15} /></button>
            </div>
          </div>
          );
        })}
        {filtered.length === 0 && <div style={S.empty}>No tires match. Try a different search.</div>}
      </div>

      {editing && <EditModal tire={editing} onClose={() => setEditing(null)} onSave={saveEdit} />}
      {historyFor && <HistoryModal tire={historyFor} onClose={() => setHistoryFor(null)} />}

      {confirmDel && (
        <div style={S.modalWrap} onClick={() => setConfirmDel(null)}>
          <div style={{ ...S.modal, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div style={S.modalHead}>
              <h3 style={S.modalTitle}>Delete tire?</h3>
              <button onClick={() => setConfirmDel(null)} className="iconbtn" style={S.iconBtn}><X size={18} /></button>
            </div>
            <p style={{ ...S.sub, marginBottom: 6 }}>This permanently removes:</p>
            <div style={S.delTarget}>
              <div style={S.tireLine}>{tireLine(confirmDel)}</div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>
                {confirmDel.supplier || "—"}{confirmDel.sku ? ` · SKU ${confirmDel.sku}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 9, marginTop: 18 }}>
              <button onClick={() => setConfirmDel(null)} style={S.cancelBtn}>Cancel</button>
              <button onClick={confirmDelete} style={S.deleteConfirmBtn}><Trash2 size={15} /> Delete</button>
            </div>
          </div>
        </div>
      )}

      {bulkSize && (
        <BulkEditModal
          tires={tires.filter(t => bulkSize.includes(t.id))}
          onClose={() => setBulkSize(null)}
          onSave={saveBulk}
        />
      )}

      {showFilters && (
        <div style={S.drawerWrap} onClick={() => setShowFilters(false)}>
          <div style={S.drawer} onClick={e => e.stopPropagation()}>
            <div style={S.modalHead}>
              <h3 style={S.modalTitle}>Filters{activeFilterCount ? ` · ${activeFilterCount} active` : ""}</h3>
              <button onClick={() => setShowFilters(false)} className="iconbtn" style={S.iconBtn}><X size={18} /></button>
            </div>

            <div style={S.filterGroup}>
              <span style={S.filterLabel}>Type</span>
              <div style={S.filterChipRow}>
                {["", "Normal", "Off-Road"].map(v => (
                  <button key={v} onClick={() => setFType(v)} style={{ ...S.fChip, ...(fType === v ? S.fChipOn : {}) }}>
                    {v === "" ? "All" : v}
                  </button>
                ))}
              </div>
            </div>

            <div style={S.filterGroup}>
              <span style={S.filterLabel}>Profit tier</span>
              <div style={S.filterChipRow}>
                {[["", "All"], ["high", "🔵 High (11+)"], ["mid", "🟡 Mid (7-10)"], ["low", "⚪ Low (≤6)"]].map(([v, lbl]) => (
                  <button key={v} onClick={() => setFProfit(v)} style={{ ...S.fChip, ...(fProfit === v ? S.fChipOn : {}) }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            <div style={S.filterGroup}>
              <span style={S.filterLabel}>Rim size</span>
              <div style={S.filterChipRow}>
                <button onClick={() => setFRim("")} style={{ ...S.fChip, ...(fRim === "" ? S.fChipOn : {}) }}>All</button>
                {rimOptions.map(r => (
                  <button key={r} onClick={() => setFRim(r)} style={{ ...S.fChip, ...(fRim === r ? S.fChipOn : {}) }}>{r}"</button>
                ))}
              </div>
            </div>

            <div style={S.filterGroup}>
              <span style={S.filterLabel}>Supplier</span>
              <select value={fSupplier} onChange={e => setFSupplier(e.target.value)} style={S.input} className="inp">
                <option value="">All suppliers</option>
                {supplierOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={clearFilters} className="ghost" style={{ ...S.copyBtn, flex: 1, justifyContent: "center" }}>Clear all</button>
              <button onClick={() => setShowFilters(false)} className="primary" style={{ ...S.waBtn, flex: 1, justifyContent: "center" }}>
                Show {filtered.length} tire{filtered.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── EDIT MODAL ────────────────────────────────────────────────────────────────
function EditModal({ tire, onClose, onSave }) {
  const [f, setF] = useState({ ...tire, cost: String(tire.cost), price: String(tire.price) });
  const [showAll, setShowAll] = useState(false);
  const [autoFill, setAutoFill] = useState(true); // cost change → auto price from formula
  const set = (k) => (e) => setF(prev => ({ ...prev, [k]: e.target.value }));
  const save = () => onSave({ ...f, cost: round3(Number(f.cost) || 0), price: round3(Number(f.price) || 0) });

  const category = detectCategory(f.brand);
  const cat = CATEGORY[category];
  const agreed = isAgreedPricing(f);
  const suggestedMargin = f.rim ? autoMargin(category, f.rim) : null;
  const reapplyMargin = () => {
    if (!f.cost) return;
    const p = computeTirePrice({ brand: f.brand, supplier: f.supplier, category, rim: f.rim, year: f.year, cost: f.cost });
    setF(prev => ({ ...prev, price: String(p) }));
  };

  const sizePreview = (f.width && f.aspect && f.rim)
    ? sizeString({ width: f.width, aspect: f.aspect, structure: f.structure, rim: f.rim, loadIndex: f.loadIndex, speedRating: f.speedRating })
    : "—";

  return (
    <div style={S.modalWrap} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.modalHead}>
          <h3 style={S.modalTitle}>Edit tire</h3>
          <button onClick={onClose} className="iconbtn" style={S.iconBtn}><X size={18} /></button>
        </div>

        {/* Category + size preview (always visible) */}
        <div style={{ ...S.previewLine, borderColor: cat.color, marginBottom: 14 }}>
          <div style={{ ...S.catTag, background: cat.soft, color: cat.color, display: "inline-flex", marginBottom: 6 }}>
            <span style={{ ...S.catDot, background: cat.color }} />{cat.en} <span style={S.catAr}>{cat.ar}</span>
          </div>
          <div style={S.previewText}>{f.brand}{f.pattern ? " " + f.pattern : ""}</div>
          <div style={S.previewSize}>Size: {sizePreview}</div>
        </div>

        {/* Default fields */}
        <div style={S.grid}>
          <Field label="Supplier"><input style={S.input} className="inp" value={f.supplier || ""} onChange={set("supplier")} /></Field>
          <Field label="Year"><input style={S.input} className="inp" value={f.year || ""} onChange={set("year")} inputMode="numeric" /></Field>
          <Field label="Cost (KD)"><input style={S.input} className="inp" value={f.cost}
            onChange={e => { const v = e.target.value; setF(prev => ({ ...prev, cost: v, price: (autoFill && v) ? String(computeTirePrice({ brand: prev.brand, supplier: prev.supplier, category, rim: prev.rim, year: prev.year, cost: v })) : prev.price })); }}
            inputMode="decimal" /></Field>
          <Field label="Price (KD)"><input style={S.input} className="inp" value={f.price} onChange={set("price")} inputMode="decimal" /></Field>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 10, flexWrap: "wrap" }}>
          <label className="chk" style={{ ...S.chkRow, marginTop: 0, fontSize: 12.5 }}>
            <input type="checkbox" checked={autoFill} onChange={e => setAutoFill(e.target.checked)} />
            <span>
              {agreed
                ? `Auto-price (${/pirelli/i.test(`${f.brand} ${f.supplier}`) ? "Pirelli 13%" : `Michelin ${Math.round(agreedMarginPct(f.brand, f.supplier, f.year) * 100)}%`})`
                : `Auto-price from formula (cost + ${suggestedMargin ?? "margin"} KD) ÷ 0.9`}
            </span>
          </label>
          <button onClick={reapplyMargin} className="ghost" style={S.reapplyBtn} title="Recompute price from cost">
            Re-apply formula
          </button>
        </div>

        <ProfitIndicator cost={f.cost} price={f.price} category={category} tire={{ brand: f.brand, supplier: f.supplier, category, rim: f.rim, year: f.year }} />

        {/* View all toggle */}
        <button onClick={() => setShowAll(v => !v)} className="ghost" style={S.viewAllBtn}>
          {showAll ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {showAll ? "Hide extra fields" : "View all fields"}
        </button>

        {showAll && (
          <div style={S.grid}>
            <Field label="Brand"><input style={S.input} className="inp" value={f.brand} onChange={set("brand")} /></Field>
            <Field label="Pattern">
              <input style={S.input} className="inp" value={f.pattern || ""} onChange={set("pattern")} list="editPatternList" />
              <datalist id="editPatternList">
                {patternsForBrand(f.brand).map(p => <option key={p} value={p} />)}
              </datalist>
            </Field>
            <Field label="Type"><select style={S.input} className="inp" value={f.type} onChange={set("type")}><option>Normal</option><option>Off-Road</option></select></Field>
            <Field label="Width"><input style={S.input} className="inp" value={f.width} onChange={set("width")} inputMode="numeric" /></Field>
            <Field label="Aspect ratio"><input style={S.input} className="inp" value={f.aspect} onChange={set("aspect")} inputMode="numeric" /></Field>
            <Field label="Structure"><select style={S.input} className="inp" value={f.structure} onChange={set("structure")}><option>R</option><option>ZR</option></select></Field>
            <Field label="Rim size"><input style={S.input} className="inp" value={f.rim} onChange={set("rim")} inputMode="numeric" /></Field>
            <Field label="Load index"><input style={S.input} className="inp" value={f.loadIndex || ""} onChange={set("loadIndex")} /></Field>
            <Field label="Speed rating"><input style={S.input} className="inp" value={f.speedRating || ""} onChange={set("speedRating")} /></Field>
            <Field label="Country">
              <select style={S.input} className="inp" value={f.country || ""} onChange={set("country")}>
                <option value="">—</option>
                {Object.keys(COUNTRIES).map(c => <option key={c} value={c}>{COUNTRIES[c]} {c}</option>)}
              </select>
            </Field>
            <Field label="SKU / Part no."><input style={S.input} className="inp" value={f.sku || ""} onChange={set("sku")} placeholder="Supplier part number" /></Field>
            <Field label="Notes"><input style={S.input} className="inp" value={f.notes || ""} onChange={set("notes")} /></Field>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={onClose} className="ghost" style={{ ...S.copyBtn, flex: 1, justifyContent: "center" }}>Cancel</button>
          <button onClick={save} className="primary" style={{ ...S.waBtn, flex: 1, justifyContent: "center" }}><Check size={16} /> Save changes</button>
        </div>
      </div>
    </div>
  );
}

// ── HISTORY MODAL ─────────────────────────────────────────────────────────────
function HistoryModal({ tire, onClose }) {
  return (
    <div style={S.modalWrap} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.modalHead}>
          <h3 style={S.modalTitle}>Price history</h3>
          <button onClick={onClose} className="iconbtn" style={S.iconBtn}><X size={18} /></button>
        </div>
        <div style={S.tireLine}>{tireLine(tire)}</div>
        <div style={{ marginTop: 14 }}>
          {[...tire.history].reverse().map((h, i) => (
            <div key={i} style={S.histRow}>
              <Clock size={14} style={{ color: "#999", marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={S.histMain}>Cost {h.cost} KD · Price {h.price} KD <span style={S.histMargin}>({h.price ? Math.round((h.price - h.cost) / h.price * 100) : 0}% margin)</span></div>
                <div style={S.histMeta}>{h.note} · {new Date(h.ts).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────
// ═══ SERVICES CATALOG — Phase 1 of the multi-service expansion ═══════════════
// Non-tire product families, following the canonical BNCHR+ SKU registry.
// Multi-supplier costs per product (one live offer per supplier, refreshed on re-quote).
// Spec fields: {opts:[...]}=tap chips · {combo:[...]}=searchable select w/ custom · {free:"ph"}=text
const SVC_CATEGORIES = {
  battery:    { label: "Batteries",   prefixes: ["BT"],                   unit: "pc",
    specs: [
      ["ah", "Capacity (Ah)", { combo: ["35","45","50","55","60","66","70","74","80","90","95","100","105","110"] }],
      ["size_group", "Size group", { combo: ["55D23L","55D23R","80D26L","80D26R","95D31L","95D31R","105D31L","LN1","LN2","LN3","LN4","LN5","H5","H6","H7","H8"] }],
      ["tech", "Tech", { opts: ["Flooded","EFB","AGM"] }],
      ["cca", "CCA", { free: "680" }],
      ["warranty_months", "Warranty (months)", { opts: ["12","15","18","24"] }],
    ] },
  engine_oil: { label: "Engine Oil",  prefixes: ["EO"],                   unit: "litre",
    specs: [
      ["viscosity", "Viscosity", { combo: ["0W16","0W20","0W30","0W40","5W20","5W30","5W40","5W50","10W30","10W40","10W60","15W40","15W50","20W50"] }],
      ["type", "Type", { opts: ["FS","SS","Mineral"] }],
      ["line", "Line (optional)", { free: "SSL / EHC / VMO…" }],
      ["approvals", "Approvals", { free: "VW 504.00 · MB 229.51" }],
      ["interval_km", "Interval (KM)", { combo: ["5000","10000","15000"] }],
    ] },
  fluid:      { label: "Fluids",      prefixes: ["FL", "BF"],             unit: "litre",
    specs: [
      ["fluid_type", "Fluid type", { opts: ["ATF","CLT","GEAR","PS","BRK"] }],
      ["spec", "Spec", { combo: ["Dexron VI","Dexron III","ATF+4","CVT","Type F","75W-90","80W-90","75W-140","DOT 3","DOT 4","DOT 5.1","G12","G13"] }],
    ] },
  filter:     { label: "Filters",     prefixes: ["FO", "FA", "FC", "FF"], unit: "pc",
    specs: [
      ["filter_type", "Filter type", { opts: ["Oil","Air","Cabin","Fuel"] }],
      ["part_ref", "Part ref", { free: "15400-PLM-A02" }],
    ] },
  brake:      { label: "Brakes",      prefixes: ["BP", "BD", "BS"],       unit: "set",
    specs: [
      ["brake_type", "Type", { opts: ["Pads","Disc","Sensor"] }],
      ["position", "Position", { opts: ["Front","Rear"] }],
      ["part_ref", "Part ref", { free: "P85020" }],
    ] },
  spark_plug: { label: "Spark Plugs", prefixes: ["SP"],                   unit: "pc",
    specs: [
      ["part_ref", "Part ref", { free: "ILKAR7B11" }],
      ["gap", "Gap", { free: "0.8mm" }],
    ] },
  other:      { label: "Other",       prefixes: ["PT", "CC"],             unit: "pc",
    specs: [
      ["group", "Group", { free: "SUSP / FRAG / POLISH" }],
    ] },
};
// ── auto-generation: product name + SKU from brand/specs (editable overrides) ──
const SVC_PART_BRANDS = {
  battery: ["Varta","Bosch","Amaron","ACDelco","Solite","Exide","Hankook","Duracell","Optima","Banner"],
  engine_oil: ["RAVENOL","TOTAL","Mobil","MOBIL1","Castrol","Shell","Liqui Moly","Motul","Valvoline","AMSOIL","Fuchs"],
  fluid: ["RAVENOL","TOTAL","Castrol","Mobil","Liqui Moly","Prestone","ZIC","Motul"],
  filter: ["MANN","Bosch","Mahle","K&N","Denso","Fram","Wix"],
  brake: ["Brembo","Bosch","ATE","Textar","TRW","Akebono","Ferodo","Zimmermann"],
  spark_plug: ["NGK","Denso","Bosch","Champion"],
  other: [],
};
const svcIsCarBrand = (b) => {
  const x = String(b || "").trim().toLowerCase();
  return !!x && typeof SQ_BRANDS !== "undefined" && SQ_BRANDS.some(cb => cb.toLowerCase() === x);
};
function svcGenName(cat, brand, sp = {}) {
  const b = String(brand || "").trim();
  const g = svcIsCarBrand(b) ? " Genuine" : "";
  const int = sp.interval_km ? ` [${Number(sp.interval_km).toLocaleString()} KM]` : "";
  const ref = sp.part_ref ? ` [Part No. ${sp.part_ref}]` : "";
  const sq = (x) => String(x || "").trim();
  if (cat === "engine_oil") return [b + g, sq(sp.line), sq(sp.viscosity), "Engine Oil"].filter(Boolean).join(" ") + int;
  if (cat === "battery")    return [b + g, "Battery", sp.ah ? `${sp.ah}AH` : "", sq(sp.tech)].filter(Boolean).join(" ");
  if (cat === "filter")     return [b + g, sq(sp.filter_type) || "Oil", "Filter"].filter(Boolean).join(" ") + ref;
  if (cat === "brake") {
    const what = sp.brake_type === "Disc" ? "Brake Discs" : sp.brake_type === "Sensor" ? "Brake Sensor" : "Brake Pads";
    return [b + g, sq(sp.position), what].filter(Boolean).join(" ") + ref;
  }
  if (cat === "spark_plug") return [b + g, "Spark Plugs"].filter(Boolean).join(" ") + ref;
  if (cat === "fluid") {
    const t = { ATF: "ATF", CLT: "Coolant", GEAR: "Gear Oil", PS: "Power Steering Fluid", BRK: "Brake Fluid" }[sp.fluid_type] || "Fluid";
    return [b, t, sq(sp.spec)].filter(Boolean).join(" ");
  }
  return "";
}
const svcSkuCode = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function svcGenSku(cat, brand, sp = {}) {
  const B = svcSkuCode(brand).slice(0, 4);
  if (!B) return "";
  const R = svcSkuCode(sp.part_ref).slice(0, 10);
  if (cat === "engine_oil") return ["EO", B, svcSkuCode(sp.viscosity), svcSkuCode(sp.line).slice(0, 4) || null].filter(Boolean).join("-");
  if (cat === "battery")    return ["BT", B, sp.ah || null, sp.warranty_months || null].filter(Boolean).join("-");
  if (cat === "filter")     return [{ Oil: "FO", Air: "FA", Cabin: "FC", Fuel: "FF" }[sp.filter_type] || "FO", B, R || null].filter(Boolean).join("-");
  if (cat === "brake")      return [{ Pads: "BP", Disc: "BD", Sensor: "BS" }[sp.brake_type] || "BP", B, R || null].filter(Boolean).join("-");
  if (cat === "spark_plug") return ["SP", B, R || null].filter(Boolean).join("-");
  if (cat === "fluid")      return sp.fluid_type === "BRK" ? ["BF", B, svcSkuCode(sp.spec).slice(0, 6) || null].filter(Boolean).join("-") : ["FL", sp.fluid_type || "ATF", B].join("-");
  return ["PT", B].join("-");
}
const SVC_CAT_KEYS = Object.keys(SVC_CATEGORIES);
const svcCatOfSku = (sku) => SVC_CAT_KEYS.find(k => SVC_CATEGORIES[k].prefixes.some(p => String(sku || "").toUpperCase().startsWith(p + "-"))) || null;

function ServicesCatalogView({ showToast }) {
  const [products, setProducts] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [brandF, setBrandF] = useState("all");
  const [showInactive, setShowInactive] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [form, setForm] = useState(null); // null | { mode:'add'|'edit', d:{...} }
  const [offerDraft, setOfferDraft] = useState({ supplier: "", cost: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, o] = await Promise.all([
        supabase.from("service_products").select("*").order("category").order("sku"),
        supabase.from("service_product_offers").select("*").order("updated_at", { ascending: false }),
      ]);
      if (p.error) throw p.error;
      setProducts(p.data || []);
      setOffers(o.data || []);
    } catch (e) { showToast("⚠ Could not load services catalog"); }
    setLoading(false);
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const offersOf = (pid) => offers.filter(o => o.product_id === pid);
  const bestCost = (pid) => {
    const os = offersOf(pid).filter(o => Number(o.cost) > 0);
    return os.length ? Math.min(...os.map(o => Number(o.cost))) : null;
  };

  const brands = useMemo(() => [...new Set(products.map(p => p.brand).filter(Boolean))].sort(), [products]);
  const ql = q.trim().toLowerCase();
  const shown = products
    .filter(p => showInactive ? true : p.active !== false)
    .filter(p => cat === "all" ? true : p.category === cat)
    .filter(p => brandF === "all" ? true : p.brand === brandF)
    .filter(p => !ql || [p.sku, p.brand, p.name, JSON.stringify(p.specs || {})].some(v => String(v || "").toLowerCase().includes(ql)));

  const specSummary = (p) => {
    const def = SVC_CATEGORIES[p.category];
    if (!def) return "";
    return def.specs.map(([k]) => (p.specs || {})[k]).filter(Boolean).join(" · ");
  };

  // ── product form ──
  const blankFor = (c) => ({ category: c, sku: "", brand: "", name: "", specs: {}, unit: SVC_CATEGORIES[c].unit, selling_price: "", cost: "", supplier: "", notes: "", active: true, _nameEdit: false, _skuEdit: false });
  const openAdd = () => setForm({ mode: "add", d: blankFor(cat === "all" ? "battery" : cat) });
  const openEdit = (p) => setForm({ mode: "edit", d: { ...p, specs: { ...(p.specs || {}) }, selling_price: p.selling_price ?? "", cost: "", supplier: "", _nameEdit: true, _skuEdit: true } });
  // any brand/spec change regenerates name + SKU unless the agent manually edited them
  const regen = (d) => ({
    ...d,
    name: d._nameEdit ? d.name : (d.category === "other" ? d.name : svcGenName(d.category, d.brand, d.specs)),
    sku: d._skuEdit ? d.sku : svcGenSku(d.category, d.brand, d.specs),
  });
  const setD = (patch) => setForm(f => ({ ...f, d: regen({ ...f.d, ...patch }) }));
  const setSpec = (k, v) => setForm(f => ({ ...f, d: regen({ ...f.d, specs: { ...f.d.specs, [k]: v } }) }));
  const skuOk = (d) => SVC_CATEGORIES[d.category].prefixes.some(p => d.sku.toUpperCase().startsWith(p + "-")) && d.sku.trim().length > 3;
  const brandOpts = (c) => [...new Set([...(SVC_PART_BRANDS[c] || []), ...brands, ...(typeof SQ_BRANDS !== "undefined" ? SQ_BRANDS : [])])].sort();
  const supplierOpts = useMemo(() => [...new Set(offers.map(o => o.supplier).filter(Boolean))].sort(), [offers]);

  // ── bulk edit ──
  const [selected, setSelected] = useState(new Set());
  const [bulkMode, setBulkMode] = useState("set");   // set | pct_up | pct_down | kd_up | kd_down | margin
  const [bulkVal, setBulkVal] = useState("");
  const [bulkSpecKey, setBulkSpecKey] = useState("");
  const [bulkSpecVal, setBulkSpecVal] = useState("");
  const toggleSel = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selProducts = products.filter(p => selected.has(p.id));
  const selCats = [...new Set(selProducts.map(p => p.category))];
  const round3 = (x) => Math.round((Number(x) || 0) * 1000) / 1000;

  const bulkApplyRows = async (rows, label) => {
    // rows: [{id, patch}]
    setSaving(true);
    try {
      await Promise.all(rows.map(r =>
        supabase.from("service_products").update({ ...r.patch, updated_at: new Date().toISOString() }).eq("id", r.id)));
      setProducts(prev => prev.map(p => { const r = rows.find(x => x.id === p.id); return r ? { ...p, ...r.patch } : p; }));
      showToast(`${label} — ${rows.length} product${rows.length === 1 ? "" : "s"} updated`);
    } catch (e) { showToast("⚠ Bulk update failed"); }
    setSaving(false);
  };
  const bulkPrice = () => {
    const v = Number(bulkVal);
    if (!(v > 0) && bulkMode !== "set") { showToast("Enter a value first"); return; }
    let skipped = 0;
    const rows = selProducts.map(p => {
      const cur = Number(p.selling_price) || 0;
      let np = null;
      if (bulkMode === "set") np = v;
      else if (bulkMode === "pct_up") np = cur * (1 + v / 100);
      else if (bulkMode === "pct_down") np = cur * (1 - v / 100);
      else if (bulkMode === "kd_up") np = cur + v;
      else if (bulkMode === "kd_down") np = cur - v;
      else if (bulkMode === "margin") {
        const bc = bestCost(p.id);
        if (bc == null) { skipped++; return null; }
        np = bc * (1 + v / 100);
      }
      return { id: p.id, patch: { selling_price: round3(Math.max(0, np)) } };
    }).filter(Boolean);
    if (!rows.length) { showToast("No selected products have a cost to price from"); return; }
    bulkApplyRows(rows, "Prices updated" + (skipped ? ` (${skipped} skipped — no cost)` : ""));
  };
  const bulkActive = (on) => bulkApplyRows(selProducts.map(p => ({ id: p.id, patch: { active: on } })), on ? "Activated" : "Deactivated");
  const bulkSpec = () => {
    if (!bulkSpecKey) { showToast("Pick a spec field first"); return; }
    bulkApplyRows(selProducts.map(p => ({ id: p.id, patch: { specs: { ...(p.specs || {}), [bulkSpecKey]: bulkSpecVal } } })), `${bulkSpecKey} set`);
  };

  const saveProduct = async () => {
    const d = form.d;
    if (!d.brand.trim()) { showToast("Pick a brand first"); return; }
    if (!d.sku.trim() || !d.name.trim()) { showToast("SKU and name are required"); return; }
    if (!skuOk(d)) { showToast(`SKU must start with ${SVC_CATEGORIES[d.category].prefixes.map(p => p + "-").join(" or ")}`); return; }
    setSaving(true);
    const row = { category: d.category, sku: d.sku.trim().toUpperCase(), brand: d.brand.trim(), name: d.name.trim(), specs: d.specs, unit: d.unit, selling_price: d.selling_price === "" ? null : Number(d.selling_price), notes: d.notes || "", active: d.active !== false, updated_at: new Date().toISOString() };
    try {
      let saved;
      if (form.mode === "add") {
        const { data, error } = await supabase.from("service_products").insert(row).select().single();
        if (error) throw error;
        saved = data;
        setProducts(prev => [...prev, data]);
      } else {
        const { error } = await supabase.from("service_products").update(row).eq("id", d.id);
        if (error) throw error;
        saved = { ...d, ...row };
        setProducts(prev => prev.map(p => p.id === d.id ? { ...p, ...row } : p));
      }
      // supplier cost entered in the same form → becomes that supplier's live offer
      if (Number(d.cost) > 0 && d.supplier.trim()) {
        const { data: off } = await supabase.from("service_product_offers")
          .upsert({ product_id: saved.id, supplier: d.supplier.trim(), cost: Number(d.cost), updated_at: new Date().toISOString() }, { onConflict: "product_id,supplier" })
          .select().single();
        if (off) setOffers(prev => [off, ...prev.filter(o => !(o.product_id === saved.id && o.supplier === d.supplier.trim()))]);
      }
      showToast(`${form.mode === "add" ? "Added" : "Saved"} ${row.sku}`);
      setForm(null);
    } catch (e) { showToast(`⚠ ${String(e.message || e).includes("duplicate") ? "SKU already exists" : "Save failed"}`); }
    setSaving(false);
  };

  // ── offers: one live offer per supplier — re-adding refreshes cost + freshness ──
  const saveOffer = async (pid) => {
    const sup = offerDraft.supplier.trim();
    const cost = Number(offerDraft.cost);
    if (!sup || !(cost > 0)) { showToast("Supplier and cost are required"); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.from("service_product_offers")
        .upsert({ product_id: pid, supplier: sup, cost, updated_at: new Date().toISOString() }, { onConflict: "product_id,supplier" })
        .select().single();
      if (error) throw error;
      setOffers(prev => [data, ...prev.filter(o => !(o.product_id === pid && o.supplier === sup))]);
      setOfferDraft({ supplier: "", cost: "" });
      showToast(`${sup} · KWD ${cost.toFixed(3)} saved`);
    } catch (e) { showToast("⚠ Offer save failed"); }
    setSaving(false);
  };
  const deleteOffer = async (o) => {
    if (!window.confirm(`Remove ${o.supplier}'s offer?`)) return;
    try {
      const { error } = await supabase.from("service_product_offers").delete().eq("id", o.id);
      if (error) throw error;
      setOffers(prev => prev.filter(x => x.id !== o.id));
    } catch (e) { showToast("⚠ Delete failed"); }
  };

  const chip = (key, label, n) => (
    <button key={key} onClick={() => setCat(key)} className="seg"
      style={{ ...S.seg, ...(cat === key ? S.segOn : {}), fontSize: 12.5 }}>
      {label}{n != null ? ` (${n})` : ""}
    </button>
  );
  const inp = { ...S.input, padding: "9px 11px", fontSize: 13.5 };
  const th = { textAlign: "left", fontSize: 10.5, fontWeight: 800, color: "#8A8A7A", padding: "8px 10px", textTransform: "uppercase", letterSpacing: 0.4 };
  const td = { fontSize: 13, padding: "9px 10px", borderTop: "1px solid #ECECE4", verticalAlign: "top" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Services Catalog</div>
          <div style={{ fontSize: 12.5, color: "#6B6B6B" }}>Batteries, oils, fluids, filters, brakes — canonical SKUs, multi-supplier costs.</div>
        </div>
        <button onClick={openAdd} style={{ ...S.loginBtn, width: "auto", marginTop: 0, padding: "10px 16px", display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={15} /> Add product
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {chip("all", "All", products.filter(p => showInactive || p.active !== false).length)}
        {SVC_CAT_KEYS.map(k => chip(k, SVC_CATEGORIES[k].label, products.filter(p => p.category === k && (showInactive || p.active !== false)).length))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search SKU, brand, name, spec…" style={{ ...inp, flex: "1 1 220px" }} className="inp" />
        <select value={brandF} onChange={e => setBrandF(e.target.value)} style={{ ...inp, flex: "0 0 auto" }}>
          <option value="all">All brands</option>
          {brands.map(b => <option key={b}>{b}</option>)}
        </select>
        <label style={{ fontSize: 12.5, color: "#6B6B6B", display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> show inactive
        </label>
      </div>

      {/* ── add / edit form — selections everywhere, auto name + SKU ── */}
      {form && (
        <div style={{ background: "#fff", border: "1.5px solid #0F2419", borderRadius: 14, padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{form.mode === "add" ? "Add product" : `Edit ${form.d.sku}`}</div>
            <button onClick={() => setForm(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={17} /></button>
          </div>

          {/* category chips */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {SVC_CAT_KEYS.map(k => (
              <button key={k} disabled={form.mode === "edit"} onClick={() => setForm(f => ({ ...f, d: { ...blankFor(k), brand: f.d.brand, selling_price: f.d.selling_price, cost: f.d.cost, supplier: f.d.supplier } }))}
                className="seg" style={{ ...S.seg, ...(form.d.category === k ? S.segOn : {}), fontSize: 12, opacity: form.mode === "edit" && form.d.category !== k ? 0.35 : 1 }}>
                {SVC_CATEGORIES[k].label}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B6B", marginBottom: 3 }}>Brand</div>
              <SqCombo value={form.d.brand} onChange={v => setD({ brand: v })} options={brandOpts(form.d.category)} placeholder="Varta / Porsche / MANN…" />
            </div>
            {SVC_CATEGORIES[form.d.category].specs.map(([k, label, def]) => (
              <div key={k}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B6B", marginBottom: 3 }}>{label}</div>
                {def.opts ? (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {def.opts.map(o => (
                      <button key={o} onClick={() => setSpec(k, form.d.specs[k] === o ? "" : o)} className="seg"
                        style={{ ...S.seg, ...(form.d.specs[k] === o ? S.segOn : {}), fontSize: 12, padding: "7px 11px" }}>{o}</button>
                    ))}
                  </div>
                ) : def.combo ? (
                  <SqCombo value={form.d.specs[k] || ""} onChange={v => setSpec(k, v)} options={def.combo} placeholder={def.combo[0]} />
                ) : (
                  <input value={form.d.specs[k] || ""} onChange={e => setSpec(k, e.target.value)} placeholder={def.free} style={inp} className="inp" />
                )}
              </div>
            ))}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B6B", marginBottom: 3 }}>Selling price (KWD / {form.d.unit})</div>
              <input type="number" step="0.001" value={form.d.selling_price} onChange={e => setD({ selling_price: e.target.value })} style={inp} className="inp" />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B6B", marginBottom: 3 }}>Supplier cost (KWD / {form.d.unit})</div>
              <input type="number" step="0.001" value={form.d.cost} onChange={e => setD({ cost: e.target.value })} style={inp} className="inp" />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B6B", marginBottom: 3 }}>Supplier</div>
              <SqCombo value={form.d.supplier} onChange={v => setD({ supplier: v })} options={supplierOpts} placeholder="Al Babtain / GRIP Autos…" />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B6B", marginBottom: 3 }}>Unit</div>
              <div style={{ display: "flex", gap: 5 }}>
                {["pc", "litre", "set"].map(u => (
                  <button key={u} onClick={() => setD({ unit: u })} className="seg" style={{ ...S.seg, ...(form.d.unit === u ? S.segOn : {}), fontSize: 12, padding: "7px 11px" }}>{u}</button>
                ))}
              </div>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B6B", marginBottom: 3 }}>Notes</div>
              <input value={form.d.notes || ""} onChange={e => setD({ notes: e.target.value })} style={inp} className="inp" />
            </div>
          </div>

          {/* auto-generated identity — editable on tap */}
          <div style={{ background: "#F6F8F6", border: "1px dashed #D8D8D0", borderRadius: 10, padding: "9px 12px", marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: "#8A8A7A" }}>NAME (auto{svcIsCarBrand(form.d.brand) ? " · Genuine" : ""}) <span onClick={() => setD({ _nameEdit: true })} style={{ cursor: "pointer" }}>✏️</span></div>
              {form.d._nameEdit
                ? <input value={form.d.name} onChange={e => setD({ name: e.target.value, _nameEdit: true })} style={{ ...inp, marginTop: 3 }} className="inp" />
                : <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{form.d.name || <span style={{ color: "#C0392B", fontWeight: 600 }}>pick brand + specs…</span>}</div>}
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: "#8A8A7A" }}>SKU (auto · {SVC_CATEGORIES[form.d.category].prefixes.map(p => p + "-").join(" / ")}) <span onClick={() => setD({ _skuEdit: true })} style={{ cursor: "pointer" }}>✏️</span></div>
              {form.d._skuEdit
                ? <input value={form.d.sku} onChange={e => setD({ sku: e.target.value.toUpperCase(), _skuEdit: true })} style={{ ...inp, marginTop: 3, borderColor: form.d.sku && !skuOk(form.d) ? "#C0392B" : "#D8D8D0" }} className="inp" />
                : <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, fontFamily: "monospace" }}>{form.d.sku || "—"}</div>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
            <button onClick={saveProduct} disabled={saving} style={{ ...S.loginBtn, width: "auto", marginTop: 0, padding: "10px 18px" }}>{saving ? "Saving…" : form.mode === "add" ? "Add product" : "Save changes"}</button>
            {form.mode === "edit" && (
              <label style={{ fontSize: 12.5, color: "#6B6B6B", display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={form.d.active !== false} onChange={e => setD({ active: e.target.checked })} /> active
              </label>
            )}
          </div>
        </div>
      )}

      {/* ── bulk edit bar ── */}
      {selected.size > 0 && (
        <div style={{ background: "#0F2419", color: "#fff", borderRadius: 12, padding: "10px 14px", marginBottom: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 800 }}>{selected.size} selected</span>
          <select value={bulkMode} onChange={e => setBulkMode(e.target.value)} style={{ ...inp, padding: "7px 9px", fontSize: 12.5, width: "auto" }}>
            <option value="set">Price → set to (KD)</option>
            <option value="pct_up">Price → increase %</option>
            <option value="pct_down">Price → decrease %</option>
            <option value="kd_up">Price → add KD</option>
            <option value="kd_down">Price → subtract KD</option>
            <option value="margin">Price = best cost + margin %</option>
          </select>
          <input type="number" step="0.25" value={bulkVal} onChange={e => setBulkVal(e.target.value)} placeholder="value" style={{ ...inp, padding: "7px 9px", fontSize: 12.5, width: 84 }} className="inp" />
          <button onClick={bulkPrice} disabled={saving} className="seg" style={{ ...S.seg, fontSize: 12 }}>Apply</button>
          {selCats.length === 1 && (
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select value={bulkSpecKey} onChange={e => setBulkSpecKey(e.target.value)} style={{ ...inp, padding: "7px 9px", fontSize: 12.5, width: "auto" }}>
                <option value="">Set spec…</option>
                {SVC_CATEGORIES[selCats[0]].specs.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <input value={bulkSpecVal} onChange={e => setBulkSpecVal(e.target.value)} placeholder="value" style={{ ...inp, padding: "7px 9px", fontSize: 12.5, width: 100 }} className="inp" />
              <button onClick={bulkSpec} disabled={saving} className="seg" style={{ ...S.seg, fontSize: 12 }}>Apply</button>
            </span>
          )}
          <button onClick={() => bulkActive(true)} disabled={saving} className="seg" style={{ ...S.seg, fontSize: 12 }}>Activate</button>
          <button onClick={() => bulkActive(false)} disabled={saving} className="seg" style={{ ...S.seg, fontSize: 12 }}>Deactivate</button>
          <button onClick={() => setSelected(new Set())} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}>clear</button>
        </div>
      )}

      {/* ── product table ── */}
      <div style={{ background: "#fff", border: "1px solid #ECECE4", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead><tr>
              <th style={{ ...th, width: 46 }}>
                <input type="checkbox"
                  checked={shown.length > 0 && shown.every(p => selected.has(p.id))}
                  onChange={e => setSelected(e.target.checked ? new Set(shown.map(p => p.id)) : new Set())} />
              </th><th style={th}>SKU</th><th style={th}>Brand</th><th style={th}>Product</th><th style={th}>Specs</th>
              <th style={{ ...th, textAlign: "right" }}>Best cost</th><th style={{ ...th, textAlign: "right" }}>Price</th><th style={{ ...th, textAlign: "right" }}>Margin</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td style={td} colSpan={8}>Loading…</td></tr>}
              {!loading && shown.length === 0 && <tr><td style={{ ...td, color: "#8A8A7A" }} colSpan={8}>No products yet{cat !== "all" ? ` in ${SVC_CATEGORIES[cat]?.label}` : ""} — use “Add product” to start the catalog.</td></tr>}
              {shown.map(p => {
                const os = offersOf(p.id);
                const bc = bestCost(p.id);
                const price = Number(p.selling_price) || 0;
                const marginPct = price && bc != null ? Math.round(((price - bc) / price) * 100) : null;
                const open = expanded === p.id;
                return (
                  <React.Fragment key={p.id}>
                    <tr onClick={() => { setExpanded(open ? null : p.id); setOfferDraft({ supplier: "", cost: "" }); }} style={{ cursor: "pointer", opacity: p.active === false ? 0.45 : 1 }}>
                      <td style={{ ...td, width: 46, whiteSpace: "nowrap" }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSel(p.id)} style={{ marginRight: 5 }} />
                        <span onClick={() => { setExpanded(open ? null : p.id); setOfferDraft({ supplier: "", cost: "" }); }} style={{ cursor: "pointer" }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                      </td>
                      <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{p.sku}{p.active === false && <span style={{ fontSize: 10, color: "#C0392B", marginLeft: 6 }}>inactive</span>}</td>
                      <td style={td}>{p.brand}</td>
                      <td style={td}>{p.name}<div style={{ fontSize: 11, color: "#8A8A7A" }}>{SVC_CATEGORIES[p.category]?.label} · per {p.unit}</div></td>
                      <td style={{ ...td, fontSize: 12, color: "#555" }}>{specSummary(p)}</td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{bc != null ? `KWD ${bc.toFixed(3)}` : <span style={{ color: "#C0392B", fontSize: 12 }}>no cost</span>}<div style={{ fontSize: 10.5, color: "#8A8A7A" }}>{(() => { const b = os.filter(o => Number(o.cost) > 0).sort((x, y) => Number(x.cost) - Number(y.cost))[0]; return b ? `${b.supplier} · ` : ""; })()}{os.length} supplier{os.length === 1 ? "" : "s"}</div></td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{price ? `KWD ${price.toFixed(3)}` : "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, color: marginPct == null ? "#8A8A7A" : marginPct >= 30 ? "#1D7A45" : marginPct >= 15 ? "#8A6A00" : "#C0392B" }}>{marginPct == null ? "—" : `${marginPct}%`}</td>
                    </tr>
                    {open && (
                      <tr><td style={{ ...td, background: "#FAFAF7" }} colSpan={8}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: "#6B6B6B" }}>SUPPLIER OFFERS — same item, different suppliers</div>
                          <button onClick={(e) => { e.stopPropagation(); openEdit(p); }} style={{ background: "none", border: "1px solid #D8D8D0", borderRadius: 8, padding: "5px 10px", fontSize: 12, cursor: "pointer", display: "flex", gap: 5, alignItems: "center" }}><Edit3 size={12} /> Edit product</button>
                        </div>
                        {os.length === 0 && <div style={{ fontSize: 12.5, color: "#8A8A7A", marginBottom: 8 }}>No supplier costs yet.</div>}
                        {os.map(o => {
                          const ts = o.updated_at ? new Date(o.updated_at).getTime() : null;
                          const tier = freshnessTier(ts);
                          return (
                            <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #ECECE4", flexWrap: "wrap" }}>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>{o.supplier}</div>
                              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                <span style={{ fontSize: 11.5, fontWeight: 600, color: FRESH_COLOR[tier] || "#8A8A7A" }}>{freshnessLabel(ts)}</span>
                                <span style={{ fontWeight: 800, fontSize: 13.5 }}>KWD {Number(o.cost).toFixed(3)}</span>
                                {bc != null && Number(o.cost) === bc && os.length > 1 && <span style={{ fontSize: 10, fontWeight: 800, color: "#1D7A45", background: "#E8F4EC", borderRadius: 5, padding: "2px 6px" }}>BEST</span>}
                                <button onClick={(e) => { e.stopPropagation(); deleteOffer(o); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#C0392B" }}><Trash2 size={13} /></button>
                              </div>
                            </div>
                          );
                        })}
                        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }} onClick={e => e.stopPropagation()}>
                          <input value={offerDraft.supplier} onChange={e => setOfferDraft(d => ({ ...d, supplier: e.target.value }))} placeholder="Supplier" style={{ ...inp, flex: "1 1 140px" }} className="inp" />
                          <input type="number" step="0.001" value={offerDraft.cost} onChange={e => setOfferDraft(d => ({ ...d, cost: e.target.value }))} placeholder={`Cost / ${p.unit}`} style={{ ...inp, flex: "0 1 120px" }} className="inp" />
                          <button onClick={() => saveOffer(p.id)} disabled={saving} style={{ ...S.loginBtn, width: "auto", marginTop: 0, padding: "9px 14px", fontSize: 13 }}>Save cost</button>
                          <span style={{ fontSize: 11, color: "#8A8A7A" }}>re-entering a supplier refreshes their cost + freshness</span>
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══ SERVICE QUOTE — car-first, MULTI-SERVICE quoting ═════════════════════════
// 1) Car → 2) add one or more services (tier/sides per service) → 3) items → quote.
// Labor tables + Major Service template are exact ports of the Scheduling New Order
// popup (keep in sync). Battery quotes with ONLY a battery = options mode (per-option totals).

// Shared car dataset — identical to the Scheduling system (keep in sync)
const SQ_CAR_DATA = {
  "Toyota": ["Land Cruiser", "Prado", "Camry", "Corolla", "Hilux", "Fortuner", "RAV4", "Avalon", "Yaris", "FJ Cruiser", "Sequoia", "Tundra", "Highlander", "Rush", "Land Cruiser 70"],
  "Lexus": ["LX", "GX", "RX", "ES", "LS", "NX", "IS", "LC", "UX", "RC"],
  "Nissan": ["Patrol", "Altima", "Maxima", "X-Trail", "Pathfinder", "Sunny", "Sentra", "Kicks", "Armada", "Patrol Safari", "Navara", "Murano"],
  "Mercedes-Benz": ["C-Class", "E-Class", "S-Class", "G-Class", "GLE", "GLS", "GLC", "GLA", "A-Class", "CLA", "AMG GT", "Maybach"],
  "BMW": ["3 Series", "5 Series", "7 Series", "X5", "X6", "X7", "X3", "X4", "M3", "M5", "i7", "8 Series"],
  "Porsche": ["911", "Cayenne", "Macan", "Panamera", "Taycan", "718 Cayman", "718 Boxster"],
  "GMC": ["Yukon", "Sierra", "Acadia", "Terrain", "Yukon XL", "Denali"],
  "Chevrolet": ["Tahoe", "Suburban", "Silverado", "Camaro", "Malibu", "Captiva", "Impala", "Corvette", "Traverse", "Blazer"],
  "Ford": ["F-150", "Explorer", "Expedition", "Mustang", "Edge", "Escape", "Taurus", "Bronco", "Ranger"],
  "Honda": ["Accord", "Civic", "CR-V", "Pilot", "City", "HR-V", "Odyssey"],
  "Hyundai": ["Sonata", "Elantra", "Tucson", "Santa Fe", "Accent", "Palisade", "Creta", "Azera", "Genesis"],
  "Kia": ["Sportage", "Sorento", "Optima", "Cerato", "Telluride", "Carnival", "Seltos", "Cadenza", "Picanto"],
  "Mitsubishi": ["Pajero", "Montero Sport", "Lancer", "ASX", "L200", "Attrage", "Outlander"],
  "Cadillac": ["Escalade", "XT5", "XT6", "CT5", "CT6", "XT4"],
  "Land Rover": ["Range Rover", "Range Rover Sport", "Range Rover Vogue", "Defender", "Discovery", "Range Rover Velar", "Evoque"],
  "Jeep": ["Wrangler", "Grand Cherokee", "Cherokee", "Compass", "Gladiator", "Renegade"],
  "Dodge": ["Charger", "Challenger", "Durango", "Ram 1500"],
  "Audi": ["A4", "A6", "A8", "Q5", "Q7", "Q8", "Q3", "RS Q8", "e-tron"],
  "Volkswagen": ["Golf", "Passat", "Tiguan", "Touareg", "Teramont", "Jetta"],
  "Infiniti": ["QX80", "QX60", "QX50", "Q50", "QX70"],
  "Mazda": ["CX-9", "CX-5", "Mazda6", "Mazda3", "CX-30", "MX-5"],
  "Bentley": ["Bentayga", "Continental GT", "Flying Spur"],
  "Rolls-Royce": ["Cullinan", "Ghost", "Phantom", "Wraith", "Dawn"],
  "Ferrari": ["Roma", "812", "F8", "SF90", "Purosangue", "296"],
  "Lamborghini": ["Urus", "Huracan", "Aventador", "Revuelto"],
  "Maserati": ["Levante", "Ghibli", "Quattroporte", "Grecale", "MC20"],
  "Tesla": ["Model S", "Model 3", "Model X", "Model Y", "Cybertruck"],
  "Suzuki": ["Vitara", "Jimny", "Swift", "Ciaz", "Baleno", "Grand Vitara"],
  "Volvo": ["XC90", "XC60", "XC40", "S90", "S60"],
  "Peugeot": ["3008", "5008", "508", "2008"],
  "Renault": ["Koleos", "Duster", "Megane", "Talisman"],
  "Chery": ["Tiggo 8", "Tiggo 7", "Arrizo 6", "Tiggo 4"],
  "MG": ["MG5", "MG6", "HS", "RX5", "ZS", "GT"],
  "Genesis": ["GV80", "GV70", "G80", "G90", "GV60"],
  "Jetour": ["X70", "X90", "Dashing", "T2"],
  "Geely": ["Coolray", "Azkarra", "Emgrand", "Tugella", "Monjaro"],
};
const SQ_BRANDS = Object.keys(SQ_CAR_DATA).sort();
const sqModelsFor = (brand) => SQ_CAR_DATA[brand] || [];
const SQ_SUB_MODELS = {
  "Honda|Accord": ["LX", "Sport", "EX", "EX-L", "Touring"],
  "Honda|Civic": ["LX", "Sport", "EX", "RS", "Type R"],
  "Honda|CR-V": ["LX", "EX", "EX-L", "Touring"],
  "Honda|Pilot": ["EX", "EX-L", "Touring", "Elite"],
  "Honda|City": ["DX", "LX", "EX"],
  "Honda|HR-V": ["LX", "EX", "EX-L"],
  "Toyota|Corolla": ["XLI", "GLI", "SE", "XSE"],
  "Toyota|Hilux": ["GL", "GLX", "SR5", "Adventure", "GR Sport"],
  "Toyota|Fortuner": ["EXR", "GXR", "VXR", "Legender"],
  "Nissan|Altima": ["S", "SV", "SR", "SL"],
  "Hyundai|Sonata": ["GL", "GLS", "Limited", "N Line"],
  "Hyundai|Tucson": ["GL", "GLS", "Limited", "N Line"],
  "Kia|Sportage": ["LX", "EX", "GT-Line", "X-Line"],
  "Lexus|LX": ["LX570", "LX600", "F Sport", "VIP"],
  "Lexus|GX": ["GX460", "GX550", "Premium", "Luxury"],
  "Lexus|RX": ["RX350", "RX450h", "F Sport"],
  "Lexus|ES": ["ES250", "ES300h", "ES350", "F Sport"],
  "Mitsubishi|Pajero": ["GLS", "GLS Signature", "Platinum"],
  "Infiniti|QX80": ["Luxe", "Premium Select", "Sensory", "Autograph"],
  "Porsche|911": ["Carrera","Carrera S","Carrera 4","Carrera 4S","Carrera GTS","Carrera 4 GTS","Targa 4","Targa 4S","Turbo","Turbo S","GT3","GT3 RS","GT3 Touring","Dakar","S/T"],
  "Porsche|Cayenne": ["Base","S","E-Hybrid","GTS","Turbo","Turbo GT","Coupe","S Coupe","GTS Coupe","Turbo Coupe"],
  "Porsche|Macan": ["Base","T","S","GTS","Turbo","4 Electric","Turbo Electric"],
  "Porsche|Panamera": ["Base","4","4S","4 E-Hybrid","GTS","Turbo E-Hybrid","Turbo S"],
  "Porsche|Taycan": ["Base","4S","GTS","Turbo","Turbo S","Cross Turismo"],
  "Porsche|718 Cayman": ["Base","S","GTS 4.0","GT4","GT4 RS"],
  "Porsche|718 Boxster": ["Base","S","GTS 4.0","Spyder","Spyder RS"],
  "Mercedes-Benz|C-Class": ["C200","C300","C43 AMG","C63 AMG"],
  "Mercedes-Benz|E-Class": ["E200","E300","E350","E450","E53 AMG","E63 S AMG"],
  "Mercedes-Benz|S-Class": ["S450","S500","S580","S63 AMG","Maybach S580","Maybach S680"],
  "Mercedes-Benz|G-Class": ["G500","G550","G63 AMG","G580 EQ"],
  "Mercedes-Benz|GLE": ["GLE350","GLE450","GLE53 AMG","GLE63 S AMG","Coupe"],
  "Mercedes-Benz|GLS": ["GLS450","GLS580","GLS63 AMG","Maybach GLS600"],
  "Mercedes-Benz|GLC": ["GLC200","GLC300","GLC43 AMG","GLC63 AMG","Coupe"],
  "BMW|3 Series": ["320i","330i","M340i"],
  "BMW|5 Series": ["520i","530i","540i","M550i"],
  "BMW|7 Series": ["730Li","735i","740Li","750Li","760Li","i7"],
  "BMW|X5": ["xDrive40i","xDrive50i","M60i","X5 M"],
  "BMW|X6": ["xDrive40i","M50i","M60i","X6 M"],
  "BMW|X7": ["xDrive40i","M60i","Alpina XB7"],
  "BMW|M3": ["Base","Competition","CS"],
  "BMW|M5": ["Base","Competition","CS"],
  "Land Rover|Range Rover": ["SE","HSE","Autobiography","SV","LWB"],
  "Land Rover|Range Rover Sport": ["SE","Dynamic SE","Autobiography","SV","SVR"],
  "Land Rover|Defender": ["90","110","130","X","V8","Octa"],
  "Toyota|Land Cruiser": ["GX","GXR","VXR","VX","GR Sport","ZX"],
  "Toyota|Prado": ["TXL","VXL","VXR","Adventure","GR Sport"],
  "Toyota|Camry": ["LE","SE","XLE","XSE","Grande","GLE"],
  "Nissan|Patrol": ["XE","SE","LE","Titanium","Platinum","Nismo"],
  "Chevrolet|Tahoe": ["LS","LT","RST","Z71","Premier","High Country"],
  "Chevrolet|Corvette": ["Stingray","Z06","E-Ray","ZR1"],
  "GMC|Yukon": ["SLE","SLT","AT4","Denali","Denali Ultimate"],
  "Cadillac|Escalade": ["Luxury","Premium Luxury","Sport","Sport Platinum","V"],
  "Ford|Mustang": ["EcoBoost","GT","Dark Horse","Shelby GT500"],
  "Ford|F-150": ["XL","XLT","Lariat","Platinum","Raptor","Raptor R"],
  "Jeep|Wrangler": ["Sport","Sahara","Rubicon","Rubicon 392"],
  "Jeep|Grand Cherokee": ["Laredo","Limited","Overland","Summit","SRT","Trackhawk"],
  "Dodge|Charger": ["GT","R/T","Scat Pack","Hellcat","Hellcat Redeye"],
  "Dodge|Challenger": ["GT","R/T","Scat Pack","Hellcat","Hellcat Redeye","Demon"],
  "Ferrari|296": ["GTB","GTS"],
  "Ferrari|812": ["Superfast","GTS","Competizione"],
  "Lamborghini|Urus": ["Base","S","Performante","SE"],
  "Lamborghini|Huracan": ["EVO","Tecnica","STO","Sterrato"],
  "Bentley|Bentayga": ["V8","S","Azure","Speed","EWB"],
  "Bentley|Continental GT": ["V8","S","Azure","Speed"],
  "Audi|Q8": ["55 TFSI","SQ8","RS Q8"],
  "Audi|A6": ["45 TFSI","55 TFSI","S6","RS6"],
  "Audi|A8": ["55 TFSI","60 TFSI","S8"],
  "Tesla|Model S": ["Long Range","Plaid"],
  "Tesla|Model X": ["Long Range","Plaid"],
  "Tesla|Model 3": ["RWD","Long Range","Performance"],
  "Tesla|Model Y": ["RWD","Long Range","Performance"],
};
const sqSubModelsFor = (brand, model) => SQ_SUB_MODELS[`${brand}|${model}`] || [];
const SQ_YEARS = (() => { const y = []; const now = new Date().getFullYear() + 1; for (let v = now; v >= 1990; v--) y.push(String(v)); return y; })();

// Searchable dropdown with custom entry — same behavior as Scheduling's ComboBox
function SqCombo({ value, onChange, options, placeholder, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = React.useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const typed = q !== "" ? q : (value || "");
  const filtered = (options || []).filter(o => o.toLowerCase().includes((q || "").toLowerCase())).slice(0, 60);
  const exact = (options || []).some(o => o.toLowerCase() === (typed || "").toLowerCase());
  const pick = (o) => { onChange(o); setQ(""); setOpen(false); };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        style={{ ...S.input, padding: "9px 11px", fontSize: 13.5, width: "100%", boxSizing: "border-box" }}
        className="inp" placeholder={placeholder} disabled={disabled}
        value={open ? q : (value || "")}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setQ(value || ""); setOpen(true); }}
      />
      {open && !disabled && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 40, background: "#fff", border: "1px solid #D8D8D0", borderRadius: 10, marginTop: 4, maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
          {filtered.length === 0 && <div style={{ padding: "8px 11px", fontSize: 12, color: "#8A8A7A" }}>No matches — your text will be saved as-is.</div>}
          {filtered.map(o => (
            <div key={o} onClick={() => pick(o)} style={{ padding: "8px 11px", fontSize: 13.5, cursor: "pointer", borderBottom: "1px solid #F0F0EC" }}>{o}</div>
          ))}
          {typed && !exact && (
            <div onClick={() => pick(typed)} style={{ padding: "8px 11px", fontSize: 12.5, cursor: "pointer", color: "#0F2419", fontWeight: 700 }}>+ Use "{typed}" (custom)</div>
          )}
        </div>
      )}
    </div>
  );
}
const SQ_SERVICES = {
  "Oil & Filter":  { variants: { tier: ["Normal", "Premium"] }, labor: { Normal: 10, Premium: 15 },
    pickers: [{ tpl: "EO", label: "Engine Oil" }, { tpl: "oil_filter", label: "Oil Filter" }],
    includes: "Engine oil + oil filter · Multi-point inspection · Home service" },
  "Battery":       { variants: { tier: ["Normal", "Complex"] }, labor: { Normal: 10, Complex: 15 },
    pickers: [{ tpl: "BT", label: "Battery" }],
    includes: "Battery with installation · Home service · Computer reset if needed" },
  "Brake Pads":    { variants: { tier: ["Normal", "Premium"], sides: ["Front", "Rear", "Front & Rear"] },
    labor: { "Normal|Front": 15, "Normal|Rear": 15, "Normal|Front & Rear": 25, "Premium|Front": 20, "Premium|Rear": 20, "Premium|Front & Rear": 35 },
    pickers: [{ tpl: "brake", label: "Brake Pads" }],
    includes: "Brake Pads with installation · Brake test · Home service" },
  "Brake Disc":    { variants: { tier: ["Normal", "Premium"], sides: ["Front", "Rear", "Front & Rear"] },
    labor: { "Normal|Front": 15, "Normal|Rear": 15, "Normal|Front & Rear": 25, "Premium|Front": 20, "Premium|Rear": 20, "Premium|Front & Rear": 35 },
    pickers: [{ tpl: "brake", label: "Brake Disc" }],
    includes: "Brake Discs with installation · Brake test · Home service" },
  "Major Service": { variants: { tier: ["Economy", "Normal", "Premium", "Top"] },
    labor: { Economy: 40, Normal: 50, Premium: 60, Top: 80 },
    pickers: [{ tpl: "EO", label: "Engine Oil" }, { tpl: "oil_filter", label: "Oil Filter" }, { tpl: "filter", label: "Filters" }],
    // exact New Order template rows (agent deletes what the car doesn't need)
    template: [
      { _tpl: "oil_filter" }, { _tpl: "spark_plugs" }, { name: "Spark Plug Wires" },
      { _tpl: "air_filter" }, { _tpl: "ac_filter" }, { name: "Injector Cleaner" }, { name: "Carburetor Tune-Up Conditioner" },
    ],
    includes: "Full tune up · Engine oil + filters · Multi-point inspection · Home service" },
  "Disc Skimming": { variants: { sides: ["One side", "Two sides"] }, labor: { "One side": 10, "Two sides": 20 },
    pickers: [],
    includes: "On-car disc skimming · Brake test · Home service" },
  "AC Gas Refill": { variants: {}, flatLabor: 20, pickers: [],
    includes: "AC gas refill · Leak check · Home service" },
  "Part Replacement": { variants: {}, labor: null, pickers: [],
    includes: "Supply & installation · Home service" },
};
const sqLabor = (svcName, variant) => {
  const s = SQ_SERVICES[svcName];
  if (!s) return 0;
  if (s.flatLabor != null) return s.flatLabor;
  if (s.labor) {
    const key = Object.keys(s.variants || {}).map(a => variant[a]).filter(Boolean).join("|");
    return s.labor[key] != null ? s.labor[key] : 0;
  }
  return 0;
};
const SQ_TPL_CAT = { EO: "engine_oil", BT: "battery", oil_filter: "filter", filter: "filter", brake: "brake" };
const sqLast8 = (m) => String(m || "").replace(/\D/g, "").slice(-8);
const sqEOSpecLine = (specs = {}) => [specs.line, specs.viscosity, specs.type, specs.interval_km ? `${Number(specs.interval_km).toLocaleString()} KM` : ""].filter(Boolean).join(", ");
// brand-aware genuine names for template + auto lines
const sqTplName = (tpl, brand, pos) => {
  const b = (brand || "").trim();
  const P = b ? b + " " : "";
  if (tpl === "oil_filter")  return `${P}Genuine Oil Filter`;
  if (tpl === "spark_plugs") return `${P}Genuine Spark Plugs`;
  if (tpl === "air_filter")  return `${P}Genuine Air Filter`;
  if (tpl === "ac_filter")   return `${P}Genuine AC Filter`;
  if (tpl === "pads")        return `${P}Genuine ${pos} Brake Pads`;
  if (tpl === "sensor")      return `${P}Genuine ${pos} Brake Sensor`;
  if (tpl === "disc")        return `${P}Genuine ${pos} Brake Discs`;
  return "";
};
const sqBrakeAutoLines = (svcName, side, brand) => {
  const kinds = svcName === "Brake Pads" ? ["pads", "sensor"] : svcName === "Brake Disc" ? ["disc"] : [];
  if (!kinds.length) return [];
  const poss = side === "Front & Rear" ? ["Front", "Rear"] : (side === "Front" || side === "Rear") ? [side] : [];
  const out = [];
  poss.forEach(pos => kinds.forEach(kind => out.push({
    name: sqTplName(kind, brand, pos), category: "brake", unit: kind === "sensor" ? "pc" : "set",
    qty: 1, unit_price: 0, _auto: `${pos.toLowerCase()}-${kind}`,
  })));
  return out;
};
const sqInitialLines = (type, variant, brand) => {
  if (type === "Brake Pads" || type === "Brake Disc") return sqBrakeAutoLines(type, variant.sides, brand);
  const d = SQ_SERVICES[type];
  if (d && d.template) return d.template.map(t => ({
    name: t._tpl ? sqTplName(t._tpl, brand) : t.name,
    category: "other", unit: "pc", qty: 1, unit_price: 0, _tpl: t._tpl || null,
  }));
  return [];
};
const sqRenameLines = (lines, brand) => lines.map(l => {
  if (l._auto) { const [pos, kind] = l._auto.split("-"); return { ...l, name: sqTplName(kind, brand, pos === "front" ? "Front" : "Rear") }; }
  if (l._tpl) return { ...l, name: sqTplName(l._tpl, brand) };
  return l;
});
const sqNewSvc = (type, brand) => {
  const d = SQ_SERVICES[type];
  const v = {};
  Object.entries(d.variants || {}).forEach(([axis, opts]) => { v[axis] = opts[0]; });
  return { id: `qs${Date.now()}${Math.floor(Math.random() * 999)}`, type, variant: v, labor: sqLabor(type, v), laborTouched: false, lines: sqInitialLines(type, v, brand) };
};
const sqMergeIncludes = (cur, add) => {
  const parts = String(cur || "").split("·").map(x => x.trim()).filter(Boolean);
  String(add || "").split("·").map(x => x.trim()).filter(Boolean).forEach(p => { if (!parts.includes(p)) parts.push(p); });
  return parts.join(" · ");
};

function ServiceQuoteView({ showToast }) {
  const [products, setProducts] = useState([]);
  const [car, setCar] = useState({ brand: "", model: "", sub_model: "", year: "", vin: "" });
  const [svcs, setSvcs] = useState([]); // sections open only when a service is tapped
  const [discount, setDiscount] = useState("");
  const [includes, setIncludes] = useState("");
  const [detailed, setDetailed] = useState(true); // Breakdown is the default view
  const previewRef = React.useRef(null);
  const [pick, setPick] = useState(null); // { svcId, tpl }
  const [pq, setPq] = useState("");
  const [mobile, setMobile] = useState("");
  const [agent, setAgent] = useState(() => { try { return localStorage.getItem("bnchr_agent") || ""; } catch { return ""; } });
  const pickAgent = (a) => { setAgent(a); try { localStorage.setItem("bnchr_agent", a); } catch {} };

  // ── live customer lookup by mobile (shared customers DB, read-only) ──
  const [matchedCustomer, setMatchedCustomer] = useState(null);
  const [customerCars, setCustomerCars] = useState([]);
  const [selectedCarId, setSelectedCarId] = useState(null);
  useEffect(() => {
    const m8 = sqLast8(mobile);
    if (m8.length < 8) { setMatchedCustomer(null); setCustomerCars([]); setSelectedCarId(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const { data } = await supabase.from("customers").select("id,name,mobile").like("mobile", "%" + m8).limit(5);
        const cust = (data || []).find(c => sqLast8(c.mobile) === m8) || null;
        if (!alive) return;
        setMatchedCustomer(cust);
        if (cust) {
          const { data: cars } = await supabase.from("customer_cars").select("id,brand,model,sub_model,year,plate").eq("customer_id", cust.id).order("created_at", { ascending: false });
          if (alive) setCustomerCars(cars || []);
        } else { setCustomerCars([]); setSelectedCarId(null); }
      } catch (e) { if (alive) { setMatchedCustomer(null); setCustomerCars([]); } }
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [mobile]);

  const renameAll = (brand) => setSvcs(prev => prev.map(sv => ({ ...sv, lines: sqRenameLines(sv.lines, brand) })));
  const pickCustomerCar = (c) => {
    setSelectedCarId(c.id);
    setCar({ brand: c.brand || "", model: c.model || "", sub_model: c.sub_model || "", year: String(c.year || ""), vin: c.plate || "" });
    renameAll((c.brand || "").trim());
  };
  const setCarField = (patch) => {
    setSelectedCarId(null);
    const cascaded = { ...patch };
    if (patch.brand !== undefined) { cascaded.model = ""; cascaded.sub_model = ""; }
    else if (patch.model !== undefined) { cascaded.sub_model = ""; }
    setCar(c => ({ ...c, ...cascaded }));
    if (patch.brand !== undefined) renameAll((patch.brand || "").trim());
  };

  const [carCatalog, setCarCatalog] = useState([]);
  const [fitments, setFitments] = useState([]);
  useEffect(() => {
    supabase.from("service_products").select("*").eq("active", true).order("sku")
      .then(({ data, error }) => { if (!error) setProducts(data || []); else showToast("⚠ Could not load catalog"); });
    supabase.from("car_catalog").select("*").then(({ data }) => setCarCatalog(data || []));
    supabase.from("engine_fitments").select("*").then(({ data }) => setFitments(data || []));
    supabase.from("quotes").select("id,created_at,agent,customer_mobile,service_type,services,lines,labor,discount,car,quote_text")
      .eq("kind", "service").order("created_at", { ascending: false }).limit(300)
      .then(({ data }) => setQuoteHistory(data || []));
  }, [showToast]);

  // ── quote history: progressive filter by the selected car ──
  const [quoteHistory, setQuoteHistory] = useState([]);
  const [histOpen, setHistOpen] = useState(false);
  const [histExpanded, setHistExpanded] = useState(null);
  const norm = (x) => String(x || "").trim().toLowerCase();
  const similarQuotes = useMemo(() => {
    if (!norm(car.brand)) return [];
    const m8 = sqLast8(mobile);
    const matches = quoteHistory.filter(q => {
      const qc = q.car || {};
      if (norm(qc.brand) !== norm(car.brand)) return false;
      if (norm(car.model) && norm(qc.model) !== norm(car.model)) return false;
      if (norm(car.sub_model) && norm(qc.sub_model) !== norm(car.sub_model)) return false;
      return true;
    });
    // the customer's own quotes pin to the top
    return matches.sort((a, b) => {
      const am = m8 && sqLast8(a.customer_mobile) === m8 ? 1 : 0;
      const bm = m8 && sqLast8(b.customer_mobile) === m8 ? 1 : 0;
      if (am !== bm) return bm - am;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    }).slice(0, 20);
  }, [quoteHistory, car.brand, car.model, car.sub_model, mobile]);
  const histValue = (q) => {
    if (Array.isArray(q.services) && q.services.length) {
      const batteryOnly = q.services.length === 1 && q.services[0].type === "Battery" && (q.services[0].lines || []).length > 1;
      if (batteryOnly) return null; // show "options" instead of a single number
      return q.services.reduce((sum, b) => sum + (b.lines || []).reduce((x, l) => x + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0) + (Number(b.labor) || 0), 0) - (Number(q.discount) || 0);
    }
    return (q.lines || []).reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0) + (Number(q.labor) || 0) - (Number(q.discount) || 0);
  };
  const histTypes = (q) => Array.isArray(q.services) && q.services.length
    ? [...new Set(q.services.map(b => b.type))].join(" + ")
    : (q.service_type || "Service");
  const useAsTemplate = (q) => {
    const blocks = (Array.isArray(q.services) && q.services.length)
      ? q.services
      : [{ type: q.service_type, variant: q.variant || {}, labor: q.labor, lines: q.lines || [] }];
    const fresh = blocks.map(b => {
      const type = SQ_SERVICES[b.type] ? b.type : "Part Replacement";
      const sv = sqNewSvc(type, car.brand);
      sv.variant = { ...sv.variant, ...(b.variant || {}) };
      sv.labor = Number(b.labor) || sv.labor;
      sv.laborTouched = true; // template's labor wins over the auto table
      sv.lines = (b.lines || []).map(l => ({ ...l })); // fresh copies, fully editable
      return sv;
    });
    setSvcs(fresh);
    if (Number(q.discount) > 0) setDiscount(String(q.discount));
    setHistOpen(false); setHistExpanded(null);
    showToast("Template loaded — adjust and copy 📋");
  };

  // ── DB-backed car options: curated lists ∪ live catalog (mined + agent entries) ──
  const brandOptions = useMemo(() => [...new Set([...SQ_BRANDS, ...carCatalog.map(r => r.brand)])].sort(), [carCatalog]);
  const modelOptions = (brand) => [...new Set([...sqModelsFor(brand), ...carCatalog.filter(r => r.brand === brand && r.model).map(r => r.model)])].sort();
  const subModelOptions = (brand, model) => [...new Set([...sqSubModelsFor(brand, model), ...carCatalog.filter(r => r.brand === brand && r.model === model && r.sub_model).map(r => r.sub_model)])];

  // ── fitment resolution: car → engine → what it takes ──
  const resolveEngine = (c) => {
    const exact = carCatalog.find(r => r.brand === c.brand && r.model === c.model && r.sub_model === (c.sub_model || "") && r.engine);
    if (exact) return exact.engine;
    const modelLevel = carCatalog.find(r => r.brand === c.brand && r.model === c.model && r.sub_model === "" && r.engine);
    return modelLevel ? modelLevel.engine : null;
  };
  const resolveOilFitment = (c) => {
    const eng = resolveEngine(c);
    if (!eng) return null;
    const f = fitments.find(x => x.brand === c.brand && x.engine_key === eng && x.service_type === "Oil & Filter");
    return f ? { ...f, _engine: eng } : null;
  };

  // ── service blocks ──
  const addService = (type) => {
    const sv = sqNewSvc(type, car.brand);
    if (type === "Oil & Filter") {
      const fit = resolveOilFitment(car);
      if (fit) {
        const lines = [];
        const litres = Math.max(1, Math.round(Number(fit.oil_litres) || 4));
        const eoProd = fit.oil_product_sku ? products.find(p => p.sku === fit.oil_product_sku) : null;
        if (eoProd) lines.push({ product_id: eoProd.id, sku: eoProd.sku, category: "engine_oil", name: eoProd.name, specs: eoProd.specs || {}, unit: "litre", qty: litres, unit_price: Number(eoProd.selling_price) || 0 });
        else if (fit.oil_viscosity) lines.push({ name: `${fit.oil_viscosity} Engine Oil`, category: "engine_oil", specs: { viscosity: fit.oil_viscosity }, unit: "litre", qty: litres, unit_price: 0 });
        const fProd = fit.oil_filter_sku ? products.find(p => p.sku === fit.oil_filter_sku) : null;
        if (fProd) lines.push({ product_id: fProd.id, sku: fProd.sku, category: "filter", name: fProd.name, specs: fProd.specs || {}, unit: "pc", qty: 1, unit_price: Number(fProd.selling_price) || 0 });
        else lines.push({ name: `${car.brand ? car.brand + " " : ""}Genuine Oil Filter${fit.oil_filter_part_no ? ` [Part No. ${fit.oil_filter_part_no}]` : ""}`, category: "filter", unit: "pc", qty: 1, unit_price: 0, _tpl: null });
        sv.lines = lines;
        sv._fit = { engine: fit._engine, verified: fit.verified };
      }
    }
    setSvcs(prev => [...prev, sv]);
  };
  // register unknown car combos so the catalog completes itself (unverified, reviewable)
  const registerCarCombo = () => {
    const b = (car.brand || "").trim(), m = (car.model || "").trim(), t = (car.sub_model || "").trim();
    if (!b || !m) return;
    const known = carCatalog.some(r => r.brand === b && r.model === m && r.sub_model === t);
    if (known) return;
    supabase.from("car_catalog").insert({ brand: b, model: m, sub_model: t, source: "agent", verified: false })
      .then(({ data }) => {}).catch(() => {});
    setCarCatalog(prev => [...prev, { brand: b, model: m, sub_model: t, engine: "", source: "agent", verified: false }]);
  };
  // save a manually-built oil quote as a fitment for this car's engine
  const [fitKeyDraft, setFitKeyDraft] = useState("");
  const saveFitmentFromBlock = async (sv) => {
    const eng = fitKeyDraft.trim() || (car.sub_model || "").trim();
    if (!car.brand || !eng) { showToast("Enter an engine key first (e.g. 1.5T)"); return; }
    const eo = sv.lines.find(l => l.category === "engine_oil");
    const fl = sv.lines.find(l => l.category === "filter");
    const partNo = fl ? ((fl.name.match(/\[Part No\.\s*([^\]]+)\]/) || [])[1] || "") : "";
    const row = {
      brand: car.brand.trim(), engine_key: eng, service_type: "Oil & Filter",
      oil_viscosity: eo && eo.specs ? (eo.specs.viscosity || null) : null,
      oil_litres: eo ? Number(eo.qty) || null : null,
      oil_product_sku: eo && eo.sku ? eo.sku : null,
      oil_filter_sku: fl && fl.sku ? fl.sku : null,
      oil_filter_part_no: partNo || null,
      notes: `Saved from quote — ${[car.brand, car.model, car.sub_model].filter(Boolean).join(" ")}`,
      verified: false, updated_at: new Date().toISOString(),
    };
    try {
      const { data, error } = await supabase.from("engine_fitments")
        .upsert(row, { onConflict: "brand,engine_key,service_type" }).select().single();
      if (error) throw error;
      setFitments(prev => [data, ...prev.filter(f => !(f.brand === row.brand && f.engine_key === eng && f.service_type === row.service_type))]);
      // link the car in the catalog to this engine
      supabase.from("car_catalog").update({ engine: eng })
        .eq("brand", car.brand.trim()).eq("model", (car.model || "").trim()).eq("sub_model", (car.sub_model || "").trim())
        .then(() => {});
      setCarCatalog(prev => prev.map(r => (r.brand === car.brand.trim() && r.model === (car.model || "").trim() && r.sub_model === (car.sub_model || "").trim()) ? { ...r, engine: eng } : r));
      setFitKeyDraft("");
      showToast(`Fitment saved — next ${car.brand} ${eng} quote auto-fills ⚡`);
    } catch (e) { showToast("⚠ Fitment save failed"); }
  };
  // Includes sentence follows the selected services: adding appends its points,
  // removing a service drops them. (Manual edits hold until the service set changes.)
  const typesKey = svcs.map(sv => sv.type).join("|");
  useEffect(() => {
    setIncludes(svcs.reduce((acc, sv) => sqMergeIncludes(acc, SQ_SERVICES[sv.type].includes), ""));
  }, [typesKey]);
  const rmService = (id) => setSvcs(prev => prev.filter(x => x.id !== id));
  const updSvc = (id, patch) => setSvcs(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
  const pickVariant = (sv, axis, val) => {
    const v = { ...sv.variant, [axis]: val };
    const patch = { variant: v };
    if (!sv.laborTouched) patch.labor = sqLabor(sv.type, v);
    if ((sv.type === "Brake Pads" || sv.type === "Brake Disc") && axis === "sides") {
      patch.lines = [...sqBrakeAutoLines(sv.type, val, car.brand), ...sv.lines.filter(l => !l._auto)];
    }
    updSvc(sv.id, patch);
  };
  const addLineTo = (svId, line) => setSvcs(prev => prev.map(x => x.id === svId ? { ...x, lines: [...x.lines, line] } : x));
  const updLine = (svId, i, patch) => setSvcs(prev => prev.map(x => x.id === svId ? { ...x, lines: x.lines.map((l, li) => li === i ? { ...l, ...patch } : l) } : x));
  const rmLine = (svId, i) => setSvcs(prev => prev.map(x => x.id === svId ? { ...x, lines: x.lines.filter((_, li) => li !== i) } : x));

  const ql = pq.trim().toLowerCase();
  const pickerCat = pick ? SQ_TPL_CAT[pick.tpl] : null;
  const pickerResults = pick ? products
    .filter(p => p.category === pickerCat)
    .filter(p => !ql || [p.sku, p.brand, p.name, JSON.stringify(p.specs || {})].some(v => String(v || "").toLowerCase().includes(ql)))
    .slice(0, 25) : [];
  const addFromCatalog = (p) => {
    addLineTo(pick.svcId, { product_id: p.id, sku: p.sku, category: p.category, name: p.name, specs: p.specs || {}, unit: p.unit || "pc", qty: p.unit === "litre" ? 4 : 1, unit_price: Number(p.selling_price) || 0 });
    setPick(null); setPq("");
  };
  const addGenuineFromPicker = () => {
    const nm = pick.tpl === "oil_filter" ? sqTplName("oil_filter", car.brand)
      : pick.tpl === "filter" ? sqTplName("air_filter", car.brand)
      : pick.tpl === "brake" ? (car.brand.trim() ? `${car.brand.trim()} Genuine ${svcs.find(x => x.id === pick.svcId)?.type || "Brake Pads"}` : (svcs.find(x => x.id === pick.svcId)?.type || "Brake Pads"))
      : "";
    if (nm) addLineTo(pick.svcId, { name: nm, category: SQ_TPL_CAT[pick.tpl] || "other", unit: "pc", qty: 1, unit_price: 0 });
    setPick(null); setPq("");
  };

  // ── money ──
  const kd = (n) => (Number(n) || 0).toFixed(3).replace(/\.?0+$/, "");
  const svcLinesKD = (sv) => sv.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
  const svcTotal = (sv) => svcLinesKD(sv) + (Number(sv.labor) || 0);
  const totalKD = svcs.reduce((s, sv) => s + svcTotal(sv), 0) - (Number(discount) || 0);
  const optionsMode = svcs.length === 1 && svcs[0].type === "Battery"; // battery-only quote = alternatives
  const optSv = svcs[0] || { lines: [], labor: 0 };
  const optionTotal = (l) => (Number(l.qty) || 1) * (Number(l.unit_price) || 0) + (Number(optSv.labor) || 0) - (Number(discount) || 0);
  const warrantyOf = (l) => l.specs && l.specs.warranty_months ? `${l.specs.warranty_months} Months Warranty` : "";
  const carLabel = [car.brand, car.model, car.sub_model, car.year].filter(Boolean).join(" \u200E"); // \u200E stops WhatsApp linking "911 2021" as a phone number
  const titleTypes = [...new Set(svcs.map(sv => sv.type))].join(" + ") || "Service";

  // ── quote texts ──
  const DIV = "━━━━━━━━━━━━━━";
  const compactText = useMemo(() => {
    const rows = [];
    rows.push("```BNCHR+ " + titleTypes + " Quote```");
    rows.push("");
    if (carLabel) rows.push("> " + carLabel);
    rows.push(DIV);
    if (optionsMode) {
      rows.push("");
      optSv.lines.forEach((l, i) => {
        const w = warrantyOf(l);
        rows.push(`${Number(l.qty) || 1}x ${l.name}${w ? ` [${w}]` : ""}`);
        rows.push(`*Total ${kd(optionTotal(l))} KD*`);
        if (i < optSv.lines.length - 1) rows.push("");
      });
      rows.push("");
      rows.push(DIV);
    } else {
      rows.push("");
      svcs.forEach((sv, si) => {
        if (svcs.length > 1) rows.push("> " + sv.type);
        sv.lines.forEach(l => {
          const nm = l.category === "engine_oil" ? l.name.replace(" Engine Oil", "") : l.name;
          rows.push(`${Number(l.qty) || 1}x ${nm}`);
        });
        if (si < svcs.length - 1) rows.push("");
      });
      rows.push("");
      rows.push(`*Total ${kd(totalKD)} KD*`);
      rows.push("");
      rows.push(DIV);
    }
    if (includes.trim()) rows.push("> ✅ Includes: " + includes.trim());
    return rows.join("\n");
  }, [titleTypes, carLabel, svcs, includes, totalKD, discount, optionsMode]);

  const detailedText = useMemo(() => {
    const rows = [];
    rows.push("```BNCHR+ " + titleTypes + " Quote```");
    rows.push("");
    if (carLabel) rows.push("> " + carLabel);
    rows.push(DIV);
    if (optionsMode) {
      optSv.lines.forEach((l) => {
        const q = Number(l.qty) || 1;
        const amt = q * (Number(l.unit_price) || 0);
        const w = warrantyOf(l);
        rows.push(`${q}× ${l.name}`);
        if (w) rows.push(`> [${w}]`);
        rows.push(`> ${kd(amt)} KD${q > 1 ? ` (${kd(l.unit_price)} KD each)` : ""}`);
        if (Number(optSv.labor) > 0) { rows.push("Labor & Home Service", `> ${kd(optSv.labor)} KD`); }
        if (Number(discount) > 0) { rows.push("Discount", `> -${kd(discount)} KD`); }
        rows.push("");
        rows.push(`*Total ${kd(optionTotal(l))} KD*`);
        rows.push(DIV);
      });
    } else {
      rows.push("");
      svcs.forEach((sv, si) => {
        if (svcs.length > 1) rows.push("> " + sv.type);
        sv.lines.forEach(l => {
          const q = Number(l.qty) || 1;
          const amt = q * (Number(l.unit_price) || 0);
          rows.push(`${q}× ${l.name}`);
          rows.push(`> ${kd(amt)} KD${q > 1 ? ` (${kd(l.unit_price)} KD each)` : ""}`);
        });
        if (Number(sv.labor) > 0) { rows.push("Labor & Home Service", `> ${kd(sv.labor)} KD`); }
        if (si < svcs.length - 1) rows.push("");
      });
      if (Number(discount) > 0) { rows.push("Discount", `> -${kd(discount)} KD`); }
      rows.push("");
      rows.push(`*Total ${kd(totalKD)} KD*`);
      rows.push("");
      rows.push(DIV);
    }
    if (includes.trim()) rows.push("> ✅ Includes: " + includes.trim());
    return rows.join("\n");
  }, [titleTypes, carLabel, svcs, discount, includes, totalKD, optionsMode]);

  const shareText = detailed ? detailedText : compactText;

  const copyAndLog = async () => {
    try {
    const m = mobile.trim();
    if (!m) { showToast("Enter customer mobile first"); return; }
    if (!agent) { showToast("Select your name (agent) first"); return; }
    if (!svcs.some(sv => sv.lines.length || Number(sv.labor) > 0)) { showToast("Add at least one item"); return; }
    let copied = false, copyErr = "";
    try {
      const r = await bnchrCopy(shareText);
      copied = r.ok; copyErr = r.err || "";
    } catch (e) { copied = false; copyErr = (e && e.message) || "unexpected error"; }
    if (!copied && previewRef.current) {
      try { const r = document.createRange(); r.selectNodeContents(previewRef.current); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e) {}
    }
    const single = svcs.length === 1 ? svcs[0] : null;
    const row = {
      customer_mobile: m, agent, kind: "service",
      customer_id: matchedCustomer ? matchedCustomer.id : null,
      car_id: selectedCarId || null,
      services: svcs.map(sv => ({ type: sv.type, variant: sv.variant, labor: Number(sv.labor) || 0, lines: sv.lines })),
      // legacy flat fields keep older readers + battery options detection working
      service_type: single ? single.type : titleTypes,
      variant: single ? single.variant : null,
      car,
      labor: svcs.reduce((s, sv) => s + (Number(sv.labor) || 0), 0),
      discount: Number(discount) || 0,
      lines: svcs.flatMap(sv => sv.lines),
      quote_text: shareText,
    };
    try { supabase.from("quotes").insert(row).then(() => {}); } catch (e) {}
    registerCarCombo(); // unknown brand/model/trim combos enter the catalog for review
    showToast(copied ? "Quote copied & logged 📋" : `⚠ Copy blocked (${copyErr}) — logged; text is selected, press Ctrl/Cmd+C`);
    } catch (e) { showToast(`⚠ Error: ${(e && e.message) || e}`); }
  };

  const inp = { ...S.input, padding: "9px 11px", fontSize: 13.5 };
  const lbl = { fontSize: 11, fontWeight: 700, color: "#6B6B6B", marginBottom: 3 };
  return (
    <div>
      <div style={{ fontSize: 19, fontWeight: 800 }}>Service Quote</div>
      <div style={{ fontSize: 12.5, color: "#6B6B6B", marginBottom: 14 }}>Car → services & tiers → items from the catalog → WhatsApp-ready quote, logged for follow-up.</div>

      <div style={{ background: "#fff", border: "1px solid #ECECE4", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#0F2419", marginBottom: 8 }}>STEP 1 · CUSTOMER</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={mobile} onChange={e => setMobile(e.target.value)} placeholder="Customer mobile *" style={{ ...inp, flex: "0 1 160px" }} className="inp" />
          {["Alaa", "Hussain"].map(a => (
            <button key={a} onClick={() => pickAgent(a)} className="seg" style={{ ...S.seg, ...(agent === a ? S.segOn : {}) }}>{a}</button>
          ))}
        </div>
      </div>

      {/* 1 · CAR */}
      <div style={{ background: "#fff", border: "1px solid #ECECE4", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#0F2419", marginBottom: 8 }}>STEP 2 · CAR</div>
        {matchedCustomer && (
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1D7A45", marginBottom: 8 }}>
            ✓ {matchedCustomer.name || "Customer"} · {customerCars.length} car{customerCars.length === 1 ? "" : "s"} on file
          </div>
        )}
        {sqLast8(mobile).length >= 8 && !matchedCustomer && (
          <div style={{ fontSize: 12, color: "#8A8A7A", marginBottom: 8 }}>New customer — enter the car below; it will be saved when the quote is booked.</div>
        )}
        {customerCars.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {customerCars.map(c => (
              <button key={c.id} onClick={() => pickCustomerCar(c)} className="seg"
                style={{ ...S.seg, ...(selectedCarId === c.id ? S.segOn : {}), fontSize: 12 }}>
                🚗 {[c.brand, c.model, c.sub_model, c.year].filter(Boolean).join(" ")}{c.plate ? ` · ${c.plate}` : ""}
              </button>
            ))}
            <button onClick={() => { setSelectedCarId(null); setCar({ brand: "", model: "", sub_model: "", year: "", vin: "" }); }} className="seg" style={{ ...S.seg, fontSize: 12 }}>+ New car</button>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
          <div><div style={lbl}>Brand *</div><SqCombo value={car.brand} onChange={v => setCarField({ brand: v })} options={brandOptions} placeholder="Porsche" /></div>
          <div><div style={lbl}>Year</div><SqCombo value={car.year} onChange={v => setCarField({ year: v })} options={SQ_YEARS} placeholder="2021" /></div>
          <div><div style={lbl}>Model</div><SqCombo value={car.model} onChange={v => setCarField({ model: v })} options={modelOptions(car.brand)} placeholder="911" /></div>
          <div><div style={lbl}>Sub-Model (optional)</div><SqCombo value={car.sub_model} onChange={v => setCarField({ sub_model: v })} options={subModelOptions(car.brand, car.model)} placeholder="Carrera" /></div>
          <div><div style={lbl}>VIN (optional)</div><input value={car.vin} onChange={e => setCarField({ vin: e.target.value.toUpperCase() })} placeholder="WP0…" style={inp} className="inp" /></div>
        </div>
      </div>

      {/* 📋 similar quotes — progressive history filter by the selected car */}
      {similarQuotes.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #ECECE4", borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <div onClick={() => setHistOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#0F2419" }}>
              📋 SIMILAR QUOTES ({similarQuotes.length}) — {[car.brand, car.model, car.sub_model].filter(Boolean).join(" ")}
            </div>
            <span style={{ fontSize: 12, color: "#8A8A7A" }}>{histOpen ? "▲ hide" : "▼ show"}</span>
          </div>
          {histOpen && (
            <div style={{ marginTop: 8 }}>
              {similarQuotes.map(q => {
                const own = sqLast8(mobile) && sqLast8(q.customer_mobile) === sqLast8(mobile);
                const val = histValue(q);
                const open = histExpanded === q.id;
                return (
                  <div key={q.id} style={{ borderTop: "1px solid #F0F0EC", padding: "7px 0" }}>
                    <div onClick={() => setHistExpanded(open ? null : q.id)} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", cursor: "pointer", flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12.5 }}>
                        {own && <span style={{ fontSize: 10, fontWeight: 800, color: "#1D7A45", background: "#E8F4EC", borderRadius: 5, padding: "1px 6px", marginRight: 6 }}>THIS CUSTOMER</span>}
                        <strong>{histTypes(q)}</strong>
                        <span style={{ color: "#8A8A7A" }}> · {[q.car?.brand, q.car?.model, q.car?.sub_model, q.car?.year].filter(Boolean).join(" ")}</span>
                        <span style={{ color: "#8A8A7A" }}> · {q.created_at ? new Date(q.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}{q.agent ? ` · ${q.agent}` : ""}</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                        <span style={{ fontWeight: 800, fontSize: 12.5 }}>{val == null ? "options" : `${(Number(val) || 0).toFixed(3).replace(/\.?0+$/, "")} KD`}</span>
                        <button onClick={(e) => { e.stopPropagation(); useAsTemplate(q); }} className="seg" style={{ ...S.seg, fontSize: 11.5 }}>Use as template</button>
                      </div>
                    </div>
                    {open && q.quote_text && (
                      <pre style={{ background: "#FAFAF7", border: "1px solid #ECECE4", borderRadius: 8, padding: 10, fontSize: 11.5, whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "6px 0 0" }}>{q.quote_text}</pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 2 · SERVICES (add as many as needed) */}
      <div style={{ background: "#fff", border: "1px solid #ECECE4", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#0F2419", marginBottom: 8 }}>STEP 3 · SERVICE — tap to add</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.keys(SQ_SERVICES).map(n => (
            <button key={n} onClick={() => addService(n)} className="seg" style={{ ...S.seg, fontSize: 12.5 }}>+ {n}</button>
          ))}
        </div>
      </div>

      {/* service blocks */}
      {svcs.map((sv, svi) => {
        const d = SQ_SERVICES[sv.type];
        return (
          <div key={sv.id} style={{ background: "#fff", border: "1.5px solid #D8D8D0", borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>{sv.type}</div>
              <button onClick={() => rmService(sv.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C0392B" }}><X size={15} /></button>
            </div>
            {sv._fit && (
              <div style={{ fontSize: 11.5, fontWeight: 700, color: sv._fit.verified ? "#1D7A45" : "#8A6A00", background: sv._fit.verified ? "#E8F4EC" : "#FFFBEB", border: `1px solid ${sv._fit.verified ? "#BFDFC9" : "#FCD34D"}`, borderRadius: 8, padding: "6px 9px", marginBottom: 8 }}>
                ⚡ Auto-filled from fitment · engine {sv._fit.engine} · {sv._fit.verified ? "verified" : "unverified — confirm before sending"}
              </div>
            )}
            {sv.type === "Oil & Filter" && !sv._fit && sv.lines.some(l => l.category === "engine_oil") && car.brand && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 11.5, background: "#F6F8F6", border: "1px dashed #D8D8D0", borderRadius: 8, padding: "6px 9px", marginBottom: 8 }}>
                <span style={{ fontWeight: 700, color: "#6B6B6B" }}>💾 Save as fitment for {[car.brand, car.model, car.sub_model].filter(Boolean).join(" ")} — engine key:</span>
                <span style={{ width: 130, display: "inline-block" }}>
                  <SqCombo value={fitKeyDraft} onChange={setFitKeyDraft}
                    options={[...new Set(fitments.filter(f => f.brand === car.brand).map(f => f.engine_key))]}
                    placeholder="1.5T / 3.0T…" />
                </span>
                <span style={{ fontSize: 10.5, color: "#8A8A7A" }}>the engine, not the trim — same engine can serve many models</span>
                <button onClick={() => saveFitmentFromBlock(sv)} className="seg" style={{ ...S.seg, fontSize: 11.5 }}>Save fitment</button>
              </div>
            )}
            {Object.entries(d.variants || {}).map(([axis, opts]) => (
              <div key={axis} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#8A8A7A", textTransform: "uppercase", width: 44 }}>{axis}</span>
                {opts.map(o => (
                  <button key={o} onClick={() => pickVariant(sv, axis, o)} className="seg" style={{ ...S.seg, ...(sv.variant[axis] === o ? S.segOn : {}), fontSize: 12 }}>{o}</button>
                ))}
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
              {(d.pickers || []).map(pt => (
                <button key={pt.tpl} onClick={() => { setPick(pick && pick.svcId === sv.id && pick.tpl === pt.tpl ? null : { svcId: sv.id, tpl: pt.tpl }); setPq(""); }} className="seg"
                  style={{ ...S.seg, ...(pick && pick.svcId === sv.id && pick.tpl === pt.tpl ? S.segOn : {}), fontSize: 12 }}>+ {pt.label}</button>
              ))}
              <button onClick={() => addLineTo(sv.id, { name: "", category: "other", unit: "pc", qty: 1, unit_price: 0 })} className="seg" style={{ ...S.seg, fontSize: 12 }}>+ Custom line</button>
            </div>

            {pick && pick.svcId === sv.id && (
              <div style={{ border: "1px dashed #D8D8D0", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                <input autoFocus value={pq} onChange={e => setPq(e.target.value)} placeholder={`Search ${SVC_CATEGORIES[pickerCat]?.label || "catalog"}…`} style={{ ...inp, width: "100%", boxSizing: "border-box", marginBottom: 6 }} className="inp" />
                <div style={{ maxHeight: 190, overflowY: "auto" }}>
                  {pickerResults.map(p => (
                    <div key={p.id} onClick={() => addFromCatalog(p)} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 8px", borderBottom: "1px solid #F0F0EC", cursor: "pointer", alignItems: "center" }}>
                      <div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{p.name}</div><div style={{ fontSize: 10.5, color: "#8A8A7A" }}>{p.sku}{p.category === "engine_oil" ? ` · ${sqEOSpecLine(p.specs)}` : ""}</div></div>
                      <span style={{ fontWeight: 800, fontSize: 12.5, flexShrink: 0 }}>{p.selling_price != null ? `${Number(p.selling_price).toFixed(3)} KD` : "—"}</span>
                    </div>
                  ))}
                  {pickerResults.length === 0 && <div style={{ fontSize: 12, color: "#8A8A7A", padding: 6 }}>Nothing in the catalog{ql ? " matches" : " for this yet"}.</div>}
                </div>
                {["oil_filter", "brake", "filter"].includes(pick.tpl) && (
                  <button onClick={addGenuineFromPicker} style={{ marginTop: 6, background: "none", border: "1px solid #D8D8D0", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>
                    Use genuine {car.brand.trim() ? `(${car.brand.trim()})` : ""} — price manual
                  </button>
                )}
              </div>
            )}

            {sv.lines.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 7, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 190px" }}>
                  {l.product_id
                    ? <div style={{ fontSize: 12.5, fontWeight: 600 }}>{l.name}<div style={{ fontSize: 10.5, color: "#8A8A7A", fontWeight: 400 }}>{l.sku}{l.category === "engine_oil" ? ` · ${sqEOSpecLine(l.specs)}` : ""}</div></div>
                    : <input value={l.name} onChange={e => updLine(sv.id, i, { name: e.target.value, _tpl: null, _auto: l._auto })} placeholder="Item name" style={{ ...inp, width: "100%", boxSizing: "border-box" }} className="inp" />}
                </div>
                <input type="number" min="0" step="1" value={l.qty} onChange={e => { const v = e.target.value; updLine(sv.id, i, { qty: v === "" ? "" : String(Math.max(0, Math.floor(Number(v) || 0))) }); }} style={{ ...inp, width: 60 }} className="inp" title={`Qty (${l.unit})`} />
                <input type="number" step="0.001" value={l.unit_price || ""} onChange={e => updLine(sv.id, i, { unit_price: e.target.value })} style={{ ...inp, width: 84 }} className="inp" title="Unit price KD" />
                <span style={{ fontSize: 12.5, fontWeight: 800, width: 72, textAlign: "right" }}>{((Number(l.qty) || 0) * (Number(l.unit_price) || 0)).toFixed(3)}</span>
                <button onClick={() => rmLine(sv.id, i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C0392B" }}><Trash2 size={14} /></button>
              </div>
            ))}

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid #ECECE4", paddingTop: 8 }}>
              <label style={{ fontSize: 12, color: "#6B6B6B", fontWeight: 700 }}>Labor <input type="number" step="0.5" value={sv.labor || ""} onChange={e => updSvc(sv.id, { labor: e.target.value, laborTouched: true })} style={{ ...inp, width: 74, marginLeft: 4 }} className="inp" /></label>
              <div style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 800 }}>
                {sv.type === "Battery" && optionsMode
                  ? (sv.lines.length ? sv.lines.map((l, i) => <div key={i} style={{ textAlign: "right" }}>{l.name.split(" ").slice(0, 2).join(" ")}: {kd(optionTotal(l))} KD</div>) : "Add battery options")
                  : `Service total: ${kd(svcTotal(sv))} KD`}
              </div>
            </div>
          </div>
        );
      })}

      {/* 3 · QUOTE */}
      <div style={{ background: "#fff", border: "1.5px solid #0F2419", borderRadius: 14, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#0F2419" }}>STEP 4 · QUOTE</div>
            <label style={{ fontSize: 12, color: "#6B6B6B", fontWeight: 700 }}>Discount <input type="number" step="0.5" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0" style={{ ...inp, width: 74, marginLeft: 4 }} className="inp" /></label>
            {!optionsMode && <span style={{ fontSize: 13.5, fontWeight: 800 }}>Total: {kd(totalKD)} KD</span>}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setDetailed(true)} className="seg" style={{ ...S.seg, ...(detailed ? S.segOn : {}), fontSize: 12 }}>Breakdown</button>
            <button onClick={() => setDetailed(false)} className="seg" style={{ ...S.seg, ...(!detailed ? S.segOn : {}), fontSize: 12 }}>Simple</button>
          </div>
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={lbl}>✅ Includes (edit freely)</div>
          <input value={includes} onChange={e => setIncludes(e.target.value)} style={{ ...inp, width: "100%", boxSizing: "border-box" }} className="inp" />
        </div>
        {svcs.length === 0
          ? <div style={{ background: "#FAFAF7", border: "1px dashed #D8D8D0", borderRadius: 10, padding: 16, fontSize: 12.5, color: "#8A8A7A", textAlign: "center" }}>Tap a service in STEP 3 to start building the quote.</div>
          : <pre ref={previewRef} style={{ background: "#FAFAF7", border: "1px solid #ECECE4", borderRadius: 10, padding: 12, fontSize: 12.5, whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0, userSelect: "text" }}>{shareText}</pre>}
        <button onClick={copyAndLog} style={{ ...S.loginBtn, marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Copy size={15} /> Copy quote & log for follow-up
        </button>
      </div>
    </div>
  );
}

const S = {
  app: { minHeight: "100vh", background: "#FAFAF7", fontFamily: "'Inter', system-ui, sans-serif", color: "#1A1A1A" },
  // Login
  loginWrap: { minHeight: "100vh", background: "#FAFAF7", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif", padding: 20 },
  loginCard: { background: "#fff", borderRadius: 16, padding: "36px 32px", width: "100%", maxWidth: 340, boxShadow: "0 12px 40px rgba(0,0,0,0.10)", border: "1px solid #ECECE4", textAlign: "center" },
  loginSub: { color: "#6B6B6B", fontSize: 13, fontWeight: 600, letterSpacing: 0.3, marginTop: 4, marginBottom: 24 },
  loginInput: { width: "100%", boxSizing: "border-box", padding: "12px 14px", fontSize: 15, border: "1.5px solid #D8D8D0", borderRadius: 10, outline: "none", textAlign: "center", fontFamily: "inherit" },
  loginErr: { color: "#C0392B", fontSize: 12.5, fontWeight: 600, marginTop: 8 },
  loginBtn: { width: "100%", marginTop: 16, padding: "12px 14px", fontSize: 15, fontWeight: 700, color: "#fff", background: "#0F2419", border: "none", borderRadius: 10, cursor: "pointer", fontFamily: "inherit" },
  dbErrorBar: { background: "#FBEAE8", color: "#9B2C20", padding: "10px 16px", fontSize: 13, fontWeight: 600, textAlign: "center", borderBottom: "1px solid #F0C9C4" },
  header: { background: "#0F2419", position: "sticky", top: 0, zIndex: 10, borderBottom: "2px solid #C9A84C" },
  headerInner: { maxWidth: 920, margin: "0 auto", padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 },
  logo: { display: "flex", flexDirection: "column" },
  logoMark: { fontSize: 24, fontWeight: 900, color: "#fff", letterSpacing: "-0.04em", lineHeight: 1, fontFamily: "'Arial Black', 'Helvetica Neue', sans-serif", fontStretch: "condensed" },
  logoReg: { fontSize: 9, fontWeight: 700, color: "#fff", marginTop: 2 },
  logoSub: { fontSize: 11, color: "#8FB3A0", marginTop: 3, letterSpacing: "0.04em" },
  nav: { display: "flex", gap: 6 },
  navBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "none", background: "transparent", color: "#8FB3A0", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all .15s" },
  navBtnActive: { background: "#1D5C3A", color: "#fff" },
  main: { maxWidth: 920, margin: "0 auto", padding: "20px 18px 80px" },
  card: { background: "#fff", borderRadius: 14, padding: 18, marginBottom: 16, border: "1px solid #EDEDE6", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" },
  modeRow: { display: "flex", gap: 8, marginBottom: 16 },
  seg: { display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 9, border: "1.5px solid #E2E2D8", background: "#fff", color: "#666", fontSize: 13.5, fontWeight: 600, cursor: "pointer" },
  segOn: { borderColor: "#1D5C3A", background: "#1D5C3A", color: "#fff" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6, marginTop: 2 },
  input: { width: "100%", padding: "11px 13px", borderRadius: 9, border: "1.5px solid #E2E2D8", fontSize: 14, fontFamily: "inherit", color: "#1a1a1a", outline: "none", boxSizing: "border-box", background: "#fff" },
  inputAuto: { background: "#F5F5F0", color: "#666" },
  parsed: { fontSize: 12, color: "#1D5C3A", marginTop: 7, fontWeight: 600 },
  sugBox: { position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid #E2E2D8", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 20, overflow: "hidden" },
  sugItem: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "10px 14px", border: "none", borderBottom: "1px solid #F0F0EA", background: "#fff", cursor: "pointer", fontSize: 14 },
  sugSize: { fontWeight: 700, color: "#1a1a1a", fontFamily: "monospace" },
  sugCount: { fontSize: 11.5, color: "#1D5C3A", fontWeight: 600, background: "#E7F2EB", padding: "2px 8px", borderRadius: 5 },
  histWrap: { marginTop: 14 },
  histLabel: { fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.04em" },
  histChips: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 },
  histChip: { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 7, border: "1px solid #E2E2D8", background: "#FCFCFA", color: "#444", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  catHistoryWrap: { display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: "1px solid #F0F0EA" },
  bulkSizeLabel: { fontSize: 14, fontWeight: 800, color: "#1A4F8A", marginTop: 2, letterSpacing: 0.3 },
  bulkModeWrap: { display: "inline-flex", gap: 0, background: "#F0F0EA", borderRadius: 9, padding: 3, marginBottom: 4 },
  bulkModeBtn: { padding: "6px 18px", fontSize: 12.5, fontWeight: 700, color: "#777", background: "transparent", border: "none", borderRadius: 7, cursor: "pointer" },
  bulkModeBtnOn: { background: "#fff", color: "#0F2419", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" },
  parsedMuted: { fontSize: 12, color: "#999", marginTop: 7 },
  chkRow: { display: "flex", alignItems: "center", gap: 9, marginTop: 12, fontSize: 13, color: "#555", cursor: "pointer" },
  carOpts: { display: "flex", flexDirection: "column", gap: 7, marginTop: 12 },
  carChip: { textAlign: "left", padding: "10px 14px", borderRadius: 9, border: "1.5px solid #E2E2D8", background: "#fff", fontSize: 13, fontWeight: 600, color: "#444", cursor: "pointer" },
  carChipOn: { borderColor: "#1D5C3A", background: "#E7F2EB", color: "#1D5C3A" },
  sizeHeader: { display: "flex", alignItems: "baseline", justifyContent: "space-between", borderBottom: "2px solid #0F2419", paddingBottom: 10 },
  sizeHeaderLabel: { fontSize: 20, fontWeight: 800, color: "#0F2419", letterSpacing: "-0.01em" },
  sizeHeaderCount: { fontSize: 12, color: "#999", fontWeight: 600 },
  catTag: { display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: 7, fontSize: 13, fontWeight: 700 },
  catDot: { width: 8, height: 8, borderRadius: "50%" },
  catAr: { fontWeight: 600, opacity: 0.7, marginLeft: 2 },
  tireRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 12px", borderRadius: 9, marginTop: 8, border: "1px solid #EDEDE6", background: "#FCFCFA", flexWrap: "wrap" },
  tireRowAvail: { background: "#F4FBF6", borderColor: "#CDE8D7" },
  tireMain: { display: "flex", flex: 1, minWidth: 200, alignItems: "flex-start" },
  tireLine: { fontSize: 14, fontWeight: 600, color: "#1a1a1a", lineHeight: 1.35 },
  markingNote: { fontSize: 11.5, color: "#8A6A00", background: "#FBF4DF", padding: "3px 9px", borderRadius: 5, marginTop: 5, display: "inline-block", fontWeight: 600 },
  markGroup: { fontSize: 11, fontWeight: 800, color: "#1D5C3A", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6, borderBottom: "2px solid #E7F2EB", paddingBottom: 4 },
  markRow: { display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid #F0F0EA", alignItems: "flex-start" },
  markCode: { fontSize: 13, fontWeight: 800, color: "#8A6A00", background: "#FBF4DF", padding: "3px 10px", borderRadius: 6, minWidth: 48, textAlign: "center" },
  markMeaning: { fontSize: 13, fontWeight: 600, color: "#1a1a1a" },
  markBrands: { fontSize: 11, color: "#999", marginTop: 2 },
  tireMeta: { display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" },
  priceTag: { fontSize: 14, fontWeight: 800, color: "#1D5C3A" },
  costTag: { fontSize: 11.5, color: "#999" },
  profitBadge: { fontSize: 12, fontWeight: 800, padding: "2px 9px", borderRadius: 6 },
  profitMargin: { fontWeight: 600, opacity: 0.75, fontSize: 10.5 },
  sortWrap: { display: "flex", alignItems: "center", gap: 4 },
  sortLabel: { fontSize: 11, color: "#999", fontWeight: 600, marginRight: 2 },
  sortBtn: { padding: "4px 10px", borderRadius: 6, border: "1px solid #E2E2D8", background: "#fff", fontSize: 11.5, fontWeight: 700, color: "#666", cursor: "pointer" },
  sortBtnOn: { background: "#1A4F8A", borderColor: "#1A4F8A", color: "#fff" },
  sortDirBtn: { background: "#F4F1E8", borderColor: "#D8D0BC", color: "#5A4A2A", marginLeft: 4 },
  availFilterBar: { display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  availFilterBtn: { padding: "8px 16px", borderRadius: 9, border: "1.5px solid #E2E2D8", background: "#fff", fontSize: 13, fontWeight: 700, color: "#666", cursor: "pointer" },
  availFilterBtnOn: { background: "#0F2419", borderColor: "#0F2419", color: "#fff" },
  catStockBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 7, border: "1.5px solid #E2E2D8", background: "#fff", fontSize: 11.5, fontWeight: 700, color: "#888", cursor: "pointer", whiteSpace: "nowrap" },
  availBadgeRO: { display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 7, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" },
  // Delete confirmation
  delTarget: { background: "#FAFAF7", border: "1px solid #ECECE4", borderRadius: 9, padding: "11px 13px" },
  cancelBtn: { flex: 1, padding: "11px 14px", fontSize: 14, fontWeight: 700, color: "#555", background: "#F0F0EA", border: "none", borderRadius: 9, cursor: "pointer" },
  deleteConfirmBtn: { flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 14px", fontSize: 14, fontWeight: 700, color: "#fff", background: "#C0392B", border: "none", borderRadius: 9, cursor: "pointer" },
  // Bulk edit
  bulkBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, color: "#0F2419", background: "#F4F1E8", border: "1px solid #D8D0BC", borderRadius: 8, cursor: "pointer" },
  bulkTableWrap: { maxHeight: "56vh", overflowY: "auto", marginTop: 6 },
  bulkRow: { display: "flex", alignItems: "center", gap: 8, padding: "8px 4px", borderBottom: "1px solid #F0F0EA" },
  bulkHeadRow: { fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: 0.3, position: "sticky", top: 0, background: "#fff", borderBottom: "1.5px solid #E2E2D8" },
  bulkCol: { flex: 1, display: "flex", alignItems: "center", gap: 3 },
  bulkTireName: { fontSize: 13, fontWeight: 700, color: "#1A1A1A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  bulkTireSub: { fontSize: 11, color: "#999", marginTop: 1 },
  bulkInput: { flex: 1, width: "100%", boxSizing: "border-box", padding: "7px 8px", fontSize: 13, border: "1.5px solid #E2E2D8", borderRadius: 7, outline: "none", fontFamily: "inherit", minWidth: 0 },
  bulkMargin: { borderColor: "#C9A84C", background: "#FDFBF4" },
  agreedTag: { marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: "#8A6A00", background: "#FBF4DF", padding: "1px 6px", borderRadius: 4, textTransform: "uppercase", letterSpacing: 0.3 },
  applyFormulaBtn: { cursor: "pointer", color: "#1A4F8A", background: "#EEF3F9", borderColor: "#C5D8EC", fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" },
  bulkAuto: { background: "#F0F7F2", borderColor: "#BFE0CC", color: "#1D7A45", fontWeight: 700 },
  bulkProfit: { fontSize: 12.5, fontWeight: 800 },
  bulkPct: { fontSize: 11, color: "#999", fontWeight: 600 },
  saveAllBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "11px 20px", fontSize: 14, fontWeight: 700, color: "#fff", background: "#0F2419", border: "none", borderRadius: 9, cursor: "pointer" },
  profInd: { border: "1.5px solid", borderRadius: 10, padding: "10px 12px", marginTop: 12, background: "#FCFCFA" },
  profIndRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  profIndRow2: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6 },
  profIndAmt: { fontSize: 15, fontWeight: 800, padding: "3px 10px", borderRadius: 7 },
  profIndMargin: { fontSize: 12.5, color: "#555", fontWeight: 600 },
  profIndTier: { fontSize: 11.5, fontWeight: 700, textTransform: "capitalize" },
  profIndSet: { fontSize: 12.5, fontWeight: 800, color: "#1A4F8A" },
  profIndTarget: { fontSize: 11.5, color: "#888" },
  profIndNote: { fontSize: 11, color: "#1A4F8A", marginTop: 6, fontWeight: 600, fontStyle: "italic" },
  reapplyBtn: { padding: "6px 12px", borderRadius: 7, border: "1px solid #E2E2D8", background: "#fff", fontSize: 11.5, fontWeight: 700, color: "#1A4F8A", cursor: "pointer" },
  viewAllBtn: { display: "flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "center", padding: "9px", borderRadius: 8, border: "1px dashed #C8C8BE", background: "#FCFCFA", fontSize: 12.5, fontWeight: 700, color: "#666", cursor: "pointer", marginTop: 14 },
  supplierTag: { fontSize: 11, color: "#666", background: "#F0F0EC", padding: "2px 8px", borderRadius: 5 },
  skuTag: { fontSize: 10.5, color: "#999", fontFamily: "monospace", background: "#F7F7F2", padding: "2px 7px", borderRadius: 5 },
  dupBanner: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "11px 14px", borderRadius: 9, background: "#FDF6E3", border: "1.5px solid #F0D070", fontSize: 13, fontWeight: 600, color: "#8A6A00", marginTop: 14 },
  dupCancelBtn: { padding: "7px 14px", borderRadius: 7, border: "1px solid #E2E2D8", background: "#fff", fontSize: 12.5, fontWeight: 700, color: "#666", cursor: "pointer" },
  dupAddBtn: { padding: "7px 14px", borderRadius: 7, border: "none", background: "#C0392B", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  brandFix: { fontSize: 10, fontWeight: 700, color: "#8A6A00", background: "#FBF4DF", border: "1px solid #F0D070", borderRadius: 5, padding: "2px 6px", cursor: "pointer", textAlign: "left", maxWidth: 130, lineHeight: 1.3 },
  patSugWrap: { display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", maxWidth: 220, marginTop: 2 },
  patSugLabel: { fontSize: 9.5, fontWeight: 700, color: "#1A4F8A", textTransform: "uppercase" },
  patSugChip: { fontSize: 10, fontWeight: 600, color: "#1A4F8A", background: "#F2F7FC", border: "1px solid #C5DBF0", borderRadius: 5, padding: "2px 7px", cursor: "pointer" },
  ddPanel: { position: "absolute", top: "100%", left: 0, zIndex: 50, marginTop: 3, minWidth: 200, maxWidth: 280, maxHeight: 240, overflowY: "auto", background: "#fff", border: "1px solid #D8D8D0", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.14)" },
  ddItem: { padding: "8px 11px", fontSize: 13, color: "#222", cursor: "pointer", borderBottom: "1px solid #F4F4EE", whiteSpace: "nowrap" },
  ddItemHover: { background: "#F0F6F2" },
  ddItemActive: { background: "#E7F2EB", fontWeight: 700, color: "#1D5C3A" },
  patSuggWrap: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, maxWidth: 200 },
  patSuggLabel: { fontSize: 9.5, color: "#999", fontWeight: 600 },
  patSuggChip: { fontSize: 10, fontWeight: 700, color: "#1A4F8A", background: "#F2F7FC", border: "1px solid #BCD4EC", borderRadius: 5, padding: "2px 7px", cursor: "pointer" },
  offroadTag: { fontSize: 10.5, color: "#B05A1A", background: "#FBEFE3", padding: "2px 8px", borderRadius: 5, fontWeight: 700 },
  tireActions: { display: "flex", alignItems: "center", gap: 6 },
  availBtn: { display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 7, border: "1.5px solid", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  availOn: { borderColor: "#1D5C3A", background: "#1D5C3A", color: "#fff" },
  availStale: { borderColor: "#C0392B", background: "#C0392B", color: "#fff" },
  availGrey: { borderColor: "#8A8A7A", background: "#8A8A7A", color: "#fff" },
  staleBanner: { display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "11px 15px", borderRadius: 10, border: "1.5px solid #F0D070", background: "#FDF6E3", cursor: "pointer", marginBottom: 14 },
  staleBannerText: { fontSize: 13.5, fontWeight: 700, color: "#8A6A00" },
  staleRedPill: { fontSize: 12, fontWeight: 800, color: "#C0392B", background: "#FBE5E1", padding: "3px 9px", borderRadius: 6 },
  staleGreyPill: { fontSize: 12, fontWeight: 800, color: "#6A6A5A", background: "#EDEDE6", padding: "3px 9px", borderRadius: 6 },
  staleRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #F0F0EA" },
  staleTireName: { fontSize: 13.5, fontWeight: 700, color: "#1a1a1a" },
  staleTireSize: { fontSize: 11.5, color: "#999", marginTop: 2 },
  selCount: { fontSize: 12.5, fontWeight: 700, color: "#C9A84C", alignSelf: "center" },
  availOff: { borderColor: "#E2E2D8", background: "#fff", color: "#999" },
  availWrap: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 },
  freshLabel: { fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" },
  iconBtn: { display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 7, border: "1px solid #E2E2D8", background: "#fff", color: "#666", cursor: "pointer" },
  empty: { padding: "20px 0", textAlign: "center", color: "#999", fontSize: 13.5 },
  shareBar: { position: "sticky", bottom: 16, display: "flex", flexDirection: "column", gap: 10, padding: 12, background: "#0F2419", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.2)" },
  shareRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  copyMain: { display: "flex", alignItems: "center", gap: 7, padding: "10px 20px", borderRadius: 8, border: "none", background: "#C9A84C", color: "#0F2419", fontSize: 13.5, fontWeight: 800, cursor: "pointer" },
  qtyWrap: { display: "flex", alignItems: "center", gap: 7 },
  langWrap: { display: "flex", gap: 3, background: "#0A1A12", padding: 3, borderRadius: 8 },
  langBtn: { padding: "6px 12px", borderRadius: 6, border: "none", background: "transparent", color: "#8FB3A0", fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  langBtnOn: { background: "#C9A84C", color: "#0F2419" },
  qtyLabel: { fontSize: 11.5, color: "#8FB3A0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" },
  qtyBtns: { display: "flex", gap: 3, background: "#0A1A12", padding: 3, borderRadius: 8 },
  qtyBtn: { width: 30, height: 30, borderRadius: 6, border: "none", background: "transparent", color: "#8FB3A0", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  qtyBtnOn: { background: "#C9A84C", color: "#0F2419" },
  qtyFixed: { fontSize: 13, color: "#fff", fontWeight: 700, background: "#0A1A12", padding: "7px 12px", borderRadius: 8 },
  clBtn: { display: "flex", alignItems: "center", gap: 5, padding: "8px 13px", borderRadius: 8, border: "1.5px solid #2E5C45", background: "transparent", color: "#8FB3A0", fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  clBtnOn: { background: "#C9A84C", borderColor: "#C9A84C", color: "#0F2419" },
  laborHint: { fontSize: 12, color: "#C9A84C", fontWeight: 700 },
  cashWrap: { display: "flex", alignItems: "center", gap: 6 },
  cashBtnOn: { background: "#1D7A45", color: "#fff", borderColor: "#1D7A45" },
  cashNote: { marginTop: 8, fontSize: 11.5, color: "#8A6A00", background: "#FBF4DF", borderRadius: 8, padding: "7px 11px", lineHeight: 1.45 },
  previewBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 8, border: "1px solid #2E5C45", background: "transparent", color: "#8FB3A0", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  copyBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 8, border: "1px solid #E2E2D8", background: "#fff", color: "#444", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  waBtn: { display: "flex", alignItems: "center", gap: 7, padding: "10px 18px", borderRadius: 8, border: "none", background: "#25D366", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" },
  modalWrap: { position: "fixed", inset: 0, background: "rgba(15,36,25,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, zIndex: 50 },
  modal: { background: "#fff", borderRadius: 14, padding: 20, maxWidth: 540, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" },
  modalHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: 800, color: "#0F2419", margin: 0 },
  preview: { background: "#F5F5F0", borderRadius: 9, padding: 14, fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "'SF Mono', Menlo, monospace", color: "#1a1a1a", margin: 0, border: "1px solid #E8E8E0", direction: "ltr", textAlign: "left", userSelect: "text", WebkitUserSelect: "text" },
  h2: { fontSize: 18, fontWeight: 800, color: "#0F2419", margin: "0 0 6px" },
  sub: { fontSize: 13, color: "#777", margin: "0 0 16px", lineHeight: 1.5 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 },
  previewLine: { border: "2px solid", borderRadius: 11, padding: 14, marginBottom: 18, background: "#FCFCFA" },
  previewText: { fontSize: 15, fontWeight: 700, color: "#1a1a1a", lineHeight: 1.4 },
  previewSize: { fontSize: 12.5, color: "#888", marginTop: 5, fontFamily: "monospace" },
  searchIcon: { position: "absolute", left: 12, top: 12, color: "#999" },
  filterChip: { padding: "8px 13px", borderRadius: 8, border: "1.5px solid #E2E2D8", background: "#fff", fontSize: 12.5, fontWeight: 700, color: "#666", cursor: "pointer" },
  filterChipOn: { background: "#1D5C3A", borderColor: "#1D5C3A", color: "#fff" },
  drawerWrap: { position: "fixed", inset: 0, background: "rgba(15,36,25,0.5)", display: "flex", justifyContent: "flex-end", zIndex: 50 },
  drawer: { background: "#fff", width: "100%", maxWidth: 380, height: "100%", padding: 20, overflowY: "auto", boxShadow: "-8px 0 30px rgba(0,0,0,0.2)" },
  filterGroup: { marginTop: 18 },
  filterLabel: { display: "block", fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.03em" },
  filterChipRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  fChip: { padding: "7px 12px", borderRadius: 7, border: "1.5px solid #E2E2D8", background: "#fff", fontSize: 12.5, fontWeight: 600, color: "#444", cursor: "pointer" },
  fChipOn: { background: "#1D5C3A", borderColor: "#1D5C3A", color: "#fff" },
  catalogHead: { fontSize: 12.5, color: "#999", fontWeight: 600, marginBottom: 10 },
  dlBtn: { display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 7, border: "1px solid #E2E2D8", background: "#fff", color: "#1D5C3A", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  draftHint: { fontSize: 12, color: "#888", marginBottom: 12, lineHeight: 1.5 },
  quickFormat: { fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#1D5C3A", background: "#E7F2EB", padding: "2px 7px", borderRadius: 5, display: "inline-block", marginTop: 4 },
  quickInline: { fontFamily: "monospace", fontSize: 11.5, fontWeight: 700, color: "#8A6A00", background: "#FBF4DF", padding: "1px 6px", borderRadius: 4 },
  qHelp: { marginTop: 10, padding: "10px 12px", borderRadius: 9, background: "#F4FBF6", border: "1px solid #D8EADE" },
  qHelpLabel: { fontSize: 11, fontWeight: 700, color: "#1D5C3A", textTransform: "uppercase", letterSpacing: "0.03em" },
  qHelpRow: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 },
  qHelpChip: { display: "flex", flexDirection: "column", gap: 1, padding: "4px 9px", borderRadius: 6, background: "#fff", border: "1px solid #D8EADE", minWidth: 50 },
  qHelpField: { fontSize: 9, fontWeight: 700, color: "#999", textTransform: "uppercase" },
  qHelpVal: { fontSize: 12.5, fontWeight: 700, color: "#1a1a1a", fontFamily: "monospace" },
  draftCard: { border: "1px solid #E2E2D8", borderRadius: 10, padding: 12, marginBottom: 10, background: "#FCFCFA" },
  draftTop: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  draftSrc: { fontSize: 11, color: "#999", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 },
  draftGrid: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" },
  draftLabel: { fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase" },
  draftSetGain: { fontSize: 10, color: "#1D7A45", fontWeight: 700, textAlign: "center" },
  draftPriceNote: { fontSize: 11, color: "#1A4F8A", marginTop: 8, fontWeight: 600, fontStyle: "italic", background: "#F4F8FC", padding: "5px 10px", borderRadius: 6, display: "inline-block" },
  draftInput: { padding: "7px 9px", borderRadius: 7, border: "1.5px solid #E2E2D8", fontSize: 13, fontFamily: "inherit", color: "#1a1a1a", outline: "none", boxSizing: "border-box", background: "#fff" },
  catalogRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 0", borderBottom: "1px solid #F0F0EA", flexWrap: "wrap" },
  catMini: { fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 5 },
  histRow: { display: "flex", gap: 10, padding: "10px 0", borderBottom: "1px solid #F0F0EA" },
  histMain: { fontSize: 13.5, fontWeight: 600, color: "#1a1a1a" },
  histMargin: { color: "#1D5C3A", fontWeight: 700 },
  histMeta: { fontSize: 11.5, color: "#999", marginTop: 3 },
  toast: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#0F2419", color: "#fff", padding: "11px 20px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, zIndex: 100, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" },
};

const CSS = `
* { box-sizing: border-box; }
body { margin: 0; }
.inp:focus { border-color: #1D5C3A !important; box-shadow: 0 0 0 3px rgba(29,92,58,0.1); }
.navbtn:hover { color: #fff; }
.seg:hover { border-color: #1D5C3A; }
.iconbtn:hover { background: #F0F0EC; border-color: #1D5C3A; color: #1D5C3A; }
.availbtn:hover { opacity: 0.85; }
.primary:hover { opacity: 0.9; }
.ghost:hover { background: #F5F5F0; }
.carChip:hover { border-color: #1D5C3A; }
.filterChip:hover { border-color: #1D5C3A; }
.qtybtn:hover { color: #fff; }
.clbtn:hover { border-color: #C9A84C; }
.sugitem:hover { background: #F4FBF6 !important; }
.histchip:hover { border-color: #1D5C3A; background: #fff; }
.sortbtn:hover { border-color: #1A4F8A; }
.langbtn:hover { color: #fff; }
.staleBanner:hover { border-color: #C9A84C; background: #FCF0D0; }
input[type=checkbox] { accent-color: #1D5C3A; width: 16px; height: 16px; cursor: pointer; }
@media (max-width: 560px) {
  .navbtn span { display: none; }
}
`;
