import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase ────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://itpghtviyotueqpspxun.supabase.co";
const SUPABASE_KEY = "sb_publishable_OhL-LX-sjKOo97uFoN7oMQ_G3j579PE";
// Realtime client — used ONLY for live push notifications; all reads/writes stay on the REST layer below.
const sbRealtime = createClient(SUPABASE_URL, SUPABASE_KEY);

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
    },
    ...opts,
  });
  if (!res.ok) { const err = await res.text(); throw new Error(err); }
  return res.status === 204 ? null : res.json();
}

// Fetch ALL rows past PostgREST's 1000-row page cap (loops in pages of 1000).
async function sbAll(path) {
  const sep = path.includes("?") ? "&" : "?";
  const out = [];
  const seen = new Set();                            // dedupe guard across pages
  for (let page = 0; page < 50; page++) {           // safety ceiling: 50k rows
    const batch = await sb(`${path}${sep}limit=1000&offset=${page * 1000}`);
    (batch || []).forEach(r => {
      const k = r.id != null ? String(r.id) : JSON.stringify(r);
      if (!seen.has(k)) { seen.add(k); out.push(r); }
    });
    if (!batch || batch.length < 1000) break;
  }
  return out;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const PASSWORD = "b7vk392";              // master — Ali only
const DIST_PASSWORD = "dst5926";         // distributor
const PURCH_PASSWORD = "prc4183";        // purchaser
// Per-truck technician logins — each truck has its own password.
// Edit these codes as needed; only activeTrucks() are offered at login.
let TRUCK_PASSWORDS = { T1: "t1x482", T2: "t2m945", T4: "t4k736" }; // fallback; hydrated from truck_config
// Per-agent sales logins — the agent is locked to the session and auto-fills
// on every new order. The shared PASSWORD still works for sales (no agent lock).
const SALES_AGENT_PASSWORDS = {
  Alaa: "alz7264",
  Hussain: "hsn8317",
  Ali: "ali2947",     // owner — unlocks profitability views
};
const OWNER_AGENTS = ["Ali"]; // never shown on the team's login pills
const TRUCKS = ["T1", "T2", "T4", "T5", "T6"];

const STATUS_FLOW = [
  { key: "draft",      label: "Draft",       color: "#94A3B8" },
  { key: "booked",     label: "Booked",      color: "#64748B" },
  { key: "part_ready", label: "Part Ready",  color: "#7C3AED" },
  { key: "assigned",   label: "Assigned",    color: "#2563EB" },
  { key: "en_route",   label: "En Route",    color: "#D97706" },
  { key: "on_site",    label: "On Site",     color: "#EA580C" },
  { key: "done",       label: "Done",        color: "#15803D" },
  { key: "invoiced",   label: "Invoiced",    color: "#0891B2" },
  { key: "paid",       label: "Paid",        color: "#059669" },
];

const DONE_STATUSES = ["done", "invoiced", "paid"];
// Operational stage of an order, the way the sales team thinks about it:
// Booked (sales placed it) → Started (technician working) → Successful (done & completed)
const jobStarted = (j) => j.truck_status === "processing" || ["en_route", "on_site"].includes(j.status);
const jobSuccessful = (j) => DONE_STATUSES.includes(j.status) || j.truck_status === "completed";
const jobBookedStage = (j) => j.status !== "cancelled" && j.status !== "incomplete" && !jobStarted(j) && !jobSuccessful(j);
// "Most recent action" timestamp for history sorting: last save wins,
// falling back to schedule/creation time for rows that predate updated_at.
// Elapsed on-site time: Start Job → Complete Job
const jobDurationMin = (j) => {
  if (!j.started_at || !j.completed_at) return null;
  const mins = Math.round((new Date(j.completed_at) - new Date(j.started_at)) / 60000);
  return mins >= 0 ? mins : null;
};
const fmtDuration = (mins) => {
  if (mins == null) return "";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};
const lastAction = (j) => new Date(j.updated_at || j.items_edited_at || j.cancelled_at || j.incomplete_at || j.scheduled_at || j.created_at || 0).getTime();
// Verification timestamps: keep/assign a time when a check completes, clear when it un-completes
const verStamp = (job, key, done) => {
  const vt = { ...(job.ver_times || {}) };
  if (done) { if (!vt[key]) vt[key] = new Date().toISOString(); } else vt[key] = null;
  return vt;
};

const CHECK_LABELS = [
  "Sales — confirmed tires/products match the car (at order)",
  "Distributor — verified tires before loading",
  "Track team — verified parts match the order details",
  "Track team — verified parts match the customer's car",
];
// Derive the 4 verification checks from real actions (read-only audit trail).
function deriveChecks(job) {
  const items = (job.items || []);
  const itemCk = job.item_checks || {};
  const ordCk = job.tech_checks_order || {};
  const carCk = { ...(job.tech_checks || {}), ...(job.tech_checks_car || {}) };
  // Each checkpoint judges exactly the items its screen shows:
  // distributor collects physical goods; technicians verify everything on their checklist.
  // Labor-only lines belong to neither — a checkpoint with nothing to check passes.
  const collectable = items.filter(it => (it.kind === "tire" && it.tire_id) || it.kind === "part");
  const verifiable  = items.filter(it => (it.kind === "tire" && it.tire_id) || it.kind === "part" || it.kind === "service");
  // #1 sales confirmed match at order submission (nothing to match on labor-only orders → auto-pass)
  const c1 = !!job.sales_match_confirmed || verifiable.length === 0;
  // #2 distributor confirmed every collectable item matches (before loading)
  const c2 = collectable.length === 0 ? true : collectable.every(it => itemCk[it.id]);
  // #3 technicians verified every part matches the ORDER details
  const c3 = !!job.tech_arrival_match || (verifiable.length === 0 ? true : verifiable.every(it => ordCk[it.id]));
  // #4 technicians verified every part matches the CUSTOMER'S CAR (office-approved mismatch counts, flagged as override)
  const mm = job.tech_mismatch || {};
  const c4 = verifiable.length === 0 ? true : verifiable.every(it => carCk[it.id] || (mm[it.id] && (mm[it.id].resolution === "approved" || mm[it.id].resolution === "dont_fit")));
  return [c1, c2, c3, c4];
}

const SERVICE_TYPES = [
  "Tire Change & Balancing","Oil & Filter","Battery Change",
  "Brake Change","Programming","Mechanical Check","Wheel Repair","Rotation","Other",
];

// ─── BNCHR+ Service Catalog (official price table — single source of truth) ────
// kind "tire"  → uses tire formula (catalog search, qty 4 default, labor from tire table)
// kind "other" → uses other-services formula (description, qty 1 default, labor from variant)
// Each service defines its variant axes. Labor auto-fills from the selected variant.
const SERVICE_CATALOG = {
  "Tire Change & Balancing": {
    kind: "tire",
    variants: { mount: ["Normal", "Center-lock"] }, // labor from LABOR table by qty
  },
  "Tire Patch": {
    kind: "other",
    flatLabor: 10, // 10 KD
  },
  "Spare Tire Change": {
    kind: "other",
    flatLabor: 10, // 10 KD
  },
  "Valve Sensor Replacement": {
    kind: "other",
    flatLabor: 20, // 20 KD
  },
  "Tire Rotation": {
    kind: "other",
    flatLabor: 20, // 20 KD
  },
  "Oil & Filter": {
    kind: "other",
    variants: { tier: ["Normal", "Premium"] },
    labor: { Normal: 10, Premium: 15 },
  },
  "Battery": {
    kind: "other",
    variants: { tier: ["Normal", "Complex"] },
    labor: { Normal: 10, Complex: 15 },
  },
  "Battery Check": {
    kind: "other",
    flatLabor: 10, // 10 KD
  },
  "Brake Pads": {
    kind: "other",
    variants: { tier: ["Normal", "Premium"], sides: ["One side", "Two sides"] },
    labor: { "Normal|One side": 15, "Normal|Two sides": 25, "Premium|One side": 20, "Premium|Two sides": 35 },
  },
  "Brake Disc": {
    kind: "other",
    variants: { tier: ["Normal", "Premium"], sides: ["One side", "Two sides"] },
    labor: { "Normal|One side": 15, "Normal|Two sides": 25, "Premium|One side": 20, "Premium|Two sides": 35 },
  },
  "Disc Skimming": {
    kind: "other",
    variants: { sides: ["One side", "Two sides"] },
    labor: { "One side": 10, "Two sides": 20 }, // 10 KD per side
  },
  "Major Service": {
    kind: "other",
    variants: { tier: ["Economy", "Normal", "Premium", "Top"] },
    labor: { Economy: 40, Normal: 50, Premium: 60, Top: 80 },
  },
  "AC Gas Refill": {
    kind: "other",
    flatLabor: 20, // 20 KD
  },
  "Car Computer Check": {
    kind: "other",
    flatLabor: 20, // 20 KD
  },
  "Distance Charges": {
    kind: "other",
    flatLabor: 5, // 5 KD
  },
  "Part Replacement": {
    kind: "other", // labor entered manually per order
  },
  "Tire Check": {
    kind: "other",
    flatLabor: 0, // inspection — no default labor charge
  },
  "Wheel Repair": {
    kind: "other", // rim taken, repaired, returned fitted + balanced; labor entered per order
  },
  "Mechanical Check": {
    kind: "other",
    flatLabor: 0, // inspection — no default labor charge
  },
};
const SERVICE_NAMES = Object.keys(SERVICE_CATALOG);

// ─── Labor-line detection ──────────────────────────────────────────────────────
// Pure labor/service lines are never purchased from a supplier, so they must never
// ask for a supplier or cost (Costs page) nor count as "missing costs" (Reports).
// Catches every shape: labor_only flags, labor/service/other kinds, SV service SKUs,
// and legacy imported items stored as kind "part" but named after a labor service.
const LABOR_LINE_NAMES = new Set([
  ...SERVICE_NAMES, ...SERVICE_TYPES,
  "Tire Patch", "Patch", "Puncture Repair", "Tire Check", "Tire Rotation", "Rotation",
  "Tire Change", "Tire Change & Balancing", "Balancing", "Wheel Balancing",
  "Wheel Alignment", "Alignment", "Disc Skimming", "AC Gas Refill",
  "Car Computer Check", "Computer Check", "Mechanical Check", "Programming",
  "Wheel Repair", "Inspection", "6 Points Check", "Labor", "Labour", "Service Charge", "Delivery",
  "Spare Tire Change", "Distance Charges", "Distance Charge", "Valve Sensor Replacement", "Valve Change", "Valve Check", "Battery Check",
].map(s => s.toLowerCase()));
function isLaborLine(it) {
  if (it.labor_only || ["labor", "service", "other"].includes(it.kind)) return true;
  if (/^SV/i.test(String(it.sku || ""))) return true; // service SKUs are labor
  const nm = String(it.name || "").toLowerCase().replace(/\(labor only\)/g, "").trim();
  return LABOR_LINE_NAMES.has(nm) || /\blabou?r\b/.test(nm);
}

// Tire mount labor table (by qty; standard vs center-lock)
const LABOR = {
  standard: { 1: 15, 2: 15, 3: 20, 4: 20, 5: 25 },
  centerlock: { 1: 25, 2: 25, 3: 40, 4: 40, 5: 40 },
};
function laborFor(qty, centerlock) {
  const table = centerlock ? LABOR.centerlock : LABOR.standard;
  const q = Number(qty) || 0;
  return table[q] ?? table[4];
}

// Resolve labor for a service given its variant + qty (for tires).
function catalogLabor(serviceName, variant, qty) {
  const svc = SERVICE_CATALOG[serviceName];
  if (!svc) return 0;
  // Tire formula: labor from qty + mount type (Normal/Center-lock)
  if (svc.kind === "tire") {
    const centerlock = (variant && variant.mount) === "Center-lock";
    return laborFor(qty != null ? qty : 4, centerlock);
  }
  if (svc.flatLabor != null) return svc.flatLabor;
  if (svc.labor) {
    const axes = Object.keys(svc.variants || {});
    const key = axes.map(a => variant[a]).filter(Boolean).join("|");
    if (svc.labor[key] != null) return svc.labor[key];
  }
  return 0;
}

const LEAD_SOURCES = ["WhatsApp", "Signal", "Shopify", "Instagram", "Other"];
// Active sales agents (edit here to add/remove)
const SALES_AGENTS = ["Alaa", "Hussain", "Ali"];
// Suppliers for "other services" parts (editable; agent can also type a custom one)
const OTHER_SUPPLIERS = [
  "Alamdar", "Hitish", "Korean Store", "Ahlia", "Porsche Dealer", "Al Babtain Group",
  "Istiqlal", "Motul", "Mercedes Benz Dealer", "Super Shine", "BMW Dealer", "BNCHR+ Inventory",
  "Grip Autos", "Safeena", "Customer",
];
const ROLES = [
  { key: "sales", label: "Sales" },
  { key: "purchaser", label: "Purchaser" },
  { key: "technician", label: "Technician" },
  { key: "distributor", label: "Distributor" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().split("T")[0];
// Revenue is recognized on the SALE DATE (day the order was placed).
// Falls back to the scheduled/created day for pre-sale_date historical orders.
const saleDateOf = (j) => {
  if (j.sale_date) return j.sale_date;
  const s = j.scheduled_at || j.created_at;
  if (!s) return "";
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }) : "—";
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "—";
const fmtDateTime = (d) => d ? `${fmtDate(d)} ${fmtTime(d)}` : "—";
// Display vocabulary is deliberately simple — Booked / Started / Successful —
// while the internal status keys keep driving the workflow underneath
// (part_ready for the distributor, invoiced/paid for accounting, etc.).
const STATUS_DISPLAY = {
  draft:      { label: "Booked",     color: "#64748B" },
  booked:     { label: "Booked",     color: "#64748B" },
  part_ready: { label: "Booked",     color: "#64748B" },
  assigned:   { label: "Booked",     color: "#64748B" },
  en_route:   { label: "Started",    color: "#EA580C" },
  on_site:    { label: "Started",    color: "#EA580C" },
  done:       { label: "Successful", color: "#15803D" },
  invoiced:   { label: "Successful", color: "#15803D" },
  paid:       { label: "Successful", color: "#15803D" },
};
const statusMeta = (key) => key === "cancelled"
  ? { key: "cancelled", label: "Cancelled", color: "#DC2626" }
  : key === "incomplete"
  ? { key: "incomplete", label: "Incomplete", color: "#B45309" }
  : { key: key || "booked", ...(STATUS_DISPLAY[key] || STATUS_DISPLAY.booked) };
const nextStatus = (key) => {
  const idx = STATUS_FLOW.findIndex((s) => s.key === key);
  return idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
};

// ─── Tire Catalog (READ-ONLY from shared tires table) ─────────────────────────
const MOCK_TIRES = [
  { id: "mt-1", brand: "Michelin", pattern: "Pilot Sport 4", width: 215, aspect: 60, rim: 16, year: "2025", price: 38, cost: 28, supplier: "Kuwait Automotive", country: "Japan", in_stock: true },
  { id: "mt-2", brand: "Pirelli", pattern: "P Zero", width: 295, aspect: 40, rim: 21, year: "2025", price: 95, cost: 70, supplier: "Behbehani (Pirelli)", country: "Germany", in_stock: true },
  { id: "mt-3", brand: "Michelin", pattern: "Primacy", width: 275, aspect: 55, rim: 20, year: "2024", price: 55, cost: 42, supplier: "Kuwait Automotive", country: "USA", in_stock: false },
  { id: "mt-4", brand: "RoadX", pattern: "RXMotion", width: 225, aspect: 55, rim: 18, year: "2026", price: 32, cost: 20, supplier: "Abbas Ghuloom", country: "China", in_stock: true },
];
const tireSize = (t) => {
  // Prefer an explicit size string if the catalog provides one (handles flotation
  // sizes like "33x12.50R17" that don't fit the metric width/aspect/rim model).
  if (t.size && String(t.size).trim()) return String(t.size).trim();
  // Flotation stored numerically (diameter present, no aspect): "33x12.50R17"
  if (t.diameter && t.section && t.rim) return `${t.diameter}x${t.section}R${t.rim}`;
  // Standard metric fallback
  return `${t.width}/${t.aspect}R${t.rim}`;
};
// Full tire spec string from an item/record: "275/35R21 103Y · 2024 · Germany"
const liSr = (li, sr) => (li || sr) ? ` ${li || ""}${sr || ""}` : "";
const itemSpec = (it) => [`${it.size || ""}${liSr(it.load_index, it.speed_rating)}`.trim(), it.oem, it.year, it.country, it.tire_note].filter(Boolean).join(" · ");
const uid = () => `it-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const itemsTotal = (items) => (items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);

// shared inline style objects (defined early — const is not hoisted)
const miniLabel = { fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", display: "block", marginBottom: 5 };
const slotCellBase = { border: "1px solid var(--border)", padding: "8px 6px", textAlign: "center" };

// ─── Truck Day View: single-column timeline for ONE truck on a date ───────────
// Pick truck + date → see that truck's working hours, booked slots filled,
// free slots tappable. A job spans `duration` consecutive hours from the start.
function TruckDayView({ jobs, truck, dateStr, duration, selectedHour, onPick, excludeId, onJobClick, overtime }) {
  if (!truck || !TRUCK_CONFIG[truck]) {
    return <div style={{ fontSize: 13, color: "var(--muted)", padding: "12px 0" }}>Select a truck to see its schedule.</div>;
  }
  const hours = overtime ? truckHoursWithOT(truck) : truckHours(truck);

  const canFit = (hour) => {
    for (let h = hour; h < hour + duration; h++) {
      if (!hours.includes(h)) return false;
      if (slotTaken(jobs, truck, dateStr, h, excludeId)) return false;
    }
    return true;
  };
  const inSelection = (hour) => selectedHour != null && hour >= selectedHour && hour < selectedHour + duration;

  const jobAt = (hour) => jobs.find(j => {
    if (j.id === excludeId) return false;
    if (j.status === "cancelled") return false; // a cancelled order must never shadow the live booking in its old slot
    if (j.assigned_truck !== truck) return false;
    const d = j.scheduled_at ? new Date(j.scheduled_at).toISOString().split("T")[0] : "";
    if (d !== dateStr) return false;
    return jobHours(j).includes(hour);
  });

  const c = TRUCK_CONFIG[truck];
  let dividerDrawn = { early: false, late: false };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontFamily: "var(--font-head)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: truckColor(truck).solid, display: "inline-block" }} />
          {truck} <span style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>· {hourLabel(TRUCK_CONFIG[truck].start)}–{hourLabel(TRUCK_CONFIG[truck].end)}</span>
        </div>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Selecting {duration}h</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {hours.map(hour => {
          const ot = isOTHour(truck, hour);
          // Divider labels before the first early-OT row and before the first late-OT row
          let dividerLabel = null;
          if (ot && hour < c.start && !dividerDrawn.early) { dividerDrawn.early = true; dividerLabel = "⏱ Overtime — early"; }
          if (ot && hour >= c.end && !dividerDrawn.late) { dividerDrawn.late = true; dividerLabel = "⏱ Overtime — late"; }

          const taken = slotTaken(jobs, truck, dateStr, hour, excludeId);
          const sel = inSelection(hour);
          const fits = canFit(hour);
          const occ = taken ? jobAt(hour) : null;
          const tc = truckColor(truck);
          let bg = "#fff", color = "var(--text)", cursor = "pointer", border = "1px solid var(--border)", borderLeft = null, shadow = "none";
          let right = "Free", rightColor = "var(--muted)";
          if (taken) { bg = tc.bg; color = tc.text; cursor = onJobClick ? "pointer" : "not-allowed"; border = "1px solid transparent"; borderLeft = `3px solid ${tc.solid}`; right = occ ? slotLabel(occ, " · ") : "Booked"; rightColor = tc.text; }
          else if (sel) { bg = "var(--accent)"; color = "#fff"; border = "1px solid var(--accent)"; right = "Selected ✓"; rightColor = "rgba(255,255,255,.9)"; shadow = "0 2px 8px rgba(0,0,0,.15)"; }
          else if (!fits) { bg = ot ? "#FFFBEB" : "#FAFAF8"; color = "#B49A6A"; cursor = "not-allowed"; border = "1px dashed #E8D9B5"; right = "—"; rightColor = "#C9B687"; }
          else if (ot) { bg = "#FFFBEB"; color = "#92400E"; border = "1px dashed #F59E0B"; right = "Free"; rightColor = "#B45309"; }
          return (
            <div key={hour}>
              {dividerLabel && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 4px" }}>
                  <div style={{ height: 1, flex: 1, background: "#FDE68A" }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#B45309", textTransform: "uppercase", letterSpacing: ".5px" }}>{dividerLabel}</span>
                  <div style={{ height: 1, flex: 1, background: "#FDE68A" }} />
                </div>
              )}
              <div
                onClick={() => { if (taken) { if (occ && onJobClick) onJobClick(occ); } else if (fits) onPick(truck, hour); }}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", borderRadius: 10, background: bg, color, cursor, border, borderLeft, boxShadow: shadow, fontSize: 13, fontWeight: sel ? 700 : 500 }}>
                <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  {hourLabel(hour)}
                  {ot && <span style={{ fontSize: 8, background: "#F59E0B", color: "#fff", padding: "1px 5px", borderRadius: 4, fontWeight: 700, letterSpacing: ".3px" }}>OT</span>}
                </span>
                <span style={{ fontSize: 12, color: rightColor, fontWeight: taken ? 600 : 500 }}>{right}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
        Tap a green slot to start a {duration}h job. {overtime ? "Amber = overtime hours (outside normal). " : ""}Red = booked, faded = not enough consecutive free hours.
      </div>
    </div>
  );
}

// ─── Truck selector pills ─────────────────────────────────────────────────────
function TruckPills({ value, onChange }) {
  // pick black/white text for best contrast on a given hex bg
  const readableOn = (hex) => {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return L > 0.6 ? "#1A1A1A" : "#FFFFFF";
  };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {activeTrucks().map(t => {
        const c = truckColor(t);
        const active = value === t;
        return (
          <button key={t} type="button" onClick={() => onChange(t)}
            className="btn btn-sm"
            style={{
              minWidth: 96,
              background: active ? c.solid : c.bg,
              color: active ? readableOn(c.solid) : c.text,
              border: `2px solid ${c.solid}`,
              boxShadow: active ? "0 2px 6px rgba(0,0,0,.18)" : "none",
              transform: active ? "translateY(-1px)" : "none",
              fontWeight: active ? 700 : 600,
            }}>
            {active ? "✓ " : ""}{t} <span style={{ fontSize: 10, opacity: active ? .9 : .85, marginLeft: 4 }}>{hourLabel(TRUCK_CONFIG[t].start).replace(":00","")}–{hourLabel(TRUCK_CONFIG[t].end).replace(":00","")}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Reschedule Modal ─────────────────────────────────────────────────────────
function RescheduleModal({ job, jobs, onClose, onSaved }) {
  const [truck, setTruck] = useState(job.assigned_truck || activeTrucks()[0]);
  const [dateStr, setDateStr] = useState(job.scheduled_date || (job.scheduled_at ? new Date(job.scheduled_at).toISOString().split("T")[0] : today()));
  const [duration, setDuration] = useState(Number(job.duration) || 1);
  const [startHour, setStartHour] = useState(null);
  const [overtime, setOvertime] = useState(!!job.is_overtime);
  const [saving, setSaving] = useState(false);

  const midJob = job.truck_status === "processing" || job.truck_status === "completed";

  const pick = (tk, hour) => { setTruck(tk); setStartHour(hour); };

  const save = async () => {
    if (startHour == null) return;
    setSaving(true);
    const scheduledAt = new Date(`${dateStr}T${String(startHour).padStart(2, "0")}:00:00`);
    const patch = {
      assigned_truck: truck, start_hour: startHour, duration,
      scheduled_date: dateStr, scheduled_at: scheduledAt.toISOString(),
      is_overtime: isOTHour(truck, startHour),
    };
    await updateJob(job.id, patch);
    onSaved({ ...job, ...patch });
    setSaving(false);
    onClose();
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3>Reschedule — {job.customer_name}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {midJob && (
            <div style={{ background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#92400E", marginBottom: 12 }}>
              ⚠ This job is already <strong>{job.truck_status}</strong>. Rescheduling now is unusual — proceed only if you're sure.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={miniLabel}>Truck</label>
              <TruckPills value={truck} onChange={(t) => { setTruck(t); setStartHour(null); }} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={miniLabel}>Date</label>
                <input type="date" className="filter-input" style={{ width: "100%" }} value={dateStr} onChange={e => { setDateStr(e.target.value); setStartHour(null); }} />
              </div>
              <div style={{ width: 120 }}>
                <label style={miniLabel}>Duration</label>
                <select className="filter-input" style={{ width: "100%" }} value={duration} onChange={e => { setDuration(Number(e.target.value)); setStartHour(null); }}>
                  {[1, 2, 3].map(d => <option key={d} value={d}>{d} hour{d > 1 ? "s" : ""}</option>)}
                </select>
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: overtime ? "#B45309" : "var(--text)" }}>
              <input type="checkbox" checked={overtime} onChange={e => { setOvertime(e.target.checked); setStartHour(null); }} />
              ⏱ Overtime — unlock early/late slots
            </label>
            <TruckDayView jobs={jobs} truck={truck} dateStr={dateStr} duration={duration} selectedHour={startHour} onPick={pick} excludeId={job.id} overtime={overtime} />
            {startHour != null && (
              <div style={{ fontSize: 13, fontWeight: 600, color: isOTHour(truck, startHour) ? "#B45309" : "var(--success)" }}>
                ✓ New: {truck} · {hourLabel(startHour)}–{hourLabel(startHour + duration)} on {dateStr}
                {isOTHour(truck, startHour) && <span style={{ fontSize: 11, background: "#F59E0B", color: "#fff", padding: "1px 6px", borderRadius: 4, marginLeft: 6 }}>OVERTIME</span>}
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={startHour == null || saving}>{saving ? "Saving…" : "Save New Time"}</button>
        </div>
      </div>
    </div>
  );
}

async function fetchQuotes(mobile) {
  const raw = (mobile || "").trim();
  if (raw.length < 4) return [];
  const digits = raw.replace(/\D/g, "");
  // Real mobiles match on their last 8 digits; alphanumeric entries
  // (test data, odd formats) fall back to a raw case-insensitive contains.
  const pattern = digits.length >= 6 ? `*${digits.slice(-8)}*` : `*${raw}*`;
  try {
    const d = await sb(`/quotes?customer_mobile=ilike.${encodeURIComponent(pattern)}&order=created_at.desc&limit=10&select=*`);
    return d || [];
  } catch { return []; }
}
// ─── Quotes dashboard helpers (shared quotes table from the Tire System) ──────
const last8 = (m) => (m || "").replace(/\D/g, "").slice(-8);
// Per-customer conversion: several quotes to one customer count once.
// A customer converts if ANY of their quotes succeeded.
const customerConv = (list, isSuccess) => {
  const by = {};
  list.forEach(q => {
    const k = last8(q.customer_mobile) || q.id;
    by[k] = by[k] || false;
    if (isSuccess(q)) by[k] = true;
  });
  const keys = Object.keys(by);
  const won = keys.filter(k => by[k]).length;
  return { customers: keys.length, won, pct: keys.length ? Math.round((won / keys.length) * 100) : 0 };
};
const quoteAge = (d) => {
  const h = (Date.now() - new Date(d).getTime()) / 36e5;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
// Estimated tires-only value of a quote (cheapest option × qty; staggered = F+R pairs)
function quoteValue(q) {
  if (q.kind === "service") {
    const labor = Number(q.labor) || 0, disc = Number(q.discount) || 0;
    if (Array.isArray(q.services) && q.services.length) {
      const batteryOnly = q.services.length === 1 && q.services[0].type === "Battery" && (q.services[0].lines || []).length > 1;
      if (batteryOnly) {
        const b = q.services[0];
        return Math.max(...b.lines.map(l => (Number(l.qty) || 1) * (Number(l.unit_price) || 0))) + (Number(b.labor) || 0) - disc;
      }
      return q.services.reduce((s, b) =>
        s + (b.lines || []).reduce((x, l) => x + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0) + (Number(b.labor) || 0), 0) - disc;
    }
    if (q.service_type === "Battery" && (q.lines || []).length > 1) {
      // batteries are ALTERNATIVES: pipeline value = the best single option (battery + labor)
      return Math.max(...q.lines.map(l => (Number(l.qty) || 1) * (Number(l.unit_price) || 0))) + labor - disc;
    }
    const prods = (q.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
    return prods + labor - disc;
  }
  if (q.staggered) {
    const opts = staggeredOptions(q);
    const cheapest = opts.reduce((a, b) => (b.price < a.price ? b : a), opts[0] || { price: 0 });
    const f = cheapest.front;
    const r = cheapest.rear;
    return (Number(f?.price) || 0) * 2 + (Number(r?.price) || 0) * 2;
  }
  const prices = (q.lines || []).map(l => Number(l.price) || 0).filter(p => p > 0);
  return (prices.length ? Math.min(...prices) : 0) * (Number(q.qty) || 4);
}
// Find the order that converted a quote: same mobile, created after the quote
// (1h grace). Strongest match = an order containing one of the quoted tires.
function quoteBookingMatch(quote, jobs) {
  const qm = last8(quote.customer_mobile);
  if (!qm) return null;
  const after = new Date(quote.created_at).getTime() - 3600000;
  const qTireIds = new Set((quote.lines || []).map(l => String(l.tire_id)).filter(Boolean));
  const candidates = jobs.filter(j =>
    j.status !== "cancelled" &&
    last8(j.customer_mobile) === qm &&
    new Date(j.created_at || j.scheduled_at || 0).getTime() >= after
  );
  const strong = candidates.find(j => (j.items || []).some(it => it.tire_id && qTireIds.has(String(it.tire_id))));
  return strong || candidates[0] || null;
}
// Pair a staggered quote's lines into options: fronts[i] + rears[i].
// (Tire System stores fronts then rears in option order; no explicit pairing field.)
function staggeredOptions(q) {
  const fronts = (q.lines || []).filter(l => l.position === "front");
  const rears = (q.lines || []).filter(l => l.position === "rear");
  const n = Math.max(fronts.length, rears.length, 1);
  const opts = [];
  for (let i = 0; i < n; i++) {
    const f = fronts[i] || fronts[0], r = rears[i] || rears[0];
    opts.push({ front: f, rear: r, price: (Number(f?.price) || 0) + (Number(r?.price) || 0) });
  }
  return opts;
}
// Build an order service block from a quote line (line optional; staggered uses F+R)
function quoteToService(q, line) {
  // Service quotes (from the Tire System's Service Quote page).
  // Multi-service quotes (q.services array) return an ARRAY of service blocks.
  if (q.kind === "service") {
    const buildBlock = (type, variant, blines, labor, discount) => {
      let svcType = type && SERVICE_CATALOG[type] ? type : null;
      if (!svcType) {
        const catCount = {};
        blines.forEach(l => { catCount[l.category] = (catCount[l.category] || 0) + 1; });
        const domCat = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a])[0] || "other";
        const brakeType = String((blines.find(l => l.category === "brake") || {}).name || "").toLowerCase();
        const typeMap = {
          battery: "Battery",
          engine_oil: "Oil & Filter", filter: "Oil & Filter",
          brake: brakeType.includes("disc") ? "Brake Disc" : "Brake Pads",
          spark_plug: "Spark Plugs",
          fluid: "Part Replacement", other: "Part Replacement",
        };
        svcType = SERVICE_CATALOG[typeMap[domCat]] ? typeMap[domCat] : "Part Replacement";
      }
      const svc = newService(svcType);
      if (variant) Object.entries(variant).forEach(([axis, val]) => {
        // quote sides use Front/Rear/Front & Rear; the order form's brake variants use One/Two sides
        let v = val;
        if (axis === "sides" && (svcType === "Brake Pads" || svcType === "Brake Disc")) {
          v = val === "Front & Rear" ? "Two sides" : (val === "Front" || val === "Rear") ? "One side" : val;
        }
        if ((SERVICE_CATALOG[svcType]?.variants || {})[axis]?.includes(v)) svc.variant[axis] = v;
      });
      svc.parts = blines.map(l => ({ id: uid(), name: l.name || l.sku || "", supplier: "", qty: Number(l.qty) || 1, price: Number(l.unit_price) || 0, cost: 0, sku: l.sku || "", product_id: l.product_id || null }));
      svc.labor = Number(labor) || catalogLabor(svcType, svc.variant, 1);
      if (Number(discount) > 0) svc.price_disc = { type: "amt", value: Number(discount) };
      return svc;
    };
    if (Array.isArray(q.services) && q.services.length) {
      const batteryOnly = q.services.length === 1 && q.services[0].type === "Battery";
      return q.services.map((b, i) => buildBlock(
        b.type, b.variant,
        (batteryOnly && line) ? [line] : (b.lines || []), // chosen battery option carries only that battery
        b.labor,
        i === 0 ? q.discount : 0, // quote-level discount applied once
      ));
    }
    // legacy flat single-service quotes
    const lines = (q.service_type === "Battery" && line) ? [line] : (q.lines || []);
    return buildBlock(q.service_type, q.variant, lines, q.labor, q.discount);
  }
  const svc = newService("Tire Change & Balancing");
  const fillFront = (ln) => ln && Object.assign(svc, { tire_id: ln.tire_id, brand: ln.brand, pattern: ln.pattern, size: ln.size, year: ln.year || "", unit_price: Number(ln.price) || 0 });
  if (q.staggered) {
    // line may be a chosen {front, rear} option; else default to the first pair
    const opt = (line && line.front) ? line : staggeredOptions(q)[0];
    const front = opt.front, rear = opt.rear;
    svc.staggered = true; fillFront(front);
    svc.qty = 2; svc.rear_qty = 2;
    if (rear) Object.assign(svc, { rear_tire_id: rear.tire_id, rear_brand: rear.brand, rear_pattern: rear.pattern, rear_size: rear.size, rear_year: rear.year || "", rear_unit_price: Number(rear.price) || 0 });
    svc.labor = catalogLabor(svc.service_type, svc.variant, 4);
  } else {
    fillFront(line || (q.lines || [])[0]);
    svc.qty = Number(q.qty) || 4;
    svc.labor = catalogLabor(svc.service_type, svc.variant, svc.qty);
  }
  return svc;
}
const MOCK_QUOTES = [
  { id: "mq-1", customer_mobile: "99001234", agent: "Hussain", qty: 4, staggered: false, cash_pct: 0,
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    lines: [
      { tire_id: "mt-1", brand: "Michelin", pattern: "Pilot Sport 4", size: "215/60R16", year: "2025", price: 38 },
      { tire_id: "mt-4", brand: "RoadX", pattern: "RXMotion", size: "225/55R18", year: "2026", price: 32 },
    ] },
  { id: "mq-2", customer_mobile: "55112233", agent: "Alaa", qty: 4, staggered: false, cash_pct: 2,
    created_at: new Date(Date.now() - 3600000 * 30).toISOString(),
    lines: [ { tire_id: "mt-3", brand: "Michelin", pattern: "Primacy", size: "275/55R20", year: "2024", price: 55 } ] },
  { id: "mq-3", customer_mobile: "51234567", agent: "Alaa", qty: 2, staggered: true, cash_pct: 0,
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    lines: [
      { position: "front", tire_id: "mt-2", brand: "Pirelli", pattern: "P Zero", size: "295/40R21", year: "2025", price: 95 },
      { position: "rear", tire_id: "mt-2", brand: "Pirelli", pattern: "P Zero", size: "305/35R21", year: "2025", price: 98 },
    ] },
  { id: "mq-4", customer_mobile: "60998877", agent: "Hussain", qty: 4, staggered: false, cash_pct: 0,
    status: "lost", lost_reason: "RR1-High Price", lost_at: new Date(Date.now() - 3600000 * 20).toISOString(),
    created_at: new Date(Date.now() - 3600000 * 60).toISOString(),
    lines: [ { tire_id: "mt-2", brand: "Pirelli", pattern: "P Zero", size: "295/40R21", year: "2025", price: 95 } ] },
];
// ─── Quote lifecycle: status, follow-up cadence, lost reasons ─────────────────
// Lost reasons — RR labels mirror Trengo; used for the "why we lose" breakdown.
const LOST_REASONS = [
  "RR1-High Price",
  "RR2-Time",
  "RR3-Brand NA or Old",
  "RR4-Postpone - Inquiry only",
  "Bought elsewhere",
  "No answer",
  "Changed mind",
];
async function updateQuote(id, patch) {
  try { await sb(`/quotes?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify(patch) }); } catch {}
}
// Effective status of a quote. Stamped status wins; legacy quotes without a
// stamp fall back to the derived order match (same mobile + after quote).
function quoteStatus(q, jobs) {
  const st = q.status || "open";
  if (st === "success" || st === "booked") {
    const job = (jobs || []).find(j => j.id === q.booked_job_id) || quoteBookingMatch(q, jobs || []);
    return { status: "success", job };
  }
  if (st === "lost") return { status: "lost", job: null };
  const job = quoteBookingMatch(q, jobs || []);
  return job ? { status: "success", job } : { status: "open", job: null };
}
// Follow-up cadence: 24h after quote → 3d after 1st contact → 7d after 2nd/3rd.
// Manual snooze (followup_at) overrides the ladder. suggestLost after 3 touches.
const FOLLOWUP_STEPS_H = [24, 72, 168];
function followupState(q, status) {
  if ((status || q.status || "open") !== "open") return { due: false, suggestLost: false, snoozed: false };
  const n = Number(q.followup_count) || 0;
  if (q.followup_at) {
    const due = Date.now() >= new Date(q.followup_at).getTime();
    return { due, suggestLost: due && n >= 3, snoozed: !due };
  }
  const anchor = q.last_contact_at || q.created_at;
  const stepH = FOLLOWUP_STEPS_H[Math.min(n, FOLLOWUP_STEPS_H.length - 1)];
  const due = Date.now() >= new Date(anchor).getTime() + stepH * 3600000;
  return { due, suggestLost: due && n >= 3, snoozed: false };
}
async function fetchAllQuotes() {
  try { const d = await sbAll("/quotes?select=*&order=created_at.desc,id.asc"); return d || []; }
  catch { return MOCK_QUOTES; }
}
async function fetchTireById(id) {
  const SELECTS = [
    // matches the real Tire System table exactly (verified 2026-07-06)
    "id,brand,pattern,type,width,aspect,structure,rim,load_index,speed_rating,country,year,cost,price,sku,supplier,notes,in_stock",
    "id,brand,pattern,width,aspect,rim,year,price,cost,supplier,country,in_stock",
  ];
  for (const sel of SELECTS) {
    try { const d = await sb(`/tires?id=eq.${encodeURIComponent(id)}&select=${sel}&limit=1`); if (d && d[0]) return d[0]; } catch {}
  }
  return MOCK_TIRES.find(t => String(t.id) === String(id)) || null;
}
async function searchTires(q) {
  const term = (q || "").trim();
  if (term.length < 2) return [];
  try {
    const m = term.match(/(\d{3})\s*\/?\s*(\d{2})?\s*r?\s*(\d{2})?/i);
    const SELECTS = [
      // matches the real Tire System table exactly (verified 2026-07-06)
      "id,brand,pattern,type,width,aspect,structure,rim,load_index,speed_rating,country,year,cost,price,sku,supplier,notes,in_stock",
      "id,brand,pattern,width,aspect,rim,year,price,cost,supplier,country,load_index,speed_rating,in_stock",
      "id,brand,pattern,width,aspect,rim,year,price,cost,supplier,country,in_stock",
    ];
    let path = `/tires?select=${SELECTS[0]}&limit=40`;
    if (m && m[1]) {
      path += `&width=eq.${m[1]}`;
      if (m[2]) path += `&aspect=eq.${m[2]}`;
      if (m[3]) path += `&rim=eq.${m[3]}`;
    } else {
      path += `&or=(brand.ilike.*${term}*,pattern.ilike.*${term}*)`;
    }
    path += "&order=price.asc";
    let d = null;
    for (const sel of SELECTS) { // live table may not have every spec column — degrade gracefully
      try { d = await sb(path.replace(SELECTS[0], sel)); break; } catch {}
    }
    return d && d.length ? d : MOCK_TIRES.filter(x => (`${x.brand} ${x.pattern} ${tireSize(x)}`).toLowerCase().includes(term.toLowerCase()));
  } catch {
    const t = term.toLowerCase();
    return MOCK_TIRES.filter(x => (`${x.brand} ${x.pattern} ${tireSize(x)}`).toLowerCase().includes(t));
  }
}

// ─── Truck config (active trucks + working hours, 24h) ────────────────────────
let TRUCK_CONFIG = {
  T1: { start: 11, end: 19 },
  T2: { start: 12, end: 20 },
  T4: { start: 13, end: 21 },
};
let TRUCK_ORDER = ["T1", "T2", "T4"];
const activeTrucks = () => TRUCK_ORDER.filter(t => TRUCK_CONFIG[t]);

// ─── App settings (app_settings key/value) ───
async function fetchAppSettings() {
  try {
    const rows = await sbAll("/app_settings?select=*");
    const out = {};
    (rows || []).forEach(r => { out[r.key] = r.value; });
    return out;
  } catch { return {}; }
}
async function saveAppSetting(key, value) {
  try {
    await sb("/app_settings?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });
    return true;
  } catch { return false; }
}

// ─── Technician incentive engine ───
// Scheme: 0.250 KD/order/person · upsell-converted ×4 (=1.000) · order that GETS a
// revisit → voided (and the revisit visit itself earns 0) · pot accrues from order #1
// but UNLOCKS at the truck's monthly target (100 base · 150 if 2 trucks · 180 if 1;
// = the company's break-even line) · four KWD 5 bonuses.
const INCENT = { perOrder: 0.25, upsellRate: 1.0, bonusKD: 5, maxCapacity: 200 };
const incentiveTarget = (nActive) => nActive >= 3 ? 100 : nActive === 2 ? 150 : 180;
function computeIncentives(jobs, refDate) {
  const y = refDate.getFullYear(), m = refDate.getMonth();
  const inMonth = (iso) => { if (!iso) return false; const d = new Date(iso); return d.getFullYear() === y && d.getMonth() === m; };
  const doneAt = (j) => j.completed_at || j.scheduled_at || j.created_at;
  const done = jobs.filter(j => jobSuccessful(j) && inMonth(doneAt(j)));
  const revisitedParents = new Set(jobs.filter(j => j.link_type === "revisit" && j.parent_job_id).map(j => j.parent_job_id));
  const byId = new Map(jobs.map(j => [j.id, j]));
  const trucks = activeTrucks();
  const target = incentiveTarget(trucks.length);
  const rows = trucks.map(t => {
    const tj = done.filter(j => j.assigned_truck === t);
    let pot = 0, base = 0, ups = 0, voided = 0;
    tj.forEach(j => {
      if (j.link_type === "revisit" || revisitedParents.has(j.id)) { voided++; return; }
      if (j.link_type === "upsell") { ups++; pot += INCENT.upsellRate; }
      else { base++; pot += INCENT.perOrder; }
    });
    const revenue = tj.reduce((sm, j) => sm + (Number(j.total) || 0), 0);
    const cost = tj.reduce((sm, j) => sm + (j.items || []).reduce((x, it) => x + (Number(it.cost) || 0) * (Number(it.qty) || 1), 0), 0);
    const reviews = tj.map(j => Number(j.review_rating)).filter(r => r >= 1);
    const revisitsCaused = jobs.filter(j => j.link_type === "revisit" && inMonth(j.created_at) && (byId.get(j.parent_job_id) || {}).assigned_truck === t).length;
    return {
      truck: t, orders: tj.length, base, ups, voided,
      pot: Math.round(pot * 1000) / 1000,
      unlocked: tj.length >= target,
      revenue, profit: revenue - cost,
      avgReview: reviews.length ? Math.round((reviews.reduce((a, b) => a + b, 0) / reviews.length) * 100) / 100 : null,
      nReviews: reviews.length, revisitsCaused,
    };
  });
  // KWD 5 bonus leaders (ties: everyone tied wins the flag; zero-revisit = all with 0)
  const flag = (key, best) => rows.forEach(r => { r[key] = best != null && rows.length > 1 ? best(r) : false; });
  const maxOrders = Math.max(...rows.map(r => r.orders), 0);
  const maxProfit = Math.max(...rows.map(r => r.profit), 0);
  const maxReview = Math.max(...rows.map(r => r.avgReview || 0), 0);
  flag("bonusOrders", r => maxOrders > 0 && r.orders === maxOrders);
  flag("bonusProfit", r => maxProfit > 0 && r.profit === maxProfit);
  flag("bonusReview", r => maxReview > 0 && (r.avgReview || 0) === maxReview);
  flag("bonusZeroRevisit", r => r.orders > 0 && r.revisitsCaused === 0);
  return { target, rows, trucksActive: trucks.length };
}
async function fetchTruckConfig() {
  try {
    const rows = await sbAll("/truck_config?select=*&order=sort_order.asc");
    if (rows && rows.length) {
      const cfg = {}, order = [];
      rows.forEach(r => { order.push(r.truck); if (r.active) cfg[r.truck] = { start: Number(r.start_hour), end: Number(r.end_hour) }; });
      TRUCK_CONFIG = cfg; TRUCK_ORDER = order;
      const pw = {};
      rows.forEach(r => { if (r.password) pw[r.truck] = r.password; });
      if (Object.keys(pw).length) TRUCK_PASSWORDS = { ...TRUCK_PASSWORDS, ...pw };
    }
    return rows || [];
  } catch { return []; }
}
async function saveTruckConfig(truck, patch) {
  try { await sb(`/truck_config?truck=eq.${truck}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) }); return true; }
  catch (e) { alert("Could not save truck settings: " + (e.message || e)); return false; }
}
async function addTruckConfig(row) {
  try { await sb("/truck_config", { method: "POST", prefer: "return=minimal", body: JSON.stringify(row) }); return true; }
  catch (e) { alert("Could not add truck: " + (e.message || e)); return false; }
}

// Truck colors (all 6 defined; only active trucks render). { solid, bg, text }
const TRUCK_COLORS = {
  T1: { solid: "#C9A227", bg: "#FAF6E9", text: "#7A6212" }, // yellow (muted gold)
  T2: { solid: "#D98A4E", bg: "#FBF0E8", text: "#8A4F25" }, // orange (muted terracotta)
  T3: { solid: "#5B9A6E", bg: "#EDF5EF", text: "#3A6249" }, // green (muted sage)
  T4: { solid: "#5B7FB0", bg: "#EDF1F7", text: "#3A5378" }, // blue (muted slate-blue)
  T5: { solid: "#8E7BB0", bg: "#F2EFF7", text: "#5C4D78" }, // purple (muted lavender)
  T6: { solid: "#C06C6C", bg: "#F8EDED", text: "#8A4444" }, // red (muted clay)
};
const truckColor = (t) => TRUCK_COLORS[t] || { solid: "#64748B", bg: "#F1F5F9", text: "#334155" };

// Hour label e.g. 13 -> "1:00 PM"
const hourLabel = (h) => {
  const am = h < 12 || h === 24;
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${am ? "AM" : "PM"}`;
};
// All hours a truck works (array of integers)
const truckHours = (truck) => {
  const c = TRUCK_CONFIG[truck];
  if (!c) return [];
  const out = [];
  for (let h = c.start; h < c.end; h++) out.push(h);
  return out;
};

// Overtime window: up to 3h before normal start, up to 4h after normal end.
const OT_BEFORE = 3, OT_AFTER = 4;
const truckOTHours = (truck) => {
  const c = TRUCK_CONFIG[truck];
  if (!c) return { early: [], late: [] };
  const early = [];
  for (let h = Math.max(0, c.start - OT_BEFORE); h < c.start; h++) early.push(h);
  const late = [];
  for (let h = c.end; h < Math.min(24, c.end + OT_AFTER); h++) late.push(h);
  return { early, late };
};
// Full bookable hours when overtime is enabled.
const truckHoursWithOT = (truck) => {
  const ot = truckOTHours(truck);
  return [...ot.early, ...truckHours(truck), ...ot.late];
};
// Is a given hour outside the truck's normal hours?
const isOTHour = (truck, hour) => {
  const c = TRUCK_CONFIG[truck];
  if (!c) return false;
  return hour < c.start || hour >= c.end;
};

// ─── Labor (mirror of Tire System — keep in sync via shared contract) ─────────
// Standard wheels vs center-lock (Porsche GT3 etc., torque wrench).
// ─── Slot helpers ─────────────────────────────────────────────────────────────
// A job occupies `duration` consecutive hours on its truck starting at start_hour.
// Returns the set of hours a job covers.
const jobHours = (job) => {
  const start = Number(job.start_hour);
  const dur = Number(job.duration) || 1;
  if (!start && start !== 0) return [];
  const out = [];
  for (let h = start; h < start + dur; h++) out.push(h);
  return out;
};
// Is a given truck+hour taken on a given date by any existing job (excluding one id)?
const slotTaken = (jobs, truck, dateStr, hour, excludeId) => {
  return jobs.some(j => {
    if (j.id === excludeId) return false;
    if (j.status === "cancelled") return false;
    if (j.assigned_truck !== truck) return false;
    const d = j.scheduled_at ? new Date(j.scheduled_at).toISOString().split("T")[0] : "";
    if (d !== dateStr) return false;
    return jobHours(j).includes(hour);
  });
};
// Short service label for tight slot cells
const shortService = (s) => {
  if (!s) return "Service";
  if (/patch/i.test(s)) return "Patch";
  if (/rotation/i.test(s)) return "Rotation";
  if (/tire/i.test(s)) return "Tires";
  if (/oil/i.test(s)) return "Oil";
  if (/battery/i.test(s)) return "Battery";
  if (/brake/i.test(s)) return "Brakes";
  if (/disc skim/i.test(s)) return "Skim";
  if (/disc/i.test(s)) return "Disc";
  if (/align/i.test(s)) return "Align";
  if (/major/i.test(s)) return "Major";
  if (/ac gas/i.test(s)) return "AC Gas";
  if (/computer/i.test(s)) return "Computer";
  if (/tune/i.test(s)) return "Tune-up";
  return s.length > 10 ? s.slice(0, 10) + "…" : s;
};
// Booked-slot label: service · mobile · area
const slotLabel = (j, sep) => [shortService(j.service_type), j.customer_mobile || "", j.area || ""].filter(Boolean).join(sep);
// Compact items summary for list rows: "4× Michelin Pilot Sport 4 · Oil & Filter"
const itemsSummary = (job) => {
  const items = job.items || [];
  if (!items.length) return job.service_details || "";
  return items.map(it => {
    const qty = Number(it.qty) || 1;
    const name = it.kind === "tire" ? `${it.brand}${it.pattern ? " " + it.pattern : ""}` : (it.name || "Item");
    return `${qty}× ${name}`;
  }).join(" · ");
};

// ─── Address → Google Maps link ──────────────────────────────────────────────
// Build a Maps search URL from Kuwait address parts. Used to auto-fill map_link.
function buildMapsLink(addr) {
  if (!addr) return "";
  const isNum = (v) => /^\s*\d+\s*$/.test(String(v || ""));
  // Kuwait geocodes best by Area + Block (real units Maps knows). Lead with those,
  // include the governorate + Kuwait for region lock. Named streets help; numbered
  // streets ("Street 33") and house numbers don't resolve, so we omit/de-emphasize them.
  const parts = [];
  if (addr.area) parts.push(addr.area);
  if (addr.block) parts.push(`Block ${addr.block}`);
  // include the street only if it's a NAME (not a bare number Maps can't use)
  if (addr.street && !isNum(addr.street)) parts.push(addr.street);
  if (addr.governorate) parts.push(addr.governorate);
  parts.push("Kuwait");
  // Need at least an area or block to be useful (more than just governorate + Kuwait)
  const hasLocator = addr.area || addr.block;
  if (!hasLocator) return "";
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(parts.join(", "));
}
// Is a map link a manually-pasted pin (coordinates / shortened link), not our generated search?
function isManualPin(link) {
  if (!link) return false;
  if (link.includes("/maps/search/?api=1&query=")) return false; // our generated format
  return /maps\.app\.goo\.gl|goo\.gl\/maps|\/maps\/place\/|[?&]q=-?\d|@-?\d/.test(link);
}

// PACI (Kuwait Finder) coordinates → exact Google Maps pin.
// PACI shows X,Y = longitude,latitude; users may paste in either order, so we
// detect: Kuwait latitude ≈ 28–31, longitude ≈ 46–49. Returns a pin URL or null.
function paciToMapsLink(raw) {
  const nums = (String(raw || "").match(/-?\d+\.?\d*/g) || []).map(parseFloat);
  if (nums.length < 2) return null;
  // find a valid Kuwait lat/long PAIR among all numbers (ignores Parcel/PACI ids).
  // Prefer decimals (real coordinates), and require lat≈29, lng≈48.
  const cand = nums.filter(n => !Number.isInteger(n)); // coordinates have decimals
  const pool = cand.length >= 2 ? cand : nums;
  for (let i = 0; i < pool.length; i++) {
    for (let j = 0; j < pool.length; j++) {
      if (i === j) continue;
      const lat = pool[i], lng = pool[j];
      if (lat >= 28 && lat <= 31 && lng >= 46 && lng <= 49) return `https://www.google.com/maps?q=${lat},${lng}`;
    }
  }
  return null;
}

// Parse a Kuwait Finder (PACI) result into address fields.
// Example: "Jaber Al-Ahmad - Block 5 - St 433 - Parcel 147 - House 7 - PACI NO ... - Unit PACI ..."
// Coordinates line "47.749298 , 29.345588" may be pasted too (any order).
function parsePaciAddress(raw, knownAreas) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const out = { area: "", block: "", street: "", lane: "", house: "", mapLink: "" };
  // coordinates anywhere in the paste → pin
  out.mapLink = paciToMapsLink(text) || "";
  // labeled parts (case-insensitive)
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : ""; };
  out.block = grab(/\bBlock\s+([A-Za-z0-9]+)/i);
  out.street = grab(/\bSt(?:reet)?\.?\s+([A-Za-z0-9]+)/i);
  out.lane = grab(/\b(?:Lane|Jadda|Jaddah)\s+([A-Za-z0-9]+)/i);
  out.house = grab(/\bHouse\s+([A-Za-z0-9]+)/i);
  // area = text before " - Block", with any leading House/Parcel prefixes stripped.
  // (PACI often writes "House 7 - Parcel 147 Jaber Al-Ahmad - Block 5 - ...")
  const bm = text.match(/^(.*?)\s*-\s*Block\b/i);
  let firstSeg = bm ? bm[1].trim() : "";
  firstSeg = firstSeg.replace(/^(?:House\s+\S+|Parcel\s+\S+)(?:\s*-\s*|\s+)/i, "");
  firstSeg = firstSeg.replace(/^(?:House\s+\S+|Parcel\s+\S+)(?:\s*-\s*|\s+)/i, "");
  if (/^[\d.,\s-]+$/.test(firstSeg)) firstSeg = ""; // guard: coordinates aren't an area
  if (firstSeg) {
    // normalize spacing/hyphens so "Jaber Al-Ahmad" matches app spelling "Jaber Al - Ahmad"
    const norm = (s) => s.toLowerCase().replace(/\s*-\s*/g, "").replace(/\s+/g, " ").trim();
    const fn = norm(firstSeg);
    const hit = (knownAreas || []).find(a => norm(a) === fn)
      || (knownAreas || []).find(a => norm(a).includes(fn) || fn.includes(norm(a)));
    out.area = hit || firstSeg;
  }
  out.governorate = out.area ? (govFor(out.area) || "") : "";
  const got = ["area", "block", "street", "house"].filter(k => out[k]);
  return got.length ? out : null;
}

// Trigger widget: agent pastes PACI coordinates → generates exact pin on demand.
// Never auto-fills; the link exists only because the agent tapped Use.
function PaciPinBuilder({ onUse, onFill }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const link = paciToMapsLink(val);
  const parsed = onFill ? parsePaciAddress(val, KW_AREA_NAMES) : null;
  const canApply = onFill ? (parsed || link) : link;
  const apply = () => {
    if (parsed && onFill) onFill(parsed); // fills area/block/st/lane/house (+ pin if present)
    else if (link) onUse(link);           // coordinates-only paste → just the pin
    setOpen(false); setVal("");
  };
  return (
    <div style={{ marginTop: 6 }}>
      {!open ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>📍 {onFill ? "Fill from Kuwait Finder" : "Build exact pin from Kuwait Finder"}</button>
      ) : (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--bg)" }}>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 5 }}>
            On <a href="https://gis.paci.gov.kw/Search/" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Kuwait Finder</a>, find the address, then copy {onFill ? "its full address line (or just the coordinates)" : "its coordinates"} and paste here.
          </div>
          <textarea className="filter-input" style={{ width: "100%", minHeight: 46, resize: "vertical" }}
            placeholder={onFill ? "Jaber Al-Ahmad - Block 5 - St 433 - House 7 …  or  29.345588, 47.749298" : "e.g. 29.352738, 47.994202"}
            value={val} onChange={e => setVal(e.target.value)} />
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={!canApply} onClick={apply}>{parsed ? "Fill address" : "Use this pin"}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setVal(""); }}>Cancel</button>
            {link && <a href={link} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#15803D", textDecoration: "underline" }}>preview pin</a>}
          </div>
          {parsed && (
            <div style={{ fontSize: 11, color: "#15803D", marginTop: 5 }}>
              ✓ Found: {[parsed.area && `Area ${parsed.area}`, parsed.block && `Block ${parsed.block}`, parsed.street && `St ${parsed.street}`, parsed.lane && `Lane ${parsed.lane}`, parsed.house && `House ${parsed.house}`, parsed.mapLink && "pin"].filter(Boolean).join(" · ")} — check after filling.
            </div>
          )}
          {val && !parsed && !link && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 5 }}>Couldn't read that — paste the full address line from Kuwait Finder, or its coordinates.</div>}
        </div>
      )}
    </div>
  );
}

// ─── Kuwait areas → governorate (6 governorates) ──────────────────────────────
// Used for clean, consistent area data + auto-derived governorate for reporting.
const KW_AREAS = {
  // Al Asimah
  "Khaldiya": "Al Asimah",
  "Dasma": "Al Asimah",
  "Da'iya": "Al Asimah",
  "Doha": "Al Asimah",
  "Rawda": "Al Asimah",
  "Surra": "Al Asimah",
  "Shamiya": "Al Asimah",
  "Sharq": "Al Asimah",
  "Shuwaikh": "Al Asimah",
  "Sulaibikhat": "Al Asimah",
  "Sawaber": "Al Asimah",
  "Adailiya": "Al Asimah",
  "Faiha": "Al Asimah",
  "Qadisiya": "Al Asimah",
  "Qibla": "Al Asimah",
  "Mirqab": "Al Asimah",
  "Mansouriya": "Al Asimah",
  "Nuzha": "Al Asimah",
  "Yarmouk": "Al Asimah",
  "Bneid Al - Gar": "Al Asimah",
  "Hadaeq Al-Soor": "Al Asimah",
  "Dasman": "Al Asimah",
  "Abdullah Al - salem": "Al Asimah",
  "Garnata": "Al Asimah",
  "Failaka": "Al Asimah",
  "Qurtuba": "Al Asimah",
  "Kaifan": "Al Asimah",
  "Jaber Al - Ahmad": "Al Asimah",
  "Maaskar Al-Mubarakiya": "Al Asimah",
  // Hawalli
  "Jabriya": "Hawalli",
  "Rumaithiya": "Hawalli",
  "Zahra": "Hawalli",
  "Salmiya": "Hawalli",
  "Salam": "Hawalli",
  "Shaab": "Hawalli",
  "Shuhada'a": "Hawalli",
  "Sadiq": "Hawalli",
  "Mubarakiya": "Hawalli",
  "Bayan": "Hawalli",
  "Hateen": "Hawalli",
  "Hawally": "Hawalli",
  "Salwa": "Hawalli",
  "Mubarak Al - Abdullah Al - Jaber": "Hawalli",
  "Mishref": "Hawalli",
  // Farwaniya
  "Eshbilya": "Farwaniya",
  "Andalous": "Farwaniya",
  "Rabia": "Farwaniya",
  "Rihab": "Farwaniya",
  "Riggae": "Farwaniya",
  "Rai": "Farwaniya",
  "Shadadiya": "Farwaniya",
  "Dhajeej": "Farwaniya",
  "Ardiya": "Farwaniya",
  "Omariya": "Farwaniya",
  "Firdous": "Farwaniya",
  "Al - Farwaniyah": "Farwaniya",
  "Jleeb Al - Shuyoukh": "Farwaniya",
  "Khaitan": "Farwaniya",
  "Sabah Al - Nasser": "Farwaniya",
  "Abdullah Al - Mubarak": "Farwaniya",
  // Mubarak Al-Kabeer
  "Adan": "Mubarak Al-Kabeer",
  "Funaitees": "Mubarak Al-Kabeer",
  "Qurain": "Mubarak Al-Kabeer",
  "Qosour": "Mubarak Al-Kabeer",
  "Messayl": "Mubarak Al-Kabeer",
  "Messila": "Mubarak Al-Kabeer",
  "Abu Al - Hasania": "Mubarak Al-Kabeer",
  "Abu Fatira": "Mubarak Al-Kabeer",
  "Sabah Al - salem": "Mubarak Al-Kabeer",
  "Subhan": "Mubarak Al-Kabeer",
  "Gharb Abu Fatira Al-Herafiya": "Mubarak Al-Kabeer",
  "Mubarak Al - Kabeer": "Mubarak Al-Kabeer",
  // Ahmadi
  "Ahmadi": "Ahmadi",
  "Khiran": "Ahmadi",
  "Riqqa": "Ahmadi",
  "Shuaiba": "Ahmadi",
  "Sabahiya": "Ahmadi",
  "Dhaher": "Ahmadi",
  "Egaila": "Ahmadi",
  "Fahaheel": "Ahmadi",
  "Fintas": "Ahmadi",
  "Mangaf": "Ahmadi",
  "Mahboula": "Ahmadi",
  "Wafra": "Ahmadi",
  "Abu Halifa": "Ahmadi",
  "Jaber Al - Ali": "Ahmadi",
  "Ali Sabah Al - Salem": "Ahmadi",
  "Fahad Al - Ahmad": "Ahmadi",
  "Sabah Al - Ahmad": "Ahmadi",
  "Sabah Al - Ahmad Al-Bahriya": "Ahmadi",
  "Mina Abdullah": "Ahmadi",
  "Hadiya": "Ahmadi",
  // Jahra
  "Jahra": "Jahra",
  "Sulaibiya": "Jahra",
  "Abdaly": "Jahra",
  "A'youn": "Jahra",
  "Qasr": "Jahra",
  "Qeirawan": "Jahra",
  "Mutla": "Jahra",
  "Naseem": "Jahra",
  "Na'eem": "Jahra",
  "Nah'da": "Jahra",
  "Waha": "Jahra",
  "Amghara": "Jahra",
  "Taima": "Jahra",
  "Suad Al - Abdullah": "Jahra",
};
const KW_AREA_NAMES = Object.keys(KW_AREAS).sort();
const govFor = (area) => KW_AREAS[area] || "";

// ─── Kuwait named streets by governorate (official; most KW streets are numbers) ─
// 'Main' roads (highways) are shown for every governorate.
const KW_MAIN_STREETS = ["AL _ Maghreb", "Abdul Aziz Bin Abdul Al - Rahman Al - Saud", "Airport", "Arabian Gulf", "Cairo", "Damascus", "Esa Bin Sulman Al - Khalifa", "Faisal Bin Abdul Aziz", "Ghazali", "Ghous", "Jahra", "Jamal Abdul Nasser", "Mohammed Bin Al - Qasim", "Riyadh", "The Custodian of The Two Holy Mosques King Fahad Ibn Abdul Aziz Road"];
const KW_STREETS_BY_GOV = {
  "Al Asimah": ["AI - Edreesi", "Abdul Al - Rahman Al - Dhakhil", "Abdul Al - Rahman Yousif Al - Bader", "Abdul Aziz Abdul Mehsin Al - Rashed", "Abdul Aziz Abdullah Al - Sarawy", "Abdul Aziz Bin Abdullah Bin Baz", "Abdul Aziz Ebrahim Al - Meshl", "Abdul Aziz Hamad Al - Sagher", "Abdul Aziz Mohammed Al - Duaij", "Abdul Aziz Yousif Al - Mzaini", "Abdul Hameed Abdul Abdul Aziz Al - Sane", "Abdul Latif Sulaiman Al - Othman", "Abdul Minem Riyad", "Abdul Qader Al - Hussaini", "Abdul Wahab Hussain Al - Qurtas", "Abdullah Al - Ahmed", "Abdullah Al - Khalaf Al - Saeed", "Abdullah Al - Khalifa Al - Sabah", "Abdullah Al - Mijrin Al - Roomi", "Abdullah Al - Mubarak", "Abdullah Al - Nouri", "Abdullah Al - salem", "Abdullah Mohammed Al - Hajeri", "Abdullah Zakariya Al - Anasri", "Abu Al - Asswad Al - Do’aly", "Abu Al - Faraj Al - Asfahani", "Abu Ayob Al - Anssari", "Abu Bakr Al - siddeeq", "Abu Hayyan Al - Tawheedy", "Abu Moussa Al - Asha’ary", "Abu Obaidah Abu Al - Jarah", "Abu Tammam", "Abu Yousif Al - Qadi", "Aden", "Ahmed Al - Estath", "Ahmed Al - Ganim", "Ahmed Al - Hindi", "Ahmed Al - Jaber", "Ahmed Bin Abdul Aziz Al - Anssary", "Ahmed Lottfi Al - sayed", "Ahmed Shawki", "Akkah", "Al - Arabi", "Al - Baha’a Zuhair", "Al - Baroodi", "Al - Emam Al - Hassan Bin Ali Bin Abi Talib", "Al - Emam Al - Hassein Bin Ali Bin Abi Talib", "Al - Khaleel Bin Ahmed", "Al - Ma’arri", "Al - Nabi’gha Al - Thebiani", "Al - No’man Bin Basheer", "Al - Oroba", "Al - Salhiya", "Al - Shareef Al - Radi", "Al - Tabarri", "Ali Al - Salem", "Ali Bin Abi Talib", "Ali Sulaiman Abu Khail", "Amadi", "Ammar Bin Yasser", "Amna Bint Wahab", "Amorria", "Anbarri", "Arafat", "Assma’ Bint Abu Bakr Al - Siddeeq", "Aukadh", "Aumayah", "Azd", "Azhar", "Babel", "Bader", "Balqees", "Belal Bin Rabah", "Bludan", "Bo Asseya", "Bukhary", "Burgan", "Dasma", "Da’iya", "Doha", "Duwaihi Bin Rumaih", "Ebn Abbas", "Ebn Al - Arqam", "Ebn Al - Atheer", "Ebn Al - Haythem", "Ebn Battota", "Ebn Ceena", "Ebn Hani", "Ebn Hazm", "Ebn Katheer", "Ebn Mandhour", "Ebn Mesbah", "Ebrahim Al - Mudhaf", "Esa Abdul Rahman Al - Asousi", "Escandariya", "Eshbilya", "Eyas Bin", "Fahad Al - Salem", "Faiha,", "Failaka", "Farazdaq", "Furat", "Garnata", "Gazza", "Ghassan", "Hakah", "Hamad Al - Khalifa Al - Humaeda", "Hamad Al - Saghir", "Hamza Bin Abdul Mutalib", "Haram Bin Senan", "Hassan Bin Thabit", "Hateen", "Hathramout", "Hisham Bin Abdul Malik", "Hunain", "Jaber Al - Mubarak", "Jahedh", "Jamal Addin Al - Afggani", "Jameel Bin Muamar", "Jareer", "Jassim Bodai", "Jassim Mohammed Al - Wazzan", "Jazaeir", "Jehad", "Kadhma", "Kanana", "Karama", "Khalid Ayoob Bandar", "Khalid Ebn Al - Waleed", "Khawla Bint Al - Azwar", "Komait", "Koofa", "Lo’lo’a", "Maan Bin Za’ida", "Maisaloun", "Mamoun", "Manfalouti", "Mangaf", "Mansour", "Marakish", "Marjan", "Marqash", "Masoudi", "Mazzini", "Mina", "Mohalab", "Mohammed Abdu", "Mohammed Abdul Mehsin Al - Kharafi", "Mohammed Bin Hamad Bin La’boun", "Mohammed Ibn Hagan", "Mohammed Rafie Marafie", "Mohammed Thinayyan Al - Ghanim", "Mohammed Yousif Al - Adasani", "Mubarak Al - Kabeer", "Mubarakiya", "Muktaffi", "Muroaa", "Mutawakkil", "Najda", "Nasser", "Nasser Ibrahim Al - Sagabi", "Neel", "Nusf Al - Yousif Al - Nuaf", "Nuzha", "Om Al - Qeween", "Oman", "Omar Al - Mukhtar", "Omar Bin Abdul Aziz", "Omar Bin Al - Khatab", "Omar Bin Habira", "Omru’o Al - Qays", "Orass", "Osama Bin Mongith", "Othman Bin Affan", "Por Sa’eed", "Qadisiya", "Qortubi", "Quds", "Quraiysh", "Qurtuba", "Qussai Bin Kilab", "Rab,ah Al - Adewya", "Raed", "Raffaee", "Rasheed", "Rashid Bin Ahmed Al - Romi", "Rashid Burusli", "Rawdhatain", "Rebat", "Salah Al - Deen Al - Ayobi", "Salam", "Salih Abdul Rahman Al - Abdaly", "Sami Ahmed Al - Munayyes", "Sami Qasim Al - Meshri", "Sanaa’", "Sayed Ali Sayed Sulaiman Al - Refai", "Sa’ad Bin Ebada", "Sebaway", "Seif Al - Dawlah Al -Hamadani", "Shabbi", "Shahba’a", "Shamiya", "Shamlan Bin Seif", "Shamlan Bin Yousif", "Shebani", "Shuhada’a", "Shuwaikh", "Soor", "Souk Al - Gharabally", "Sukayna Bint Al - Hussein", "Sultan Al Kulaib", "Surra", "Suwais", "Tarabluss", "Tariq Bin Ziyad", "Telmesani", "Thaalbi", "Wahran", "Watia", "Wazzan", "Wehda", "Yamen", "Yosif Bin Tashqeen", "Yousif Abdul Aziz Al - Fleaj", "Yousif Al - Adhma", "Yousif Al - Roomi", "Yousif Al - Sabeeh", "Zabadani", "Zahra’"],
  "Hawalli": ["Abdul Kareem Al - Khattabi", "AbdulAl - Rahman Al - Ghafigi", "Abdullah Abdul Latif Al - Othman", "Abdullah Al - Fadala", "Abdullah Al - Faraj", "Abdullah Bin Al - Zubair", "Abdullah Bin Masoud", "Abdullah Mshari Al - Roudan", "Abu Hanifah", "Abu Horeira", "Abu Thar Al - Ghafari", "Ahmed Bin Hanbal", "Ahmed Bin Tolon", "Al - Awazim", "Al - Dhahak Bin Qays", "Al - Hassan Al - Basri", "Al - Masjed Al - Aqssa", "Al - Muthana", "Al - Mu’gheera Bin Sho’ba", "Al - Zubair Bin Al - Awam", "Ali Thnayan Al - Othainah", "Amman", "Amro Bin Al - Aas", "Baghdad", "Bahrain", "Beirut", "Belajat", "Dimna", "Ebn Al - Khateeb", "Ebn Khaldoon", "Ebn Roshd", "Ebn Salam", "Ebrahim Mohammed Al - Mazidi", "Esa Al - Qatami", "Hamad Al - Khalid", "Hamad Al - Mubarak", "Haroon Al - Rasheed", "Hassan Al - Banna", "Hilal Al - Mutairi", "Hira’a", "Hmoud Al - Nasser", "Jaber Bin Hayyan", "Khalid Bin Abdul Aziz", "Khansa", "Kindi", "Luthan", "Maath Bin Jabal", "Malik Bin Anas", "Manama", "Mohammed Wasmi Al - Wasmi", "Motanabbi", "Mousa Al - Abdul Razzaq", "Mousa Bin Nusair", "Musaed Al - Azmi", "Mus’ab Bin Al - Zubair", "Mutamad", "Mutasim", "Mutaz", "Nafie Bin Al - Azraq", "Nah’da", "Naser Al - Bader", "Nasser Al - Mobarak", "Ohod", "Osama Bin Zaid", "Qatar", "Qotaiba Bin Muslim", "Rabee’a", "Saba’", "Salem Al - Mubarak", "Salwa", "Sati’ Al - Husari", "Sayed Yaseen Al -Tabtabai", "Sa’eed Bin Al - Mesayeb", "Shaab", "Shafae", "Shaheen Al - Ghanim", "Sharahbeel Bin Hasna", "Sulaiman Al - Adsani", "Suraqa Bin Malik", "Ta’awn", "Thahabi", "Thaqeef", "Tunis", "Wasel Bin Atta", "Yarmouk", "Yathrib", "Yousif Al - Bader", "Yousif Bin Homoud", "Yousif Bin Isa Al - Qanaei", "Zaba’", "Zerqa’a Al - Yammama"],
  "Farwaniya": ["Abdulah Mohammed Al - Khaldi", "Abdullah Bin Al - Mugafa’", "Abu Dhabi", "Al - Alla’ Al - Jarood", "Al - Waleed Bin Abdul Malik", "Ardon", "Ebn Sereen", "Ebn Tofail", "Ebn Zaher", "Ebrahim Bin Adham", "Ebrahim Bin Al - Aghlab", "Firdous", "Habeeb Al - Monawer", "Khalid Egab Al - Ashhab", "Mazin Bin Malik", "Muscat", "Omariya", "Rabia", "Saud Bin Abdul Aziz", "Zaid Al - Khail"],
  "Mubarak Al-Kabeer": [],
  "Ahmadi": ["Abdul Malik Bin Marwan", "Abu Firas Al - Hamadany", "Abu Mihjin Al - Thaqafy", "Al - Ahnaf Bin Qays", "Al - Daboos", "Al - Kassaei", "Awadh Mohammed Al - Khedher", "Balatt Al - Shuhadaa", "Bani Rabi’aa", "Dubai", "Ebn Malik", "Ebn Taymiya", "Ebrahim Al - Mousseli", "Faisal Al - Malik Al - Sabah", "Hadiya", "Hatem Al - Ta’ai", "Homoud Abdul Aziz Al - Sinan", "Ka’ab Bin Zuhair", "Malik Bin Al - Raib", "Mecca", "Mohammed Abdul Mehsin Al - Duaij", "Mohammed Iqbal", "Mudhar Bin Nazar", "Mutlaq Fahad Al - Adwani", "Ras Al - Khaima", "Razi", "Riqqa", "Sabahiya", "Sahil", "Turfa Bin Al - Abd"],
  "Jahra": ["Abdaly", "Abdullah Bin Jad’an", "Abu Al - Boqa Al - Ak,bari", "Ahw’ass", "Ain Jaloot", "Al - Baghllany", "Al - Hajaj Bin Yousif Al - Thaqafi", "Al - Najashi", "Amro Bin Kalthoum", "Assma’i", "Attraf", "Bakri", "Bayrooni", "Bisher Bin Abi Awana", "Dihya Al - Kalbi", "Do’bell Al - Khozai", "Ebn Abd Rabbah", "Ebn Al - Roomi", "Ebn Bassam", "Ebn Hijer", "Hajib Bin Zorara", "Khalaf Al - Ahmar", "Louay Bin Ghalib", "Mahdi", "Marzouq Al - Met’eb", "Maskeen Al - Darmi", "Muhalhal Bin Rabiaa", "Murshid Al -Tawala Al - Shimmary", "Nsser Bin Sayyar", "Qiss Bin Sa’eda", "Sa’eed Bin Jubair", "Sha’bi", "Slayil", "Sulaibiya", "Suyoti"],
};
// streets for an area = its governorate's streets + main roads
const streetsForArea = (area) => {
  const gov = govFor(area);
  const base = KW_STREETS_BY_GOV[gov] || [];
  return [...base, ...KW_MAIN_STREETS];
};

// ─── Car brands (Kuwait-relevant) + common models ─────────────────────────────
const CAR_DATA = {
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
const CAR_BRANDS = Object.keys(CAR_DATA).sort();
const modelsFor = (brand) => CAR_DATA[brand] || [];

// Optional sub-model (trim) per brand|model — ComboBox allows custom entries for gaps.
const SUB_MODELS = {
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
const subModelsFor = (brand, model) => SUB_MODELS[`${brand}|${model}`] || [];
// Live shared car catalog (car_catalog table, owned by the Tire System).
// Dropdown options = curated lists ∪ DB entries, so both systems stay in sync
// and agent-registered trims/models appear here automatically.
let CAR_CATALOG_DB = [];
async function fetchCarCatalog() {
  try { CAR_CATALOG_DB = (await sbAll("/car_catalog?select=brand,model,sub_model,verified,source")) || []; } catch { CAR_CATALOG_DB = []; }
}
const carCatalogTrusted = () => CAR_CATALOG_DB.filter(r =>
  (r.verified || r.source === "agent") && /^[A-Za-z]/.test(String(r.brand || "")) && !/^\d+$/.test(String(r.model || "").trim()));
const carBrandOpts = () => [...new Set([...CAR_BRANDS, ...carCatalogTrusted().map(r => r.brand)])].sort();
const carModelOpts = (brand) => [...new Set([...modelsFor(brand), ...carCatalogTrusted().filter(r => r.brand === brand && r.model).map(r => r.model)])].sort();
const carSubModelOpts = (brand, model) => [...new Set([...subModelsFor(brand, model), ...carCatalogTrusted().filter(r => r.brand === brand && r.model === model && r.sub_model).map(r => r.sub_model)])];
const carYears = (() => { const y = []; const now = new Date().getFullYear() + 1; for (let v = now; v >= 1990; v--) y.push(String(v)); return y; })();

// ─── Mock Data ───────────────────────────────────────────────────────────────
const MOCK_CUSTOMERS = [
  { id: "mc-1", name: "Ahmad Al-Salem",   mobile: "99001234", area: "Salmiya",    notes: "VIP — Porsche fleet" },
  { id: "mc-2", name: "Sara Al-Rashidi",  mobile: "66778899", area: "Rumaithiya", notes: "" },
  { id: "mc-3", name: "Khalid Al-Mutairi",mobile: "55443322", area: "Hawalli",    notes: "Prefers morning slots" },
];
const MOCK_CARS = [
  { id: "mcar-1", customer_id: "mc-1", brand: "Toyota",  model: "Land Cruiser", year: "2022", plate: "Kuwait · 12345 · Private" },
  { id: "mcar-2", customer_id: "mc-1", brand: "Porsche", model: "Cayenne",      year: "2023", plate: "Kuwait · 84000 · Private" },
  { id: "mcar-3", customer_id: "mc-2", brand: "Porsche", model: "Cayenne",      year: "2023", plate: "Kuwait · 77321 · Private" },
  { id: "mcar-4", customer_id: "mc-3", brand: "GMC",     model: "Yukon",        year: "2021", plate: "Kuwait · 33210 · Private" },
];
const MOCK_ADDRESSES = [
  { id: "ma-1", customer_id: "mc-1", label: "Home", area: "Salmiya", governorate: "Hawalli", block: "12", street: "Hamad Al-Mubarak", house: "14", map_link: "https://maps.google.com/?q=29.3375,48.0838" },
  { id: "ma-2", customer_id: "mc-1", label: "Office", area: "Sharq", block: "3", street: "Ahmad Al-Jaber", lane: "5", house: "Tower 5", map_link: "" },
  { id: "ma-3", customer_id: "mc-2", label: "Home", area: "Rumaithiya", governorate: "Hawalli", block: "3", street: "Al-Khaleej", house: "7A", map_link: "" },
  { id: "ma-4", customer_id: "mc-3", label: "Home", area: "Hawalli", block: "5", street: "Tunis", house: "22", map_link: "" },
];
const MOCK_JOBS = [
  {
    id: "mock-1", customer_id: "mc-1",
    customer_name: "Ahmad Al-Salem", customer_mobile: "99001234",
    area: "Salmiya", block: "12", street: "Hamad Al-Mubarak", house: "14",
    map_link: "https://maps.google.com/?q=29.3375,48.0838",
    car_brand: "Toyota", car_model: "Land Cruiser", car_year: "2022", car_plate: "Kuwait · 12345 · Private",
    service_type: "Tire Change & Balancing", service_details: "215/60R16 Michelin Pilot Sport 4", qty: 4, total: 172,
    items: [
      { id: "i1a", kind: "tire", tire_id: "mt-1", brand: "Michelin", pattern: "Pilot Sport 4", size: "215/60R16", year: "2025", cost: 28, supplier: "Kuwait Automotive", qty: 4, unit_price: 38 },
      { id: "i1b", kind: "service", name: "Wheel Alignment", qty: 1, unit_price: 20 },
    ],
    assigned_truck: "T2", assigned_technician: "Fahad", status: "assigned", parts_released: true, techs_released: true,
    scheduled_at: new Date().toISOString(), lead_from: "WhatsApp", sales_agent: "Hussain",
    xero_ref: "PO-2026-0041", payment_through: "Link", payment_status: "paid",
    checks: [true, false, false, false], notes: "Tesla wall charger — park carefully",
    created_at: new Date().toISOString(),
  },
  {
    id: "mock-2", customer_id: "mc-2",
    customer_name: "Sara Al-Rashidi", customer_mobile: "66778899",
    area: "Rumaithiya", block: "3", street: "Al-Khaleej", house: "7A", map_link: "",
    car_brand: "Porsche", car_model: "Cayenne", car_year: "2023", car_plate: "Kuwait · 77321 · Private",
    service_type: "Tire Change & Balancing", service_details: "295/40R21 Pirelli P Zero", qty: 2, total: 190,
    items: [
      { id: "i2a", kind: "tire", tire_id: "mt-2", brand: "Pirelli", pattern: "P Zero", size: "295/40R21", year: "2025", cost: 70, supplier: "Behbehani (Pirelli)", qty: 2, unit_price: 95 },
    ],
    assigned_truck: "T4", assigned_technician: "Omar", status: "booked", parts_released: true, techs_released: false,
    scheduled_at: new Date(Date.now() + 3600000 * 3).toISOString(), lead_from: "Signal", sales_agent: "Alaa",
    xero_ref: "", payment_through: "Tabby", payment_status: "pending", payment_link: "https://pay.bnchr.com/abc123",
    checks: [false, false, false, false], notes: "",
    created_at: new Date().toISOString(),
  },
  {
    id: "mock-3", customer_id: "mc-1",
    customer_name: "Ahmad Al-Salem", customer_mobile: "99001234",
    area: "Salmiya", block: "12", street: "Hamad Al-Mubarak", house: "14", map_link: "",
    car_brand: "Porsche", car_model: "Cayenne", car_year: "2023", car_plate: "Kuwait · 84000 · Private",
    service_type: "Oil & Filter", service_details: "Mobil 1 5W-40 Full Synthetic", qty: 1, total: 25,
    items: [ { id: "i3a", kind: "service", name: "Oil & Filter (Mobil 1 5W-40)", qty: 1, unit_price: 25 } ],
    assigned_truck: "T1", assigned_technician: "Fahad", status: "paid",
    scheduled_at: new Date(Date.now() - 86400000 * 5).toISOString(), lead_from: "WhatsApp", sales_agent: "Hussain",
    xero_ref: "PO-2026-0038", payment_through: "Link", payment_status: "paid",
    checks: [true, true, true, true], notes: "",
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: "mock-4", customer_id: "mc-3",
    customer_name: "Khalid Al-Mutairi", customer_mobile: "55443322",
    area: "Hawalli", block: "5", street: "Tunis", house: "22", map_link: "",
    car_brand: "GMC", car_model: "Yukon", car_year: "2021", car_plate: "Kuwait · 33210 · Private",
    service_type: "Tire Change & Balancing", service_details: "275/55R20 Michelin Primacy", qty: 4, total: 220,
    items: [
      { id: "i4a", kind: "tire", tire_id: "mt-3", brand: "Michelin", pattern: "Primacy", size: "275/55R20", year: "2024", cost: 42, supplier: "Kuwait Automotive", qty: 4, unit_price: 55 },
    ],
    assigned_truck: "T5", assigned_technician: "Saad", status: "paid",
    scheduled_at: new Date(Date.now() - 86400000 * 12).toISOString(), lead_from: "WhatsApp", sales_agent: "Yousef",
    xero_ref: "PO-2026-0031", payment_through: "Link", payment_status: "paid",
    checks: [true, true, true, true], notes: "",
    created_at: new Date(Date.now() - 86400000 * 12).toISOString(),
  },
];

// ─── DB Layer ─────────────────────────────────────────────────────────────────
async function fetchJobs() {
  try { const d = await sbAll("/jobs?select=*&order=scheduled_at.desc,id.asc"); return d || []; }
  catch { return MOCK_JOBS; }
}
async function fetchCustomers() {
  try { const d = await sbAll("/customers?select=*&order=name.asc,id.asc"); return d || []; }
  catch { return MOCK_CUSTOMERS; }
}
async function fetchCars() {
  try { const d = await sbAll("/customer_cars?select=*&order=id.asc"); return d || []; }
  catch { return MOCK_CARS; }
}
async function createJob(job) {
  try { const r = await sb("/jobs", { method: "POST", body: JSON.stringify(job) }); return r?.[0] || { ...job, id: `local-${Date.now()}` }; }
  catch (e) {
    console.error("Order create FAILED:", e?.message || e);
    alert("⚠ Could not save the new order to the server — it will disappear on refresh.\n\n" + String(e?.message || e).slice(0, 300));
    return { ...job, id: `local-${Date.now()}` };
  }
}
// Real columns on the jobs table — every PATCH is filtered to these, so a
// stray UI-only key can never reject the whole save.
const JOB_COLUMNS = new Set(["customer_id","customer_name","customer_mobile","area","governorate","block","street","lane","house","map_link","car_brand","car_model","car_year","car_plate","car_id","services","items","service_type","service_details","qty","labor_charge","total","sales_match_confirmed","assigned_truck","assigned_technician","start_hour","duration","overtime","is_overtime","scheduled_date","scheduled_at","lead_from","sales_agent","xero_ref","invoice_no","payment_through","payment_status","payment_link","notes","status","parts_status","truck_status","parts_released","techs_released","parts_received","tech_arrival_match","checks","ver_times","item_checks","tech_checks","tech_checks_order","tech_checks_car","collected_items","tech_mismatch","partial_completion","unfitted_items","cancel_reason","cancelled_at","incomplete_reason","incomplete_at","items_edited_at","updated_at","started_at","completed_at","service_mileage","service_mileage_unit","invoice_shared","check_notes","car_mileages","parent_job_id","link_type","upsell_truck","upsell_technician","upsell_response","sale_date","no_products_reason","paid_date","review_rating"]);
// Merge a refetched jobs list over local state: a fetched row wins only if
// strictly NEWER (updated_at). Ties = stale realtime echoes of our own PATCH
// → keep the local optimistic row (kills the check→uncheck→check flicker).
function mergeJobs(prev, fresh) {
  const byId = new Map(prev.map(p => [p.id, p]));
  return fresh.map(f => {
    const p = byId.get(f.id);
    if (!p) return f;
    const pt = new Date(p.updated_at || 0).getTime();
    const ft = new Date(f.updated_at || 0).getTime();
    return ft > pt ? f : p;
  });
}
async function updateJob(id, patch) {
  const clean = { updated_at: new Date().toISOString() }; // every save stamps "last action"
  Object.keys(patch || {}).forEach(k => { if (JOB_COLUMNS.has(k)) clean[k] = patch[k]; });
  try {
    await sb(`/jobs?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify(clean) });
    return true;
  } catch (e) {
    console.error("Order save FAILED:", e?.message || e);
    alert("⚠ Could not save to the server — this change will be lost on refresh.\n\n" + String(e?.message || e).slice(0, 300));
    return false;
  }
}
async function createCustomer(c) {
  try { const r = await sb("/customers", { method: "POST", body: JSON.stringify(c) }); return r?.[0] || { ...c, id: `lc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }; }
  catch { return { ...c, id: `lc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }; }
}
async function createCar(car) {
  try { const r = await sb("/customer_cars", { method: "POST", body: JSON.stringify(car) }); return r?.[0] || { ...car, id: `lcar-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }; }
  catch { return { ...car, id: `lcar-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }; }
}
async function fetchCatalogItems() {
  // SINGLE SOURCE: the Tire System's service_products (+ offers for best cost).
  // Adapted to the CatalogPicker shape; the legacy catalog_items table is retired.
  try {
    const [p, o] = await Promise.all([
      sbAll("/service_products?select=*&active=eq.true&order=sku.asc"),
      sbAll("/service_product_offers?select=*"),
    ]);
    const best = {};
    (o || []).forEach(x => {
      const c = Number(x.cost) || 0;
      if (c > 0 && (!best[x.product_id] || c < best[x.product_id].cost)) best[x.product_id] = { cost: c, supplier: x.supplier };
    });
    const CATMAP = { engine_oil: "EO", battery: "BT", filter: "FT", fluid: "FL", brake: "BP", spark_plug: "SP", other: "PT" };
    return (p || []).map(x => ({
      id: x.id, category: CATMAP[x.category] || "PT", sku: x.sku,
      description: x.name, price: x.selling_price,
      cost: best[x.id] ? best[x.id].cost : 0, supplier: best[x.id] ? best[x.id].supplier : "",
    }));
  } catch { return []; }
}

// ─── Upsell leads (technician-spotted opportunities) ──────────────────────────
async function fetchUpsellLeads() {
  try { const d = await sbAll("/upsell_leads?select=*&order=created_at.desc"); return d || []; }
  catch { return []; }
}
async function createUpsellLead(lead) {
  try { const r = await sb("/upsell_leads", { method: "POST", body: JSON.stringify(lead) }); return r?.[0] || { ...lead, id: `lu-${Date.now()}`, status: "open", created_at: new Date().toISOString() }; }
  catch (e) {
    console.error("Upsell lead create FAILED:", e?.message || e);
    alert("⚠ Could not save the upsell to the server.\n\n" + String(e?.message || e).slice(0, 300));
    return null;
  }
}
async function updateUpsellLead(id, patch) {
  try { await sb(`/upsell_leads?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) }); return true; }
  catch (e) { console.error("Upsell lead save FAILED:", e?.message || e); return false; }
}
// Walk a thread up to its root order (revisits/upsells always link to the root).
function rootJobId(job, all) {
  let cur = job, guard = 0;
  while (cur && cur.parent_job_id && guard++ < 10) {
    const p = (all || []).find(x => x.id === cur.parent_job_id);
    if (!p) return cur.parent_job_id;
    cur = p;
  }
  return cur ? cur.id : null;
}
const leadAgeDays = (l) => Math.floor((Date.now() - new Date(l.created_at || Date.now()).getTime()) / 86400000);
const leadAgeColor = (d) => d >= 7 ? "#DC2626" : d >= 3 ? "#B45309" : "var(--muted)";
const LINK_BADGE = { revisit: { t: "🔁 Revisit", c: "#1D4ED8", bg: "#EFF6FF" }, upsell: { t: "⬆ Upsell", c: "#15803D", bg: "#F0FDF4" } };
async function fetchAddresses() {
  try { const d = await sbAll("/customer_addresses?select=*&order=id.asc"); return d || []; }
  catch { return MOCK_ADDRESSES; }
}
async function createAddress(a) {
  try { const r = await sb("/customer_addresses", { method: "POST", body: JSON.stringify(a) }); return r?.[0] || { ...a, id: `laddr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }; }
  catch { return { ...a, id: `laddr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }; }
}
async function updateCustomer(id, patch) {
  try { await sb(`/customers?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify(patch) }); } catch {}
}
async function updateCar(id, patch) {
  try { await sb(`/customer_cars?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify(patch) }); } catch {}
}
async function deleteCar(id) {
  try { await sb(`/customer_cars?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" }); } catch {}
}
// Append a mileage reading to a car's log + update its latest reading.
async function appendCarMileage(carId, entry) {
  try {
    const rows = await sb(`/customer_cars?id=eq.${carId}&select=mileage_log`);
    const log = (rows && rows[0] && Array.isArray(rows[0].mileage_log)) ? rows[0].mileage_log : [];
    // de-dupe by job so re-completing doesn't double-log
    const next = [...log.filter(e => e.job_id !== entry.job_id), entry].sort((a, b) => new Date(b.date) - new Date(a.date));
    await sb(`/customer_cars?id=eq.${carId}`, { method: "PATCH", prefer: "return=minimal",
      body: JSON.stringify({ mileage_log: next, last_mileage: entry.km, last_mileage_unit: entry.unit }) });
  } catch (e) { /* non-blocking */ }
}
async function updateAddress(id, patch) {
  try { await sb(`/customer_addresses?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify(patch) }); } catch {}
}
async function deleteAddress(id) {
  try { await sb(`/customer_addresses?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" }); } catch {}
}

// ─── CSS ─────────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { max-width: 100%; overflow-x: hidden; -webkit-text-size-adjust: 100%; }
  :root {
    --bg: #F0F2F5; --surface: #FFFFFF; --card: #FFFFFF; --border: #D8DCE6;
    --accent: #D4840A; --accent2: #C13A06; --text: #0F1117; --muted: #5A6278;
    --success: #15803D; --danger: #DC2626; --radius: 10px;
    --font-head: 'Space Grotesk', sans-serif; --font-body: 'Inter', sans-serif;
  }
  body { background: var(--bg); color: var(--text); font-family: var(--font-body); font-size: 14px; line-height: 1.5; min-height: 100vh; }

  /* Login */
  .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); }
  .login-box { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 36px 28px; width: 320px; max-width: calc(100vw - 32px); box-shadow: 0 4px 24px rgba(0,0,0,.08); }
  .login-box h1 { font-family: var(--font-head); font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .login-box h1 span { color: var(--accent); }
  .login-box p { color: var(--muted); font-size: 13px; margin-bottom: 28px; }
  .login-box input { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 11px 14px; color: var(--text); font-size: 16px; margin-bottom: 12px; outline: none; }
  .login-box input:focus { border-color: var(--accent); }
  .login-error { color: var(--danger); font-size: 12px; margin-bottom: 10px; }
  .role-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px; }
  .role-btn { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 8px; color: var(--muted); font-size: 13px; cursor: pointer; text-align: center; transition: all .15s; }
  .role-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }

  /* Layout */
  .app { display: flex; flex-direction: column; min-height: 100vh; }
  .topbar { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 20px; height: 56px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .topbar-left { display: flex; align-items: center; gap: 12px; }
  .logo { font-family: var(--font-head); font-size: 17px; font-weight: 700; letter-spacing: -.3px; }
  .logo span { color: var(--accent); }
  .badge-role { background: var(--border); border-radius: 6px; padding: 3px 10px; font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
  .nav-tabs { display: flex; gap: 2px; }
  .nav-tab { background: none; border: none; color: var(--muted); font-size: 13px; font-weight: 500; padding: 8px 14px; border-radius: 8px; cursor: pointer; transition: all .15s; }
  .nav-tab.active { background: var(--bg); color: var(--text); font-weight: 600; }
  .nav-tab:hover:not(.active) { color: var(--text); }
  .topbar-right { display: flex; align-items: center; gap: 10px; }
  .btn-logout { background: none; border: 1px solid var(--border); border-radius: 8px; color: var(--muted); font-size: 12px; padding: 6px 12px; cursor: pointer; }
  .btn-logout:hover { border-color: var(--danger); color: var(--danger); }
  .main { flex: 1; padding: 24px 20px; max-width: 1200px; margin: 0 auto; width: 100%; }

  /* Buttons */
  .btn { border: none; border-radius: var(--radius); padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all .15s; display: inline-flex; align-items: center; gap: 6px; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { background: #b86e08; }
  .btn-ghost { background: var(--card); border: 1px solid var(--border); color: var(--text); }
  .btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
  .btn-danger { background: transparent; border: 1px solid var(--danger); color: var(--danger); }
  .btn-success { background: var(--success); color: #fff; }
  .btn-sm { padding: 5px 12px; font-size: 12px; }

  /* Cards */
  .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 1px 3px rgba(0,0,0,.04); }
  .card-header { padding: 14px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .card-header h3 { font-family: var(--font-head); font-size: 15px; font-weight: 600; }
  .card-body { padding: 16px; }

  /* Tags & Pills */
  .tag { border-radius: 6px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
  .tag-truck { background: #DBEAFE; color: #1D4ED8; }
  .tag-time  { background: #DCFCE7; color: #15803D; font-size: 12px; }
  .tag-total { background: #FEF3C7; color: var(--accent); }
  .status-pill { border-radius: 20px; padding: 3px 10px; font-size: 11px; font-weight: 700; letter-spacing: .3px; }

  /* Search input */
  .search-wrap { position: relative; }
  .search-input { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px 9px 34px; font-size: 14px; color: var(--text); outline: none; }
  .search-input:focus { border-color: var(--accent); }
  .search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--muted); font-size: 14px; pointer-events: none; }
  .search-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: var(--card); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.1); z-index: 50; max-height: 260px; overflow-y: auto; }
  .search-item { padding: 10px 14px; cursor: pointer; border-bottom: 1px solid var(--border); }
  .search-item:last-child { border-bottom: none; }
  .search-item:hover { background: var(--bg); }
  .search-item-name { font-weight: 600; font-size: 14px; }
  .search-item-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .search-new { padding: 10px 14px; cursor: pointer; color: var(--accent); font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .search-new:hover { background: var(--bg); }

  /* Job list */
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 10px; }
  .page-title { font-family: var(--font-head); font-size: 20px; font-weight: 700; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; }
  .filter-select { background: var(--card); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px; padding: 7px 12px; cursor: pointer; outline: none; }
  .filter-select:focus { border-color: var(--accent); }
  .filter-input { background: var(--card); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px; padding: 7px 12px; outline: none; }
  .filter-input:focus { border-color: var(--accent); }

  .job-cards { display: flex; flex-direction: column; gap: 10px; }
  @media (min-width: 900px) {
    .schedule-board-panel { position: sticky; top: 12px; max-height: calc(100vh - 40px); overflow-y: auto; }
  }
  .job-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; cursor: pointer; transition: border-color .15s, box-shadow .15s; overflow: hidden; min-width: 0; }
  .job-card:hover { border-color: var(--accent); box-shadow: 0 2px 8px rgba(212,132,10,.1); }
  .job-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; } .job-card-top .status-pill { flex-shrink: 0; margin-left: auto; }
  .job-card-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
  .job-card-name { font-weight: 600; font-size: 15px; }
  .job-card-service { color: var(--muted); font-size: 13px; margin-top: 2px; }

  /* Stats */
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
  .stat-num { font-family: var(--font-head); font-size: 28px; font-weight: 700; }
  .stat-lbl { color: var(--muted); font-size: 12px; margin-top: 2px; }

  /* Detail */
  .detail-back { background: none; border: none; color: var(--muted); font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 6px; margin-bottom: 12px; padding: 0; }
  .detail-back:hover { color: var(--text); }
  .detail-hero { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
  .detail-hero-top { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
  .detail-hero h2 { font-family: var(--font-head); font-size: 20px; font-weight: 700; }
  .detail-hero-sub { color: var(--muted); font-size: 13px; margin-top: 3px; }
  .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .detail-field label { display: block; font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 3px; }
  .detail-field p { font-size: 14px; }
  .detail-field a { color: var(--accent); text-decoration: none; }
  .detail-field a:hover { text-decoration: underline; }

  /* Checks */
  .checks-list { display: flex; flex-direction: column; gap: 8px; }
  .check-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; transition: border-color .15s; }
  .check-item.done { border-color: var(--success); background: #F0FDF4; }
  .check-item.locked { opacity: .45; cursor: not-allowed; }
  .check-circle { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; }
  .check-circle.done { background: var(--success); border-color: var(--success); color: #fff; }
  .check-text { font-size: 13px; }
  .check-num { font-size: 11px; font-weight: 700; color: var(--muted); margin-right: 4px; }

  /* Form */
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .form-field { display: flex; flex-direction: column; gap: 5px; }
  .form-field label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
  .form-field input, .form-field select, .form-field textarea { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; color: var(--text); font-size: 14px; font-family: var(--font-body); outline: none; width: 100%; }
  .form-field input:focus, .form-field select:focus, .form-field textarea:focus { border-color: var(--accent); }
  .form-field textarea { resize: vertical; min-height: 70px; }
  .form-section-title { font-family: var(--font-head); font-size: 12px; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: .8px; margin-top: 4px; grid-column: 1/-1; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  .form-full { grid-column: 1/-1; }

  /* Customer search in form */
  .customer-found { background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; }
  .customer-found-name { font-weight: 600; font-size: 14px; color: #1D4ED8; }
  .customer-found-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .car-picker { display: flex; flex-direction: column; gap: 6px; }
  .car-option { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; background: var(--bg); transition: all .15s; }
  .car-option.selected { border-color: var(--accent); background: #FEF9EE; }
  .car-option-radio { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .car-option-radio.selected { border-color: var(--accent); background: var(--accent); }
  .car-option-radio.selected::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #fff; }

  /* My Jobs */
  .my-job-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; cursor: pointer; transition: border-color .15s; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
  .my-job-card:hover { border-color: var(--accent); }
  .my-job-num { font-family: var(--font-head); font-size: 28px; font-weight: 700; color: var(--accent); }
  .map-btn { display: inline-flex; align-items: center; gap: 6px; background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; color: #1D4ED8; font-size: 13px; font-weight: 600; padding: 8px 14px; text-decoration: none; margin-top: 10px; }

  /* Distributor */
  .dist-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
  .dist-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .dist-row:last-child { border-bottom: none; }
  .toggle-btn { width: 38px; height: 22px; border-radius: 11px; border: none; cursor: pointer; transition: background .2s; position: relative; flex-shrink: 0; }
  .toggle-btn.on { background: var(--success); }
  .toggle-btn.off { background: var(--border); }
  .toggle-btn::after { content: ''; position: absolute; width: 16px; height: 16px; border-radius: 50%; background: #fff; top: 3px; transition: left .2s; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
  .toggle-btn.on::after { left: 19px; }
  .toggle-btn.off::after { left: 3px; }

  /* Customer profile cards */
  .customer-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px; cursor: pointer; transition: border-color .15s, box-shadow .15s; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
  .customer-card:hover { border-color: var(--accent); box-shadow: 0 2px 8px rgba(212,132,10,.1); }
  .customer-card-name { font-family: var(--font-head); font-size: 16px; font-weight: 700; margin-bottom: 4px; }
  .customer-card-meta { font-size: 13px; color: var(--muted); display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
  .cars-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  .car-chip { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 3px 10px; font-size: 12px; font-weight: 500; }
  .history-mini { font-size: 12px; color: var(--muted); }

  /* Profile detail */
  .profile-section { margin-bottom: 16px; }
  .profile-section-title { font-family: var(--font-head); font-size: 13px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .6px; margin-bottom: 10px; }
  .car-card { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; }
  .car-card-info { font-size: 14px; font-weight: 600; }
  .car-card-plate { font-size: 12px; color: var(--muted); margin-top: 2px; }

  /* History view */
  .history-job-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 16px; margin-bottom: 8px; cursor: pointer; transition: border-color .15s; }
  .history-job-card:hover { border-color: var(--accent); }

  /* Modal */
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 200; display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 40px 16px; }
  .modal { background: var(--card); border: 1px solid var(--border); border-radius: 14px; width: 100%; max-width: 640px; box-shadow: 0 8px 40px rgba(0,0,0,.15); }
  .modal-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .modal-header h3 { font-family: var(--font-head); font-size: 17px; font-weight: 700; }
  .modal-close { background: none; border: none; color: var(--muted); font-size: 20px; cursor: pointer; line-height: 1; }
  .modal-close:hover { color: var(--text); }
  .modal-body { padding: 20px; }
  .modal-footer { padding: 14px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; }

  /* Empty */
  .empty { text-align: center; padding: 60px 20px; color: var(--muted); }
  .empty h3 { font-family: var(--font-head); font-size: 18px; margin-bottom: 8px; color: var(--text); }

  /* Divider */
  .job-detail { display: flex; flex-direction: column; gap: 14px; }

  .bottom-nav { display: none; }
  @media (max-width: 640px) {
    /* iOS zooms in on focus when an input's font-size < 16px — force 16px on phones */
    input, select, textarea,
    .filter-input, .filter-select, .search-input,
    .form-field input, .form-field select, .form-field textarea { font-size: 16px !important; }
    .form-grid, .detail-grid { grid-template-columns: 1fr; }
    .nav-tabs { display: none; }
    .topbar { padding: 0 12px; }
    .main { padding: 14px 12px 84px; }
    .bottom-nav { display: flex; position: fixed; bottom: 0; left: 0; right: 0; z-index: 150;
      background: var(--surface); border-top: 1px solid var(--border); box-shadow: 0 -2px 10px rgba(0,0,0,.06);
      padding: 6px 6px calc(6px + env(safe-area-inset-bottom)); justify-content: space-around; }
    .bottom-nav-item { flex: 1; background: none; border: none; display: flex; flex-direction: column; align-items: center; gap: 2px;
      padding: 6px 4px; border-radius: 10px; cursor: pointer; color: var(--muted); font-size: 11px; font-weight: 600; }
    .bottom-nav-item.active { color: var(--accent); background: #FFF7EC; }
    .bottom-nav-icon { font-size: 18px; line-height: 1; }
  }
`;

function StyleTag() {
  useEffect(() => {
    // Ensure the mobile viewport is set so the app renders at device width (no zoom-in).
    let vp = document.querySelector('meta[name="viewport"]');
    const created = !vp;
    if (!vp) { vp = document.createElement("meta"); vp.name = "viewport"; }
    vp.setAttribute("content", "width=device-width, initial-scale=1, viewport-fit=cover");
    if (created) document.head.appendChild(vp);

    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);
  return null;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const m = statusMeta(status);
  return <span className="status-pill" style={{ background: m.color + "18", color: m.color, border: `1px solid ${m.color}33` }}>{m.label}</span>;
}

// Distributor's item verification (checkpoint 2) → per-line "Collected" chip
const itemOK = (job, itemId) => !!(job.item_checks || {})[itemId];

// TEST ONLY — push an order through every stage in one shot, so a solo sales
// tester can fill realistic history without switching into truck/distributor.
// Builds the same check maps the real flow produces, so verification reads 4/4.
function forceCompletePatch(job) {
  const items = job.items || [];
  const collectable = items.filter(it => (it.kind === "tire" && it.tire_id) || it.kind === "part");
  const verifiable = items.filter(it => (it.kind === "tire" && it.tire_id) || it.kind === "part" || it.kind === "service");
  const now = new Date().toISOString();
  const allTrue = (list) => { const m = {}; list.forEach(it => { m[it.id] = true; }); return m; };
  return {
    parts_released: true, techs_released: true, parts_received: true,
    parts_status: "delivered", tech_arrival_match: true,
    sales_match_confirmed: true,
    item_checks: allTrue(collectable),
    tech_checks_order: allTrue(verifiable),
    tech_checks_car: allTrue(verifiable),
    status: "done", truck_status: "completed",
    started_at: job.started_at || now, completed_at: now,
    payment_status: job.payment_status || "paid",
    updated_at: now,
  };
}
// hidden test-mode flag (owner flips it; persists on this device)
const getTestMode = () => { try { return localStorage.getItem("bnchr_testmode") === "1"; } catch { return false; } };
const setTestMode = (on) => { try { localStorage.setItem("bnchr_testmode", on ? "1" : "0"); } catch {} };
function CollectedChip({ ok }) {
  if (!ok) return null;
  return <span style={{ fontSize: 9.5, fontWeight: 700, color: "#15803D", background: "#DCFCE7", border: "1px solid #BBF7D0", borderRadius: 5, padding: "1px 5px", whiteSpace: "nowrap", marginLeft: 5 }}>✓ Collected</span>;
}

// ─── ComboBox: autocomplete that suggests from a list but allows custom input ─
function ComboBox({ value, onChange, options, placeholder, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const typed = q !== "" ? q : (value || "");
  const filtered = (options || []).filter(o => o.toLowerCase().includes((q || "").toLowerCase())).slice(0, 60);
  const exact = (options || []).some(o => o.toLowerCase() === (typed || "").toLowerCase());

  const pick = (o) => { onChange(o); setQ(""); setOpen(false); };

  return (
    <div ref={ref} className="search-wrap">
      <input
        className="filter-input"
        style={{ width: "100%" }}
        placeholder={placeholder}
        disabled={disabled}
        value={open ? q : (value || "")}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setQ(value || ""); setOpen(true); }}
      />
      {open && !disabled && (
        <div className="search-dropdown" style={{ maxHeight: 220 }}>
          {filtered.length === 0 && (
            <div className="search-item"><div className="search-item-sub">No matches — your text will be saved as-is.</div></div>
          )}
          {filtered.map(o => (
            <div key={o} className="search-item" onClick={() => pick(o)}>
              <div className="search-item-name" style={{ fontSize: 14 }}>{o}</div>
            </div>
          ))}
          {typed && !exact && (
            <div className="search-new" onClick={() => pick(typed)}>
              + Use "{typed}" (custom)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Catalog Picker: searchable oils/batteries with custom-text fallback ──────
function CatalogPicker({ items, value, placeholder, onPick, onCustom }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const typed = open ? q : (value || "");
  const filtered = (items || []).filter(x =>
    `${x.description} ${x.sku}`.toLowerCase().includes((q || "").toLowerCase())).slice(0, 40);
  return (
    <div ref={ref} className="search-wrap" style={{ flex: 1 }}>
      <input className="filter-input" style={{ width: "100%" }} placeholder={placeholder}
        value={typed}
        onChange={(e) => { setQ(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setQ(""); setOpen(true); }} />
      {open && (
        <div className="search-dropdown" style={{ maxHeight: 240 }}>
          {filtered.map(x => (
            <div key={x.sku} className="search-item" onClick={() => { onPick(x); setQ(""); setOpen(false); }}>
              <div className="search-item-name" style={{ fontSize: 13.5 }}>{x.description}</div>
              <div className="search-item-sub">{x.sku}{x.price ? ` · KD ${Number(x.price)} /u` : ""}{x.supplier ? ` · ${x.supplier}` : ""}</div>
            </div>
          ))}
          {filtered.length === 0 && <div className="search-item"><div className="search-item-sub">No matches in the catalog.</div></div>}
          {q && (
            <div className="search-new" onClick={() => { onCustom(q); setQ(""); setOpen(false); }}>
              ✏ Use "{q}" as custom text
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Customer Search Box ──────────────────────────────────────────────────────
function CustomerSearchBox({ customers, onSelect, onCreateNew }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = q.length < 2 ? [] : customers.filter(c =>
    c.name.toLowerCase().includes(q.toLowerCase()) ||
    c.mobile.includes(q)
  );

  return (
    <div ref={ref} className="search-wrap">
      <span className="search-icon">🔍</span>
      <input
        className="search-input"
        placeholder="Search customer by name or mobile…"
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => q.length >= 2 && setOpen(true)}
      />
      {open && q.length >= 2 && (
        <div className="search-dropdown">
          {filtered.map(c => (
            <div key={c.id} className="search-item" onClick={() => { onSelect(c); setOpen(false); setQ(""); }}>
              <div className="search-item-name">{c.name}</div>
              <div className="search-item-sub">{c.mobile} · {c.area}</div>
            </div>
          ))}
          <div className="search-new" onClick={() => { onCreateNew(q); setOpen(false); setQ(""); }}>
            + Create new customer "{q}"
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tire Catalog Picker ──────────────────────────────────────────────────────
function TireCatalogPicker({ onPick }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    const id = setTimeout(async () => {
      const r = await searchTires(q);
      setResults(r); setLoading(false); setOpen(true);
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div ref={ref} className="search-wrap">
      <span className="search-icon">🔍</span>
      <input className="search-input" placeholder="Search catalog by size (215/60R18) or brand…"
        value={q} onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => results.length && setOpen(true)} />
      {open && q.trim().length >= 2 && (
        <div className="search-dropdown">
          {loading && <div className="search-item"><div className="search-item-sub">Searching catalog…</div></div>}
          {!loading && results.length === 0 && (
            <div className="search-item"><div className="search-item-sub">No tires found — add a manual item instead.</div></div>
          )}
          {results.map(t => (
            <div key={t.id} className="search-item" onClick={() => { onPick(t); setOpen(false); setQ(""); }}>
              <div className="search-item-name">{t.brand}{t.pattern ? " " + t.pattern : ""}</div>
              <div className="search-item-sub">
                {tireSize(t)}{liSr(t.load_index, t.speed_rating)}{t.oem ? " · " + t.oem : ""}{t.year ? " · " + t.year : ""}{t.country ? " · " + t.country : ""}{t.sku ? " · " + t.sku : ""}{t.notes ? " · " + t.notes : ""}
                {" · "}<strong style={{ color: "var(--accent)" }}>KWD {Number(t.price).toFixed(3)}</strong>
                {t.in_stock ? <span style={{ color: "var(--success)", marginLeft: 6 }}>● in stock</span>
                            : <span style={{ color: "var(--danger)", marginLeft: 6 }}>● out</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Job Items Builder ────────────────────────────────────────────────────────
function ItemsBuilder({ items, setItems }) {
  const addTire = (t) => setItems(prev => [...prev, {
    id: uid(), kind: "tire", tire_id: t.id,
    brand: t.brand, pattern: t.pattern, size: `${t.width}/${t.aspect}R${t.rim}`,
    year: t.year, cost: t.cost, supplier: t.supplier,
    qty: 4, unit_price: Number(t.price) || 0,
  }]);
  const addService = () => setItems(prev => [...prev, {
    id: uid(), kind: "service", name: "", qty: 1, unit_price: 0,
  }]);
  const upd = (id, field, val) => setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: val } : it));
  const remove = (id) => setItems(prev => prev.filter(it => it.id !== id));

  return (
    <div className="form-full">
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        {items.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>No items yet. Add a tire from the catalog or a manual service below.</div>
        )}
        {items.map(it => (
          <div key={it.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", background: it.kind === "tire" ? "#FEFBF3" : "var(--bg)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1 }}>
                {it.kind === "tire" ? (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>🔗 {it.brand} {it.pattern}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{it.size}{it.year ? " · " + it.year : ""} · catalog id {String(it.tire_id).slice(0, 8)}…</div>
                  </>
                ) : (
                  <input className="filter-input" style={{ width: "100%" }} placeholder="Service name (Oil & Filter, Battery…)"
                    value={it.name} onChange={e => upd(it.id, "name", e.target.value)} />
                )}
              </div>
              <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)", borderColor: "var(--border)" }} onClick={() => remove(it.id)}>✕</button>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Qty</label>
                <input type="number" min={1} className="filter-input" style={{ width: 70 }} value={it.qty} onChange={e => upd(it.id, "qty", e.target.value)} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Unit Price (KD)</label>
                <input type="number" className="filter-input" style={{ width: 110 }} value={it.unit_price} onChange={e => upd(it.id, "unit_price", e.target.value)} />
              </div>
              <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Line Total</div>
                <div style={{ fontWeight: 700, color: "var(--accent)" }}>KWD {((Number(it.qty) || 0) * (Number(it.unit_price) || 0)).toFixed(3)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <TireCatalogPicker onPick={addTire} />
        </div>
        <button className="btn btn-ghost btn-sm" onClick={addService}>+ Manual service</button>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
        <div style={{ textAlign: "right" }}>
          <span style={{ fontSize: 12, color: "var(--muted)", marginRight: 10 }}>Job Total</span>
          <span style={{ fontFamily: "var(--font-head)", fontSize: 18, fontWeight: 700, color: "var(--accent)" }}>KWD {itemsTotal(items).toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Discount helpers ─────────────────────────────────────────────────────────
// A discount = { type: "pct"|"amt", value: number }. Applied to a base number.
function applyDiscount(base, disc) {
  const b = Number(base) || 0;
  if (!disc || !disc.value) return b;
  const v = Number(disc.value) || 0;
  if (disc.type === "pct") return Math.max(0, b - (b * v) / 100);
  return Math.max(0, b - v);
}
const blankDisc = () => ({ type: "pct", value: 0 });

// One editable discount control (toggle %/amount + value), shows live result.
function DiscountField({ base, disc, onChange, label }) {
  const result = applyDiscount(base, disc);
  const has = disc && Number(disc.value) > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>{label} discount</label>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
          <button type="button" onClick={() => onChange({ ...disc, type: "pct" })}
            style={{ border: "none", padding: "4px 8px", fontSize: 11, cursor: "pointer", background: disc.type === "pct" ? "var(--accent)" : "var(--card)", color: disc.type === "pct" ? "#fff" : "var(--muted)" }}>%</button>
          <button type="button" onClick={() => onChange({ ...disc, type: "amt" })}
            style={{ border: "none", padding: "4px 8px", fontSize: 11, cursor: "pointer", background: disc.type === "amt" ? "var(--accent)" : "var(--card)", color: disc.type === "amt" ? "#fff" : "var(--muted)" }}>KD</button>
        </div>
        <input type="number" min={0} className="filter-input" style={{ width: 64 }} value={disc.value || ""}
          placeholder="0" onChange={e => onChange({ ...disc, value: e.target.value })} />
        {has && <span style={{ fontSize: 11, color: "var(--success)", fontWeight: 600, whiteSpace: "nowrap" }}>→ {result.toFixed(3)}</span>}
      </div>
    </div>
  );
}

// A single part row within an "other" service.
const newPart = () => ({ id: uid(), name: "", supplier: "", qty: 1, price: 0, cost: 0 });

// ─── Service item templates ───────────────────────────────────────────────────
// Selecting these services pre-fills their parts. Every row stays editable,
// deletable, and overridable; "+ Add part" still adds normal rows.
// tpl keys: EO/BT = catalog pickers · others = option lists (brand-aware).
const TPL_OPTIONS = {
  oil_filter:  (b) => [...(b ? [`${b} Genuine Oil Filter`] : []), "Oil Filter", ...CAR_BRANDS.filter(x => x !== b).map(x => `${x} Genuine Oil Filter`)],
  brake_pads:  (b) => [...(b ? [`${b} Genuine Front Brake Pads`, `${b} Genuine Rear Brake Pads`] : []), "Front Brake Pads", "Rear Brake Pads", ...CAR_BRANDS.filter(x => x !== b).flatMap(x => [`${x} Genuine Front Brake Pads`, `${x} Genuine Rear Brake Pads`])],
  brake_disc:  (b) => [...(b ? [`${b} Genuine Front Brake Disc`, `${b} Genuine Rear Brake Disc`] : []), "Front Brake Disc", "Rear Brake Disc", ...CAR_BRANDS.filter(x => x !== b).flatMap(x => [`${x} Genuine Front Brake Disc`, `${x} Genuine Rear Brake Disc`])],
  brake_sensor: () => ["Genuine Brake Sensor", "Brake Sensor"],
  spark_plugs: (b) => [...(b ? [`${b} Genuine Spark Plugs`] : []), ...CAR_BRANDS.filter(x => x !== b).map(x => `${x} Genuine Spark Plugs`)],
  air_filter:  () => ["Genuine Air Filter", "Air Filter"],
  ac_filter:   () => ["Genuine AC Filter", "AC Filter"],
};
const SERVICE_TEMPLATES = {
  "Oil & Filter": [
    { tpl: "EO", qty: 4 },                       // engine oil from catalog, per litre
    { tpl: "oil_filter", name: "Oil Filter" },
  ],
  "Battery": [
    { tpl: "BT" },                                // battery from catalog
  ],
  "Major Service": [
    { tpl: "EO", qty: 4 },
    { tpl: "oil_filter", name: "Oil Filter" },
    { tpl: "spark_plugs", name: "Spark Plugs" },
    { name: "Spark Plug Wires" },
    { tpl: "air_filter", name: "Air Filter" },
    { tpl: "ac_filter", name: "AC Filter" },
    { name: "Injector Cleaner" },
    { name: "Carburetor Tune-Up Conditioner" },
  ],
};
// When a car gets linked, template rows still holding option values switch to
// that brand's genuine part automatically (Front/Rear preserved; custom text untouched).
const rebrandPartName = (tpl, name, brand) => {
  if (!brand) return name;
  const isRear = /rear/i.test(name || "");
  if (tpl === "oil_filter")  return `${brand} Genuine Oil Filter`;
  if (tpl === "spark_plugs") return `${brand} Genuine Spark Plugs`;
  if (tpl === "brake_pads")  return `${brand} Genuine ${isRear ? "Rear" : "Front"} Brake Pads`;
  if (tpl === "brake_disc")  return `${brand} Genuine ${isRear ? "Rear" : "Front"} Brake Disc`;
  return name;
};
const rebrandParts = (parts, brand) =>
  (parts || []).map(p => p.tpl && !p.custom ? { ...p, name: rebrandPartName(p.tpl, p.name, brand) } : p);

const buildTemplateParts = (serviceType, carBrand, sides = "both") => {
  const mk = (row) => ({
    ...newPart(),
    name: row.tpl && carBrand ? rebrandPartName(row.tpl, row.name || "", carBrand) : (row.name || ""),
    qty: row.qty || 1,
    tpl: row.tpl || null,
  });
  if (serviceType === "Brake Pads") {
    const rows = [];
    if (sides !== "rear")  rows.push({ tpl: "brake_pads", name: "Front Brake Pads" });
    if (sides !== "front") rows.push({ tpl: "brake_pads", name: "Rear Brake Pads" });
    rows.push({ tpl: "brake_sensor", name: "Brake Sensor" });
    return rows.map(mk);
  }
  if (serviceType === "Brake Disc") {
    const rows = [];
    if (sides !== "rear")  rows.push({ tpl: "brake_disc", name: "Front Brake Disc" });
    if (sides !== "front") rows.push({ tpl: "brake_disc", name: "Rear Brake Disc" });
    return rows.map(mk);
  }
  const t = SERVICE_TEMPLATES[serviceType];
  if (!t) return [newPart()];
  return t.map(mk);
};
const partsGross = (parts) => (parts || []).reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.qty) || 1), 0);

// Compute a single service block's totals.
function serviceTotals(svc) {
  const isTire = SERVICE_CATALOG[svc.service_type]?.kind === "tire";
  let grossPrice;
  if (isTire) {
    if (svc.staggered) {
      grossPrice = (Number(svc.unit_price) || 0) * (Number(svc.qty) || 2) + (Number(svc.rear_unit_price) || 0) * (Number(svc.rear_qty) || 2);
    } else {
      const qty = Number(svc.qty) || 4;
      grossPrice = (Number(svc.unit_price) || 0) * qty;
    }
  } else {
    // other services: parts subtotal = sum of item prices
    grossPrice = partsGross(svc.parts);
  }
  const qty = Number(svc.qty) || (isTire ? 4 : 1);
  const netPrice = applyDiscount(grossPrice, svc.price_disc);
  const grossLabor = Number(svc.labor) || 0;
  const netLabor = applyDiscount(grossLabor, svc.labor_disc);
  return { qty, grossPrice, netPrice, grossLabor, netLabor, total: netPrice + netLabor };
}
const orderTotal = (services) => (services || []).reduce((s, svc) => s + serviceTotals(svc).total, 0);
// A service carries a product if it has a real tire OR any priced part.
const svcHasProduct = (s) => !!s.tire_id || !!s.rear_tire_id || (SERVICE_CATALOG[s.service_type]?.kind === "tire" ? (Number(s.unit_price) || 0) > 0 || (Number(s.rear_unit_price) || 0) > 0 : partsGross(s.parts) > 0 || (s.parts || []).some(p => p.name));
const orderHasProducts = (services) => (services || []).some(svcHasProduct);

// A fresh service block.
const newService = (type = "Tire Change & Balancing") => {
  const cat = SERVICE_CATALOG[type] || {};
  const variant = {};
  Object.entries(cat.variants || {}).forEach(([axis, opts]) => { variant[axis] = opts[0]; });
  return {
    id: uid(), service_type: type, kind: cat.kind || "other",
    variant,
    // tire fields (front when staggered)
    tire_id: null, brand: "", pattern: "", size: "", year: "", cost: 0, supplier: "", load_index: "", speed_rating: "", country: "", oem: "", tire_note: "",
    staggered: false,
    rear_tire_id: null, rear_brand: "", rear_pattern: "", rear_size: "", rear_year: "", rear_cost: 0, rear_supplier: "", rear_unit_price: 0, rear_qty: 2, rear_load_index: "", rear_speed_rating: "", rear_country: "", rear_oem: "", rear_tire_note: "",
    // other fields
    description: "",
    parts: cat.kind === "tire" ? [] : [newPart()], // itemized parts for other services
    qty: cat.kind === "tire" ? 4 : 1,
    unit_price: 0,
    price_disc: blankDisc(),
    labor: catalogLabor(type, variant, cat.kind === "tire" ? 4 : 1),
    labor_disc: blankDisc(),
    car_id: null,
    _open: true,
  };
};

// ─── Service Builder: array of service blocks, each its own formula ───────────
function ServiceBuilder({ services, setServices, customerCars, onSaveCar, catalog }) {
  const upd = (id, patch) => setServices(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  const remove = (id) => setServices(prev => prev.filter(s => s.id !== id));
  const addBlock = () => setServices(prev => prev.map(s => ({ ...s, _open: false })).concat(newService()));
  // parts helpers (other services)
  const addPart = (sid) => setServices(prev => prev.map(s => s.id === sid ? { ...s, parts: [...(s.parts || []), newPart()] } : s));
  const updPart = (sid, pid, patch) => setServices(prev => prev.map(s => s.id === sid ? { ...s, parts: (s.parts || []).map(p => p.id === pid ? { ...p, ...patch } : p) } : s));
  const removePart = (sid, pid) => setServices(prev => prev.map(s => s.id === sid ? { ...s, parts: (s.parts || []).filter(p => p.id !== pid) } : s));

  // when service type changes, reset variant + auto-labor + kind/qty
  const changeType = (id, type) => {
    const cat = SERVICE_CATALOG[type] || {};
    const variant = {};
    Object.entries(cat.variants || {}).forEach(([axis, opts]) => { variant[axis] = opts[0]; });
    const svcNow = (services || []).find(s => s.id === id);
    const carBrand = svcNow && (customerCars || []).find(c => c.id === svcNow.car_id)?.brand;
    const isBrake = type === "Brake Pads" || type === "Brake Disc";
    if (isBrake && variant.sides) variant.sides = "Two sides"; // Front & Rear default
    upd(id, {
      service_type: type, kind: cat.kind || "other", variant,
      sides: isBrake ? "both" : undefined,
      qty: cat.kind === "tire" ? 4 : 1,
      labor: catalogLabor(type, variant, cat.kind === "tire" ? 4 : 1),
      // clear cross-formula fields + apply the service's item template
      tire_id: null, brand: "", pattern: "", size: "", description: "",
      unit_price: 0,
      parts: cat.kind === "tire" ? [] : buildTemplateParts(type, carBrand, "both"),
    });
  };
  const changeVariant = (id, axis, value, svc) => {
    const variant = { ...svc.variant, [axis]: value };
    const q = svc.staggered ? (Number(svc.qty) || 0) + (Number(svc.rear_qty) || 0) : svc.qty;
    upd(id, { variant, labor: catalogLabor(svc.service_type, variant, q) });
  };
  const totalTireQty = (s, patch = {}) => {
    const m = { ...s, ...patch };
    return m.staggered ? (Number(m.qty) || 0) + (Number(m.rear_qty) || 0) : (Number(m.qty) || 4);
  };
  const pickTire = (id, t, svc, pos) => {
    if (pos === "rear") {
      upd(id, { rear_tire_id: t.id, rear_brand: t.brand, rear_pattern: t.pattern, rear_size: `${t.width}/${t.aspect}R${t.rim}`,
        rear_year: t.year, rear_cost: t.cost, rear_supplier: t.supplier, rear_unit_price: Number(t.price) || 0, rear_sku: t.sku || "",
        rear_load_index: t.load_index || "", rear_speed_rating: t.speed_rating || "", rear_country: t.country || "", rear_oem: t.oem || "", rear_tire_note: t.notes || "",
        labor: catalogLabor(svc.service_type, svc.variant, totalTireQty(svc)) });
    } else if (svc.staggered) {
      upd(id, { tire_id: t.id, brand: t.brand, pattern: t.pattern, size: `${t.width}/${t.aspect}R${t.rim}`, sku: t.sku || "",
        load_index: t.load_index || "", speed_rating: t.speed_rating || "", country: t.country || "", oem: t.oem || "", tire_note: t.notes || "",
        year: t.year, cost: t.cost, supplier: t.supplier, unit_price: Number(t.price) || 0,
        labor: catalogLabor(svc.service_type, svc.variant, totalTireQty(svc)) });
    } else {
      upd(id, { tire_id: t.id, brand: t.brand, pattern: t.pattern, size: `${t.width}/${t.aspect}R${t.rim}`, sku: t.sku || "",
        load_index: t.load_index || "", speed_rating: t.speed_rating || "", country: t.country || "", oem: t.oem || "", tire_note: t.notes || "",
        year: t.year, cost: t.cost, supplier: t.supplier, unit_price: Number(t.price) || 0, qty: 4,
        labor: catalogLabor(svc.service_type, svc.variant, 4) });
    }
  };

  const carLabel = (cid) => {
    const c = (customerCars || []).find(x => x.id === cid);
    return c ? `${c.brand} ${c.model} ${c.year}` : null;
  };

  return (
    <div className="form-full">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(services || []).length === 0 && (
          <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>No services yet. Add one below.</div>
        )}
        {(services || []).map((svc, idx) => {
          const cat = SERVICE_CATALOG[svc.service_type] || {};
          const t = serviceTotals(svc);
          const isTire = cat.kind === "tire";
          if (!svc._open) {
            // collapsed summary row
            return (
              <div key={svc.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", background: "var(--card)", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                onClick={() => upd(svc.id, { _open: true })}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {idx + 1}. {svc.service_type}
                    {Object.values(svc.variant || {}).filter(Boolean).length > 0 && <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}> · {Object.values(svc.variant).join(" / ")}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {isTire ? (svc.staggered ? `Staggered · F ${svc.qty}× + R ${svc.rear_qty}×` : (svc.tire_id ? `${svc.brand} ${svc.pattern} · ${svc.qty}×` : `Labor only · ${svc.qty}×${svc.description ? " · " + svc.description.slice(0, 20) : ""}`)) : (svc.description ? svc.description.slice(0, 40) + (svc.description.length > 40 ? "…" : "") : "No description")}
                    {carLabel(svc.car_id) ? ` · ${carLabel(svc.car_id)}` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, color: "var(--accent)" }}>KWD {t.total.toFixed(3)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>tap to edit</div>
                </div>
              </div>
            );
          }
          return (
            <div key={svc.id} style={{ border: "1px solid var(--accent)", borderRadius: 10, padding: "14px", background: isTire ? "#FEFBF3" : "var(--bg)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <strong style={{ fontFamily: "var(--font-head)" }}>Service {idx + 1}</strong>
                <div style={{ display: "flex", gap: 6 }}>
                  {(services.length > 1) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => upd(svc.id, { _open: false })}>Done</button>}
                  <button type="button" className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => remove(svc.id)}>✕</button>
                </div>
              </div>

              {/* Service type */}
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
                <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Service type</label>
                <select className="filter-input" value={svc.service_type} onChange={e => changeType(svc.id, e.target.value)}>
                  {SERVICE_NAMES.map(n => <option key={n}>{n}</option>)}
                </select>
              </div>

              {/* Variants */}
              {Object.entries(cat.variants || {}).length > 0 && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  {Object.entries(cat.variants).filter(([axis]) => !(axis === "sides" && (svc.service_type === "Brake Pads" || svc.service_type === "Brake Disc"))).map(([axis, opts]) => (
                    <div key={axis} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>{axis === "mount" ? "Type" : axis === "tier" ? "Car tier" : axis}</label>
                      <select className="filter-input" value={svc.variant[axis] || ""} onChange={e => changeVariant(svc.id, axis, e.target.value, svc)}>
                        {opts.map(o => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}

              {/* Formula 1: tire — search is optional (no tire = labor only) */}
              {isTire ? (
                <div style={{ marginBottom: 10 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 600, marginBottom: 8, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!svc.staggered} onChange={e => {
                      const st = e.target.checked;
                      const patch = st
                        ? { staggered: true, qty: 2, rear_qty: 2 }
                        : { staggered: false, qty: 4, rear_tire_id: null, rear_brand: "", rear_pattern: "", rear_size: "", rear_unit_price: 0 };
                      upd(svc.id, { ...patch, labor: catalogLabor(svc.service_type, svc.variant, st ? 4 : 4) });
                    }} />
                    Staggered — front and rear tires are different
                  </label>

                  {!svc.staggered ? (
                    svc.tire_id ? (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>🔗 {svc.brand} {svc.pattern}</div>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>{itemSpec(svc) || svc.size}</div>
                        </div>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => upd(svc.id, { tire_id: null, brand: "", pattern: "", size: "", unit_price: 0 })}>Change</button>
                      </div>
                    ) : (
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Search tire <span style={{ textTransform: "none", fontWeight: 500 }}>· optional (leave empty for labor only)</span></label>
                        <TireCatalogPicker onPick={(t) => pickTire(svc.id, t, svc)} />
                        <textarea className="filter-input" style={{ minHeight: 40, resize: "vertical", width: "100%", marginTop: 6 }} value={svc.description}
                          placeholder="Optional note (e.g. customer supplies tires, mounting + balancing only)"
                          onChange={e => upd(svc.id, { description: e.target.value })} />
                      </div>
                    )
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {/* Front */}
                      <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>Front tires</div>
                        {svc.tire_id ? (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--card)", borderRadius: 8 }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>🔗 {svc.brand} {svc.pattern}</div>
                              <div style={{ fontSize: 12, color: "var(--muted)" }}>{itemSpec(svc) || svc.size}</div>
                            </div>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => upd(svc.id, { tire_id: null, brand: "", pattern: "", size: "", unit_price: 0 })}>Change</button>
                          </div>
                        ) : (
                          <TireCatalogPicker onPick={(t) => pickTire(svc.id, t, svc)} />
                        )}
                        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "flex-end" }}>
                          <div>
                            <label style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Qty</label>
                            <input type="number" min={1} className="filter-input" style={{ width: 56 }} value={svc.qty}
                              onChange={e => upd(svc.id, { qty: e.target.value, labor: catalogLabor(svc.service_type, svc.variant, totalTireQty(svc, { qty: e.target.value })) })} />
                          </div>
                          <div>
                            <label style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Price/tire (KD)</label>
                            <input type="number" min={0} className="filter-input" style={{ width: 90 }} value={svc.unit_price || ""} onChange={e => upd(svc.id, { unit_price: e.target.value })} />
                          </div>
                        </div>
                      </div>
                      {/* Rear */}
                      <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>Rear tires</div>
                        {svc.rear_tire_id ? (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--card)", borderRadius: 8 }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>🔗 {svc.rear_brand} {svc.rear_pattern}</div>
                              <div style={{ fontSize: 12, color: "var(--muted)" }}>{itemSpec({ size: svc.rear_size, load_index: svc.rear_load_index, speed_rating: svc.rear_speed_rating, year: svc.rear_year, country: svc.rear_country, oem: svc.rear_oem, tire_note: svc.rear_tire_note }) || svc.rear_size}</div>
                            </div>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => upd(svc.id, { rear_tire_id: null, rear_brand: "", rear_pattern: "", rear_size: "", rear_unit_price: 0 })}>Change</button>
                          </div>
                        ) : (
                          <TireCatalogPicker onPick={(t) => pickTire(svc.id, t, svc, "rear")} />
                        )}
                        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "flex-end" }}>
                          <div>
                            <label style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Qty</label>
                            <input type="number" min={1} className="filter-input" style={{ width: 56 }} value={svc.rear_qty}
                              onChange={e => upd(svc.id, { rear_qty: e.target.value, labor: catalogLabor(svc.service_type, svc.variant, totalTireQty(svc, { rear_qty: e.target.value })) })} />
                          </div>
                          <div>
                            <label style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Price/tire (KD)</label>
                            <input type="number" min={0} className="filter-input" style={{ width: 90 }} value={svc.rear_unit_price || ""} onChange={e => upd(svc.id, { rear_unit_price: e.target.value })} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                // Formula 2: other — itemized parts (name + supplier + qty + price + optional cost)
                <div style={{ marginBottom: 10 }}>
                  {(svc.service_type === "Brake Pads" || svc.service_type === "Brake Disc") && (
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Sides</label>
                      {[{ k: "both", label: "Front & Rear" }, { k: "front", label: "Front" }, { k: "rear", label: "Rear" }].map(o => (
                        <button key={o.k} type="button" className={`btn btn-sm ${(svc.sides || "both") === o.k ? "btn-primary" : "btn-ghost"}`}
                          onClick={() => {
                            const brand = (customerCars || []).find(c => c.id === svc.car_id)?.brand;
                            const tplKey = svc.service_type === "Brake Pads" ? "brake_pads" : "brake_disc";
                            setServices(prev => prev.map(s => {
                              if (s.id !== svc.id) return s;
                              const kept = (s.parts || []).filter(p => p.tpl !== tplKey);
                              const fresh = buildTemplateParts(s.service_type, brand, o.k).filter(p => p.tpl === tplKey);
                              const variant = { ...s.variant, sides: o.k === "both" ? "Two sides" : "One side" };
                              return { ...s, sides: o.k, variant, parts: [...fresh, ...kept], labor: catalogLabor(s.service_type, variant, s.qty) };
                            }));
                          }}>{o.label}</button>
                      ))}
                    </div>
                  )}
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Parts / items — each from its supplier</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(svc.parts || []).map((p, pi) => (
                      <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8, background: "var(--card)" }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{pi + 1}.</span>
                          {p.tpl && !p.custom ? (
                            (p.tpl === "EO" || p.tpl === "BT") ? (
                              <CatalogPicker
                                items={(catalog || []).filter(x => x.category === p.tpl)}
                                value={p.name}
                                placeholder={p.tpl === "EO" ? "🔍 Search engine oil (brand, grade, 5W30…)" : "🔍 Search battery (brand, warranty…)"}
                                onPick={(it) => updPart(svc.id, p.id, { name: it.description, sku: it.sku, cost: Number(it.cost) || 0, price: Number(it.price) || 0, supplier: it.supplier || p.supplier || "" })}
                                onCustom={(text) => updPart(svc.id, p.id, { name: text, sku: "", custom: true })}
                              />
                            ) : (
                              <select className="filter-input" style={{ flex: 1 }} value={p.name}
                                onChange={e => {
                                  if (e.target.value === "__custom__") { updPart(svc.id, p.id, { custom: true }); return; }
                                  updPart(svc.id, p.id, { name: e.target.value });
                                }}>
                                {(() => {
                                  const carBrand = (customerCars || []).find(c => c.id === svc.car_id)?.brand;
                                  const opts = TPL_OPTIONS[p.tpl] ? TPL_OPTIONS[p.tpl](carBrand) : [];
                                  return (opts.includes(p.name) ? opts : [p.name, ...opts]).map(o => <option key={o}>{o}</option>);
                                })()}
                                <option value="__custom__">✏ Custom text…</option>
                              </select>
                            )
                          ) : (
                            <input className="filter-input" style={{ flex: 1 }} value={p.name} placeholder="Part (e.g. Total 20W50 5L, oil filter, drain bolt)"
                              onChange={e => updPart(svc.id, p.id, { name: e.target.value })} />
                          )}
                          {(svc.parts.length > 1) && <button type="button" className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => removePart(svc.id, p.id)}>✕</button>}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
                          <div style={{ flex: "1 1 130px" }}>
                            <label style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Supplier</label>
                            <ComboBox value={p.supplier} onChange={v => updPart(svc.id, p.id, { supplier: v })} options={OTHER_SUPPLIERS} placeholder="Supplier" />
                          </div>
                          <div style={{ width: 48 }}>
                            <label style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Qty</label>
                            <input type="number" min={1} className="filter-input" style={{ width: "100%" }} value={p.qty} onChange={e => updPart(svc.id, p.id, { qty: e.target.value })} />
                          </div>
                          <div style={{ width: 76 }}>
                            <label style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Price</label>
                            <input type="number" min={0} className="filter-input" style={{ width: "100%" }} value={p.price || ""} onChange={e => updPart(svc.id, p.id, { price: e.target.value })} />
                          </div>
                          <div style={{ width: 76 }}>
                            <label style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Cost <span style={{ textTransform: "none", fontWeight: 400 }}>opt</span></label>
                            <input type="number" min={0} className="filter-input" style={{ width: "100%" }} value={p.cost || ""} onChange={e => updPart(svc.id, p.id, { cost: e.target.value })} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => addPart(svc.id)}>+ Add part</button>
                    {svc.service_type === "Oil & Filter" && !(svc.parts || []).some(p => /injector/i.test(p.name)) && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setServices(prev => prev.map(s => s.id === svc.id ? { ...s, parts: [...(s.parts || []), { ...newPart(), name: "Injector Cleaner" }] } : s))}>+ Injector Cleaner</button>
                    )}
                  </div>
                </div>
              )}

              {/* Price row — tires use qty×unit price; other services use parts sum */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
                {isTire && !svc.staggered && (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Qty</label>
                      <input type="number" min={1} className="filter-input" style={{ width: 60 }} value={svc.qty} onChange={e => { const q = e.target.value; upd(svc.id, { qty: q, labor: catalogLabor(svc.service_type, svc.variant, q) }); }} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Price/tire (KD)</label>
                      <input type="number" min={0} className="filter-input" style={{ width: 90 }} value={svc.unit_price || ""} onChange={e => upd(svc.id, { unit_price: e.target.value })} />
                    </div>
                  </>
                )}
                <DiscountField base={t.grossPrice} disc={svc.price_disc} onChange={(d) => upd(svc.id, { price_disc: d })} label="Price" />
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>{isTire ? "Tires subtotal" : "Parts subtotal"}</div>
                  <div style={{ fontWeight: 700 }}>KWD {t.netPrice.toFixed(3)}</div>
                </div>
              </div>

              {/* Labor (auto-filled) + labor discount */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Labor (KD) · auto</label>
                  <input type="number" min={0} className="filter-input" style={{ width: 90 }} value={svc.labor || ""} onChange={e => upd(svc.id, { labor: e.target.value })} />
                </div>
                <DiscountField base={t.grossLabor} disc={svc.labor_disc} onChange={(d) => upd(svc.id, { labor_disc: d })} label="Labor" />
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>Labor subtotal</div>
                  <div style={{ fontWeight: 700 }}>KWD {t.netLabor.toFixed(3)}</div>
                </div>
              </div>

              {/* Link car */}
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
                <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Link to car</label>
                <select className="filter-input" value={svc.new_car ? "__new__" : (svc.car_id || "")}
                  onChange={e => {
                    if (e.target.value === "__new__") upd(svc.id, { car_id: null, new_car: { brand: "", model: "", year: "", plate: "" } });
                    else {
                      const cid = e.target.value || null;
                      const brand = (customerCars || []).find(c => c.id === cid)?.brand;
                      upd(svc.id, { car_id: cid, new_car: null, parts: rebrandParts(svc.parts, brand) });
                    }
                  }}>
                  <option value="">— select car —</option>
                  {(customerCars || []).map(c => <option key={c.id} value={c.id}>{c.brand} {c.model}{c.sub_model ? ` ${c.sub_model}` : ""} {c.year} {c.plate ? `· ${c.plate}` : ""}</option>)}
                  <option value="__new__">+ Link a new car…</option>
                </select>
                {svc.new_car && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6, padding: 8, border: "1px dashed var(--border)", borderRadius: 8 }}>
                    <ComboBox value={svc.new_car.brand} onChange={(v) => upd(svc.id, { new_car: { ...svc.new_car, brand: v, model: "", sub_model: "" } })} options={carBrandOpts()} placeholder="Brand" />
                    <ComboBox value={svc.new_car.model} onChange={(v) => upd(svc.id, { new_car: { ...svc.new_car, model: v, sub_model: "" } })} options={carModelOpts(svc.new_car.brand)} placeholder="Model" />
                    <ComboBox value={svc.new_car.sub_model || ""} onChange={(v) => upd(svc.id, { new_car: { ...svc.new_car, sub_model: v } })} options={carSubModelOpts(svc.new_car.brand, svc.new_car.model)} placeholder="Sub-Model (optional)" />
                    <ComboBox value={svc.new_car.year} onChange={(v) => upd(svc.id, { new_car: { ...svc.new_car, year: v } })} options={carYears} placeholder="Year" />
                    <input className="filter-input" value={svc.new_car.plate} onChange={e => upd(svc.id, { new_car: { ...svc.new_car, plate: e.target.value } })} placeholder="VIN" />

                    <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center" }}>
                      <button type="button" className="btn btn-primary btn-sm" disabled={!onSaveCar || !svc.new_car.brand || !svc.new_car.model} onClick={() => onSaveCar && onSaveCar(svc.id)}>💾 Save car to profile</button>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>{onSaveCar ? "Saves to the customer's cars." : "Save or select the customer first — then cars attach to their profile."}</span>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                <span style={{ fontSize: 12, color: "var(--muted)", marginRight: 10 }}>Service total</span>
                <span style={{ fontFamily: "var(--font-head)", fontSize: 16, fontWeight: 700, color: "var(--accent)" }}>KWD {t.total.toFixed(3)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={addBlock}>+ Add another service</button>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, paddingTop: 12, borderTop: "2px solid var(--border)" }}>
        <span style={{ fontSize: 13, color: "var(--muted)", marginRight: 10 }}>Order Total</span>
        <span style={{ fontFamily: "var(--font-head)", fontSize: 20, fontWeight: 700, color: "var(--accent)" }}>KWD {orderTotal(services).toFixed(3)}</span>
      </div>
    </div>
  );
}

// ─── Truck Slot Grid ──────────────────────────────────────────────────────────
// One day, all active trucks as columns, 1h rows. Click a free slot to select a
// start; the job spans `duration` consecutive hours. Shows booked slots.
function TruckSlotGrid({ jobs, dateStr, duration, selectedTruck, selectedHour, onPick, onJobClick, excludeId }) {
  const allHours = [];
  activeTrucks().forEach(t => truckHours(t).forEach(h => { if (!allHours.includes(h)) allHours.push(h); }));
  // include overtime rows for hours actually booked outside regular time on this date
  const regularSet = new Set(allHours);
  const otRowHours = new Set();
  jobs.forEach(j => {
    if (j.id === excludeId || j.status === "cancelled") return;
    const d = j.scheduled_at ? new Date(j.scheduled_at).toISOString().split("T")[0] : "";
    if (d !== dateStr) return;
    jobHours(j).forEach(h => { if (!regularSet.has(h)) { otRowHours.add(h); if (!allHours.includes(h)) allHours.push(h); } });
  });
  allHours.sort((a, b) => a - b);

  const canFit = (truck, hour) => {
    const hrs = truckHours(truck);
    for (let h = hour; h < hour + duration; h++) {
      if (!hrs.includes(h)) return false;
      if (slotTaken(jobs, truck, dateStr, h, excludeId)) return false;
    }
    return true;
  };
  const inSelection = (truck, hour) =>
    selectedTruck === truck && selectedHour != null &&
    hour >= selectedHour && hour < selectedHour + duration;
  const jobAt = (truck, hour) => jobs.find(j => {
    if (j.id === excludeId) return false;
    if (j.status === "cancelled") return false; // a cancelled order must never shadow the live booking in its old slot
    if (j.assigned_truck !== truck) return false;
    const d = j.scheduled_at ? new Date(j.scheduled_at).toISOString().split("T")[0] : "";
    if (d !== dateStr) return false;
    return jobHours(j).includes(hour);
  });
  // a booked cell shows the start label only on the job's first hour, spanning visually
  const isJobStart = (job, hour) => jobHours(job)[0] === hour;

  const gridCols = `48px repeat(${activeTrucks().length}, 1fr)`;

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 320 }}>
        {/* Header row */}
        <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 6, marginBottom: 6 }}>
          <div />
          {activeTrucks().map(t => {
            const c = truckColor(t);
            return (
              <div key={t} style={{ borderRadius: 10, background: c.solid, color: "#fff", padding: "7px 4px", textAlign: "center", boxShadow: "0 1px 2px rgba(0,0,0,.08)" }}>
                <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".3px" }}>{t}</div>
                <div style={{ fontSize: 9, opacity: .85, fontWeight: 500 }}>{hourLabel(TRUCK_CONFIG[t].start).replace(":00", "")}–{hourLabel(TRUCK_CONFIG[t].end).replace(":00", "")}</div>
              </div>
            );
          })}
        </div>
        {/* Hour rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {allHours.map(hour => (
            <div key={hour} style={{ display: "grid", gridTemplateColumns: gridCols, gap: 6, alignItems: "stretch" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 4, fontSize: 11, color: otRowHours.has(hour) ? "#B45309" : "var(--muted)", fontWeight: otRowHours.has(hour) ? 700 : 600 }}>
                {otRowHours.has(hour) ? "⏱" : ""}{hourLabel(hour).replace(":00", "")}
              </div>
              {activeTrucks().map(truck => {
                const c = truckColor(truck);
                const works = truckHours(truck).includes(hour);
                const otOcc = !works ? jobAt(truck, hour) : null; // overtime booking outside regular hours
                if (!works && !otOcc) return <div key={truck} style={{ borderRadius: 8, background: "repeating-linear-gradient(45deg, #F4F5F7, #F4F5F7 6px, #EEF0F3 6px, #EEF0F3 12px)", minHeight: 38 }} />;
                const taken = !works ? true : slotTaken(jobs, truck, dateStr, hour, excludeId);
                const sel = inSelection(truck, hour);
                const fits = canFit(truck, hour);
                const occ = taken ? (otOcc || jobAt(truck, hour)) : null;

                if (taken) {
                  const start = occ ? isJobStart(occ, hour) : true;
                  const isOT = !!occ && (occ.is_overtime || !works);
                  const isDone = !!occ && jobSuccessful(occ); // successful slots recede: green edge, ✓, dimmed
                  return (
                    <div key={truck}
                      onClick={() => { if (occ && onJobClick) onJobClick(occ); }}
                      style={{
                        borderRadius: 8, minHeight: 48, padding: "5px 7px",
                        background: isDone ? "#86EFAC" : c.bg,
                        borderLeft: `3px solid ${isDone ? "#16A34A" : isOT ? "#F59E0B" : c.solid}`,
                        boxShadow: !isDone && isOT ? "inset 0 0 0 1px #FDE68A" : "none",
                        color: isDone ? "#14532D" : c.text, cursor: onJobClick ? "pointer" : "default",
                        display: "flex", flexDirection: "column", justifyContent: "center",
                        overflow: "hidden",
                      }}>
                      {start && occ ? (
                        <>
                          <div style={{ fontSize: 10, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{isDone ? "✓ " : ""}{isOT ? "⏱ " : ""}{shortService(occ.service_type)}</div>
                          <div style={{ fontSize: 9.5, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={occ.customer_name || ""}>{occ.customer_name || ""}</div>
                          <div style={{ fontSize: 9, fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{occ.customer_mobile || ""}</div>
                          <div style={{ fontSize: 9, opacity: .8, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{occ.area || ""}</div>
                        </>
                      ) : <div style={{ fontSize: 9, opacity: .5 }}>↑</div>}
                    </div>
                  );
                }
                let bg = "#fff", color = "var(--muted)", border = "1px solid var(--border)", label = "+", cursor = "pointer", weight = 500;
                if (sel) { bg = "var(--accent)"; color = "#fff"; border = "1px solid var(--accent)"; label = "✓"; weight = 700; }
                else if (!fits) { bg = "#FAFAF8"; color = "#D4B483"; border = "1px dashed #E8D9B5"; label = "·"; cursor = "not-allowed"; }
                return (
                  <div key={truck}
                    onClick={() => { if (fits) onPick(truck, hour); }}
                    title={fits ? `Book ${truck} at ${hourLabel(hour)}` : "Not enough consecutive free time"}
                    style={{
                      borderRadius: 8, minHeight: 38, border, background: bg, color, cursor,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 15, fontWeight: weight, transition: "transform .08s, box-shadow .08s",
                    }}>
                    {label}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* Legend */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 11, color: "var(--muted)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, border: "1px solid var(--border)", background: "#fff" }} /> Free</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--accent)" }} /> Selected</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: truckColor(activeTrucks()[0]).bg, borderLeft: `3px solid ${truckColor(activeTrucks()[0]).solid}` }} /> Booked</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, border: "1px dashed #E8D9B5", background: "#FAFAF8" }} /> Won't fit {duration}h</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "#FEF3C7", borderLeft: "3px solid #F59E0B" }} /> Overtime</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "#86EFAC", borderLeft: "3px solid #16A34A" }} /> ✓ Done</span>
        </div>
        {onJobClick && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Tap a booked slot to open it, or any free slot to start a new order.</div>}
      </div>
    </div>
  );
}

// ─── New Order Modal (redesigned flow) ────────────────────────────────────────
// 1) Mobile → autofill name + cars + addresses
// 2) Service type → auto labor + items (with per-item match checkbox)
// 3) Slot grid scheduling (truck + start hour, multi-hour duration)
// 4) Admin (lead, payment, notes)  → submit as DRAFT
function NewJobModal({ onClose, onCreated, onEdited, editJob, customers, cars, addresses, jobs, prefill, prefillOrder, onNewCustomer, onCustomerCreated, onCarCreated, onAddressCreated, defaultAgent, catalog }) {
  const isEdit = !!editJob;
  // Reconstruct editable service blocks from a saved job (uses services[] if present, else items[])
  const hydrateServices = (job) => {
    const base = (job.services && job.services.length) ? job.services : (job.items || []).map(it => ({
      service_type: it.service_type || job.service_type, kind: it.kind || "other",
      variant: it.variant || {}, tire_id: it.tire_id || null,
      brand: it.brand || "", pattern: it.pattern || "", size: it.size || "",
      cost: it.cost || 0, supplier: it.supplier || "", description: it.description || "",
      qty: it.qty || 1, unit_price: it.unit_price || 0, car_id: it.car_id || null,
      price_disc: blankDisc(), labor_disc: blankDisc(),
      labor: catalogLabor(it.service_type || job.service_type, it.variant || {}, it.qty),
    }));
    return base.map((s, i) => ({ ...s, id: s.id || uid(), _open: i === 0, new_car: null, parts: s.kind !== "tire" ? (s.parts && s.parts.length ? s.parts.map(p => ({ ...p, id: p.id || uid() })) : [newPart()]) : (s.parts || []), price_disc: s.price_disc || blankDisc(), labor_disc: s.labor_disc || blankDisc() }));
  };
  const blank = isEdit ? {
    ...editJob,
    services: hydrateServices(editJob),
    start_hour: editJob.start_hour ?? (editJob.scheduled_at ? new Date(editJob.scheduled_at).getHours() : null),
    scheduled_date: editJob.scheduled_date || (editJob.scheduled_at ? new Date(editJob.scheduled_at).toISOString().split("T")[0] : today()),
  } : {
    customer_name: "", customer_mobile: "", customer_id: null,
    area: "", governorate: "", block: "", street: "", lane: "", house: "", map_link: "",
    car_brand: "", car_model: "", car_year: "", car_plate: "", car_id: null,
    services: [newService()], sales_match_confirmed: false,
    assigned_truck: prefill?.truck || "T1", start_hour: prefill?.hour ?? null, duration: 1,
    overtime: false, is_overtime: false,
    scheduled_date: prefill?.date || today(),
    lead_from: "WhatsApp", sales_agent: defaultAgent || "",
    xero_ref: "", invoice_no: "", payment_through: "Link", payment_status: "pending", payment_link: "", notes: "",
    status: "draft",
    no_products_reason: null, // required choice when the order has no products: 'labor_only' | 'customer_parts'
    checks: [false, false, false, false],
  };
  const [f, setF] = useState(blank);
  const [mobileQ, setMobileQ] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  // EDIT MODE: restore the customer link immediately so the per-service car selector
  // and saved addresses show the order's actual selections (not "select car").
  useEffect(() => {
    if (!isEdit || selectedCustomer) return;
    const c = customers.find(x => x.id === editJob.customer_id) ||
              customers.find(x => last8(x.mobile) === last8(editJob.customer_mobile));
    if (c) setSelectedCustomer(c);
  }, [isEdit, customers]);
  const [selectedCar, setSelectedCar] = useState(null);
  const [selectedAddr, setSelectedAddr] = useState(null);
  const [addrMode, setAddrMode] = useState("pick"); // pick | new
  const [carMode, setCarMode] = useState("pick"); // pick | new
  const [schedView, setSchedView] = useState("truck"); // truck | all
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.value }));
  const setServices = (updater) => setF(p => ({ ...p, services: typeof updater === "function" ? updater(p.services) : updater }));

  // customer's cars for per-service linking
  const formCustomerCars = selectedCustomer ? cars.filter(c => c.customer_id === selectedCustomer.id) : [];

  const grandTotal = orderTotal(f.services);


  const customerCars = selectedCustomer ? cars.filter(c => c.customer_id === selectedCustomer.id) : [];
  const customerAddrs = selectedCustomer ? (addresses || []).filter(a => a.customer_id === selectedCustomer.id) : [];

  // mobile lookup
  const mobileMatches = mobileQ.length < 3 ? [] : customers.filter(c => (c.mobile || "").includes(mobileQ));

  const selectCustomer = (c) => {
    setSelectedCustomer(c); setSelectedCar(null); setSelectedAddr(null); setAddrMode("pick"); setCarMode("pick"); setMobileQ("");
    setF(p => ({ ...p, customer_id: c.id, customer_name: c.name, customer_mobile: c.mobile, area: c.area || p.area,
      car_brand: "", car_model: "", car_year: "", car_plate: "", car_id: null }));
  };
  const selectCar = (car) => {
    setSelectedCar(car); setCarMode("pick");
    setF(p => ({ ...p, car_id: car.id, car_brand: car.brand, car_model: car.model, car_year: car.year, car_plate: car.plate }));
  };
  const selectAddr = (a) => {
    setSelectedAddr(a); setAddrMode("pick");
    setF(p => ({ ...p, area: a.area, governorate: a.governorate || govFor(a.area), block: a.block, street: a.street, lane: a.lane || "", house: a.house, map_link: a.map_link || "" }));
  };
  // ── From quote: pull a confirmed Tire System quote into this order ──
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteMobileQ, setQuoteMobileQ] = useState("");
  const [quoteResults, setQuoteResults] = useState(null); // null = not searched
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [usedQuoteId, setUsedQuoteId] = useState(null); // quote that fed this order → stamped Success on submit
  const searchQuotes = async () => {
    const m = (quoteMobileQ || f.customer_mobile || "").trim();
    if (!m) return;
    setQuoteBusy(true);
    const r = await fetchQuotes(m);
    setQuoteResults(r); setQuoteBusy(false);
  };
  const applyQuoteLine = (q, line) => {
    setUsedQuoteId(q.id);
    const svc = quoteToService(q, line);
    setServices(prev => {
      const isEmptyTire = (s) => s.kind === "tire" && !s.tire_id && !s.staggered && !(Number(s.unit_price) > 0) && !(s.description || "").trim();
      const others = prev.map(s => ({ ...s, _open: false }));
      if (others.length === 1 && isEmptyTire(others[0])) return [{ ...svc, _open: true }];
      return others.concat({ ...svc, _open: true });
    });
    // set the customer mobile from the quote; auto-select the customer if they exist
    const digits = (s) => (s || "").replace(/\D/g, "");
    const cust = customers.find(x => digits(x.mobile).slice(-8) === digits(q.customer_mobile).slice(-8));
    if (cust && !selectedCustomer) {
      setSelectedCustomer(cust);
      setF(p => ({ ...p, customer_id: cust.id, customer_name: cust.name, customer_mobile: cust.mobile, area: cust.area || p.area }));
    } else if (!f.customer_mobile) {
      setF(p => ({ ...p, customer_mobile: q.customer_mobile }));
    }
    setQuoteOpen(false);
  };

  // Explicit inline saves — create on the SERVER first so the row gets a real id.
  // (Previously a local "lcar-…" text id was POSTed into a uuid column — Supabase
  // rejected the insert silently, so cars/addresses added here never persisted.)
  const saveInlineCar = async (sid) => {
    const s = f.services.find(x => x.id === sid);
    if (!selectedCustomer || !s?.new_car?.brand || !s?.new_car?.model) return;
    const car = await createCar({ ...s.new_car, customer_id: selectedCustomer.id, created_at: new Date().toISOString() });
    if (onCarCreated) onCarCreated(car);                    // appears in profile + dropdowns
    setServices(prev => prev.map(x => x.id === sid ? { ...x, car_id: car.id, new_car: null, parts: rebrandParts(x.parts, car.brand) } : x));
  };
  const saveInlineAddress = async () => {
    if (!selectedCustomer || !f.area) return;
    const a = await createAddress({ label: f.area, area: f.area, governorate: f.governorate || govFor(f.area), block: f.block, street: f.street, lane: f.lane, house: f.house, map_link: f.map_link || buildMapsLink({ ...f, governorate: f.governorate || govFor(f.area) }), customer_id: selectedCustomer.id, created_at: new Date().toISOString() });
    if (onAddressCreated) onAddressCreated(a);              // appears in saved addresses
    setSelectedAddr(a); setAddrMode("pick");
  };
  const [savingCustomer, setSavingCustomer] = useState(false);
  const saveAsNewCustomer = async () => {
    if (!f.customer_name || !f.customer_mobile) return;
    setSavingCustomer(true);
    const c = await createCustomer({ name: f.customer_name, mobile: f.customer_mobile, area: f.area || "", notes: "", created_at: new Date().toISOString() });
    if (onCustomerCreated) onCustomerCreated(c);
    setSelectedCustomer(c);
    setF(p => ({ ...p, customer_id: c.id, customer_name: c.name, customer_mobile: c.mobile }));
    setSavingCustomer(false);
  };
  const clearCustomer = () => {
    setSelectedCustomer(null); setSelectedCar(null);
    setF(p => ({ ...p, customer_id: null, customer_name: "", customer_mobile: "", car_brand: "", car_model: "", car_year: "", car_plate: "", car_id: null }));
  };
  const pickSlot = (truck, hour) => setF(p => ({ ...p, assigned_truck: truck, start_hour: hour, is_overtime: isOTHour(truck, hour) }));

  // In edit mode, resolve the customer so per-service car linking + address work
  useEffect(() => {
    if (isEdit && editJob.customer_id) {
      const c = customers.find(x => x.id === editJob.customer_id);
      if (c) setSelectedCustomer(c);
    }
  }, [isEdit]);

  // Auto-generate the Google Maps link from address fields — unless the agent
  // pasted a precise pin (manual links are preserved, never overwritten).
  useEffect(() => {
    setF(p => {
      if (isManualPin(p.map_link)) return p; // keep precise pin
      const gen = buildMapsLink({ area: p.area, governorate: p.governorate, block: p.block, street: p.street, lane: p.lane, house: p.house });
      if (gen === p.map_link) return p;
      return { ...p, map_link: gen };
    });
  }, [f.area, f.governorate, f.block, f.street, f.lane, f.house]);

  // Apply prefill from customer profile: "New Order" (customer only) or "Reorder" (copy services)
  useEffect(() => {
    if (!prefillOrder) return;
    if (prefillOrder.quoteId) setUsedQuoteId(prefillOrder.quoteId);
    if (!prefillOrder.customer && prefillOrder.name) setF(p => ({ ...p, customer_name: p.customer_name || prefillOrder.name }));
    const c = prefillOrder.customer;
    if (c) {
      setSelectedCustomer(c);
      setF(p => ({ ...p, customer_id: c.id, customer_name: c.name, customer_mobile: c.mobile, area: c.area || p.area }));
    }
    // Deep link from the Tire System: prefilled service blocks (tire already picked)
    if (prefillOrder.services && prefillOrder.services.length) {
      const services = prefillOrder.services.map((s, i) => ({ ...s, id: s.id || uid(), _open: i === 0, new_car: s.new_car || null }));
      setF(p => ({ ...p, services, ...(prefillOrder.mobile && !c ? { customer_mobile: prefillOrder.mobile } : {}) }));
    }
    // Revisit: carry over the customer + address from the original order, prime the
    // feedback note — but start with a FRESH service (sales picks what's needed).
    const rv = prefillOrder.revisitOf;
    if (rv) {
      setF(p => ({
        ...p,
        ...(c ? {} : { customer_name: p.customer_name || rv.customer_name || "", customer_mobile: p.customer_mobile || rv.customer_mobile || "" }),
        area: rv.area || (c && c.area) || p.area, governorate: rv.governorate || "",
        block: rv.block || "", street: rv.street || "", lane: rv.lane || "", house: rv.house || "", map_link: rv.map_link || "",
        notes: p.notes || prefillOrder.noteHint || "",
      }));
    }
    const src = prefillOrder.sourceJob;
    if (src) {
      // Rebuild service blocks from the source job (copy services/cars/prices/discounts;
      // reset schedule + payment; ALWAYS leave the match checkbox unchecked).
      const baseServices = (src.services && src.services.length)
        ? src.services
        : (src.items || []).map(it => ({
            service_type: it.service_type || src.service_type, kind: it.kind || "other",
            variant: it.variant || {}, tire_id: it.tire_id || null,
            brand: it.brand || "", pattern: it.pattern || "", size: it.size || "",
            cost: it.cost || 0, supplier: it.supplier || "", description: it.description || "",
            qty: it.qty || 1, unit_price: it.unit_price || 0, car_id: it.car_id || null,
            price_disc: blankDisc(), labor_disc: blankDisc(),
            labor: catalogLabor(it.service_type || src.service_type, it.variant || {}, it.qty),
          }));
      const services = baseServices.map(s => ({
        ...s, id: uid(), _open: false, new_car: null,
        price_disc: s.price_disc || blankDisc(), labor_disc: s.labor_disc || blankDisc(),
      }));
      // open the first one for review
      if (services[0]) services[0]._open = true;
      setF(p => ({
        ...p,
        services,
        ...(c ? {} : { customer_name: p.customer_name || src.customer_name || "", customer_mobile: p.customer_mobile || src.customer_mobile || "" }),
        sales_match_confirmed: false,         // always re-verify
        start_hour: null, assigned_truck: "T1", scheduled_date: today(),
        payment_status: "pending", payment_link: "", payment_through: "Link",
        xero_ref: "", invoice_no: "", status: "draft", notes: src.notes || "",
        area: src.area || (c && c.area) || p.area, governorate: src.governorate || "",
        block: src.block || "", street: src.street || "", lane: src.lane || "", house: src.house || "", map_link: src.map_link || "",
      }));
    }
  }, [prefillOrder]);


  const hasProducts = orderHasProducts(f.services);
  // Collect reasons submit is blocked (shown to the agent)
  const submitReasons = [];
  if (!f.customer_name) submitReasons.push("Add a customer");
  if (!f.customer_mobile) submitReasons.push("Add a customer mobile");
  if (!f.area) submitReasons.push("Add the area");
  if (!(f.services || []).length) submitReasons.push("Add at least one service");
  else if (!f.services.every(s => s.kind === "tire" ? true : (partsGross(s.parts) > 0 || (s.parts || []).some(p => p.name) || s.labor)))
    submitReasons.push("Each non-tire service needs a part or labor");
  if (hasProducts && !f.sales_match_confirmed) submitReasons.push("Confirm the products match the customer's car");
  if (!hasProducts && (f.services || []).length && !f.no_products_reason) submitReasons.push("Select: labor only, or parts/tires with customer");
  if (f.start_hour == null) submitReasons.push("Pick a time slot");
  const canSubmit = submitReasons.length === 0;

  const save = async () => {
    if (!canSubmit) return;
    setSaving(true);
    // Create any inline new cars first, link their ids back to the service blocks
    let services = f.services;
    const createdCars = [];
    if (selectedCustomer) {
      const withCars = [];
      for (const s of services) {
        if (s.new_car && (s.new_car.brand || s.new_car.model)) {
          const car = await createCar({ ...s.new_car, customer_id: selectedCustomer.id, created_at: new Date().toISOString() });
          if (onCarCreated) onCarCreated(car);
          createdCars.push(car);
          withCars.push({ ...s, car_id: car.id, new_car: null });
        } else {
          withCars.push(s);
        }
      }
      services = withCars;
    }
    // Quote-sourced tires carry only brand/size/price — pull the full catalog
    // spec (supplier, cost, LI/SR, SKU, notes) by id before saving, so the
    // collect list and profitability reports never miss supplier or cost.
    for (let i = 0; i < services.length; i++) {
      const s = services[i];
      if (s.kind !== "tire") continue;
      if (s.tire_id && (!s.supplier || !s.sku)) {
        const t = await fetchTireById(s.tire_id);
        if (t) services[i] = { ...services[i],
          supplier: s.supplier || t.supplier || "", cost: Number(s.cost) || Number(t.cost) || 0,
          load_index: s.load_index || t.load_index || "", speed_rating: s.speed_rating || t.speed_rating || "",
          country: s.country || t.country || "", year: s.year || t.year || "",
          sku: s.sku || t.sku || "", tire_note: s.tire_note || t.notes || "" };
      }
      const s2 = services[i];
      if (s2.rear_tire_id && (!s2.rear_supplier || !s2.rear_sku)) {
        const t = await fetchTireById(s2.rear_tire_id);
        if (t) services[i] = { ...services[i],
          rear_supplier: s2.rear_supplier || t.supplier || "", rear_cost: Number(s2.rear_cost) || Number(t.cost) || 0,
          rear_load_index: s2.rear_load_index || t.load_index || "", rear_speed_rating: s2.rear_speed_rating || t.speed_rating || "",
          rear_country: s2.rear_country || t.country || "", rear_year: s2.rear_year || t.year || "",
          rear_sku: s2.rear_sku || t.sku || "", rear_tire_note: s2.rear_tire_note || t.notes || "" };
      }
    }
    // Cars available to this order: profile cars + any created inline just now
    const allCars = [...formCustomerCars, ...createdCars];
    // Top-level car snapshot for reporting — the first car linked on the order
    const primaryCar = services.map(s => allCars.find(c => c.id === s.car_id)).find(Boolean) || null;
    const scheduledAt = new Date(`${f.scheduled_date}T${String(f.start_hour).padStart(2, "0")}:00:00`);
    const totalLabor = services.reduce((s, svc) => s + serviceTotals(svc).netLabor, 0);
    const headline = [...new Set(services.map(s => s.service_type))].join(" + ");
    const details = services.map(s => s.kind === "tire"
      ? (s.staggered
          ? [s.tire_id ? `F: ${s.size} ${s.brand} ×${s.qty}` : "", s.rear_tire_id ? `R: ${s.rear_size} ${s.rear_brand} ×${s.rear_qty}` : ""].filter(Boolean).join(" + ") || `${s.service_type} (labor only)`
          : (s.tire_id ? `${s.size} ${s.brand}${s.pattern ? " " + s.pattern : ""} ×${s.qty}` : `${s.service_type} (labor only) ×${s.qty}`))
      : (() => { const ps = (s.parts || []).filter(p => p.name); return ps.length ? `${s.service_type}: ${ps.map(p => p.name).join(", ")}` : `${s.service_type} (labor only)`; })()).filter(Boolean).join(" · ");
    const totQtyOf = (s) => s.staggered ? (Number(s.qty) || 0) + (Number(s.rear_qty) || 0) : (Number(s.qty) || 4);
    const carLabelFor = (cid) => {
      const c = allCars.find(x => x.id === cid);
      return c ? `${c.brand} ${c.model}${c.year ? " " + c.year : ""}`.trim() : "";
    };
    const items = services.flatMap(s => {
      const car_label = carLabelFor(s.car_id);
      if (s.kind === "tire") {
        if (s.staggered) {
          const out = [];
          if (s.tire_id) out.push({
            id: s.id + "-F", kind: "tire", tire_id: s.tire_id, position: "front",
            brand: s.brand, pattern: s.pattern, size: s.size, year: s.year, load_index: s.load_index, speed_rating: s.speed_rating, country: s.country, oem: s.oem, tire_note: s.tire_note,
            name: `${s.brand} ${s.pattern} (front)`,
            supplier: s.supplier || "", sku: s.sku || "", qty: s.qty, unit_price: s.unit_price,
            cost: s.cost, car_id: s.car_id, car_label,
            service_type: s.service_type, service_id: s.id, variant: s.variant,
          });
          if (s.rear_tire_id) out.push({
            id: s.id + "-R", kind: "tire", tire_id: s.rear_tire_id, position: "rear",
            brand: s.rear_brand, pattern: s.rear_pattern, size: s.rear_size, year: s.rear_year, load_index: s.rear_load_index, speed_rating: s.rear_speed_rating, country: s.rear_country, oem: s.rear_oem, tire_note: s.rear_tire_note,
            name: `${s.rear_brand} ${s.rear_pattern} (rear)`,
            supplier: s.rear_supplier || "", sku: s.rear_sku || "", qty: s.rear_qty, unit_price: s.rear_unit_price,
            cost: s.rear_cost, car_id: s.car_id, car_label,
            service_type: s.service_type, service_id: s.id, variant: s.variant,
          });
          if (out.length === 0) out.push({
            id: s.id, kind: "tire", labor_only: true, name: `${s.service_type} (labor only)`,
            supplier: "", qty: totQtyOf(s), unit_price: 0, cost: 0, car_id: s.car_id, car_label,
            service_type: s.service_type, service_id: s.id, variant: s.variant,
          });
          return out;
        }
        return [{
          id: s.id, kind: "tire", tire_id: s.tire_id, labor_only: !s.tire_id,
          brand: s.brand, pattern: s.pattern, size: s.size, year: s.year, load_index: s.load_index, speed_rating: s.speed_rating, country: s.country, oem: s.oem, tire_note: s.tire_note,
          name: s.tire_id ? `${s.brand} ${s.pattern}` : `${s.service_type} (labor only)`,
          supplier: s.supplier || "", sku: s.sku || "", qty: s.qty, unit_price: s.unit_price,
          cost: s.cost, car_id: s.car_id, car_label,
          service_type: s.service_type, service_id: s.id, variant: s.variant,
        }];
      }
      // other service → one item per part (each collectable with its own supplier)
      const parts = (s.parts || []).filter(p => p.name || Number(p.price) > 0);
      if (parts.length === 0) {
        // labor-only other service
        return [{
          id: s.id, kind: "other", labor_only: true, name: `${s.service_type} (labor only)`,
          supplier: "", qty: 1, unit_price: 0, cost: 0, car_id: s.car_id, car_label,
          service_type: s.service_type, service_id: s.id, variant: s.variant,
        }];
      }
      return parts.map(p => ({
        id: p.id, kind: "part", name: p.name || s.service_type,
        supplier: p.supplier || "", sku: p.sku || "", qty: p.qty, unit_price: p.price, cost: p.cost,
        car_id: s.car_id, car_label,
        service_type: s.service_type, service_id: s.id, variant: s.variant,
      }));
    });
    const common = {
      ...f,
      no_products_reason: hasProducts ? null : (f.no_products_reason || null),
      paid_date: f.payment_status === "paid" ? ((editJob && editJob.paid_date) || today()) : null,
      car_id: primaryCar ? primaryCar.id : (f.car_id || null),
      car_brand: primaryCar ? (primaryCar.brand || "") : (f.car_brand || ""),
      car_model: primaryCar ? (primaryCar.model || "") : (f.car_model || ""),
      car_year: primaryCar ? (primaryCar.year || "") : (f.car_year || ""),
      car_plate: primaryCar ? (primaryCar.plate || "") : (f.car_plate || ""),
      ver_times: { ...(editJob?.ver_times || {}), c1: f.sales_match_confirmed ? ((editJob?.ver_times || {}).c1 || new Date().toISOString()) : null },
      services,
      service_type: headline,
      items,
      labor_charge: totalLabor,
      total: grandTotal,
      qty: services.reduce((s, svc) => s + (Number(svc.qty) || 0), 0),
      service_details: details,
      scheduled_at: scheduledAt.toISOString(),
    };

    if (isEdit) {
      // Detect whether services/items materially changed (to decide re-verification)
      const sig = (list) => JSON.stringify((list || []).map(s => ({
        t: s.service_type, k: s.kind, v: s.variant, tire: s.tire_id, d: s.description,
        q: Number(s.qty) || 0, p: Number(s.unit_price) || 0, car: s.car_id || null,
      })));
      const itemsChanged = sig(hydrateServices(editJob)) !== sig(services);
      const settled = jobSuccessful(editJob); // completed orders are a historical record
      const patch = { ...common };
      delete patch.created_at; // preserve original
      if (editJob.status === "cancelled") {
        // Saving an edit on a cancelled order restores it into the pipeline
        patch.status = "booked";
        patch.cancel_reason = null;
        patch.cancelled_at = null;
        patch.truck_status = "scheduled";
        patch.parts_status = "pending";
        patch.parts_released = false;
        patch.techs_released = false;
      }
      if (itemsChanged && !settled) {
        // re-verification habit: clear all match confirmations + downstream per-item checks.
        // NEVER on completed orders — corrections (e.g. linking the car afterwards) must
        // not erase the verification history of work already delivered.
        patch.sales_match_confirmed = false;
        patch.tech_arrival_match = false;
        patch.item_checks = {};
        patch.tech_checks = {};
        patch.tech_checks_order = {};
        patch.tech_checks_car = {};
        patch.ver_times = { c1: patch.sales_match_confirmed === false ? null : ((editJob.ver_times || {}).c1 || null), c2: null, c3: null, c4: null };
        patch.items_edited_at = new Date().toISOString();
      }
      // Late car link on a completed order → back-fill the recorded mileage onto the
      // car's own log. appendCarMileage de-dupes by job_id, so re-saving is harmless.
      const backfills = [];
      if (settled) {
        const cm = editJob.car_mileages
          || (Number(editJob.service_mileage) > 0 ? { primary: { km: Number(editJob.service_mileage), unit: editJob.service_mileage_unit || "KM" } } : null);
        if (cm) {
          const realIds = [...new Set([common.car_id, ...services.map(s => s.car_id)]
            .filter(id => id && cars.some(c => c.id === id)))];
          const fixedCm = { ...cm };
          Object.entries(cm).forEach(([key, e]) => {
            if (!(Number(e?.km) > 0)) return;
            const target = (e.car_id && cars.some(c => c.id === e.car_id)) ? e.car_id
              : (realIds.length === 1 ? realIds[0] : null); // single-car order → unambiguous
            if (!target) return;
            fixedCm[key] = { ...e, car_id: target };
            backfills.push({ carId: target, entry: {
              date: editJob.completed_at || new Date().toISOString(), km: Number(e.km), unit: e.unit || "KM",
              service: editJob.service_type || "", job_id: editJob.id, mobile: common.customer_mobile || "",
            } });
          });
          patch.car_mileages = fixedCm;
        }
      }
      await updateJob(editJob.id, patch);
      backfills.forEach(b => appendCarMileage(b.carId, b.entry)); // fire-and-forget, de-duped
      onEdited({ ...editJob, ...patch });
      setSaving(false);
      onClose();
      return;
    }

    const job = {
      ...common,
      ...(prefillOrder && prefillOrder.linkTo ? prefillOrder.linkTo : {}), // thread link: parent_job_id / link_type / upsell credit
      sale_date: today(), // revenue is recognized the day the order is PLACED, not scheduled/completed
      created_at: new Date().toISOString(),
      parts_status: "pending",
      truck_status: "scheduled",
      parts_released: false,
      techs_released: false,
      tech_arrival_match: false,
      item_checks: {},
      tech_checks: {}, tech_checks_order: {}, tech_checks_car: {}, parts_received: false,
    };
    const created = await createJob(job);
    onCreated(created, usedQuoteId);
    setSaving(false);
    onClose();
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{isEdit ? `Edit Order — ${editJob.customer_name}` : "New Order"}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {!isEdit && prefillOrder?.linkTo && (
            <div style={{ margin: "0 0 14px", padding: "8px 12px", background: prefillOrder.linkTo.link_type === "upsell" ? "#F0FDF4" : "#EFF6FF", border: `1px solid ${prefillOrder.linkTo.link_type === "upsell" ? "#BBF7D0" : "#BFDBFE"}`, borderRadius: 8, fontSize: 12.5, color: prefillOrder.linkTo.link_type === "upsell" ? "#166534" : "#1E40AF", fontWeight: 600 }}>
              {prefillOrder.linkLabel || `🔗 This order will be linked to the original order as a ${prefillOrder.linkTo.link_type}.`}
              {prefillOrder.linkTo.link_type === "upsell" && prefillOrder.linkTo.upsell_truck ? ` · credit: ${prefillOrder.linkTo.upsell_truck}` : ""}
            </div>
          )}
          {isEdit && editJob.status === "cancelled" && (
            <div style={{ margin: "10px 16px 0", padding: "8px 12px", background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 8, fontSize: 12.5, color: "#92400E" }}>
              ↺ This order is <strong>cancelled</strong>. Saving will restore it as <strong>Booked</strong> and it will go through parts &amp; verification again.
            </div>
          )}
          {isEdit && (editJob.parts_released || editJob.techs_released || editJob.truck_status === "processing" || editJob.truck_status === "completed") && (
            <div style={{ background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, padding: "10px 14px", margin: "0 0 14px", fontSize: 13, color: "#92400E" }}>
              ⚠ Work has already started on this order ({editJob.parts_released ? "parts released" : ""}{editJob.parts_released && (editJob.techs_released || editJob.truck_status !== "scheduled") ? ", " : ""}{editJob.techs_released ? "shown to technicians" : ""}{editJob.truck_status && editJob.truck_status !== "scheduled" ? ` · truck ${editJob.truck_status}` : ""}). Editing services or items will reset the verification checks and the distributor/technician will need to re-verify. Proceed carefully.
            </div>
          )}
          <div className="form-grid">

            {/* 1 — Customer by mobile */}
            <div className="form-section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>1 · Customer</span>
              {!isEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQuoteOpen(o => !o); if (!quoteOpen) { setQuoteMobileQ(f.customer_mobile || ""); setQuoteResults(null); } }}>📋 From quote</button>}
            </div>
            {quoteOpen && (
              <div className="form-full" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "var(--bg)", marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
                  <input type="tel" className="filter-input" style={{ flex: 1 }} value={quoteMobileQ} placeholder="Customer mobile from the quote…"
                    onChange={e => setQuoteMobileQ(e.target.value)} onKeyDown={e => e.key === "Enter" && searchQuotes()} />
                  <button type="button" className="btn btn-primary btn-sm" onClick={searchQuotes} disabled={quoteBusy}>{quoteBusy ? "…" : "Search"}</button>
                </div>
                {quoteResults && quoteResults.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No quotes found for this mobile. Quotes appear here once sent from the Tire System.</div>}
                {quoteResults && quoteResults.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 260, overflowY: "auto" }}>
                    {quoteResults.map(q => {
                      const st = quoteStatus(q, jobs);
                      const isSuccess = st.status === "success";
                      const isLost = st.status === "lost";
                      return (
                      <div key={q.id} style={{ background: isSuccess ? "#F0FDF4" : "var(--card)", border: `1px solid ${isSuccess ? "#BBF7D0" : "var(--border)"}`, borderRadius: 8, padding: "8px 10px" }}>
                        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span>{fmtDate(q.created_at)} {fmtTime(q.created_at)}{q.agent ? ` · ${q.agent}` : ""}{q.staggered ? " · staggered" : ` · qty ${q.qty || 4}`}{q.cash_pct ? ` · cash ${q.cash_pct}%` : ""}</span>
                          {isSuccess && <span style={{ fontSize: 10, fontWeight: 700, color: "#15803D", background: "#DCFCE7", borderRadius: 5, padding: "1px 7px" }}>✓ Converted{st.job ? ` · ${fmtDate(st.job.scheduled_at)}` : ""}</span>}
                          {isLost && <span style={{ fontSize: 10, fontWeight: 700, color: "#991B1B", background: "#FEE2E2", borderRadius: 5, padding: "1px 7px" }}>✕ Lost{q.lost_reason ? ` · ${q.lost_reason}` : ""}</span>}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {q.staggered ? (
                            staggeredOptions(q).map((opt, oi) => (
                              <div key={oi} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12.5, borderTop: oi ? "1px dashed var(--border)" : "none", paddingTop: oi ? 6 : 0 }}>
                                <span>
                                  <div><span style={{ color: "var(--muted)", fontWeight: 700 }}>Front</span> <strong>{opt.front?.brand} {opt.front?.pattern}</strong> <span style={{ color: "var(--muted)" }}>· {opt.front?.size}{opt.front?.year ? ` · ${opt.front.year}` : ""}</span></div>
                                  <div><span style={{ color: "var(--muted)", fontWeight: 700 }}>Rear</span> <strong>{opt.rear?.brand} {opt.rear?.pattern}</strong> <span style={{ color: "var(--muted)" }}>· {opt.rear?.size}{opt.rear?.year ? ` · ${opt.rear.year}` : ""}</span></div>
                                  <span style={{ color: "var(--accent)", fontWeight: 700 }}>@ {Number(opt.price).toFixed(0)} KD</span>
                                </span>
                                <button type="button" className={`btn btn-sm ${isSuccess ? "btn-ghost" : "btn-primary"}`} style={{ flexShrink: 0 }} onClick={() => applyQuoteLine(q, opt)}>{isSuccess ? "Use again" : "Use"}</button>
                              </div>
                            ))
                          ) : (
                            (q.lines || []).map((line, li) => (
                              <div key={li} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                                <span>
                                  <strong>{line.brand} {line.pattern}</strong> <span style={{ color: "var(--muted)" }}>· {line.size}{line.year ? ` · ${line.year}` : ""}</span>
                                  <span style={{ color: "var(--accent)", fontWeight: 700 }}> @ {Number(line.price).toFixed(0)} KD</span>
                                </span>
                                <button type="button" className={`btn btn-sm ${isSuccess ? "btn-ghost" : "btn-primary"}`} style={{ flexShrink: 0 }} onClick={() => applyQuoteLine(q, line)}>{isSuccess ? "Use again" : "Use"}</button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div className="form-full">
              {!selectedCustomer ? (
                <div className="search-wrap">
                  <span className="search-icon">📱</span>
                  <input className="search-input" placeholder="Type customer mobile…" value={mobileQ}
                    onChange={e => setMobileQ(e.target.value)} inputMode="tel" />
                  {mobileQ.length >= 3 && (
                    <div className="search-dropdown">
                      {mobileMatches.map(c => (
                        <div key={c.id} className="search-item" onClick={() => selectCustomer(c)}>
                          <div className="search-item-name">{c.name}</div>
                          <div className="search-item-sub">{c.mobile} · {c.area}</div>
                        </div>
                      ))}
                      <div className="search-new" onClick={() => onNewCustomer(mobileQ, selectCustomer)}>
                        + New customer with mobile "{mobileQ}"
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="customer-found">
                  <div>
                    <div className="customer-found-name">{selectedCustomer.name}</div>
                    <div className="customer-found-sub">{selectedCustomer.mobile} · {selectedCustomer.area}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={clearCustomer}>Change</button>
                </div>
              )}
            </div>

            {/* Manual name/mobile when no customer selected */}
            {!selectedCustomer && (
              <>
                <div className="form-field"><label>Name *</label><input value={f.customer_name} onChange={set("customer_name")} placeholder="Ahmad Al-Salem" /></div>
                <div className="form-field"><label>Mobile *</label><input value={f.customer_mobile} onChange={set("customer_mobile")} placeholder="99001234" /></div>
                {(f.customer_name || f.customer_mobile) && (
                  <div className="form-full" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-primary btn-sm" disabled={!f.customer_name || !f.customer_mobile || savingCustomer}
                      onClick={saveAsNewCustomer}>
                      {savingCustomer ? "Saving…" : "💾 Save as new customer"}
                    </button>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>Creates their profile — then cars and addresses can be saved to it.</span>
                  </div>
                )}
              </>
            )}

            {/* Address */}
            <div className="form-section-title">Location</div>
            {/* Saved address picker (when customer has addresses) */}
            {selectedCustomer && customerAddrs.length > 0 && addrMode === "pick" && (
              <div className="form-full">
                <label style={miniLabel}>Saved Addresses</label>
                <div className="car-picker">
                  {customerAddrs.map(a => (
                    <div key={a.id} className={`car-option ${selectedAddr?.id === a.id ? "selected" : ""}`} onClick={() => selectAddr(a)}>
                      <div className={`car-option-radio ${selectedAddr?.id === a.id ? "selected" : ""}`} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{a.label || "Address"} — {a.area}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>Block {a.block}, St {a.street}{a.lane ? ", Lane " + a.lane : ""}, {a.house}{a.map_link ? " · 📍" : ""}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => { setAddrMode("new"); setSelectedAddr(null); setF(p => ({ ...p, area: "", governorate: "", block: "", street: "", lane: "", house: "", map_link: "" })); }}>+ Use a new address</button>
              </div>
            )}
            {/* Manual address fields (no saved addrs, or adding new) */}
            {(!selectedCustomer || customerAddrs.length === 0 || addrMode === "new") && (
              <>
                {selectedCustomer && customerAddrs.length > 0 && addrMode === "new" && (
                  <div className="form-full" style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setAddrMode("pick")}>← Back to saved addresses</button>
                  </div>
                )}
                <div className="form-field"><label>Area *</label><ComboBox value={f.area} onChange={(v) => setF(p => ({ ...p, area: v, governorate: govFor(v) || p.governorate }))} options={KW_AREA_NAMES} placeholder="Salmiya" /></div>
                <div className="form-field"><label>Governorate</label><input value={f.governorate || govFor(f.area)} readOnly placeholder="auto" style={{ background: "#F3F4F6", color: "var(--muted)" }} /></div>
                <div className="form-field"><label>Block</label><input value={f.block} onChange={set("block")} placeholder="12" /></div>
                <div className="form-field"><label>Street</label><ComboBox value={f.street} onChange={(v) => setF(p => ({ ...p, street: v }))} options={streetsForArea(f.area)} placeholder="33 or name" /></div>
                <div className="form-field"><label>Lane (Jadda)</label><input value={f.lane} onChange={set("lane")} placeholder="optional" /></div>
                <div className="form-field"><label>House #</label><input value={f.house} onChange={set("house")} placeholder="7A" /></div>
                <div className="form-field form-full">
                  <label>Google Map Link {!isManualPin(f.map_link) && f.map_link ? <span style={{ color: "var(--success)", fontWeight: 600 }}>· auto (block-level)</span> : isManualPin(f.map_link) ? <span style={{ color: "var(--accent)", fontWeight: 600 }}>· exact pin</span> : ""}</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={f.map_link} onChange={set("map_link")} placeholder="Auto-fills to the block; paste customer's WhatsApp pin for exact" style={{ flex: 1 }} />
                    {f.map_link && <a href={f.map_link} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ whiteSpace: "nowrap" }}>📍 Open</a>}
                  </div>
                  {!isManualPin(f.map_link) && f.map_link && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>Rough block-level link. For pinpoint accuracy, paste the customer's shared location pin.</div>}
                  {isManualPin(f.map_link) && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>Using exact pin. <button type="button" onClick={() => setF(p => ({ ...p, map_link: buildMapsLink(p) }))} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontSize: 11, textDecoration: "underline" }}>Reset to auto from address</button></div>}
                  <PaciPinBuilder
                    onUse={(link) => setF(p => ({ ...p, map_link: link }))}
                    onFill={(a) => setF(p => ({ ...p,
                      area: a.area || p.area,
                      governorate: a.governorate || p.governorate,
                      block: a.block || p.block,
                      street: a.street || p.street,
                      lane: a.lane || p.lane,
                      house: a.house || p.house,
                      map_link: a.mapLink || p.map_link,
                    }))} />
                </div>
                {selectedCustomer && (
                  <div className="form-full" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button type="button" className="btn btn-primary btn-sm" disabled={!f.area} onClick={saveInlineAddress}>💾 Save address to profile</button>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>Saves to the customer's addresses for future orders.</span>
                  </div>
                )}
              </>
            )}

            {/* 2 — Services (each its own formula) */}
            <div className="form-section-title">2 · Services</div>
            <ServiceBuilder services={f.services} setServices={setServices} customerCars={formCustomerCars} onSaveCar={selectedCustomer ? saveInlineCar : null} catalog={catalog} />

            {/* Sales match confirmation gate — only when the order has products to verify */}
            {hasProducts ? (
              <label className="form-full" style={{ display: "flex", gap: 10, alignItems: "flex-start", background: f.sales_match_confirmed ? "#F0FDF4" : "var(--bg)", border: `1px solid ${f.sales_match_confirmed ? "var(--success)" : "var(--border)"}`, borderRadius: 8, padding: "10px 12px", cursor: "pointer" }}>
                <input type="checkbox" checked={f.sales_match_confirmed} onChange={e => setF(p => ({ ...p, sales_match_confirmed: e.target.checked }))} style={{ marginTop: 2 }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>I'm sure the tires / products match the customer's car. <span style={{ color: "var(--danger)" }}>*</span></span>
              </label>
            ) : (
              <div className="form-full" style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1E40AF", marginBottom: 8 }}>No products on this order — tell the technicians exactly what to expect: <span style={{ color: "var(--danger)" }}>*</span></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    { v: "labor_only", icon: "🔧", t: "Labor only — no products for this order" },
                    { v: "customer_parts", icon: "🛞", t: "Parts/tires with customer" },
                  ].map(o => (
                    <label key={o.v} style={{ display: "flex", gap: 9, alignItems: "center", background: f.no_products_reason === o.v ? "#DBEAFE" : "#fff", border: `1.5px solid ${f.no_products_reason === o.v ? "#2563EB" : "var(--border)"}`, borderRadius: 8, padding: "8px 11px", cursor: "pointer" }}>
                      <input type="radio" name="no_products_reason" checked={f.no_products_reason === o.v} onChange={() => setF(p => ({ ...p, no_products_reason: o.v }))} />
                      <span style={{ fontSize: 15 }}>{o.icon}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#1E40AF" }}>{o.t}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* 3 — Scheduling slot grid */}
            <div className="form-section-title">3 · Scheduling</div>
            <div className="form-full" style={{ display: "flex", gap: 6, marginBottom: 4 }}>
              <button type="button" className={`btn btn-sm ${schedView === "truck" ? "btn-primary" : "btn-ghost"}`} onClick={() => setSchedView("truck")}>Per-truck</button>
              <button type="button" className={`btn btn-sm ${schedView === "all" ? "btn-primary" : "btn-ghost"}`} onClick={() => setSchedView("all")}>All trucks</button>
            </div>
            {schedView === "truck" && (
              <div className="form-full">
                <label style={miniLabel}>Truck</label>
                <TruckPills value={f.assigned_truck} onChange={(t) => setF(p => ({ ...p, assigned_truck: t, start_hour: null }))} />
              </div>
            )}
            {schedView === "truck" && (
              <div className="form-full" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: f.overtime ? "#B45309" : "var(--text)" }}>
                  <input type="checkbox" checked={!!f.overtime} onChange={e => setF(p => ({ ...p, overtime: e.target.checked, start_hour: null }))} />
                  ⏱ Overtime — unlock early/late slots (3h before, 4h after)
                </label>
              </div>
            )}
            <div className="form-field">
              <label>Date</label>
              <input type="date" value={f.scheduled_date} onChange={e => setF(p => ({ ...p, scheduled_date: e.target.value, start_hour: null }))} />
            </div>
            <div className="form-field">
              <label>Duration (hours)</label>
              <select value={f.duration} onChange={e => setF(p => ({ ...p, duration: Number(e.target.value), start_hour: null }))}>
                {[1, 2, 3].map(d => <option key={d} value={d}>{d} hour{d > 1 ? "s" : ""}</option>)}
              </select>
            </div>
            <div className="form-full">
              {schedView === "truck" ? (
                <TruckDayView jobs={jobs} truck={f.assigned_truck} dateStr={f.scheduled_date} duration={f.duration}
                  selectedHour={f.start_hour} onPick={pickSlot} excludeId={null} overtime={f.overtime} />
              ) : (
                <TruckSlotGrid jobs={jobs} dateStr={f.scheduled_date} duration={f.duration}
                  selectedTruck={f.start_hour != null ? f.assigned_truck : null} selectedHour={f.start_hour}
                  onPick={pickSlot} excludeId={null} />
              )}
              {f.start_hour != null && (
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600, color: f.is_overtime ? "#B45309" : "var(--success)" }}>
                  ✓ {f.assigned_truck} · {hourLabel(f.start_hour)}–{hourLabel(f.start_hour + f.duration)} on {f.scheduled_date}
                  {f.is_overtime && <span style={{ fontSize: 11, background: "#F59E0B", color: "#fff", padding: "1px 6px", borderRadius: 4, marginLeft: 6 }}>OVERTIME</span>}
                </div>
              )}
            </div>

            {/* 4 — Admin */}
            <div className="form-section-title">4 · Admin</div>
            <div className="form-field"><label>Lead From</label><select value={f.lead_from} onChange={set("lead_from")}>{LEAD_SOURCES.map(s => <option key={s}>{s}</option>)}</select></div>
            <div className="form-field"><label>Payment Through</label><select value={f.payment_through} onChange={set("payment_through")}>{["Link","Tabby","Taly","Sparts","Warranty","Cash","KNET"].map(s => <option key={s}>{s}</option>)}</select></div>
            <div className="form-field"><label>Sales Agent</label>
              <select value={f.sales_agent} onChange={set("sales_agent")}>
                <option value="">Select agent…</option>
                {SALES_AGENTS.map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div className="form-field"><label>Xero PO Ref</label><input value={f.xero_ref} onChange={set("xero_ref")} placeholder="PO-2026-0041" /></div>
            <div className="form-field"><label>Invoice No</label><input value={f.invoice_no} onChange={set("invoice_no")} placeholder="INV-… (optional)" /></div>
            <div className="form-field form-full"><label>Payment Link</label><input value={f.payment_link} onChange={set("payment_link")} placeholder="https://… (paste link to share with customer)" /></div>
            <div className="form-field form-full"><label>Notes</label><textarea value={f.notes} onChange={set("notes")} placeholder="Gate code, special instructions…" /></div>
          </div>
        </div>
        <div className="modal-footer">
          {!canSubmit && (
            <span style={{ fontSize: 12, color: "var(--danger)", marginRight: "auto", alignSelf: "center" }}>
              Can't submit yet: {submitReasons.join(" · ")}
            </span>
          )}
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { if (!canSubmit) { alert("Can't submit yet:\n\n• " + submitReasons.join("\n• ")); return; } save(); }} disabled={saving}>{saving ? "Saving…" : isEdit ? "Save Changes" : "Submit as Draft"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Mini editors: cars + addresses (used in New Customer + profile) ──────────
function CarRowsEditor({ rows, setRows }) {
  const add = () => setRows(p => [...p, { _tmp: uid(), brand: "", model: "", year: "", plate: "" }]);
  const upd = (i, k, v) => setRows(p => p.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  const updBrand = (i, v) => setRows(p => p.map((r, idx) => idx === i ? { ...r, brand: v, model: "" } : r));
  const del = (i) => setRows(p => p.filter((_, idx) => idx !== i));
  return (
    <div className="form-full">
      <label style={miniLabel}>Vehicles</label>
      {rows.map((r, i) => (
        <div key={r._tmp || r.id || i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 1fr 1fr 32px", gap: 6, marginBottom: 6 }}>
          <ComboBox value={r.brand} onChange={(v) => updBrand(i, v)} options={carBrandOpts()} placeholder="Brand" />
          <ComboBox value={r.year} onChange={(v) => upd(i, "year", v)} options={carYears} placeholder="Year" />
          <ComboBox value={r.model} onChange={(v) => upd(i, "model", v)} options={modelsFor(r.brand)} placeholder="Model" />
          <input className="filter-input" placeholder="VIN" value={r.plate} onChange={e => upd(i, "plate", e.target.value)} />
          <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => del(i)}>✕</button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={add}>+ Add vehicle</button>
    </div>
  );
}

function AddressRowsEditor({ rows, setRows }) {
  const add = () => setRows(p => [...p, { _tmp: uid(), label: "Home", area: "", governorate: "", block: "", street: "", lane: "", house: "", map_link: "" }]);
  const upd = (i, k, v) => setRows(p => p.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  const updArea = (i, v) => setRows(p => p.map((r, idx) => idx === i ? { ...r, area: v, governorate: govFor(v) || r.governorate } : r));
  const del = (i) => setRows(p => p.filter((_, idx) => idx !== i));
  return (
    <div className="form-full">
      <label style={miniLabel}>Addresses</label>
      {rows.map((r, i) => (
        <div key={r._tmp || r.id || i} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <input className="filter-input" placeholder="Label (Home, Office…)" value={r.label} onChange={e => upd(i, "label", e.target.value)} style={{ width: 160 }} />
            <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => del(i)}>✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
            <ComboBox value={r.area} onChange={(v) => updArea(i, v)} options={KW_AREA_NAMES} placeholder="Area" />
            <input className="filter-input" placeholder="Governorate (auto)" value={r.governorate || govFor(r.area)} readOnly style={{ background: "#F3F4F6", color: "var(--muted)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 70px 60px", gap: 6, marginBottom: 6 }}>
            <input className="filter-input" placeholder="Block" value={r.block} onChange={e => upd(i, "block", e.target.value)} />
            <div style={{ gridColumn: "span 1" }}><ComboBox value={r.street} onChange={(v) => upd(i, "street", v)} options={streetsForArea(r.area)} placeholder="Street" /></div>
            <input className="filter-input" placeholder="Lane" value={r.lane || ""} onChange={e => upd(i, "lane", e.target.value)} />
            <input className="filter-input" placeholder="House" value={r.house} onChange={e => upd(i, "house", e.target.value)} />
          </div>
          <input className="filter-input" style={{ width: "100%" }} placeholder="Google Map link" value={r.map_link} onChange={e => upd(i, "map_link", e.target.value)} />
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={add}>+ Add address</button>
    </div>
  );
}

// ─── New Customer Modal (with cars + addresses) ───────────────────────────────
function NewCustomerModal({ initialName, initialMobile, onClose, onCreated }) {
  const [f, setF] = useState({ name: initialName || "", mobile: initialMobile || "", notes: "" });
  const [carRows, setCarRows] = useState([]);
  const [addrRows, setAddrRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    if (!f.name || !f.mobile) return;
    setSaving(true);
    // primary area = first address area (back-compat with customer.area)
    const primaryArea = addrRows[0]?.area || "";
    const c = await createCustomer({ ...f, area: primaryArea, created_at: new Date().toISOString() });
    // save cars
    const savedCars = [];
    for (const r of carRows) {
      if (!r.brand && !r.model) continue;
      const car = await createCar({ brand: r.brand, model: r.model, year: r.year, plate: r.plate, customer_id: c.id, created_at: new Date().toISOString() });
      savedCars.push(car);
    }
    // save addresses
    const savedAddrs = [];
    for (const r of addrRows) {
      if (!r.area) continue;
      const a = await createAddress({ label: r.label, area: r.area, governorate: r.governorate || govFor(r.area), block: r.block, street: r.street, lane: r.lane, house: r.house, map_link: r.map_link || buildMapsLink({ ...r, governorate: r.governorate || govFor(r.area) }), customer_id: c.id, created_at: new Date().toISOString() });
      savedAddrs.push(a);
    }
    onCreated(c, savedCars, savedAddrs);
    setSaving(false);
    onClose();
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>New Customer</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-field"><label>Full Name *</label><input value={f.name} onChange={set("name")} placeholder="Ahmad Al-Salem" /></div>
            <div className="form-field"><label>Mobile *</label><input value={f.mobile} onChange={set("mobile")} placeholder="99001234" /></div>
            <div className="form-field form-full"><label>Notes</label><textarea value={f.notes} onChange={set("notes")} placeholder="VIP, fleet client…" /></div>
            <div className="form-section-title">Vehicles</div>
            <CarRowsEditor rows={carRows} setRows={setCarRows} />
            <div className="form-section-title">Addresses</div>
            <AddressRowsEditor rows={addrRows} setRows={setAddrRows} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Create Customer"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Status helpers for the new model ─────────────────────────────────────────
const DRAFT_STATUS = { key: "draft", label: "Draft", color: "#94A3B8" };

// ─── Job Detail (with order actions) ─────────────────────────────────────────
// ─── Threads: revisits & upsells linked to an original order ──────────────────
function UpsellLeadCard({ lead, role, onConvert, onDismiss, showCustomer }) {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("Customer declined");
  const age = leadAgeDays(lead);
  const open = lead.status === "open";
  const photos = Array.isArray(lead.photo_urls) ? lead.photo_urls : [];
  return (
    <div style={{ border: "1px solid var(--border)", borderLeft: `3px solid ${open ? leadAgeColor(age) : "var(--border)"}`, borderRadius: 8, padding: "10px 12px", background: "var(--card)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>
          ⬆ {lead.service_type || "Service"}
          {showCustomer && lead.customer_name ? <span style={{ fontWeight: 500, color: "var(--muted)" }}> · {lead.customer_name}{lead.customer_mobile ? ` · ${lead.customer_mobile}` : ""}</span> : null}
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: open ? leadAgeColor(age) : "var(--muted)" }}>
          {open ? (age === 0 ? "today" : `${age} day${age > 1 ? "s" : ""} old`) : lead.status === "converted" ? "✓ converted" : "✕ dismissed"}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
        Spotted by <strong style={{ color: "var(--text)" }}>{lead.truck || "—"}</strong>{lead.technician ? ` · ${lead.technician}` : ""} · {fmtDate(lead.created_at)}
        {lead.car_label ? <> · 🚗 <strong style={{ color: "var(--text)" }}>{lead.car_label}</strong></> : null}
      </div>
      {lead.note && <div style={{ fontSize: 12.5, marginTop: 6 }}>{lead.note}</div>}
      {photos.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {photos.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} /></a>)}
        </div>
      )}
      {lead.status === "dismissed" && lead.dismiss_reason && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Reason: {lead.dismiss_reason}</div>}
      {open && role === "sales" && (onConvert || onDismiss) && (
        !dismissing ? (
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {onConvert && <button type="button" className="btn btn-primary btn-sm" onClick={() => onConvert(lead)}>✓ Convert to order</button>}
            {onDismiss && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDismissing(true)}>✕ Dismiss</button>}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select className="filter-select" value={reason} onChange={e => setReason(e.target.value)}>
              {["Customer declined", "Not needed after check", "Too expensive for customer", "Customer will do elsewhere", "Duplicate", "Other"].map(r => <option key={r}>{r}</option>)}
            </select>
            <button type="button" className="btn btn-sm" style={{ background: "var(--danger)", color: "#fff" }} onClick={() => { onDismiss(lead, reason); setDismissing(false); }}>Confirm dismiss</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDismissing(false)}>Back</button>
          </div>
        )
      )}
    </div>
  );
}

function TechUpsellForm({ job, onCreate, autoOpen, onDone, onCancel }) {
  const [open, setOpen] = useState(!!autoOpen);
  const [svc, setSvc] = useState(SERVICE_NAMES[0]);
  const [note, setNote] = useState("");
  const [pics, setPics] = useState([]); // File[]
  const [busy, setBusy] = useState(false);
  // Distinct cars on this order (same pattern as mileage capture)
  const jobCars = (() => {
    const m = new Map();
    (job.items || []).forEach(it => {
      const key = it.car_id || it.car_label || "primary";
      if (!m.has(key)) m.set(key, { key, car_id: it.car_id || (key === "primary" ? job.car_id : null), label: it.car_label || `${job.car_brand || ""} ${job.car_model || ""}`.trim() || "Car" });
    });
    if (!m.size) m.set("primary", { key: "primary", car_id: job.car_id, label: `${job.car_brand || ""} ${job.car_model || ""}`.trim() || "Car" });
    return [...m.values()];
  })();
  const [carKey, setCarKey] = useState(jobCars[0].key);
  const [uploading, setUploading] = useState(0);
  // Photos upload the moment they're picked — no waiting at submit, × to remove
  const addPics = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, Math.max(0, 3 - pics.length)); e.target.value = "";
    for (const f of files) {
      setUploading(u => u + 1);
      try { const u = await uploadJobPhoto(f, `upsell-${job.id}`); setPics(p => p.length < 3 ? [...p, u] : p); }
      catch { alert("⚠ Photo upload failed — please try again."); }
      setUploading(u => u - 1);
    }
  };
  const submit = async () => {
    setBusy(true);
    const car = jobCars.find(c => c.key === carKey) || jobCars[0];
    const ok = await onCreate({
      job_id: job.id, truck: job.assigned_truck || null, technician: job.assigned_technician || null,
      customer_name: job.customer_name || "", customer_mobile: job.customer_mobile || "",
      car_id: car.car_id || null, car_label: car.label || "",
      service_type: svc, note: note.trim(), photo_urls: pics, status: "open",
    });
    setBusy(false);
    if (ok) { setOpen(false); setNote(""); setPics([]); if (onDone) onDone(); }
  };
  const cancel = () => { if (onCancel) onCancel(); else setOpen(false); };
  if (!open) return <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>⬆ Upsell</button>;
  return (
    <div style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: 10, marginTop: 8, width: "100%" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>⬆ New upsell — {job.assigned_truck}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {jobCars.length > 1 ? (
          <select className="filter-select" value={carKey} onChange={e => setCarKey(e.target.value)}>
            {jobCars.map(c => <option key={c.key} value={c.key}>🚗 {c.label}</option>)}
          </select>
        ) : (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>🚗 {jobCars[0].label}</div>
        )}
        <select className="filter-select" value={svc} onChange={e => setSvc(e.target.value)}>
          {SERVICE_NAMES.map(n => <option key={n}>{n}</option>)}
        </select>
        <textarea className="filter-input" rows={2} placeholder="What did you notice? (e.g., front pads at 20%, tires cracking)" value={note} onChange={e => setNote(e.target.value)} style={{ resize: "vertical" }} />
        {(pics.length > 0 || uploading > 0) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {pics.map((u, i) => (
              <span key={i} style={{ position: "relative", display: "inline-block" }}>
                <a href={u} target="_blank" rel="noreferrer"><img src={u} alt="" style={{ height: 52, borderRadius: 6, border: "1px solid var(--border)", objectFit: "cover" }} /></a>
                <button type="button" onClick={(e) => { e.preventDefault(); setPics(p => p.filter(x => x !== u)); }}
                  style={{ position: "absolute", top: -6, right: -6, width: 17, height: 17, borderRadius: "50%", border: "none", background: "var(--danger)", color: "#fff", fontSize: 10, fontWeight: 800, lineHeight: 1, cursor: "pointer", padding: 0 }}>×</button>
              </span>
            ))}
            {uploading > 0 && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>⏳ uploading{uploading > 1 ? ` ×${uploading}` : ""}…</span>}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer", opacity: pics.length >= 3 ? .5 : 1 }}>📷 Add photo<input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={addPics} disabled={pics.length >= 3} /></label>
          {pics.length >= 3 && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>max 3 photos</span>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || uploading > 0} onClick={submit}>{busy ? "Saving…" : uploading > 0 ? "Uploading photos…" : "Send to sales"}</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Upsells page: the technician-generated funnel, with its own simple report ──
function UpsellsView({ upsellLeads, jobs, role, onConvert, onDismiss, onSelectJob }) {
  const [filter, setFilter] = useState("open"); // open | converted | dismissed | all
  const [truckF, setTruckF] = useState("all");
  const [q, setQ] = useState("");

  const leads = upsellLeads || [];
  const jobOf = (l) => l.converted_job_id ? jobs.find(j => j.id === l.converted_job_id) : null;

  // ── KPIs ──
  const open = leads.filter(l => l.status === "open");
  const converted = leads.filter(l => l.status === "converted");
  const dismissed = leads.filter(l => l.status === "dismissed");
  const decided = converted.length + dismissed.length;
  const convRate = decided ? Math.round((converted.length / decided) * 100) : null;
  const convJobs = converted.map(jobOf).filter(Boolean);
  const convKD = convJobs.reduce((s, j) => s + (Number(j.total) || 0), 0);
  const completedKD = convJobs.filter(j => jobSuccessful(j)).reduce((s, j) => s + (Number(j.total) || 0), 0);

  // ── Per truck (the incentive view: credit stays with the spotting truck) ──
  const trucks = {};
  leads.forEach(l => {
    const t = l.truck || "—";
    trucks[t] = trucks[t] || { t, spotted: 0, open: 0, converted: 0, completed: 0, kd: 0 };
    trucks[t].spotted++;
    if (l.status === "open") trucks[t].open++;
    if (l.status === "converted") {
      trucks[t].converted++;
      const cj = jobOf(l);
      if (cj && jobSuccessful(cj)) { trucks[t].completed++; trucks[t].kd += Number(cj.total) || 0; }
    }
  });
  const truckRows = Object.values(trucks).sort((a, b) => b.kd - a.kd || b.converted - a.converted);

  // ── List ──
  const ql = q.trim().toLowerCase();
  const shown = leads
    .filter(l => filter === "all" ? true : l.status === filter)
    .filter(l => truckF === "all" ? true : l.truck === truckF)
    .filter(l => !ql || [l.customer_name, l.customer_mobile, l.service_type, l.car_label, l.truck, l.technician].some(v => String(v || "").toLowerCase().includes(ql)))
    .sort((a, b) => filter === "open" ? new Date(a.created_at) - new Date(b.created_at) : new Date(b.created_at) - new Date(a.created_at));

  const chip = (label, val, sub, color) => (
    <div style={{ flex: "1 1 120px", minWidth: 120, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "var(--card)" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || "var(--text)", marginTop: 2 }}>{val}</div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>{sub}</div>}
    </div>
  );
  const th = { textAlign: "left", fontSize: 10.5, fontWeight: 800, color: "var(--muted)", padding: "6px 8px", textTransform: "uppercase" };
  const td = { fontSize: 12.5, padding: "7px 8px", borderTop: "1px solid var(--border)" };

  return (
    <>
      <div className="page-title">Upsells</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>Opportunities spotted by the trucks. Credit always stays with the truck that spotted it — whoever completes the order.</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {chip("Open", open.length, open.length ? "oldest first below" : "all handled 🎉", open.some(l => leadAgeDays(l) >= 7) ? "#DC2626" : open.some(l => leadAgeDays(l) >= 3) ? "#B45309" : undefined)}
        {chip("Converted", converted.length, decided ? `${convRate}% of decided` : null, "#15803D")}
        {chip("Dismissed", dismissed.length, null)}
        {chip("Converted value", `KWD ${convKD.toFixed(0)}`, "all converted orders")}
        {chip("Completed value", `KWD ${completedKD.toFixed(0)}`, "counts for incentives", "#15803D")}
      </div>

      {truckRows.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-header"><h3>Per truck</h3><span style={{ fontSize: 11.5, color: "var(--muted)" }}>completed = converted order finished (official incentive count)</span></div>
          <div className="card-body" style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>Truck</th><th style={th}>Spotted</th><th style={th}>Open</th><th style={th}>Converted</th><th style={th}>Completed</th><th style={{ ...th, textAlign: "right" }}>KD (completed)</th></tr></thead>
              <tbody>
                {truckRows.map(r => (
                  <tr key={r.t}>
                    <td style={{ ...td, fontWeight: 700 }}>{r.t}</td>
                    <td style={td}>{r.spotted}</td>
                    <td style={{ ...td, color: r.open ? "#B45309" : "var(--muted)", fontWeight: r.open ? 700 : 400 }}>{r.open}</td>
                    <td style={td}>{r.converted}</td>
                    <td style={{ ...td, fontWeight: 700, color: "#15803D" }}>{r.completed}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{r.kd.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        {["open", "converted", "dismissed", "all"].map(f => (
          <button key={f} type="button" className={`btn btn-sm ${filter === f ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter(f)} style={{ textTransform: "capitalize" }}>
            {f}{f === "open" && open.length ? ` (${open.length})` : ""}
          </button>
        ))}
        <select className="filter-select" value={truckF} onChange={e => setTruckF(e.target.value)}>
          <option value="all">All trucks</option>
          {[...new Set(leads.map(l => l.truck).filter(Boolean))].sort().map(t => <option key={t}>{t}</option>)}
        </select>
        <input className="filter-input" placeholder="Search name, mobile, service…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: "1 1 180px" }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {shown.length === 0 && <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "18px 4px" }}>No upsells here{filter !== "all" ? ` — try another filter` : " yet. They'll appear when technicians spot opportunities on completed jobs."}</div>}
        {shown.map(l => {
          const cj = jobOf(l);
          return (
            <div key={l.id}>
              <UpsellLeadCard lead={l} role={role} showCustomer onConvert={onConvert} onDismiss={onDismiss} />
              {cj && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0 0 12px", fontSize: 12 }}>
                  <span style={{ color: "var(--muted)" }}>↳ order:</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelectJob && onSelectJob(cj)}>
                    {fmtDate(cj.scheduled_at)} · {cj.assigned_truck} · KWD {Number(cj.total || 0).toFixed(3)}
                  </button>
                  <StatusPill status={cj.status} />
                  {jobSuccessful(cj) && <span style={{ fontSize: 11, fontWeight: 700, color: "#15803D" }}>✓ counts for {l.truck}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function ThreadSection({ j, jobs, upsellLeads, role, onOpenJob, onConvertLead, onDismissLead }) {
  const parent = j.parent_job_id ? (jobs || []).find(x => x.id === j.parent_job_id) : null;
  const children = (jobs || []).filter(x => x.parent_job_id === j.id);
  const leads = (upsellLeads || []).filter(l => l.job_id === j.id);
  if (!parent && !j.parent_job_id && children.length === 0 && leads.length === 0) return null;
  const linkRow = (job, badgeKey) => {
    const b = LINK_BADGE[badgeKey] || { t: "🔗 Linked", c: "var(--muted)", bg: "var(--bg)" };
    return (
      <div key={job.id} onClick={() => onOpenJob && onOpenJob(job)} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, cursor: onOpenJob ? "pointer" : "default", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: b.c, background: b.bg, border: `1px solid ${b.c}33`, borderRadius: 5, padding: "2px 7px" }}>{b.t}</span>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{job.service_type}</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{fmtDate(job.scheduled_at)} · {job.assigned_truck}{badgeKey === "upsell" && job.upsell_truck ? ` · credit ${job.upsell_truck}` : ""}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--accent)" }}>KWD {Number(job.total || 0).toFixed(3)}</span>
          <StatusPill status={job.status} />
        </div>
      </div>
    );
  };
  return (
    <div className="card">
      <div className="card-body" style={{ padding: "12px 16px" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>🧵 Thread</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {j.parent_job_id && (parent
            ? (
              <div onClick={() => onOpenJob && onOpenJob(parent)} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, cursor: onOpenJob ? "pointer" : "default", background: "var(--bg)", flexWrap: "wrap" }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)" }}>ORIGINAL</span>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{parent.service_type}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{fmtDate(parent.scheduled_at)} · {parent.assigned_truck}{parent.invoice_no ? ` · ${parent.invoice_no}` : ""}</span>
                {j.link_type && LINK_BADGE[j.link_type] && <span style={{ fontSize: 11, color: LINK_BADGE[j.link_type].c, fontWeight: 700, marginLeft: "auto" }}>this order is a {LINK_BADGE[j.link_type].t.replace(/^\S+ /, "")}</span>}
              </div>
            )
            : <div style={{ fontSize: 12, color: "var(--muted)" }}>🔗 Linked to an original order (not loaded)</div>
          )}
          {children.map(ch => linkRow(ch, ch.link_type || "revisit"))}
          {leads.map(l => <UpsellLeadCard key={l.id} lead={l} role={role} onConvert={onConvertLead} onDismiss={onDismissLead} />)}
        </div>
      </div>
    </div>
  );
}

// ═══ 🏁 Master incentive report — per-truck table + launch switch ═════════════
function IncentiveReport({ jobs, enabled, onToggle }) {
  const [mo, setMo] = useState(0); // 0 = this month, -1 = last…
  const [truckFilter, setTruckFilter] = useState("all");
  const ref = new Date();
  ref.setMonth(ref.getMonth() + mo);
  const { target, rows: allRows, trucksActive } = computeIncentives(jobs, ref);
  const rows = truckFilter === "all" ? allRows : allRows.filter(r => r.truck === truckFilter);
  const monthName = ref.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const kd = (n) => `KWD ${(Number(n) || 0).toFixed(3)}`;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-body" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>🎯 Technician Incentive — {monthName}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setMo(m => m - 1)}>‹</button>
            <button className="btn btn-ghost btn-sm" disabled={mo >= 0} onClick={() => setMo(m => m + 1)}>›</button>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: enabled ? "#E8F4EC" : "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px" }}>
              <input type="checkbox" checked={enabled} onChange={e => onToggle(e.target.checked)} />
              {enabled ? "LIVE — technicians see their dashboard" : "OFF — test mode (only you see this)"}
            </label>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 10px" }}>
          Target {target}/truck ({trucksActive} truck{trucksActive === 1 ? "" : "s"} active) · 0.250/order · upsell ×4 · revisited orders void · pot unlocks at target · KWD 5 bonuses per person
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {["all", ...allRows.map(r => r.truck)].map(t => (
            <button key={t} className="btn btn-sm" onClick={() => setTruckFilter(t)}
              style={{ fontWeight: 700, background: truckFilter === t ? "var(--ink)" : "var(--card)", color: truckFilter === t ? "#fff" : "var(--ink)", border: "1px solid var(--border)" }}>
              {t === "all" ? "All trucks" : t}
            </button>
          ))}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="rep-table" style={{ width: "100%", fontSize: 12.5 }}>
            <thead><tr>
              <th style={{ textAlign: "left" }}>Truck</th><th>Orders</th><th>vs target</th><th>Upsells ×4</th><th>Voided</th>
              <th>★ Review</th><th>Revisits caused</th><th>Profit</th><th>Bonuses</th><th style={{ textAlign: "right" }}>Payout / person</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const badges = [r.bonusOrders && "🥇 orders", r.bonusReview && "⭐ review", r.bonusProfit && "💰 profit", r.bonusZeroRevisit && "✨ zero-revisit"].filter(Boolean);
                const bonusKD = badges.length * INCENT.bonusKD;
                const payout = (r.unlocked ? r.pot : 0) + bonusKD;
                return (
                  <tr key={r.truck}>
                    <td style={{ fontWeight: 800 }}>{r.truck}</td>
                    <td style={{ textAlign: "center" }}>{r.orders}</td>
                    <td style={{ textAlign: "center", fontWeight: 700, color: r.unlocked ? "var(--success)" : "#B45309" }}>{Math.round((r.orders / target) * 100)}%{r.unlocked ? " ✓" : ""}</td>
                    <td style={{ textAlign: "center" }}>{r.ups}</td>
                    <td style={{ textAlign: "center", color: r.voided ? "var(--danger)" : "var(--muted)" }}>{r.voided}</td>
                    <td style={{ textAlign: "center" }}>{r.avgReview ? `${r.avgReview} (${r.nReviews})` : "—"}</td>
                    <td style={{ textAlign: "center", color: r.revisitsCaused ? "var(--danger)" : "var(--success)" }}>{r.revisitsCaused}</td>
                    <td style={{ textAlign: "center" }}>{kd(r.profit)}</td>
                    <td style={{ fontSize: 11.5 }}>{badges.join(" · ") || "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 800 }}>{kd(payout)}<div style={{ fontSize: 10.5, fontWeight: 500, color: "var(--muted)" }}>{r.unlocked ? "" : `pot ${kd(r.pot)} locked · `}bonuses {bonusKD}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>Payout = unlocked pot + KWD 5 per bonus (per person). Bonus winners are provisional until month end.</div>
      </div>
    </div>
  );
}

// ═══ 🎯 Technician monthly target & incentive dashboard ═══════════════════════
function TechTargetView({ jobs, truck, owner }) {
  const trucksAll = activeTrucks();
  const [viewTruck, setViewTruck] = useState(truck || trucksAll[0] || "");
  const now = new Date();
  const { target, rows } = computeIncentives(jobs, now);
  const activeTruckKey = owner ? viewTruck : truck;
  const me = rows.find(r => r.truck === activeTruckKey) || { orders: 0, base: 0, ups: 0, voided: 0, pot: 0, unlocked: false, avgReview: null, nReviews: 0, revisitsCaused: 0, profit: 0 };
  const day = now.getDate();
  const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const pace = day > 0 ? Math.round((me.orders / day) * daysIn) : 0;
  const pct = Math.min(100, Math.round((me.orders / target) * 100));
  const monthName = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const bonuses = [
    { label: "Most orders", won: me.bonusOrders, hint: `${me.orders} orders` },
    { label: "Best reviews", won: me.bonusReview, hint: me.avgReview ? `★ ${me.avgReview} (${me.nReviews})` : "no reviews yet" },
    { label: "Highest profit", won: me.bonusProfit, hint: `KWD ${(me.profit || 0).toFixed(0)}` },
    { label: "Zero revisits", won: me.bonusZeroRevisit, hint: me.revisitsCaused === 0 ? "clean so far ✨" : `${me.revisitsCaused} caused` },
  ];
  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      {owner && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {trucksAll.map(t => (
            <button key={t} className="btn btn-sm" onClick={() => setViewTruck(t)}
              style={{ fontWeight: 700, background: viewTruck === t ? "var(--ink)" : "var(--card)", color: viewTruck === t ? "#fff" : "var(--ink)", border: "1px solid var(--border)" }}>
              {t}
            </button>
          ))}
          <span style={{ fontSize: 11.5, color: "var(--muted)", alignSelf: "center" }}>viewing as this truck's technicians</span>
        </div>
      )}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>🎯 {activeTruckKey} — {monthName}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>target adjusts with active trucks</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 12 }}>
          <div style={{ fontSize: 34, fontWeight: 800 }}>{me.orders}<span style={{ fontSize: 15, color: "var(--muted)", fontWeight: 600 }}> / {target} orders</span></div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: pace >= target ? "var(--success)" : "#B45309" }}>pace: ~{pace} by month end</div>
        </div>
        <div style={{ background: "var(--border)", borderRadius: 99, height: 14, marginTop: 8, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: me.unlocked ? "var(--success)" : "linear-gradient(90deg,#F59E0B,#FBBF24)", transition: "width .4s" }} />
        </div>
        <div style={{ marginTop: 14, background: me.unlocked ? "#E8F4EC" : "#FFFBEB", border: `1.5px solid ${me.unlocked ? "#BFDFC9" : "#FCD34D"}`, borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: me.unlocked ? "#1D7A45" : "#92400E" }}>
            {me.unlocked ? "✅ INCENTIVE UNLOCKED — every order keeps paying" : `🔒 ACCRUED — unlocks at ${target} orders (${target - me.orders} to go)`}
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4, color: me.unlocked ? "#1D7A45" : "#92400E" }}>
            KWD {(me.pot || 0).toFixed(3)} <span style={{ fontSize: 13, fontWeight: 600 }}>per technician</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            {me.base}× orders @ 0.250 · {me.ups}× upsell orders @ 1.000{me.voided ? ` · ${me.voided} voided by revisit` : ""}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>🏆 KWD 5 bonuses — live standings</div>
        {bonuses.map(b => (
          <div key={b.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{b.won ? "🥇" : "▫️"} {b.label}</div>
            <div style={{ fontSize: 12.5, color: b.won ? "var(--success)" : "var(--muted)", fontWeight: b.won ? 800 : 500 }}>{b.won ? "LEADING — " : ""}{b.hint}</div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>Winners are decided at month end. Upsells pay ×4 — spot them, report them, win.</div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Trucks this month</div>
        {rows.map(r => (
          <div key={r.truck} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 13, fontWeight: r.truck === activeTruckKey ? 800 : 500 }}>
            <span>{r.truck === activeTruckKey ? "→ " : ""}{r.truck}</span>
            <span>{r.orders} orders · {r.ups} upsells{r.avgReview ? ` · ★${r.avgReview}` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function JobDetail({ job, onBack, onUpdate, onReschedule, onEdit, onReorder, onRevisit, jobs, upsellLeads, onOpenJob, onCreateUpsell, onConvertLead, onDismissLead, role }) {
  const [j, setJ] = useState(job);
  useEffect(() => { setJ(job); }, [job]); // follow live updates (edits, realtime sync)
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const patchJob = async (patch) => {
    const next = { ...j, ...patch };
    setJ(next);
    await updateJob(j.id, patch);
    onUpdate(next);
  };

  const confirmCancel = () => {
    const patch = { status: "cancelled", cancel_reason: cancelReason.trim() || "—", cancelled_at: new Date().toISOString() };
    const next = { ...j, ...patch };
    setJ(next);
    onUpdate(next);           // reflect in list immediately
    setShowCancel(false);
    setCancelReason("");
    updateJob(j.id, patch);   // persist in background (non-blocking)
  };

  const isPaid = j.payment_status === "paid";
  const isCancelled = j.status === "cancelled";
  const [verOpen, setVerOpen] = useState(false);
  const checks = deriveChecks(j);
  const passed = checks.filter(Boolean).length;
  const mismEntries = Object.values(j.tech_mismatch || {});
  const c4Override = checks[3] && mismEntries.some(m => m.resolution === "approved" || m.resolution === "dont_fit");

  const misBad = (id) => { const m = (j.tech_mismatch || {})[id]; return m && m.resolution !== "approved"; };
  // group services by their linked car for the Service Details section
  const svcCarLabel = (s) => {
    const it = (j.items || []).find(x => x.service_id === s.id && x.car_label);
    return (it && it.car_label) || `${j.car_brand || ""} ${j.car_model || ""}`.trim() || "—";
  };
  const svcGroups = {};
  (j.services || []).forEach(s => { const car = svcCarLabel(s); (svcGroups[car] = svcGroups[car] || []).push(s); });

  const Row = ({ icon, children, right }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 13 }}>
      <span style={{ color: "var(--muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{icon} {children}</span>
      {right}
    </div>
  );

  return (
    <div className="job-detail">
      <button className="detail-back" onClick={onBack}>← Back</button>

      {isCancelled && (
        <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#991B1B" }}>
          ✕ This order is <strong>cancelled</strong>{j.cancel_reason && j.cancel_reason !== "—" ? ` — ${j.cancel_reason}` : ""}.
        </div>
      )}
      {j.partial_completion && j.status !== "incomplete" && (
        <div style={{ background: "#FFFBEB", border: "1px solid #F59E0B", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#92400E" }}>
          ◐ <strong>Partially completed</strong> — not fitted: {j.unfitted_items || "see verification"}. Schedule a follow-up job for the remaining items.
        </div>
      )}
      {j.status === "incomplete" && (
        <div style={{ background: "#FFFBEB", border: "1px solid #F59E0B", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#92400E" }}>
          ⚠ This order is <strong>incomplete</strong> — {j.incomplete_reason || "stopped in the field"}. Office confirmed stop{j.incomplete_at ? ` · ${fmtDate(j.incomplete_at)} ${fmtTime(j.incomplete_at)}` : ""}.
        </div>
      )}

      {/* ── Customer info — one calm card ── */}
      <div className="detail-hero">
        <div className="detail-hero-top" style={{ marginBottom: 10 }}>
          <div>
            <h2 style={{ marginBottom: 2 }}>{j.customer_name}</h2>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {fmtDate(j.scheduled_at)} · <strong style={{ color: "var(--text)" }}>{fmtTime(j.scheduled_at)}</strong>{j.duration ? ` · ${j.duration}h` : ""}
              {" · "}<span style={{ color: truckColor(j.assigned_truck).text, fontWeight: 700 }}>{j.assigned_truck}</span>
              {j.is_overtime ? <span style={{ fontSize: 10, background: "#F59E0B", color: "#fff", padding: "1px 6px", borderRadius: 4, marginLeft: 6, fontWeight: 700 }}>⏱ OT</span> : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <StatusPill status={j.status} />
            <div style={{ fontFamily: "var(--font-head)", fontSize: 20, fontWeight: 700, color: "var(--accent)", marginLeft: 4 }}>KWD {Number(j.total || 0).toFixed(3)}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Row icon="📞" right={<a href={`tel:${j.customer_mobile}`} className="btn btn-ghost btn-sm" style={{ textDecoration: "none", flexShrink: 0 }}>Call</a>}>
            <a href={`tel:${j.customer_mobile}`} style={{ color: "var(--accent)", fontWeight: 600 }}>{j.customer_mobile}</a>
            <span style={{ marginLeft: 8, color: "var(--muted)", fontSize: 12 }}>lead: {j.lead_from || "—"}</span>
          </Row>
          <Row icon="📍" right={j.map_link ? <a href={j.map_link} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ textDecoration: "none", flexShrink: 0 }}>🧭 Navigate</a> : null}>
            {j.area}{(j.governorate || govFor(j.area)) ? ` (${j.governorate || govFor(j.area)})` : ""}, Blk {j.block}{j.street ? `, St ${j.street}` : ""}{j.lane ? `, Ln ${j.lane}` : ""}{j.house ? `, ${j.house}` : ""}
          </Row>
          {j.notes && <div style={{ fontSize: 12.5, color: "#B45309", fontWeight: 500 }}>⚠ {j.notes}</div>}
        </div>
        {role === "sales" && !isCancelled && (
          <div style={{ display: "flex", gap: 6, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(j)}>✏ Edit</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReschedule(j)}>↻ Reschedule</button>
            {jobSuccessful(j) && onRevisit && <button type="button" className="btn btn-ghost btn-sm" style={{ color: "#1D4ED8" }} onClick={() => onRevisit(j)}>🔁 Revisit / Follow-up</button>}
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: "var(--danger)", marginLeft: "auto" }} onClick={() => setShowCancel(true)}>✕ Cancel</button>
          </div>
        )}
        {role === "sales" && isCancelled && (
          <div style={{ display: "flex", gap: 6, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", alignItems: "center" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(j)}>✏ Edit &amp; Restore</button>
            {onReorder && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReorder(j)}>↻ Reorder</button>}
            <span style={{ fontSize: 11.5, color: "var(--muted)", marginLeft: "auto" }}>Restore this order, or start a fresh one from it</span>
          </div>
        )}
      </div>

      {/* ── Thread: original / revisits / upsells linked to this order ── */}
      <ThreadSection j={j} jobs={jobs} upsellLeads={upsellLeads} role={role} onOpenJob={onOpenJob} onConvertLead={onConvertLead} onDismissLead={onDismissLead} />

      {/* ── Technician: spot an upsell on a completed job ── */}
      {role === "technician" && jobSuccessful(j) && !isCancelled && onCreateUpsell && (
        <div className="card">
          <div className="card-body" style={{ padding: "12px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>Spotted something the car needs?</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>Send it to sales — if it converts, the credit counts for {j.assigned_truck}.</div>
              </div>
              <TechUpsellForm job={j} onCreate={onCreateUpsell} />
            </div>
          </div>
        </div>
      )}

      {/* ── Order actions — one slim card ── */}
      {(role === "sales" || role === "purchaser") && (
        <div className="card">
          <div className="card-body" style={{ padding: "12px 16px" }}>
            <OrderActions job={j} onAction={(patch) => patchJob(patch)} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10, fontSize: 12 }}>
              <PaymentLinkEditor value={j.payment_link} onSave={(link) => patchJob({ payment_link: link })} compact />
              <span style={{ flex: "1 1 100%" }}><AccountingEditor xeroRef={j.xero_ref} invoiceNo={j.invoice_no} onSave={(patch) => patchJob(patch)} /></span>
            </div>
            <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--muted)" }}>
              Payment: <span style={{ color: isPaid ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>{j.payment_status}</span>
              {" · "}Parts: {j.parts_status || "pending"} · Truck: {j.truck_status || "scheduled"}
              {jobDurationMin(j) != null && <>{" · "}⏱ Job time: <strong>{fmtDuration(jobDurationMin(j))}</strong></>}
              {Number(j.service_mileage) > 0 && <>{" · "}🧭 Mileage: <strong>{Number(j.service_mileage).toLocaleString()} {j.service_mileage_unit || "KM"}</strong></>}
            </div>
          </div>
        </div>
      )}

      {/* ⭐ customer review — sales asks after completion; feeds the review bonus */}
      {jobSuccessful(j) && !["technician", "distributor"].includes(role) && (
        <div className="card">
          <div className="card-body" style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>⭐ Customer review</span>
            <span style={{ display: "flex", alignItems: "center" }}>
              {[1, 2, 3, 4, 5].map(n => (
                <span key={n} onClick={() => onUpdate(job.id, { review_rating: Number(j.review_rating) === n ? null : n })}
                  style={{ cursor: "pointer", fontSize: 23, lineHeight: 1, color: (Number(j.review_rating) || 0) >= n ? "#F59E0B" : "var(--border)", padding: "0 2px" }}>★</span>
              ))}
              {Number(j.review_rating) > 0
                ? <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginLeft: 6 }}>{j.review_rating}/5</span>
                : <span style={{ fontSize: 11.5, color: "var(--muted)", marginLeft: 6 }}>ask the customer</span>}
            </span>
          </div>
        </div>
      )}

      {/* ── Verification — segmented progress bar, tap for detail ── */}
      <div className="card">
        <div className="card-body" style={{ padding: "12px 16px", cursor: "pointer" }} onClick={() => setVerOpen(o => !o)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>Verification</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: passed === 4 ? "var(--success)" : "var(--muted)" }}>{passed}/4 {passed === 4 ? "✓" : ""} <span style={{ fontWeight: 500, color: "var(--muted)" }}>{verOpen ? "▲" : "▼"}</span></span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
            {checks.map((done, i) => (
              <div key={i} title={CHECK_LABELS[i]} style={{ height: 8, borderRadius: 5, background: done ? (i === 3 && c4Override ? "#D97706" : "var(--success)") : "var(--border)", transition: "background .2s" }} />
            ))}
          </div>
          {verOpen && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
              {CHECK_LABELS.map((label, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                  <span style={{ width: 16, height: 16, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, background: checks[i] ? "var(--success)" : "var(--bg)", color: checks[i] ? "#fff" : "var(--muted)", border: checks[i] ? "none" : "1px solid var(--border)", flexShrink: 0 }}>{checks[i] ? "✓" : i + 1}</span>
                  <span style={{ color: checks[i] ? "var(--text)" : "var(--muted)", flex: 1 }}>{label}</span>
                  {checks[i] && (j.ver_times || {})[`c${i + 1}`] && (
                    <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate((j.ver_times)[`c${i + 1}`])} {fmtTime((j.ver_times)[`c${i + 1}`])}</span>
                  )}
                </div>
              ))}
              {mismEntries.length > 0 && (
                <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                  {mismEntries.map((m, i) => (
                    <div key={i} style={{ fontSize: 11.5, color: m.resolution === "approved" ? "#92400E" : "#991B1B", fontWeight: 600 }}>
                      {m.resolution === "approved" ? "✓ Office-approved despite mismatch" : m.resolution === "dont_fit" ? "⛔ Office confirmed — not fitted" : "⚠ Mismatch reported"} — {m.reason}{m.at ? ` · ${fmtDate(m.at)} ${fmtTime(m.at)}` : ""}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Auto-filled as each party verifies. Not manually editable.</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Service details — Car → services → items ── */}
      <div className="card">
        <div className="card-header"><h3>Service Details</h3></div>
        <div className="card-body" style={{ padding: "12px 16px" }}>
          {Object.keys(svcGroups).length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {Object.entries(svcGroups).map(([car, svcs]) => (
                <div key={car}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>🚗 {car}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 12, borderLeft: "2px solid var(--border)" }}>
                    {svcs.map(s => {
                      const t = serviceTotals(s);
                      const isTire = SERVICE_CATALOG[s.service_type]?.kind === "tire";
                      const variantStr = s.variant && Object.values(s.variant).filter(Boolean).join(" / ");
                      return (
                        <div key={s.id} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                            <span style={{ fontSize: 13, fontWeight: 700 }}>
                              {s.service_type}{variantStr ? <span style={{ color: "var(--muted)", fontWeight: 500 }}> · {variantStr}</span> : ""}
                            </span>
                            <span style={{ fontFamily: "var(--font-head)", fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap" }}>KWD {t.total.toFixed(3)}</span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
                            {isTire ? (<>
                              {s.tire_id && (
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                  <span style={misBad(s.staggered ? s.id + "-F" : s.id) ? { color: "#DC2626", fontWeight: 700 } : undefined}>{misBad(s.staggered ? s.id + "-F" : s.id) ? "⚠ " : ""}<span style={{ color: misBad(s.staggered ? s.id + "-F" : s.id) ? "#DC2626" : "var(--accent)", fontWeight: 700 }}>{s.qty}×</span> {s.brand} {s.pattern}{s.staggered ? " (front)" : ""} <span style={{ color: "var(--muted)" }}>· {itemSpec(s)}</span><CollectedChip ok={itemOK(j, s.staggered ? s.id + "-F" : s.id)} /></span>
                                  <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>@ {Number(s.unit_price).toFixed(3)} <span style={{ color: "var(--text)", fontWeight: 600 }}>= {((Number(s.qty) || 0) * (Number(s.unit_price) || 0)).toFixed(3)}</span></span>
                                </div>
                              )}
                              {s.staggered && s.rear_tire_id && (
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                  <span style={misBad(s.id + "-R") ? { color: "#DC2626", fontWeight: 700 } : undefined}>{misBad(s.id + "-R") ? "⚠ " : ""}<span style={{ color: misBad(s.id + "-R") ? "#DC2626" : "var(--accent)", fontWeight: 700 }}>{s.rear_qty}×</span> {s.rear_brand} {s.rear_pattern} (rear) <span style={{ color: "var(--muted)" }}>· {itemSpec({ size: s.rear_size, load_index: s.rear_load_index, speed_rating: s.rear_speed_rating, year: s.rear_year, country: s.rear_country, oem: s.rear_oem, tire_note: s.rear_tire_note })}</span><CollectedChip ok={itemOK(j, s.id + "-R")} /></span>
                                  <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>@ {Number(s.rear_unit_price).toFixed(3)} <span style={{ color: "var(--text)", fontWeight: 600 }}>= {((Number(s.rear_qty) || 0) * (Number(s.rear_unit_price) || 0)).toFixed(3)}</span></span>
                                </div>
                              )}
                              {!s.tire_id && !s.rear_tire_id && <div style={{ color: "#1E40AF", fontWeight: 600 }}>🔧 Labor only — tires with customer{s.description ? ` · ${s.description}` : ""}</div>}
                            </>) : (
                              (s.parts || []).filter(p => p.name || Number(p.price) > 0).length ? (s.parts || []).filter(p => p.name || Number(p.price) > 0).map(p => (
                                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                  <span style={misBad(p.id) ? { color: "#DC2626", fontWeight: 700 } : undefined}>{misBad(p.id) ? "⚠ " : ""}<span style={{ color: misBad(p.id) ? "#DC2626" : "var(--accent)", fontWeight: 700 }}>{p.qty}×</span> {p.name || "—"}{p.supplier ? <span style={{ fontSize: 10.5, fontWeight: 700, color: "#1E40AF", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 5, padding: "1px 6px", marginLeft: 6 }}>{p.supplier}</span> : ""}<CollectedChip ok={itemOK(j, p.id)} /></span>
                                  <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>@ {Number(p.price).toFixed(3)} <span style={{ color: "var(--text)", fontWeight: 600 }}>= {((Number(p.qty) || 1) * (Number(p.price) || 0)).toFixed(3)}</span></span>
                                </div>
                              )) : <div style={{ color: "#1E40AF", fontWeight: 600 }}>🔧 Labor only — parts with customer{s.description ? ` · ${s.description}` : ""}</div>
                            )}
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "var(--muted)", borderTop: "1px dashed var(--border)", paddingTop: 3, marginTop: 2 }}>
                              <span>Labor{s.labor_disc && Number(s.labor_disc.value) ? ` (disc ${s.labor_disc.type === "pct" ? s.labor_disc.value + "%" : "KD " + s.labor_disc.value})` : ""}{s.price_disc && Number(s.price_disc.value) ? ` · parts disc ${s.price_disc.type === "pct" ? s.price_disc.value + "%" : "KD " + s.price_disc.value}` : ""}</span>
                              <span>KWD {t.netLabor.toFixed(3)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* legacy orders without service blocks */
            (j.items && j.items.length) ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {j.items.map(it => (
                  <div key={it.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
                    <span>{it.kind === "tire" ? `${it.brand} ${it.pattern || ""} · ${itemSpec(it)}` : (it.name || it.service_type)} <span style={{ color: "var(--accent)", fontWeight: 700 }}>×{it.qty}</span><CollectedChip ok={itemOK(j, it.id)} /></span>
                    <span style={{ whiteSpace: "nowrap" }}><span style={{ color: "var(--muted)", fontWeight: 500 }}>@ {Number(it.unit_price || 0).toFixed(3)} · </span><span style={{ fontWeight: 700, color: "var(--accent)" }}>KWD {((Number(it.qty) || 0) * (Number(it.unit_price) || 0)).toFixed(3)}</span></span>
                  </div>
                ))}
              </div>
            ) : <p style={{ fontSize: 13, color: "var(--muted)" }}>{j.service_details || "—"}</p>
          )}
        </div>
      </div>

      {Array.isArray(j.check_notes) && j.check_notes.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><h3>Technician Notes</h3></div>
          <div style={{ padding: "12px 16px" }}>
            {j.check_notes.map(n => (
              <div key={n.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", marginBottom: 8, background: n.phase === "pre" ? "#FFFBEB" : "#F0FDF4" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: n.phase === "pre" ? "#B45309" : "#15803D" }}>
                  {n.phase === "pre" ? "🔍 Pre-check" : "✅ Post-service"} <span style={{ fontWeight: 500, color: "var(--muted)" }}>· {fmtDate(n.at)}</span>
                </div>
                {n.text && <div style={{ fontSize: 13, marginTop: 4 }}>{n.text}</div>}
                {(n.photos || []).length > 0 && (
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    {n.photos.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" style={{ height: 64, borderRadius: 6, border: "1px solid var(--border)", objectFit: "cover" }} /></a>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showCancel && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setShowCancel(false)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3>Cancel Order — {j.customer_name}</h3>
              <button className="modal-close" onClick={() => setShowCancel(false)}>×</button>
            </div>
            <div className="modal-body">
              {(j.parts_released || j.techs_released || (j.truck_status && j.truck_status !== "scheduled")) && (
                <div style={{ background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#92400E", marginBottom: 12 }}>
                  ⚠ This order already has work in progress. Cancelling will remove it from the distributor/technician dashboards.
                </div>
              )}
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>Reason for cancellation (kept for records)</label>
              <textarea className="filter-input" style={{ width: "100%", minHeight: 70, resize: "vertical" }} value={cancelReason}
                placeholder="e.g. Customer rescheduled to next week / changed their mind / duplicate order"
                onChange={e => setCancelReason(e.target.value)} autoFocus />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowCancel(false)}>Keep Order</button>
              <button className="btn btn-primary" style={{ background: "var(--danger)", borderColor: "var(--danger)" }} onClick={confirmCancel}>Cancel Order</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Schedule View ────────────────────────────────────────────────────────────
// ─── Accounting editor: Xero PO Ref + Invoice No, editable after submission ────
function AccountingEditor({ xeroRef, invoiceNo, onSave }) {
  const [xero, setXero] = useState(xeroRef || "");
  const [inv, setInv] = useState(invoiceNo || "");
  const [saved, setSaved] = useState(false);
  useEffect(() => { setXero(xeroRef || ""); setInv(invoiceNo || ""); }, [xeroRef, invoiceNo]);
  const dirty = xero !== (xeroRef || "") || inv !== (invoiceNo || "");
  const save = () => { onSave({ xero_ref: xero, invoice_no: inv }); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 140 }}>
        <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Xero PO Ref</label>
        <input className="filter-input" style={{ width: "100%" }} value={xero} placeholder="PO-2026-0041" onChange={e => setXero(e.target.value)} />
      </div>
      <div style={{ flex: 1, minWidth: 140 }}>
        <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Invoice No</label>
        <input className="filter-input" style={{ width: "100%" }} value={inv} placeholder="INV-…" onChange={e => setInv(e.target.value)} />
      </div>
      <button className="btn btn-ghost btn-sm" disabled={!dirty} onClick={save}>{saved ? "✓ Saved" : "Save"}</button>
    </div>
  );
}

// ─── Payment Link editor: paste + copy, used in detail and row ────────────────
function PaymentLinkEditor({ value, onSave, compact }) {
  const [link, setLink] = useState(value || "");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => { setLink(value || ""); }, [value]);
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  const save = () => { onSave(link); setSaved(true); setTimeout(() => setSaved(false), 1500); if (compact) setEditing(false); };
  const chip = (active) => ({
    display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer",
    border: `1px solid ${active ? "#BBF7D0" : "var(--border)"}`, borderRadius: 8, padding: "3px 10px",
    background: active ? "#F0FDF4" : "var(--bg)", color: active ? "#15803D" : "var(--muted)",
    fontSize: 12, fontWeight: 600, userSelect: "none",
  });
  if (compact && !editing) {
    return value ? (
      <span style={{ display: "inline-flex", gap: 6 }} onClick={e => e.stopPropagation()}>
        <span style={chip(true)} onClick={copy}>🔗 {copied ? "✓ Copied" : "Copy link"}</span>
        <span style={chip(false)} onClick={() => setEditing(true)}>✎</span>
      </span>
    ) : (
      <span style={chip(false)} onClick={(e) => { e.stopPropagation(); setEditing(true); }}>+ Payment link</span>
    );
  }
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
      <input className="filter-input" style={{ flex: 1, minWidth: 160 }} value={link}
        placeholder="Paste payment link…" onChange={e => setLink(e.target.value)} autoFocus={compact} />
      <button className="btn btn-ghost btn-sm" onClick={save}>{saved ? "✓ Saved" : "Save"}</button>
      <button className="btn btn-ghost btn-sm" disabled={!link} onClick={copy}>{copied ? "✓ Copied" : "Copy"}</button>
      {compact && <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setLink(value || ""); }}>✕</button>}
    </div>
  );
}

// ─── Order Actions: status buttons reused on list rows + job detail ───────────
// No payment gate (per ops decision) — all actions available any time.
// Payment status stays visible so it's never hidden, just not enforced.
function OrderActions({ job, onAction, compact }) {
  const isPaid = job.payment_status === "paid";
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  {
    // chip format — unified on rows and inside order details
    const chip = (active) => ({
      display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer",
      border: `1px solid ${active ? "#BBF7D0" : "var(--border)"}`, borderRadius: 8, padding: "3px 10px",
      background: active ? "#F0FDF4" : "var(--bg)", color: active ? "#15803D" : "var(--muted)",
      fontSize: 12, fontWeight: 600, userSelect: "none",
    });
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={chip(isPaid)} onClick={stop(() => onAction({ payment_status: isPaid ? "pending" : "paid", paid_date: isPaid ? null : today(), status: isPaid ? job.status : (job.status === "draft" ? "booked" : job.status) }))}>{isPaid ? "✓" : "○"} Paid</span>
        <span style={chip(job.parts_released)} onClick={stop(() => onAction({ parts_released: !job.parts_released }))}>{job.parts_released ? "✓" : "○"} Parts Ready</span>
        <span style={chip(job.techs_released)} onClick={stop(() => onAction({ techs_released: !job.techs_released }))}>{job.techs_released ? "✓" : "○"} Show Technicians</span>
        <span style={chip(job.invoice_shared)} onClick={stop(() => onAction({ invoice_shared: !job.invoice_shared }))}>{job.invoice_shared ? "✓" : "○"} Invoice Sent</span>
        {getTestMode() && job.status !== "done" && job.status !== "cancelled" && (
          <span style={{ borderRadius: 20, padding: "5px 12px", cursor: "pointer", background: "#7C3AED", color: "#fff", fontSize: 12, fontWeight: 700, userSelect: "none" }}
            onClick={stop(() => { if (window.confirm("TEST: force this order through collection, verification, and completion?")) onAction(forceCompletePatch(job)); })}>
            ⏩ Force complete (test)
          </span>
        )}
      </div>
    );
  }
}

function ScheduleView({ jobs, customers, onSelectJob, onNewJob, onNewJobAt, onReschedule, onAction, role }) {
  const [filterTruck, setFilterTruck] = useState("all");
  const [stageF, setStageF] = useState("active");   // active | successful | all — default: the working queue
  const [payF, setPayF] = useState(null);           // null | paid | unpaid (toggle)
  const [filterDate, setFilterDate] = useState(today());
  const [search, setSearch] = useState("");
  const [boardOpen, setBoardOpen] = useState(true); // Day Board shown by default, collapsible

  // base = the day (date/truck/search scope) — the summary reads from THIS, never from the pills
  const base = jobs.filter(j => {
    if (filterTruck !== "all" && j.assigned_truck !== filterTruck) return false;
    if (filterDate) { const d = j.scheduled_at ? new Date(j.scheduled_at).toISOString().split("T")[0] : ""; if (d !== filterDate) return false; }
    if (search) { const s = search.toLowerCase(); if (!j.customer_name?.toLowerCase().includes(s) && !j.customer_mobile?.includes(s) && !j.area?.toLowerCase().includes(s)) return false; }
    return true;
  });
  // Active = the working queue: booked + started
  const isActive = (j) => j.status !== "cancelled" && j.status !== "incomplete" && !jobSuccessful(j);
  const stageList = base.filter(j =>
    stageF === "all" ? true : stageF === "successful" ? jobSuccessful(j) : isActive(j));
  const counts = {
    active: base.filter(isActive).length,
    successful: base.filter(jobSuccessful).length,
    all: base.length,
    // payment counts within the chosen stage — Successful + Unpaid = collections list
    paid: stageList.filter(j => j.payment_status === "paid").length,
    unpaid: stageList.filter(j => j.payment_status !== "paid" && j.status !== "cancelled").length,
  };
  const filtered = stageList
    .filter(j => !payF ? true : payF === "paid" ? j.payment_status === "paid" : (j.payment_status !== "paid" && j.status !== "cancelled"))
    .sort((a, b) => new Date(a.scheduled_at || a.created_at) - new Date(b.scheduled_at || b.created_at)); // earliest on top

  // Day summary — whole day always (never affected by the pills)
  const totalKD = base.reduce((s, j) => s + (j.status !== "cancelled" ? Number(j.total || 0) : 0), 0);
  // Headline revenue = orders SOLD on this day (sale_date), matching the Reports page,
  // regardless of when they're scheduled. Truck/search scope still applies.
  const salesKD = jobs.filter(j => {
    if (j.status === "cancelled") return false;
    if (filterTruck !== "all" && j.assigned_truck !== filterTruck) return false;
    if (search) { const s = search.toLowerCase(); if (!j.customer_name?.toLowerCase().includes(s) && !j.customer_mobile?.includes(s) && !j.area?.toLowerCase().includes(s)) return false; }
    return saleDateOf(j) === (filterDate || today());
  }).reduce((s, j) => s + (Number(j.total) || 0), 0);
  // Cash companion: money actually collected this day (Paid trigger stamps paid_date)
  const collectedKD = jobs.filter(j => {
    if (j.status === "cancelled" || !j.paid_date) return false;
    if (filterTruck !== "all" && j.assigned_truck !== filterTruck) return false;
    if (search) { const s = search.toLowerCase(); if (!j.customer_name?.toLowerCase().includes(s) && !j.customer_mobile?.includes(s) && !j.area?.toLowerCase().includes(s)) return false; }
    return j.paid_date === (filterDate || today());
  }).reduce((s, j) => s + (Number(j.total) || 0), 0);
  const done = base.filter(jobSuccessful).length;

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--accent)" }}>{base.length}</div><div className="stat-lbl">Jobs today</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--success)" }}>{done}</div><div className="stat-lbl">Completed</div></div>
        <div className="stat-card">
          <div className="stat-num" style={{ color: "var(--accent)" }}>KWD {salesKD.toFixed(3)}</div>
          <div className="stat-lbl">{(filterDate || today()) === today() ? "Today's Revenue" : "Revenue (sold this day)"}</div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>on this day's schedule: KWD {totalKD.toFixed(3)}</div>
          <div style={{ fontSize: 10, color: "#059669", fontWeight: 600, marginTop: 1 }}>collected this day: KWD {collectedKD.toFixed(3)}</div>
        </div>
        <div className="stat-card"><div className="stat-num" style={{ color: "#1D4ED8" }}>{base.filter(j => j.payment_status === "paid").length}</div><div className="stat-lbl">Paid</div></div>
      </div>

      <div className="page-header">
        <div className="page-title">Schedule</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className={`btn btn-sm ${boardOpen ? "btn-primary" : "btn-ghost"}`} onClick={() => setBoardOpen(o => !o)}>
            {boardOpen ? "◧ Hide Day Board" : "◧ Show Day Board"}
          </button>
          <div className="filters">
            <input className="filter-input" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 140 }} />
            <input type="date" className="filter-select" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
            <select className="filter-select" value={filterTruck} onChange={e => setFilterTruck(e.target.value)}>
              <option value="all">All Trucks</option>
              {TRUCKS.map(t => <option key={t}>{t}</option>)}
            </select>
            {filterDate && <button className="btn btn-ghost btn-sm" onClick={() => setFilterDate("")}>Clear Date</button>}
          </div>
          {role === "sales" && <button className="btn btn-primary" onClick={onNewJob}>+ New Job</button>}
        </div>

      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      {boardOpen && (
        <div className="card schedule-board-panel" style={{ marginBottom: 16, flex: "1 1 380px", minWidth: 300, alignSelf: "stretch" }}>
          <div className="card-header">
            <h3>Day Board — {filterDate || today()}</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>tap a job to open, empty slot to book</span>
          </div>
          <div className="card-body">
            {(() => {
              const d = filterDate || today();
              const otByTruck = {};
              activeTrucks().forEach(t => { otByTruck[t] = 0; });
              jobs.forEach(j => {
                if (!j.is_overtime) return;
                const jd = j.scheduled_at ? new Date(j.scheduled_at).toISOString().split("T")[0] : "";
                if (jd === d && otByTruck[j.assigned_truck] != null) otByTruck[j.assigned_truck]++;
              });
              const totalOT = Object.values(otByTruck).reduce((a, b) => a + b, 0);
              if (totalOT === 0) return null;
              return (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12, padding: "8px 12px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#B45309" }}>⏱ Overtime today:</span>
                  {activeTrucks().filter(t => otByTruck[t] > 0).map(t => (
                    <span key={t} style={{ fontSize: 12, fontWeight: 600, color: truckColor(t).text, background: truckColor(t).bg, border: `1px solid ${truckColor(t).solid}`, borderRadius: 6, padding: "2px 8px" }}>
                      {t}: {otByTruck[t]} order{otByTruck[t] > 1 ? "s" : ""}
                    </span>
                  ))}
                </div>
              );
            })()}
            <TruckSlotGrid
              jobs={jobs}
              dateStr={filterDate || today()}
              duration={1}
              selectedTruck={null}
              selectedHour={null}
              onJobClick={onSelectJob}
              onPick={(truck, hour) => onNewJobAt && onNewJobAt(truck, hour, filterDate || today())}
              excludeId={null}
            />
          </div>
        </div>
      )}

      <div className="job-cards" style={{ flex: "2 1 420px", minWidth: 300 }}>
          {/* Stage pills + payment toggle — filter the LIST only; the summary above stays whole-day */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", marginBottom: 4 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { k: "active", label: `Active (${counts.active})` },
                { k: "successful", label: `✓ Successful (${counts.successful})` },
                { k: "all", label: `All (${counts.all})` },
              ].map(p => (
                <button key={p.k} className={`btn btn-sm ${stageF === p.k ? "btn-primary" : "btn-ghost"}`} onClick={() => setStageF(p.k)}>{p.label}</button>
              ))}
            </div>
            <div style={{ width: 1, height: 22, background: "var(--border)" }} />
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { k: "paid", label: `Paid (${counts.paid})` },
                { k: "unpaid", label: `Unpaid (${counts.unpaid})` },
              ].map(p => (
                <button key={p.k} className={`btn btn-sm ${payF === p.k ? "btn-primary" : "btn-ghost"}`} onClick={() => setPayF(payF === p.k ? null : p.k)}>{p.label}</button>
              ))}
            </div>
          </div>
        {filtered.length === 0 && <div className="empty"><h3>No jobs</h3><p>Adjust filters or create a new job.</p></div>}
        {filtered.map(job => (
          <div key={job.id} className="job-card" onClick={() => onSelectJob(job)}>
            <div className="job-card-top">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="job-card-name" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>{job.customer_name}</span>
                  {job.customer_mobile && <a href={`tel:${job.customer_mobile}`} onClick={e => e.stopPropagation()} style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>{job.customer_mobile}</a>}
                  {job.assigned_truck && <span className="tag" style={{ background: truckColor(job.assigned_truck).bg, color: truckColor(job.assigned_truck).text, whiteSpace: "nowrap" }}>{job.assigned_truck}</span>}
                  {job.scheduled_at && (
                    <span className="tag tag-time" style={{ whiteSpace: "nowrap" }}>
                      {fmtDate(job.scheduled_at)} · {fmtTime(job.scheduled_at)}{job.duration ? ` · ${job.duration}h` : ""}
                    </span>
                  )}
                </div>
                {(() => {
                  const cn = (customers || []).find(c => c.id === job.customer_id || (last8(c.mobile) && last8(c.mobile) === last8(job.customer_mobile)));
                  return cn?.notes ? <div style={{ fontSize: 12, color: "#B45309", fontWeight: 600, marginTop: 3 }}>⚠ {cn.notes}</div> : null;
                })()}
                {(job.items && job.items.length) ? (
                  <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 7 }}>
                    {(() => {
                      // group items → services → cars
                      const svcMap = {};
                      job.items.forEach(it => {
                        const k = it.service_id || it.id;
                        if (!svcMap[k]) svcMap[k] = { key: k, service_type: it.service_type, isTire: it.kind === "tire", qty: 0, products: [], car: it.car_label || `${job.car_brand || ""} ${job.car_model || ""}`.trim() || "—" };
                        if (it.kind === "tire" && it.tire_id) { svcMap[k].qty += Number(it.qty) || 0; svcMap[k].products.push({ q: it.qty, n: `${it.brand} ${it.pattern || ""}`.trim(), ok: itemOK(job, it.id) }); }
                        else if (it.kind === "part") svcMap[k].products.push({ q: it.qty, n: it.name, ok: itemOK(job, it.id) });
                      });
                      const carGroups = {};
                      Object.values(svcMap).forEach(l => { (carGroups[l.car] = carGroups[l.car] || []).push(l); });
                      return Object.entries(carGroups).map(([car, lines]) => (
                        <div key={car}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>🚗 {car}</div>
                          <div style={{ paddingLeft: 16, display: "flex", flexDirection: "column", gap: 2 }}>
                            {lines.map(l => (
                              <div key={l.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, lineHeight: 1.45 }}>
                                <span style={{ whiteSpace: "nowrap", fontWeight: 600, color: "var(--text)", flexShrink: 0, width: 92 }}>
                                  <span style={{ color: "var(--accent)", fontWeight: 700 }}>{l.isTire ? (l.qty || "") : 1}×</span> {shortService(l.service_type)}{l.isTire && !l.qty ? " (labor)" : ""}
                                </span>
                                <span style={{ color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "left", flex: "1 1 auto", minWidth: 0, display: "block" }}>
                                  {l.products.slice(0, 2).map((p, i) => {
                                    const short = (p.n || "").length > 26 ? (p.n || "").slice(0, 25) + "…" : (p.n || "");
                                    return <span key={i} title={p.n}>{i > 0 ? " · " : ""}<span style={{ color: "var(--accent)", fontWeight: 700 }}>{p.q}×</span> {short}{p.ok && <span style={{ color: "#15803D", fontWeight: 800 }}> ✓</span>}</span>;
                                  })}
                                  {l.products.length > 2 && (
                                    <span style={{ fontWeight: 600 }}> · +{l.products.length - 2} more{l.products.slice(2).every(p => p.ok) && l.products.length > 2 ? <span style={{ color: "#15803D", fontWeight: 800 }}> ✓</span> : ""}</span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                ) : (
                  <>
                    <div className="job-card-service">{job.service_type} · {job.car_brand} {job.car_model}</div>
                    {itemsSummary(job) && <div className="job-card-service" style={{ marginTop: 2, color: "var(--text)" }}>📦 {itemsSummary(job)}</div>}
                  </>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                <StatusPill status={job.status} />
                {job.truck_status && job.truck_status !== "scheduled"
                  && !(job.truck_status === "completed" && DONE_STATUSES.includes(job.status))
                  && !(job.truck_status === "processing" && ["en_route", "on_site"].includes(job.status)) && (
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".3px", padding: "2px 7px", borderRadius: 6,
                    background: job.truck_status === "completed" ? "#DCFCE7" : job.truck_status === "processing" ? "#FEF3C7" : "#DBEAFE",
                    color: job.truck_status === "completed" ? "#15803D" : job.truck_status === "processing" ? "#92400E" : "#1D4ED8" }}>
                    🚚 {job.truck_status === "arrived" ? "parts received" : job.truck_status === "processing" ? "started" : job.truck_status === "completed" ? "successful" : job.truck_status}
                  </span>
                )}
              </div>
            </div>
            <div className="job-card-meta">
              {(() => {
                const cks = deriveChecks(job);
                const done = cks.filter(Boolean).length;
                return (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }} title={`Verification ${done}/4`}>
                    {cks.map((c, i) => <span key={i} style={{ width: 15, height: 6, borderRadius: 3, background: c ? "var(--success)" : "var(--border)" }} />)}
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: done === 4 ? "var(--success)" : "var(--muted)", marginLeft: 3 }}>{done}/4</span>
                  </span>
                );
              })()}
              {job.is_overtime && <span className="tag" style={{ background: "#F59E0B", color: "#fff", fontWeight: 700 }}>⏱ OT</span>}

              {job.total ? <span className="tag tag-total">KWD {Number(job.total).toFixed(3)}</span> : null}
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{job.area}</span>
              {role === "sales" && (
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }}
                  onClick={(e) => { e.stopPropagation(); onReschedule(job); }}>↻ Reschedule</button>
              )}
            </div>
            {(role === "sales" || role === "purchaser") && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                <OrderActions job={job} compact onAction={(patch) => onAction(job, patch)} />
                <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                  <PaymentLinkEditor value={job.payment_link} onSave={(link) => onAction(job, { payment_link: link })} compact />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      </div>
    </>
  );
}

// ─── Distributor Dashboard ────────────────────────────────────────────────────
// Shows part_ready orders. Per-item: match-checkbox + Collected; once all collected,
// Delivered unlocks. Persists to DB (parts_status, item_checks).
function DistributorView({ jobs, onUpdate }) {
  const [view, setView] = useState("order"); // order | supplier
  // Only jobs with something to physically collect reach the distributor —
  // labor-only orders (skimming, computer check, labor-only replacements) stay out.
  const hasCollectables = (j) => (j.items || []).some(it => (it.kind === "tire" && it.tire_id) || it.kind === "part");
  const active = jobs.filter(j => hasCollectables(j) && j.parts_released && j.parts_status !== "delivered" && j.status !== "cancelled" && j.status !== "incomplete")
    .sort((a, b) => new Date(a.scheduled_at || a.created_at) - new Date(b.scheduled_at || b.created_at)); // earliest on top

  // per-item collect action (used by supplier view too) — writes to the job
  const collectItem = (job, itemId) => {
    const collected = { ...(job.collected_items || {}), [itemId]: new Date().toISOString() };
    const next = { ...job, collected_items: collected };
    onUpdate(next); updateJob(job.id, { collected_items: collected });
  };
  const confirmItem = (job, itemId, val) => {
    const item_checks = { ...(job.item_checks || {}), [itemId]: val };
    const collectable = (job.items || []).filter(it => (it.kind === "tire" && it.tire_id) || it.kind === "part");
    const done = collectable.length > 0 && collectable.every(it => item_checks[it.id]);
    const ver_times = verStamp(job, "c2", done);
    const next = { ...job, item_checks, ver_times };
    onUpdate(next); updateJob(job.id, { item_checks, ver_times });
  };

  // Supplier groups across active orders (includes collected, for ✅ + progress)
  const supplierGroups = {};
  active.forEach(j => {
    (j.items || []).filter(it => (it.kind === "tire" && it.tire_id) || it.kind === "part").forEach(it => {
      const sup = it.supplier || "⚠ No supplier assigned";
      (supplierGroups[sup] = supplierGroups[sup] || []).push({ ...it, _job: j });
    });
  });
  const supplierNames = Object.keys(supplierGroups).sort();

  return (
    <>
      <div className="page-header">
        <div className="page-title">Collect</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button className={`btn btn-sm ${view === "order" ? "btn-primary" : "btn-ghost"}`} onClick={() => setView("order")}>By order</button>
          <button className={`btn btn-sm ${view === "supplier" ? "btn-primary" : "btn-ghost"}`} onClick={() => setView("supplier")}>By supplier</button>
        </div>
      </div>

      {(() => {
        // Pipeline: each item lives in exactly one bucket → to collect → collected → delivered
        const released = jobs.filter(j => j.parts_released && j.status !== "cancelled");
        let toCollect = 0, collectedCount = 0, deliveredCount = 0;
        released.forEach(j => {
          const col = j.collected_items || {};
          const delivered = j.parts_status === "delivered";
          (j.items || []).filter(it => (it.kind === "tire" && it.tire_id) || it.kind === "part").forEach(it => {
            if (delivered) deliveredCount++;
            else if (col[it.id]) collectedCount++;
            else toCollect++;
          });
        });
        if (toCollect + collectedCount + deliveredCount === 0) return null;
        return (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            {[
              { label: "Items to collect", value: toCollect, color: "#D97706" },
              { label: "Collected", value: collectedCount, color: "var(--accent)" },
              { label: "Delivered", value: deliveredCount, color: "var(--success)" },
            ].map(s => (
              <div key={s.label} style={{ flex: "1 1 90px", minWidth: 90, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px", textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-head)", fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".4px" }}>{s.label}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {view === "order" && (<>
        {active.length === 0 && <div className="empty"><h3>Nothing to collect</h3><p>Orders appear here when Sales marks "Parts Ready".</p></div>}
        {active.map(job => <DistributorCard key={job.id} job={job} onUpdate={onUpdate} />)}
      </>)}

      {view === "supplier" && (
        supplierNames.length === 0 ? <div className="empty"><h3>Nothing to collect</h3><p>No outstanding orders.</p></div> :
        supplierNames.map(sup => {
          const list = supplierGroups[sup];
          const doneCount = list.filter(it => (it._job.collected_items || {})[it.id]).length;
          return (
            <div key={sup} className="dist-card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 15, color: "#1E40AF" }}>📍 {sup}</div>
                <span style={{ fontSize: 11, color: doneCount === list.length ? "var(--success)" : "var(--muted)", fontWeight: 700 }}>{doneCount} of {list.length} collected</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {list.map(it => {
                  const job = it._job;
                  const isCollected = (job.collected_items || {})[it.id];
                  const isChecked = (job.item_checks || {})[it.id];
                  return (
                    <div key={it.id + job.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: isCollected ? "#F0FDF4" : "var(--card)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 13 }}><strong>{it.kind === "tire" ? `${it.brand} ${it.pattern || ""} · ${itemSpec(it)}` : it.name}</strong> × {it.qty}
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>{job.customer_name} · {job.assigned_truck} · {it.service_type}</div>
                        </span>
                        {isCollected
                          ? <span style={{ fontSize: 13, color: "var(--success)", fontWeight: 700, whiteSpace: "nowrap" }}>✅ Collected</span>
                          : null}
                      </div>
                      {!isCollected && (
                        <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                            <input type="checkbox" checked={!!isChecked} onChange={e => confirmItem(job, it.id, e.target.checked)} />
                            matches order
                          </label>
                          <button className="btn btn-ghost btn-sm" disabled={!isChecked} onClick={() => collectItem(job, it.id)} title={!isChecked ? "Confirm match first" : ""}>Mark Collected</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}


// ─── Distributor History (own page) ──────────────────────────────────────────
function DistributorHistoryView({ jobs }) {
  const [histSupplier, setHistSupplier] = useState("all");
  const [histGroup, setHistGroup] = useState("order"); // order | supplier (default: per order)

  const history = [];
  jobs.forEach(j => {
    const collected = j.collected_items || {};
    (j.items || []).filter(it => (it.kind === "tire" && it.tire_id) || it.kind === "part").forEach(it => {
      if (collected[it.id]) history.push({
        ...it, when: typeof collected[it.id] === "string" ? collected[it.id] : null,
        customer: j.customer_name, truck: j.assigned_truck, service: it.service_type,
        orderId: j.id, orderWhen: j.scheduled_at, orderDelivered: j.parts_status === "delivered",
      });
    });
  });
  history.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));
  const histSuppliers = [...new Set(history.map(h => h.supplier || "Unassigned"))].sort();
  const histFiltered = histSupplier === "all" ? history : history.filter(h => (h.supplier || "Unassigned") === histSupplier);

  return (
    <>
      <div className="page-header"><div className="page-title">Collected History</div></div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            <button className={`btn btn-sm ${histGroup === "order" ? "btn-primary" : "btn-ghost"}`} onClick={() => setHistGroup("order")}>Per order</button>
            <button className={`btn btn-sm ${histGroup === "supplier" ? "btn-primary" : "btn-ghost"}`} onClick={() => setHistGroup("supplier")}>Per supplier</button>
          </div>
          {histGroup === "supplier" && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <button className={`btn btn-sm ${histSupplier === "all" ? "btn-primary" : "btn-ghost"}`} onClick={() => setHistSupplier("all")}>All</button>
              {histSuppliers.map(s => (
                <button key={s} className={`btn btn-sm ${histSupplier === s ? "btn-primary" : "btn-ghost"}`} onClick={() => setHistSupplier(s)}>{s}</button>
              ))}
            </div>
          )}
          <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>{histFiltered.length} collected item{histFiltered.length !== 1 ? "s" : ""}</span>
        </div>

        {histFiltered.length === 0 ? <div className="empty"><h3>No collected history</h3><p>Collected items will appear here.</p></div> : (() => {
          // group into { groupKey: { title, sub, items[] } }
          const groups = {};
          histFiltered.forEach(h => {
            const key = histGroup === "supplier" ? (h.supplier || "Unassigned") : h.orderId;
            if (!groups[key]) groups[key] = {
              title: histGroup === "supplier" ? (h.supplier || "Unassigned") : h.customer,
              sub: histGroup === "supplier" ? "" : `${h.truck} · ${h.orderWhen ? fmtDate(h.orderWhen) : ""}`,
              delivered: histGroup === "order" ? h.orderDelivered : null,
              items: [],
            };
            groups[key].items.push(h);
          });
          const keys = Object.keys(groups);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {keys.map(k => (
                <div key={k} className="dist-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 15, color: histGroup === "supplier" ? "#1E40AF" : "var(--text)" }}>
                      {histGroup === "supplier" ? "📍 " : "🧾 "}{groups[k].title}
                      {groups[k].sub && <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}> · {groups[k].sub}</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      {histGroup === "order" && (
                        <>
                          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".3px", padding: "2px 8px", borderRadius: 6, background: "#DCFCE7", color: "#15803D" }}>✅ Collected</span>
                          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".3px", padding: "2px 8px", borderRadius: 6, background: groups[k].delivered ? "#DCFCE7" : "#F1F5F9", color: groups[k].delivered ? "#15803D" : "#94A3B8" }}>{groups[k].delivered ? "✅ Delivered" : "○ Not delivered"}</span>
                        </>
                      )}
                      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{groups[k].items.length} item{groups[k].items.length > 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {groups[k].items.map((h, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, borderBottom: i < groups[k].items.length - 1 ? "1px solid var(--border)" : "none", paddingBottom: 6 }}>
                        <div>
                          <strong>{h.kind === "tire" ? `${h.brand} ${h.pattern || ""} · ${itemSpec(h)}` : h.name}</strong> × {h.qty}
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            {histGroup === "supplier" ? `${h.customer} · ${h.service}` : `${h.supplier || "Unassigned"} · ${h.service}`}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", textAlign: "right" }}>{h.when ? `${fmtDate(h.when)} ${fmtTime(h.when)}` : "—"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
    </>
  );
}

function DistributorCard({ job, onUpdate }) {
  const [j, setJ] = useState(job);
  useEffect(() => { setJ(job); }, [job]); // follow live updates
  // collectable items = tires with a tire OR parts (exclude labor-only lines)
  const items = (j.items || []).filter(it => (it.kind === "tire" && it.tire_id) || it.kind === "part" || it.kind === "service");
  const checks = j.item_checks || {};
  const collected = j.collected_items || {};

  const patch = (p) => { const next = { ...j, ...p }; setJ(next); onUpdate(next); updateJob(j.id, p); };

  const toggleMatch = (id) => {
    const item_checks = { ...checks, [id]: !checks[id] };
    const done = items.length > 0 && items.every(it => item_checks[it.id]);
    patch({ item_checks, ver_times: verStamp(j, "c2", done) });
  };
  const markCollected = (id) => {
    if (!checks[id]) return; // must confirm match first
    patch({ collected_items: { ...collected, [id]: new Date().toISOString() } });
  };
  const allCollected = items.length > 0 && items.every(it => collected[it.id]);
  const markDelivered = () => { if (allCollected) patch({ parts_status: "delivered" }); };
  const partsStatus = j.parts_status === "delivered" ? "delivered" : (allCollected ? "collected" : "pending");

  return (
    <div className="dist-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div style={{ fontFamily: "var(--font-head)", fontWeight: 600, fontSize: 15 }}>{j.customer_name} — {j.service_type}</div>
        <span className="status-pill" style={{ background: partsStatus === "delivered" ? "#DCFCE7" : partsStatus === "collected" ? "#FEF3C7" : "var(--bg)", color: partsStatus === "delivered" ? "#15803D" : partsStatus === "collected" ? "#92400E" : "var(--muted)" }}>{partsStatus}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Truck {j.assigned_truck} · {fmtDate(j.scheduled_at)} {fmtTime(j.scheduled_at)} · {j.area}</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{j.xero_ref ? `PO Ref: ${j.xero_ref}` : "No PO ref"}</div>

      {items.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>Labor-only order — nothing to collect.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map(it => (
          <div key={it.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", background: collected[it.id] ? "#F0FDF4" : "var(--card)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                {it.kind === "tire" ? `🔗 ${it.brand} ${it.pattern || ""} · ${itemSpec(it)}` : it.name} × {it.qty}
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500, marginTop: 1 }}>for {it.service_type}{it.car_label ? ` · 🚗 ${it.car_label}` : ""}</div>
              </div>
              {it.supplier && <span style={{ fontSize: 11, fontWeight: 700, color: "#1E40AF", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 6, padding: "2px 8px", height: "fit-content", whiteSpace: "nowrap" }}>{it.supplier}</span>}
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 600, margin: "6px 0 8px", cursor: "pointer" }}>
              <input type="checkbox" checked={!!checks[it.id]} onChange={() => toggleMatch(it.id)} />
              I'm sure this item matches the order
            </label>
            {!collected[it.id]
              ? <button className="btn btn-ghost btn-sm" disabled={!checks[it.id]} onClick={() => markCollected(it.id)} title={!checks[it.id] ? "Confirm match first" : ""}>Mark Collected</button>
              : <span style={{ fontSize: 12, color: "var(--success)", fontWeight: 700 }}>✓ Collected</span>}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn btn-primary btn-sm" disabled={!allCollected || j.parts_status === "delivered"} onClick={markDelivered}>
          {j.parts_status === "delivered" ? "✓ Delivered to Truck" : "Mark Delivered to Truck"}
        </button>
        {!allCollected && items.length > 0 && <span style={{ fontSize: 11, color: "var(--muted)" }}>Collect all items to enable delivery.</span>}
      </div>
    </div>
  );
}

// ─── Technician Dashboard (per truck) ─────────────────────────────────────────
function MyJobsView({ jobs, onUpdate, onSelectJob, lockedTruck, onCreateUpsell }) {
  const [upsellJob, setUpsellJob] = useState(null);     // job that just completed
  const [upsellStep, setUpsellStep] = useState("ask");  // "ask" | "form"
  const promptUpsell = (job) => { setUpsellJob(job); setUpsellStep("ask"); };
  const stampResponse = (resp) => {
    const next = { ...upsellJob, upsell_response: resp };
    onUpdate(next);                                    // local state (full job object)
    updateJob(upsellJob.id, { upsell_response: resp }); // server patch
    setUpsellJob(null);
  };
  const [pickTruck, setPickTruck] = useState(activeTrucks()[0]);
  const myTruck = lockedTruck || pickTruck;
  const todayJobs = jobs
    .filter(j => j.assigned_truck === myTruck && j.techs_released && j.status !== "cancelled")
    .filter(j => { const d = j.scheduled_at ? new Date(j.scheduled_at).toISOString().split("T")[0] : ""; return d === today(); })
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

  const isDone = (j) => j.truck_status === "completed" || j.status === "done" || j.status === "incomplete";

  // 🔔 New-order alert: when a job appears on this truck's list (realtime), show
  // a banner + try sound/vibration so the technician notices without watching.
  const seenIds = useRef(null);
  const [newAlert, setNewAlert] = useState(null);
  useEffect(() => {
    const ids = new Set(todayJobs.map(x => x.id));
    if (seenIds.current) {
      const fresh = todayJobs.filter(x => !seenIds.current.has(x.id) && !isDone(x));
      if (fresh.length) {
        setNewAlert(fresh[0]);
        try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {}
        try {
          const ac = new (window.AudioContext || window.webkitAudioContext)();
          const o = ac.createOscillator(), g = ac.createGain();
          o.connect(g); g.connect(ac.destination);
          o.frequency.value = 880; g.gain.value = 0.15;
          o.start(); o.stop(ac.currentTime + 0.18);
          setTimeout(() => { const o2 = ac.createOscillator(); o2.connect(g); o2.frequency.value = 1100; o2.start(); o2.stop(ac.currentTime + 0.4); }, 220);
        } catch {}
        setTimeout(() => setNewAlert(a => (a && fresh[0] && a.id === fresh[0].id) ? null : a), 10000);
      }
    }
    seenIds.current = ids;
  }, [todayJobs.map(x => x.id).join(",")]);

  const active = todayJobs.filter(j => !isDone(j));
  const completed = todayJobs.filter(isDone);
  const inProgress = active.filter(j => j.truck_status === "processing" || j.truck_status === "arrived").length;

  const tc = truckColor(myTruck);

  return (
    <>
      {newAlert && (
        <div onClick={() => { onSelectJob && onSelectJob(newAlert); setNewAlert(null); }}
          style={{ position: "sticky", top: 8, zIndex: 60, background: "#16A34A", color: "#fff", borderRadius: 12, padding: "12px 16px", marginBottom: 12, boxShadow: "0 6px 18px rgba(22,163,74,.35)", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>🔔 New order assigned</div>
            <div style={{ fontSize: 12.5, marginTop: 2 }}>{fmtTime(newAlert.scheduled_at)} · {newAlert.customer_name} · {newAlert.area || ""}</div>
          </div>
          <span onClick={(e) => { e.stopPropagation(); setNewAlert(null); }} style={{ fontWeight: 800, padding: "2px 8px" }}>✕</span>
        </div>
      )}
    <>
      <div className="page-header">
        <div className="page-title">My Jobs — {fmtDate(new Date().toISOString())}</div>
        {lockedTruck ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, color: truckColor(myTruck).text, background: truckColor(myTruck).bg, border: `2px solid ${truckColor(myTruck).solid}`, borderRadius: 8, padding: "5px 12px", fontSize: 14 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: truckColor(myTruck).solid }} /> {myTruck}
          </span>
        ) : (
          <TruckPills value={myTruck} onChange={setPickTruck} />
        )}
      </div>

      {/* Reporting strip */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        {[
          { label: "Jobs", value: active.length, color: truckColor(myTruck).solid },
          { label: "Completed", value: completed.length, color: "var(--success)" },
        ].map(s => (
          <div key={s.label} style={{ flex: "1 1 90px", minWidth: 90, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-head)", fontSize: 26, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {active.length === 0 && <div className="empty"><h3>No active jobs</h3><p>{completed.length > 0 ? `${completed.length} completed today — see History.` : `All clear for ${myTruck}.`}</p></div>}

      <div className="job-cards">
        {active.map((job, i) => <TechJobCard key={job.id} job={job} index={i} onUpdate={onUpdate} onCompletedPrompt={onCreateUpsell ? promptUpsell : null} />)}
      </div>

      {/* ⬆ post-completion upsell prompt — survives the job card unmounting */}
      {upsellJob && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-body" style={{ padding: 18 }}>
              {upsellStep === "ask" ? (
                <>
                  <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>✅ Job completed - Do you have Upsell?</div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14, lineHeight: 1.5 }}>
                    While you were on the car, did you notice anything it needs?
                    Tires, brakes, battery, valves — anything worth a quote.
                    If it converts, the credit counts for <strong style={{ color: "var(--text)" }}>{upsellJob.assigned_truck}</strong>.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <button type="button" className="btn btn-primary" onClick={() => setUpsellStep("form")}>Yes, I have Upsell</button>
                    <button type="button" className="btn btn-ghost" onClick={() => stampResponse("none")}>No, nothing to report</button>
                  </div>
                </>
              ) : (
                <TechUpsellForm job={upsellJob} autoOpen onCreate={onCreateUpsell}
                  onDone={() => stampResponse("added")}
                  onCancel={() => setUpsellStep("ask")} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
    </>
  );
}

// ─── Technician History: completed jobs (own page to keep My Jobs clean) ──────
function TechHistoryView({ jobs, onSelectJob, lockedTruck }) {
  const [pickTruck, setPickTruck] = useState(activeTrucks()[0]);
  const myTruck = lockedTruck || pickTruck;
  const [dateStr, setDateStr] = useState(today());
  const isDone = (j) => j.truck_status === "completed" || j.status === "done" || j.status === "incomplete";
  const done = jobs
    .filter(j => j.assigned_truck === myTruck && isDone(j) && j.status !== "cancelled")
    .filter(j => { const d = j.scheduled_at ? new Date(j.scheduled_at).toISOString().split("T")[0] : ""; return !dateStr || d === dateStr; })
    .sort((a, b) => lastAction(b) - lastAction(a)); // most recent action first
  const dayTotal = done.reduce((s, j) => s + Number(j.total || 0), 0);

  return (
    <>
      <div className="page-header">
        <div className="page-title">History</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="date" className="filter-select" value={dateStr} onChange={e => setDateStr(e.target.value)} />
          {dateStr && <button className="btn btn-ghost btn-sm" onClick={() => setDateStr("")}>All dates</button>}
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        {lockedTruck ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, color: truckColor(myTruck).text, background: truckColor(myTruck).bg, border: `2px solid ${truckColor(myTruck).solid}`, borderRadius: 8, padding: "5px 12px", fontSize: 14 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: truckColor(myTruck).solid }} /> {myTruck}
          </span>
        ) : (
          <TruckPills value={myTruck} onChange={setPickTruck} />
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
        <span style={{ color: "var(--muted)" }}>{done.length} completed{dateStr ? ` on ${fmtDate(dateStr)}` : " (all time)"}</span>
      </div>

      {done.length === 0 && <div className="empty"><h3>No completed jobs</h3><p>Nothing for {myTruck}{dateStr ? " on this date" : ""} yet.</p></div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {done.map((job, i) => (
          <div key={job.id} onClick={() => onSelectJob && onSelectJob(job)} style={{ background: "var(--card)", border: "1px solid var(--border)", borderLeft: `3px solid ${job.status === "incomplete" ? "#B45309" : "var(--success)"}`, borderRadius: 10, padding: "12px 14px", cursor: onSelectJob ? "pointer" : "default", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                <span className="my-job-num" style={{ marginRight: 6 }}>#{i + 1}</span>
                {job.customer_name} <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>· {fmtDate(job.scheduled_at)} {fmtTime(job.scheduled_at)}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{job.service_type} · {job.area}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700, color: job.status === "incomplete" ? "#B45309" : "var(--success)" }}>KWD {Number(job.total || 0).toFixed(3)}</div>
              <div style={{ fontSize: 11, color: job.status === "incomplete" ? "#B45309" : "var(--success)", fontWeight: 600 }}>{job.status === "incomplete" ? "⚠ Incomplete" : "✓ Done"}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// Shrink a photo in-browser before upload (max 1400px, JPEG ~0.8) — damage
// documentation doesn't need full camera resolution; this ~10x's storage life.
async function compressPhoto(file) {
  try {
    const img = await new Promise((res, rej) => {
      const u = URL.createObjectURL(file); const im = new Image();
      im.onload = () => res(im); im.onerror = rej; im.src = u;
    });
    const MAX = 1400;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 400 * 1024) return file; // already small
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise(res => cv.toBlob(res, "image/jpeg", 0.8));
    return blob && blob.size < file.size ? new File([blob], (file.name.replace(/\.\w+$/, "") || "photo") + ".jpg", { type: "image/jpeg" }) : file;
  } catch { return file; } // any failure → upload original rather than block
}
async function uploadJobPhoto(rawFile, jobId) {
  const file = await compressPhoto(rawFile);
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${jobId}/${Date.now()}-${Math.random().toString(36).slice(2,6)}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/job-photos/${path}`, {
    method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": file.type || "image/jpeg" }, body: file });
  if (!res.ok) throw new Error(await res.text());
  return `${SUPABASE_URL}/storage/v1/object/public/job-photos/${path}`;
}
function JobNotes({ j, patch, completed }) {
  const [phase, setPhase] = useState(null); // 'pre' | 'post' | null
  const [txt, setTxt] = useState("");
  const [draftId, setDraftId] = useState(null);
  const [uploading, setUploading] = useState(0);
  const notes = Array.isArray(j.check_notes) ? j.check_notes : [];
  // Always read/patch through refs so async photo uploads never act on a stale snapshot
  const notesRef = useRef(notes); notesRef.current = notes;
  const patchRef = useRef(patch); patchRef.current = patch;

  const openPhase = (p) => { setPhase(p); setTxt(""); setDraftId("n" + Date.now()); };

  // Photos AUTO-SAVE onto the order the moment each upload finishes — no Save button.
  const commitPhoto = (url, ph, id) => {
    const cur = notesRef.current;
    const ex = cur.find(n => n.id === id);
    patchRef.current({
      check_notes: ex
        ? cur.map(n => n.id === id ? { ...n, photos: [...(n.photos || []), url] } : n)
        : [...cur, { id, phase: ph, text: "", photos: [url], at: new Date().toISOString() }],
    });
  };
  const addPic = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = "";
    for (const f of files) {
      setUploading(u => u + 1);
      try { const u = await uploadJobPhoto(f, j.id); commitPhoto(u, phase, draftId); }
      catch { alert("⚠ Photo upload failed — please try again."); }
      setUploading(u => u - 1);
    }
  };
  // × delete a photo from any note (drops empty notes entirely)
  const delPic = (noteId, url) => {
    const next = notesRef.current
      .map(n => n.id === noteId ? { ...n, photos: (n.photos || []).filter(u => u !== url) } : n)
      .filter(n => (n.text && n.text.trim()) || (n.photos || []).length > 0);
    patchRef.current({ check_notes: next });
  };
  // Done: persist the text (if any) into the draft note, then close
  const done = () => {
    const t = txt.trim();
    if (t) {
      const cur = notesRef.current;
      const ex = cur.find(n => n.id === draftId);
      patchRef.current({
        check_notes: ex
          ? cur.map(n => n.id === draftId ? { ...n, text: t } : n)
          : [...cur, { id: draftId, phase, text: t, photos: [], at: new Date().toISOString() }],
      });
    }
    setPhase(null); setTxt(""); setDraftId(null);
  };

  const badge = (p) => p === "pre" ? { t: "🔍 Pre-check", c: "#B45309", bg: "#FFFBEB" } : { t: "✅ Post-service", c: "#15803D", bg: "#F0FDF4" };
  const thumb = (n, u, i) => (
    <span key={i} style={{ position: "relative", display: "inline-block" }}>
      <a href={u} target="_blank" rel="noreferrer"><img src={u} alt="" style={{ height: 46, borderRadius: 5, border: "1px solid var(--border)", objectFit: "cover" }} /></a>
      {!completed && (
        <button type="button" onClick={(e) => { e.preventDefault(); delPic(n.id, u); }}
          style={{ position: "absolute", top: -6, right: -6, width: 17, height: 17, borderRadius: "50%", border: "none", background: "var(--danger)", color: "#fff", fontSize: 10, fontWeight: 800, lineHeight: 1, cursor: "pointer", padding: 0 }}>×</button>
      )}
    </span>
  );
  const draftNote = notes.find(n => n.id === draftId);
  return (
    <div style={{ marginBottom: 10 }}>
      {notes.filter(n => n.id !== draftId).map(n => { const b = badge(n.phase); return (
        <div key={n.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", marginBottom: 6, background: b.bg }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: b.c }}>{b.t} <span style={{ fontWeight: 500, color: "var(--muted)" }}>· {fmtDate(n.at)}</span></div>
          {n.text && <div style={{ fontSize: 12.5, marginTop: 3 }}>{n.text}</div>}
          {(n.photos || []).length > 0 && <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            {n.photos.map((u, i) => thumb(n, u, i))}
          </div>}
        </div>); })}
      {!completed && !phase && (
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => openPhase("pre")}>+ 🔍 Pre-check note</button>
          <button className="btn btn-ghost btn-sm" onClick={() => openPhase("post")}>+ ✅ Post-service note</button>
        </div>
      )}
      {!completed && phase && (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: badge(phase).c, marginBottom: 5 }}>{badge(phase).t}</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
            {(phase === "pre"
              ? ["6 Points Check", "Rim scratch", "Rim bent", "Body scratch", "Body dent", "Tire sidewall damage", "Low tread", "Missing wheel cap", "Missing lock nut key", "Warning light on"]
              : ["6 Points Check", "Torque checked", "Pressures set", "Test drive done", "Old parts returned", "Area cleaned"]
            ).map(s => (
              <button key={s} type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10.5, padding: "3px 9px", borderRadius: 14 }}
                onClick={() => setTxt(t => t ? (t.endsWith(" ") || t.endsWith(",") ? t + s : t + ", " + s) : s)}>{s}</button>
            ))}
          </div>
          <textarea className="filter-input" style={{ width: "100%", minHeight: 44 }} placeholder="Note (e.g. front-right rim scratch before service)…" value={txt} onChange={e => setTxt(e.target.value)} />
          {(draftNote?.photos?.length > 0 || uploading > 0) && (
            <div style={{ display: "flex", gap: 8, margin: "8px 0 2px", flexWrap: "wrap", alignItems: "center" }}>
              {(draftNote?.photos || []).map((u, i) => thumb(draftNote, u, i))}
              {uploading > 0 && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>⏳ uploading{uploading > 1 ? ` ×${uploading}` : ""}…</span>}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: "var(--muted)", margin: "4px 0 6px" }}>Photos save automatically — use × to remove a mistake.</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>📷 Add photo<input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={addPic} /></label>
            <button className="btn btn-primary btn-sm" disabled={uploading > 0} onClick={done}>✓ Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
function TechStage({ num, title, done, meta, children, muted, reopened, setReopened }) {
  const showBody = !done || reopened[num];
  return (
    <div style={{ border: `1px solid ${done ? "#BBF7D0" : "var(--border)"}`, borderRadius: 10, marginBottom: 8, background: done ? "#F0FDF4" : "var(--card)", opacity: muted ? .55 : 1 }}>
      <div onClick={() => done && setReopened(r => ({ ...r, [num]: !r[num] }))}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", cursor: done ? "pointer" : "default" }}>
        <span style={{ width: 20, height: 20, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0,
          background: done ? "var(--success)" : "var(--bg)", color: done ? "#fff" : "var(--muted)", border: done ? "none" : "1px solid var(--border)" }}>{done ? "✓" : num}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: done ? "#15803D" : "var(--text)" }}>{title}</span>
        {meta && <span style={{ fontSize: 11, color: done ? "#15803D" : "var(--muted)", marginLeft: "auto", fontWeight: 600 }}>{meta}</span>}
      </div>
      {showBody && children && <div style={{ padding: "0 12px 12px" }}>{children}</div>}
    </div>
  );
}

function TechJobCard({ job, index, onUpdate, onCompletedPrompt }) {
  const [j, setJ] = useState(job);
  useEffect(() => { setJ(job); }, [job.id, job.updated_at, job.status, job.truck_status, job.parts_released, job.techs_released]); // resync only on real changes, not every keystroke re-render
  const [open, setOpen] = useState(false);
  const [reopened, setReopened] = useState({}); // manually reopened done-stages
  // distinct cars on this order (multi-car orders get one mileage each)
  const jobCars = (() => {
    const m = new Map();
    (job.items || []).forEach(it => {
      const key = it.car_id || it.car_label || "primary";
      if (!m.has(key)) m.set(key, { key, car_id: it.car_id || (key === "primary" ? job.car_id : null), label: it.car_label || `${job.car_brand || ""} ${job.car_model || ""}`.trim() || "Car" });
    });
    if (!m.size) m.set("primary", { key: "primary", car_id: job.car_id, label: `${job.car_brand || ""} ${job.car_model || ""}`.trim() || "Car" });
    return [...m.values()];
  })();
  const [mileages, setMileages] = useState(() => job.car_mileages || (job.service_mileage ? { [jobCars[0].key]: { km: job.service_mileage, unit: job.service_mileage_unit || "KM" } } : {}));
  const mSet = (key, patch) => setMileages(p => ({ ...p, [key]: { ...(p[key] || { unit: "KM" }), ...patch } }));
  const allMiles = jobCars.every(c => Number((mileages[c.key] || {}).km) > 0);
  const items = j.items || [];
  const productItems = items.filter(it => it.tire_id || (Number(it.unit_price) || 0) > 0);
  const hasProducts = productItems.length > 0;
  const ordChecks = j.tech_checks_order || {};
  const carChecks = j.tech_checks_car || {};
  const patch = (p) => { const next = { ...j, ...p }; setJ(next); onUpdate(next); updateJob(j.id, p); };

  const completed = j.truck_status === "completed" || j.status === "done";
  const started = j.truck_status === "processing" || completed;
  const partsReceived = !!j.parts_received || j.truck_status === "arrived" || started;

  const startJob = () => patch({ truck_status: "processing", status: "on_site", started_at: j.started_at || new Date().toISOString() }); // pill shows "Started"
  const toggleOrd = (id) => {
    const tech_checks_order = { ...ordChecks, [id]: !ordChecks[id] };
    const done = productItems.length > 0 && productItems.every(it => tech_checks_order[it.id]);
    const p = { tech_checks_order, ver_times: verStamp(j, "c3", done) };
    // completing "parts match the order" = parts received (auto — no separate button)
    if (done && !started && !completed) { p.parts_received = true; p.truck_status = "arrived"; }
    patch(p);
  };
  const toggleCar = (id) => {
    const tech_checks_car = { ...carChecks, [id]: !carChecks[id] };
    const done = productItems.length > 0 && productItems.every(it => tech_checks_car[it.id] || (mism[it.id] && (mism[it.id].resolution === "approved" || mism[it.id].resolution === "dont_fit")));
    patch({ tech_checks_car, ver_times: verStamp(j, "c4", done) });
  };

  const mism = j.tech_mismatch || {};
  // an item is "resolved" for stage ② if checked OK, office-approved, or office said don't fit
  const itemCarOk = (it) => carChecks[it.id] || (mism[it.id] && (mism[it.id].resolution === "approved" || mism[it.id].resolution === "dont_fit"));
  const dontFitItems = productItems.filter(it => mism[it.id] && mism[it.id].resolution === "dont_fit");
  const hasDontFit = dontFitItems.length > 0;
  const s2count = productItems.filter(it => ordChecks[it.id]).length;
  const s3count = productItems.filter(itemCarOk).length;
  const s2done = hasProducts && s2count === productItems.length;
  const s3done = hasProducts && productItems.every(itemCarOk);

  // ── Mismatch flow (stage ②): flag item → office decides. Inline UI (no browser popups — they're blocked in some mobile browsers) ──
  const [flagging, setFlagging] = useState(null);      // item id whose reason input is open
  const [flagReason, setFlagReason] = useState("");
  const [confirmStop, setConfirmStop] = useState(false); // inline stop confirmation
  const startFlag = (id) => { setFlagging(id); setFlagReason(""); };
  const saveFlag = (id) => {
    const reason = flagReason.trim();
    if (!reason) return;
    setFlagging(null); setFlagReason("");
    patch({ tech_mismatch: { ...mism, [id]: { reason, at: new Date().toISOString(), resolution: null } }, tech_checks_car: { ...carChecks, [id]: false }, ver_times: verStamp(j, "c4", false) });
  };
  const clearMismatch = (id) => { const m = { ...mism }; delete m[id]; setConfirmStop(false); patch({ tech_mismatch: m }); };
  const resolveMismatch = (id, resolution) => {
    const m = { ...mism, [id]: { ...mism[id], resolution, resolved_at: new Date().toISOString() } };
    const done = productItems.every(it => carChecks[it.id] || (m[it.id] && (m[it.id].resolution === "approved" || m[it.id].resolution === "dont_fit")));
    setConfirmStop(false);
    patch({ tech_mismatch: m, ver_times: verStamp(j, "c4", done) });
  };
  const approveMismatch = (id) => resolveMismatch(id, "approved");
  const dontFitMismatch = (id) => resolveMismatch(id, "dont_fit");
  const stopIncomplete = () => {
    const reasons = Object.values(mism).map(x => x.reason).filter(Boolean).join(" · ");
    setConfirmStop(false);
    patch({ status: "incomplete", incomplete_at: new Date().toISOString(), incomplete_reason: reasons || "Mismatch — office confirmed stop" });
  };
  const canComplete = !hasProducts || (s2done && s3done);
  const complete = () => {
    if (!canComplete || completed) return;
    if (!allMiles) { alert("Please enter the current mileage for every car before completing."); return; }
    const now = new Date().toISOString();
    const cm = {};
    jobCars.forEach(c => { const v = mileages[c.key]; cm[c.key] = { car_id: c.car_id, label: c.label, km: Number(v.km), unit: v.unit || "KM" }; });
    const first = cm[jobCars[0].key];
    const p = { truck_status: "completed", status: "done", completed_at: now,
      car_mileages: cm, service_mileage: first.km, service_mileage_unit: first.unit };
    if (hasDontFit) {
      p.partial_completion = true;
      p.unfitted_items = dontFitItems.map(it => `${it.qty}× ${it.kind === "tire" ? `${it.brand} ${it.pattern || ""}`.trim() : it.name} — ${mism[it.id].reason}`).join(" · ");
    }
    patch(p);
    if (onCompletedPrompt) onCompletedPrompt({ ...j, ...p }); // "one last thing" — prompt lives in MyJobsView (this card unmounts on completion)
    // append to the car's mileage log (fire-and-forget; never blocks completion)
    jobCars.forEach(c => {
      const v = cm[c.key];
      if (c.car_id && v) appendCarMileage(c.car_id, {
        date: now, km: v.km, unit: v.unit,
        service: j.service_type || "", job_id: j.id, mobile: j.customer_mobile || "",
      });
    });
  };

  const ts = completed ? "completed" : started ? "processing" : partsReceived ? "arrived" : "scheduled";
  const tsLabel = ts === "arrived" ? "parts received" : ts === "processing" ? "in progress" : ts;
  const statusColor = ts === "completed" ? "#15803D" : ts === "processing" ? "#D97706" : ts === "arrived" ? "#2563EB" : "#94A3B8";
  const pillBg = ts === "completed" ? "#DCFCE7" : ts === "processing" ? "#FEF3C7" : ts === "arrived" ? "#DBEAFE" : "#F1F5F9";

  // Collapsed summary: car → services → product summaries (sales-row structure)
  const collapsedGroups = (() => {
    const svcMap = {};
    items.forEach(it => {
      const k = it.service_id || it.id;
      if (!svcMap[k]) svcMap[k] = { key: k, service_type: it.service_type, isTire: it.kind === "tire", qty: 0, products: [], car: it.car_label || `${j.car_brand || ""} ${j.car_model || ""}`.trim() || "—" };
      const _bad = mism[it.id] && mism[it.id].resolution !== "approved";
      if (it.kind === "tire" && it.tire_id) { svcMap[k].qty += Number(it.qty) || 0; svcMap[k].products.push({ q: it.qty, n: `${it.brand} ${it.pattern || ""}`.trim(), bad: _bad }); }
      else if (it.kind === "part") svcMap[k].products.push({ q: it.qty, n: it.name, bad: _bad });
    });
    const groups = {};
    Object.values(svcMap).forEach(l => { (groups[l.car] = groups[l.car] || []).push(l); });
    return Object.entries(groups);
  })();

  // A stage section: done → slim green ✓ header (tap to reopen); active → full body

  // Verification checklist structured like Service Details: car → service → products (no prices)
  const verGroups = (() => {
    const svcMap = {};
    productItems.forEach(it => {
      const k = it.service_id || it.id;
      if (!svcMap[k]) svcMap[k] = { key: k, service_type: it.service_type, variant: it.variant, car: it.car_label || `${j.car_brand || ""} ${j.car_model || ""}`.trim() || "—", items: [] };
      svcMap[k].items.push(it);
    });
    const g = {};
    Object.values(svcMap).forEach(s => { (g[s.car] = g[s.car] || []).push(s); });
    return Object.entries(g);
  })();
  const verChecklist = (checkMap, toggle, withMismatch) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {verGroups.map(([car, svcs]) => (
        <div key={car}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>🚗 {car}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 10, borderLeft: "2px solid var(--border)" }}>
            {svcs.map(s => {
              const variantStr = s.variant && Object.values(s.variant).filter(Boolean).join(" / ");
              return (
                <div key={s.key} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 9, padding: "8px 10px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>{s.service_type}{variantStr ? <span style={{ color: "var(--muted)", fontWeight: 500 }}> · {variantStr}</span> : ""}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {s.items.map(it => {
                      const m = withMismatch ? mism[it.id] : null;
                      const itemLabel = (
                        <span style={{ fontSize: 12.5 }}>
                          <span style={{ color: "var(--accent)", fontWeight: 700 }}>{it.qty}×</span> <strong>{it.kind === "tire" ? `${it.brand} ${it.pattern || ""}${it.position ? ` (${it.position})` : ""}` : it.name}</strong>
                          {it.kind === "tire" && itemSpec(it) ? <span style={{ color: "var(--muted)" }}> · {itemSpec(it)}</span> : ""}
                          {it.kind === "part" && it.supplier ? <span style={{ fontSize: 10, fontWeight: 700, color: "#1E40AF", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 5, padding: "0 5px", marginLeft: 5 }}>{it.supplier}</span> : ""}
                        </span>
                      );
                      if (m && !m.resolution) return (
                        <div key={it.id} style={{ border: "1px solid #FCA5A5", borderRadius: 8, padding: "8px 10px", background: "#FEF2F2" }}>
                          {itemLabel}
                          <div style={{ fontSize: 12, color: "#991B1B", fontWeight: 600, margin: "5px 0" }}>⚠ Doesn't match: {m.reason}</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <button type="button" className="btn btn-sm" style={{ background: "#FEF3C7", border: "1px solid #F59E0B", color: "#92400E", fontWeight: 700 }} onClick={() => approveMismatch(it.id)}>✓ Office approved — proceed with fitting</button>
                            <button type="button" className="btn btn-sm" style={{ background: "#FEE2E2", border: "1px solid #DC2626", color: "#991B1B", fontWeight: 700 }} onClick={() => dontFitMismatch(it.id)}>⛔ Office confirmed — don't fit this item</button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => clearMismatch(it.id)}>↩ Undo (flagged by mistake)</button>
                          </div>
                        </div>
                      );
                      if (m && m.resolution === "dont_fit") return (
                        <div key={it.id} style={{ border: "1px solid #DC2626", borderRadius: 8, padding: "7px 9px", background: "#FEF2F2", opacity: .9 }}>
                          {itemLabel}
                          <div style={{ fontSize: 11.5, color: "#991B1B", fontWeight: 700, marginTop: 3 }}>⛔ Office confirmed — don't fit · {m.reason}</div>
                          {m.resolved_at && <div style={{ fontSize: 10.5, color: "#B91C1C" }}>{fmtDate(m.resolved_at)} {fmtTime(m.resolved_at)}</div>}
                        </div>
                      );
                      if (m && m.resolution === "approved") return (
                        <div key={it.id} style={{ border: "1px solid #F59E0B", borderRadius: 8, padding: "7px 9px", background: "#FFFBEB" }}>
                          {itemLabel}
                          <div style={{ fontSize: 11.5, color: "#92400E", fontWeight: 700, marginTop: 3 }}>✓ Office-approved despite mismatch · {m.reason}</div>
                          {m.approved_at && <div style={{ fontSize: 10.5, color: "#B45309" }}>{fmtDate(m.approved_at)} {fmtTime(m.approved_at)}</div>}
                        </div>
                      );
                      return (
                        <div key={it.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 9px", background: checkMap[it.id] ? "#F0FDF4" : "var(--card)" }}>
                          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                            <input type="checkbox" checked={!!checkMap[it.id]} onChange={() => toggle(it.id)} style={{ marginTop: 2 }} />
                            {itemLabel}
                          </label>
                          {withMismatch && !checkMap[it.id] && flagging !== it.id && (
                            <button type="button" className="btn btn-ghost btn-sm" style={{ color: "var(--danger)", marginTop: 4, marginLeft: 24, padding: "1px 6px" }} onClick={() => startFlag(it.id)}>⚠ Doesn't match customer's car</button>
                          )}
                          {withMismatch && flagging === it.id && (
                            <div style={{ marginTop: 6, marginLeft: 24, display: "flex", flexDirection: "column", gap: 6 }}>
                              <input className="filter-input" style={{ width: "100%" }} autoFocus value={flagReason}
                                placeholder="What doesn't match? (required — e.g. car needs 21-inch, tire is 20)"
                                onChange={e => setFlagReason(e.target.value)} />
                              <div style={{ display: "flex", gap: 6 }}>
                                <button type="button" className="btn btn-sm" style={{ background: "#FEE2E2", border: "1px solid #DC2626", color: "#991B1B", fontWeight: 700 }} disabled={!flagReason.trim()} onClick={() => saveFlag(it.id)}>Report mismatch</button>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFlagging(null); setFlagReason(""); }}>Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="my-job-card" style={{ borderLeft: `4px solid ${statusColor}`, padding: 0, overflow: "hidden" }}>
      {/* ⚠ mismatch banner — pinned on top whenever any item doesn't match */}
      {(() => {
        const bad = productItems.filter(it => mism[it.id] && mism[it.id].resolution !== "approved");
        if (!bad.length) return null;
        return (
          <div style={{ background: "#FEF2F2", borderBottom: "1.5px solid #FCA5A5", padding: "7px 14px", fontSize: 12, fontWeight: 700, color: "#991B1B" }}>
            ⚠ {bad.length} item{bad.length > 1 ? "s don't" : " doesn't"} match the customer's car — {bad.map(it => it.kind === "tire" ? `${it.brand} ${it.pattern || ""}`.trim() : it.name).join(" · ")}
          </div>
        );
      })()}
      {/* Collapsed summary — always visible, tap to expand */}
      <div onClick={() => setOpen(o => !o)} style={{ cursor: "pointer", padding: "12px 14px" }}>
        {/* 1 · order number / time */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="my-job-num">#{index + 1}</span>
            <span style={{ fontFamily: "var(--font-head)", fontSize: 18, fontWeight: 700 }}>⏰ {fmtTime(j.scheduled_at)}</span>
            {j.is_overtime ? <span style={{ fontSize: 9, background: "#F59E0B", color: "#fff", padding: "1px 5px", borderRadius: 4, fontWeight: 700 }}>OT</span> : ""}
          </div>
          <span style={{ fontSize: 14, color: "var(--muted)" }}>{open ? "▲" : "▼"}</span>
        </div>
        {/* 2 · customer / mobile */}
        <div style={{ fontWeight: 600, fontSize: 14, marginTop: 4 }}>
          {j.customer_name} · <a href={`tel:${j.customer_mobile}`} onClick={e => e.stopPropagation()} style={{ color: "var(--accent)", fontWeight: 600 }}>{j.customer_mobile}</a>
        </div>
        {/* 3 · full address — tap to navigate */}
        <div style={{ fontSize: 12.5, marginTop: 2 }}>
          {j.map_link ? (
            <a href={j.map_link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: "var(--accent)", fontWeight: 500, textDecoration: "underline", textDecorationColor: "rgba(212,132,10,.4)" }}>
              📍 {j.area}, Blk {j.block}{j.street ? `, St ${j.street}` : ""}{j.lane ? `, Ln ${j.lane}` : ""}{j.house ? `, ${j.house}` : ""}
            </a>
          ) : (
            <span style={{ color: "var(--muted)" }}>📍 {j.area}, Blk {j.block}{j.street ? `, St ${j.street}` : ""}{j.lane ? `, Ln ${j.lane}` : ""}{j.house ? `, ${j.house}` : ""}</span>
          )}
        </div>
        {/* 4–5 · car → services / items */}
        {collapsedGroups.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
            {collapsedGroups.map(([car, lines]) => (
              <div key={car}>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>🚗 {car}</div>
                <div style={{ paddingLeft: 14, display: "flex", flexDirection: "column", gap: 2 }}>
                  {lines.map(l => (
                    <div key={l.key} style={{ display: "flex", justifyContent: "space-between", gap: 14, fontSize: 12, lineHeight: 1.45 }}>
                      <span style={{ whiteSpace: "nowrap", fontWeight: 600, flexShrink: 0, width: 92 }}>
                        <span style={{ color: "var(--accent)", fontWeight: 700 }}>{l.isTire ? (l.qty || "") : 1}×</span> {shortService(l.service_type)}{l.isTire && !l.qty ? " (labor)" : ""}
                      </span>
                      <span style={{ color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "left", flex: "1 1 auto", minWidth: 0, display: "block" }}>
                        {l.products.slice(0, 2).map((p, i) => {
                          const short = (p.n || "").length > 26 ? (p.n || "").slice(0, 25) + "…" : (p.n || "");
                          return <span key={i} title={p.n} style={p.bad ? { color: "#DC2626", fontWeight: 700 } : undefined}>{i > 0 ? " · " : ""}<span style={{ color: p.bad ? "#DC2626" : "var(--accent)", fontWeight: 700 }}>{p.q}×</span> {p.bad ? "⚠ " : ""}{short}</span>;
                        })}
                        {l.products.length > 2 && <span style={{ fontWeight: 600 }}> · +{l.products.length - 2} more</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {/* 6 · total — highlighted like the sales row · 7 · note */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 7 }}>
          <span style={{ fontSize: 12, color: "#B45309", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.notes ? `⚠ ${j.notes}` : ""}</span>
          <span style={{ fontFamily: "var(--font-head)", fontWeight: 700, color: "var(--accent)", fontSize: 15, whiteSpace: "nowrap" }}>KWD {Number(j.total || 0).toFixed(3)}</span>
        </div>
      </div>

      {!open ? null : (
      <div style={{ padding: "0 12px 12px" }}>

        {!completed && !started && (
          <div style={{ margin: "2px 0 10px" }}>
            <button className="btn btn-primary btn-sm" onClick={startJob}>▶ Start Job</button>
          </div>
        )}

        {hasProducts ? (
          <>
            {/* Stage 2 · parts vs ORDER */}
            <TechStage reopened={reopened} setReopened={setReopened} num={1} title="Verify parts match the order" done={s2done} meta={`${s2count}/${productItems.length}`}>
              {verChecklist(ordChecks, toggleOrd)}
            </TechStage>

            {/* Stage 3 · parts vs CAR */}
            <TechStage reopened={reopened} setReopened={setReopened} num={2} title="Verify parts match the customer's car" done={s3done} meta={`${s3count}/${productItems.length}`}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Check against the actual car — even if the order was confirmed by the customer.</div>
              {verChecklist(carChecks, toggleCar, true)}
            </TechStage>
          </>
        ) : (
          j.no_products_reason === "customer_parts" ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#FFFBEB", border: "1.5px solid #FCD34D", borderRadius: 10, padding: "9px 12px", marginBottom: 8 }}>
              <span style={{ fontSize: 15 }}>🛞</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#92400E" }}>Parts/tires are WITH THE CUSTOMER — install what the customer provides.</span>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "9px 12px", marginBottom: 8 }}>
              <span style={{ fontSize: 15 }}>🔧</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "#1E40AF" }}>{j.no_products_reason === "labor_only" ? "Labor only — no products for this order." : "Labor only — no products for this order. Parts/tires with customer."}</span>
            </div>
          )
        )}

        {/* Stage 4 · Complete */}
        <TechStage reopened={reopened} setReopened={setReopened} num={hasProducts ? 3 : 1} title="Complete job" done={completed} meta={completed ? (jobDurationMin(j) != null ? fmtDuration(jobDurationMin(j)) : "done") : null}>
          <JobNotes j={j} patch={patch} completed={completed} />
          {!completed && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px" }}>Current mileage (required{jobCars.length > 1 ? " — per car" : ""})</label>
                {jobCars.map(c => {
                  const v = mileages[c.key] || { km: "", unit: "KM" };
                  return (
                    <div key={c.key} style={{ marginTop: 8 }}>
                      {jobCars.length > 1 && <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>🚗 {c.label}</div>}
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input className="filter-input" style={{ width: 130 }} type="number" min="0" inputMode="numeric"
                          placeholder="e.g. 82500" value={v.km || ""} onChange={e => mSet(c.key, { km: e.target.value })} />
                        <div style={{ display: "flex", gap: 4 }}>
                          {["KM", "Mile"].map(u => (
                            <button key={u} type="button" className={`btn btn-sm ${(v.unit || "KM") === u ? "btn-primary" : "btn-ghost"}`} onClick={() => mSet(c.key, { unit: u })}>{u}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div>
                <button className="btn btn-success btn-sm" disabled={!canComplete || !allMiles} onClick={complete}
                  title={!canComplete ? "Finish stages 1 and 2 first" : !allMiles ? "Enter mileage for every car first" : ""}>
                  {hasDontFit ? "Complete Job (partial — skip don't-fit items)" : "Complete Job"}
                </button>
                {!canComplete && <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>Finish both verifications to unlock.</span>}
                {j.started_at && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>⏱ Started {fmtDuration(Math.max(0, Math.round((Date.now() - new Date(j.started_at)) / 60000)))} ago</div>}
              </div>
              {hasDontFit && !confirmStop && (
                <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-start", background: "#FEE2E2", border: "1px solid #DC2626", color: "#991B1B", fontWeight: 700 }} onClick={() => setConfirmStop(true)}>⛔ Stop job — mark incomplete</button>
              )}
              {hasDontFit && confirmStop && (
                <div style={{ border: "1px solid #DC2626", borderRadius: 8, padding: "8px 10px", background: "#FEF2F2" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#991B1B", marginBottom: 6 }}>Mark this order incomplete?</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>It will move to history and won't be completed today. This can't be undone from the truck.</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="btn btn-sm" style={{ background: "#DC2626", border: "1px solid #DC2626", color: "#fff", fontWeight: 700 }} onClick={stopIncomplete}>Yes — mark incomplete</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmStop(false)}>Back</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </TechStage>
      </div>
      )}
    </div>
  );
}

function HistoryView({ jobs, onSelectJob, onEdit, onReorder }) {
  const [search, setSearch] = useState("");
  const [filterTruck, setFilterTruck] = useState("all");
  const [filterAgent, setFilterAgent] = useState("all");
  const [quick, setQuick] = useState("all"); // all | completed | cancelled | paid | unpaid
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // History = successful orders (by status OR technician completion) + cancelled + incomplete
  const histJobs = jobs.filter(j => jobSuccessful(j) || j.status === "cancelled" || j.status === "incomplete");
  const agents = [...new Set(histJobs.map(j => j.sales_agent).filter(Boolean))];

  const filtered = histJobs.filter(j => {
    const cancelled = j.status === "cancelled";
    const incomplete = j.status === "incomplete";
    if (quick === "completed" && (cancelled || incomplete)) return false;
    if (quick === "cancelled" && !cancelled) return false;
    if (quick === "incomplete" && !incomplete) return false;
    if (quick === "paid" && (cancelled || incomplete || j.payment_status !== "paid")) return false;
    if (quick === "unpaid" && (cancelled || incomplete || j.payment_status === "paid")) return false;
    if (filterTruck !== "all" && j.assigned_truck !== filterTruck) return false;
    if (filterAgent !== "all" && j.sales_agent !== filterAgent) return false;
    const d = j.scheduled_at ? new Date(j.scheduled_at).toISOString().split("T")[0] : "";
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!j.customer_name?.toLowerCase().includes(s) && !j.customer_mobile?.includes(s) && !j.service_details?.toLowerCase().includes(s)) return false;
    }
    return true;
  }).sort((a, b) => lastAction(b) - lastAction(a)); // most recent action first

  const completedShown = filtered.filter(j => j.status !== "cancelled" && j.status !== "incomplete");
  const totalRevenue = completedShown.reduce((s, j) => s + Number(j.total || 0), 0);

  const QUICK = [
    { key: "all", label: "All" },
    { key: "completed", label: "✓ Successful" },
    { key: "cancelled", label: "Cancelled" },
    { key: "incomplete", label: "Incomplete" },
    { key: "paid", label: "Paid" },
    { key: "unpaid", label: "Unpaid" },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Order History</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
            {filtered.length} order{filtered.length !== 1 ? "s" : ""} shown · KWD {totalRevenue.toFixed(3)} successful{quick === "all" ? "" : " (filtered)"} — full numbers live in Reports
          </div>
        </div>
        <div className="filters">
          <input className="filter-input" placeholder="Search customer, item…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 200 }} />
          <select className="filter-select" value={filterTruck} onChange={e => setFilterTruck(e.target.value)}>
            <option value="all">All Trucks</option>
            {TRUCKS.map(t => <option key={t}>{t}</option>)}
          </select>
          {agents.length > 0 && (
            <select className="filter-select" value={filterAgent} onChange={e => setFilterAgent(e.target.value)}>
              <option value="all">All Agents</option>
              {agents.map(a => <option key={a}>{a}</option>)}
            </select>
          )}
          <input type="date" className="filter-select" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From date" />
          <input type="date" className="filter-select" value={dateTo} onChange={e => setDateTo(e.target.value)} title="To date" />
        </div>
      </div>

      {/* Quick status filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {QUICK.map(q => (
          <button key={q.key} className={`btn btn-sm ${quick === q.key ? "btn-primary" : "btn-ghost"}`} onClick={() => setQuick(q.key)}>{q.label}</button>
        ))}
      </div>

      {filtered.length === 0 && <div className="empty"><h3>No orders found</h3><p>Completed and cancelled orders will appear here.</p></div>}

      {filtered.map(job => (
        <div key={job.id} className="history-job-card" onClick={() => onSelectJob(job)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{job.customer_name}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                {job.link_type && LINK_BADGE[job.link_type] && <span style={{ fontSize: 10, fontWeight: 800, color: LINK_BADGE[job.link_type].c, background: LINK_BADGE[job.link_type].bg, border: `1px solid ${LINK_BADGE[job.link_type].c}33`, borderRadius: 5, padding: "1px 6px", marginRight: 6 }}>{LINK_BADGE[job.link_type].t}</span>}
                {job.service_type} · {job.car_brand} {job.car_model}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{fmtDateTime(job.scheduled_at)} · {job.assigned_truck} · {job.sales_agent}</div>
              {job.status === "cancelled" && job.cancel_reason && job.cancel_reason !== "—" && (
                <div style={{ fontSize: 12, color: "#991B1B", marginTop: 4 }}>✕ {job.cancel_reason}{job.cancelled_at ? ` · ${fmtDate(job.cancelled_at)}` : ""}</div>
              )}
              {job.status === "cancelled" && (onEdit || onReorder) && (
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {onEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(job); }}>✏ Edit &amp; Restore</button>}
                  {onReorder && <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onReorder(job); }}>↻ Reorder</button>}
                </div>
              )}
              {job.status === "incomplete" && (
                <div style={{ fontSize: 12, color: "#B45309", marginTop: 4 }}>⚠ {job.incomplete_reason || "Incomplete"}{job.incomplete_at ? ` · ${fmtDate(job.incomplete_at)}` : ""}</div>
              )}
              {job.partial_completion && job.status !== "incomplete" && (
                <div style={{ fontSize: 12, color: "#B45309", marginTop: 4 }}>◐ Partial — not fitted: {job.unfitted_items || "see order"}</div>
              )}
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontWeight: 700, color: "var(--accent)", fontSize: 15 }}>KWD {Number(job.total || 0).toFixed(3)}</div>
              <StatusPill status={job.status} />
              <div style={{ fontSize: 11, marginTop: 4, color: job.payment_status === "paid" ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>{job.payment_status}</div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

// ─── Customer Profile Detail ──────────────────────────────────────────────────
// Build a branded per-car service-history PDF (client-side, via print window).
// mode: "simple" = date/service/mileage; "detailed" = adds items done.
const BNCHR_LOGO = "data:image/png;base64,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";
// Branded per-car service-history PDF — timeline design, direct .pdf download.
const SVC_AR = {
  "Tire Change & Balancing": "تبديل تواير مع ميزان",
  "Tire Patch": "رقعة تواير",
  "Tire Rotation": "تدوير تواير",
  "Oil & Filter": "تبديل زيت وفلتر",
  "Battery": "تبديل بطارية",
  "Brake Pads": "تبديل فحمات بريك",
  "Brake Disc": "تبديل أقراص بريك",
  "Disc Skimming": "مخرطة أقراص",
  "Major Service": "صيانة شاملة",
  "AC Gas Refill": "تعبئة غاز مكيف",
  "Car Computer Check": "فحص كمبيوتر",
  "Part Replacement": "تبديل قطع غيار",
  "Tire Check": "فحص تواير",
  "Wheel Repair": "إصلاح عجلات",
  "Mechanical Check": "فحص ميكانيكي",
};
const arSvc = (t) => String(t || "").split(" + ").map(p => SVC_AR[p.trim()] || p.trim()).join(" + ");
function openServiceHistoryPDF(car, customer, jobs, mode, lang) {
  const ar = lang === "ar";
  const L = ar ? {
    title: "سجل صيانة المركبة", issued: "تاريخ الإصدار", customer: "العميل", vehicle: "المركبة",
    vin: "رقم القاعدة", visits: "عدد الزيارات", latest: "آخر قراءة للعداد", period: "فترة الخدمة",
    logh: "سجل الخدمات — الأحدث في الأسفل", none: "لا توجد خدمات مسجلة بعد.",
    sealb: "سجل صيانة موثق", sealt: "يعكس هذا السجل الخدمات المنفذة والموثقة بواسطة فرق بنشر+ المتنقلة في الكويت.",
    dl: "⬇ تحميل PDF",
  } : {
    title: "Vehicle Service History", issued: "Issued", customer: "Customer", vehicle: "Vehicle",
    vin: "VIN / Plate", visits: "Recorded visits", latest: "Latest mileage", period: "Service period",
    logh: "Service Log — Most Recent Last", none: "No completed services on record yet.",
    sealb: "Verified service history", sealt: "This record reflects services performed and documented by BNCHR+ mobile service units in Kuwait.",
    dl: "⬇ Download PDF",
  };
  const carJobs = (jobs || [])
    .filter(j => j.car_id === car.id && (j.status === "done" || j.truck_status === "completed"))
    .sort((a, b) => new Date(a.scheduled_at || a.created_at) - new Date(b.scheduled_at || b.created_at));
  const log = Array.isArray(car.mileage_log) ? car.mileage_log : [];
  const kmFor = (j) => {
    if (Number(j.service_mileage) > 0) return `${Number(j.service_mileage).toLocaleString()} ${j.service_mileage_unit || "KM"}`;
    const e = log.find(x => x.job_id === j.id);
    return e ? `${Number(e.km).toLocaleString()} ${e.unit || "KM"}` : "";
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const detailed = mode === "detailed";
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const chipsFor = (j) => (j.items || [])
    .filter(it => detailed ? true : it.kind !== "labor")
    .map(it => {
      const nm = it.kind === "tire" ? `${it.brand || ""} ${it.pattern || ""} ${it.size || ""}`.replace(/\s+/g, " ").trim() : (it.name || "");
      if (!nm) return "";
      const q = Number(it.qty) > 1 ? `${it.qty}× ` : "";
      return `<span class="part">${it.kind === "labor" ? "🔧 " : ""}<b>${esc(q + nm.slice(0, 60))}</b></span>`;
    }).filter(Boolean).join("");
  const entries = carJobs.map(j => {
    const d = new Date(j.scheduled_at || j.created_at);
    const km = kmFor(j);
    const ch = detailed ? chipsFor(j) : "";
    return `<div class="entry">
      <div class="date"><div class="dow">${DOW[d.getDay()]}</div><div class="dm mono">${d.getDate()} ${MON[d.getMonth()]}</div><div class="yr mono">${d.getFullYear()}</div></div>
      <div class="spine"><div class="node"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/><path d="M12 4.5v1.6M19.5 12h-1.6M12 19.5v-1.6M4.5 12h1.6"/></svg></div></div>
      <div class="body-col"><div class="svc-line"><span class="svc-type">${esc(ar ? arSvc(j.service_type || "Service") : (j.service_type || "Service"))}</span>${km ? `<span class="svc-km mono">${esc(km)}</span>` : ""}</div>
      ${ch ? `<div class="parts">${ch}</div>` : ""}</div>
    </div>`;
  }).join("");
  const latest = car.last_mileage ? `${Number(car.last_mileage).toLocaleString()} ${car.last_mileage_unit || "KM"}` : "—";
  const range = carJobs.length ? `${MON[new Date(carJobs[0].scheduled_at).getMonth()]} ${new Date(carJobs[0].scheduled_at).getFullYear()} — ${MON[new Date(carJobs[carJobs.length-1].scheduled_at).getMonth()]} ${new Date(carJobs[carJobs.length-1].scheduled_at).getFullYear()}` : "—";
  const fname = `BNCHR-Service-History-${(car.brand || "car")}-${(car.model || "")}`.replace(/\s+/g, "-");

  const html = `<!doctype html><html${ar ? ' dir="rtl" lang="ar"' : ""}><head><meta charset="utf-8"><title>Service History — ${esc(car.brand)} ${esc(car.model)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..900&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
  :root{--ink:#16181d;--graphite:#5c616b;--faint:#9aa0aa;--hairline:#e4e2dd;--paper:#fff;--brand:#00ca00;--brand-ink:#00a000;--brand-soft:#eafbe6;--tint:#f7f6f3;}
  *{margin:0;padding:0;box-sizing:border-box;}html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{font-family:'Archivo',sans-serif;color:var(--ink);background:#d8d7d3;}
  html[dir=rtl] body,html[dir=rtl] .svc-type,html[dir=rtl] .doc-title{font-family:'IBM Plex Sans Arabic','Archivo',sans-serif;}
  html[dir=rtl] .date{text-align:left;padding-right:0;padding-left:4px;}
  html[dir=rtl] .doc-id{text-align:left;}html[dir=rtl] .foot .url{text-align:left;}
  html[dir=rtl] .body-col{padding-left:0;padding-right:8px;}
  .mono{font-family:'IBM Plex Mono',monospace;}
  .page{width:210mm;min-height:297mm;margin:24px auto;background:var(--paper);padding:16mm 16mm 12mm;box-shadow:0 6px 32px rgba(0,0,0,.18);display:flex;flex-direction:column;}
  .masthead{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:14px;border-bottom:2.5px solid var(--ink);}
  .logo{height:24px;display:block;}
  .doc-id{text-align:right;}.doc-id .doc-title{font-size:15px;font-weight:750;letter-spacing:.06em;text-transform:uppercase;}
  .doc-id .issued{font-size:9.5px;color:var(--graphite);margin-top:5px;}
  .identity{display:grid;grid-template-columns:1.1fr 1.2fr 1.1fr;border-bottom:1px solid var(--hairline);padding:14px 0 16px;gap:16px;}
  .field .label{font-size:8px;letter-spacing:.22em;text-transform:uppercase;color:var(--faint);font-weight:700;margin-bottom:5px;}
  .field .value{font-size:13.5px;font-weight:640;}
  .plate{display:inline-block;margin-top:2px;border:1.5px solid var(--ink);border-radius:4px;padding:3px 9px;font-size:11px;font-weight:600;letter-spacing:.08em;}
  .summary{display:grid;grid-template-columns:repeat(3,1fr);background:var(--tint);border-radius:6px;padding:12px 18px;margin:16px 0 22px;}
  .summary .stat + .stat{border-left:1px solid var(--hairline);padding-left:18px;}
  .summary .num{font-size:19px;font-weight:800;}.summary .num em{font-style:normal;color:var(--brand-ink);}
  .summary .label{font-size:8px;letter-spacing:.2em;text-transform:uppercase;color:var(--graphite);font-weight:700;margin-top:3px;}
  .log-heading{font-size:9px;letter-spacing:.26em;text-transform:uppercase;color:var(--graphite);font-weight:750;margin-bottom:14px;}
  .entry{display:grid;grid-template-columns:70px 40px 1fr;padding-bottom:22px;position:relative;}
  .date{text-align:right;padding-right:4px;}
  .date .dow{font-size:8.5px;color:var(--faint);text-transform:uppercase;letter-spacing:.14em;}
  .date .dm{font-size:13px;font-weight:600;margin-top:1px;}.date .yr{font-size:9px;color:var(--faint);margin-top:1px;}
  .spine{position:relative;}
  .spine::before{content:'';position:absolute;left:17px;top:30px;bottom:-24px;border-left:1.5px dashed var(--hairline);}
  .entry:last-of-type .spine::before{display:none;}
  .spine .node{position:absolute;left:4px;top:0;width:27px;height:27px;border-radius:50%;background:var(--paper);border:1.5px solid var(--ink);display:flex;align-items:center;justify-content:center;}
  .spine .node svg{width:14px;height:14px;stroke:var(--ink);fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;}
  .body-col{padding-left:8px;padding-top:4px;}
  .svc-line{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
  .svc-type{font-size:13.5px;font-weight:760;letter-spacing:.04em;text-transform:uppercase;}
  .svc-km{font-size:9.5px;color:var(--graphite);}
  .parts{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;}
  .part{font-size:9px;border:1px solid var(--hairline);border-radius:20px;padding:3px 9px;color:var(--ink);background:var(--paper);}
  .part b{font-weight:600;}
  .foot{margin-top:auto;border-top:1px solid var(--hairline);padding-top:12px;display:flex;justify-content:space-between;align-items:center;gap:16px;}
  .seal{display:flex;align-items:center;gap:10px;}
  .seal .badge{width:34px;height:34px;border-radius:50%;border:1.5px solid var(--brand);color:var(--brand-ink);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;background:var(--brand-soft);}
  .seal .txt{font-size:8.5px;line-height:1.5;color:var(--graphite);max-width:340px;}
  .seal .txt b{color:var(--ink);font-weight:700;letter-spacing:.05em;text-transform:uppercase;font-size:8.5px;}
  .foot .url{font-size:8.5px;color:var(--faint);text-align:right;}
  .dlbar{text-align:center;margin:14px 0 30px;}
  .dlbtn{padding:11px 26px;font-size:13px;font-weight:700;background:#16181d;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Archivo',sans-serif;}
  .entry{page-break-inside:avoid;break-inside:avoid;}
  body.pdf{background:none;margin:0;padding:0;}
  html.pdf{margin:0;padding:0;}
  body.pdf .page{margin:0 !important;box-shadow:none;min-height:auto;width:794px;padding:34px 40px 28px;}
  body.pdf .foot{margin-top:26px;}
  body.pdf .dlbar{display:none;}
  @page{size:A4;margin:0;}
  @media print{html,body{margin:0;padding:0;background:none;height:auto;}.page{margin:0;box-shadow:none;width:auto;min-height:auto;padding:10mm 12mm;}.dlbar{display:none;}.foot{margin-top:26px;}}
  </style></head><body>
  <div class="page" id="pg">
    <div class="masthead">
      <div><img class="logo" src="${BNCHR_LOGO}" alt="BNCHR+"></div>
      <div class="doc-id"><div class="doc-title">${L.title}</div><div class="issued mono">${L.issued} ${new Date().toLocaleDateString("en-GB")}</div></div>
    </div>
    <div class="identity">
      <div class="field"><div class="label">${L.customer}</div><div class="value">${esc(customer.name || "")}</div></div>
      <div class="field"><div class="label">${L.vehicle}</div><div class="value">${esc(car.brand)} ${esc(car.model)} ${esc(car.year || "")}</div></div>
      <div class="field"><div class="label">${L.vin}</div>${car.plate ? `<span class="plate mono">${esc(car.plate)}</span>` : `<div class="value">—</div>`}</div>
    </div>
    <div class="summary">
      <div class="stat"><div class="num">${carJobs.length}</div><div class="label">${L.visits}</div></div>
      <div class="stat"><div class="num"><em>${esc(latest)}</em></div><div class="label">${L.latest}</div></div>
      <div class="stat"><div class="num" style="font-size:14px;padding-top:4px">${esc(range)}</div><div class="label">${L.period}</div></div>
    </div>
    <div class="log-heading">${L.logh}</div>
    ${entries || `<div style="color:#9aa0aa;font-size:12px">${L.none}</div>`}
    <div class="foot">
      <div class="seal"><div class="badge">✓</div><div class="txt"><b>${L.sealb}</b><br>${L.sealt}</div></div>
      <div class="url mono">bnchrplus.com</div>
    </div>
  </div>
  <div class="dlbar"><button class="dlbtn" onclick="dl()">${L.dl}</button></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"><\/script>
  <script>
    function dl(){
      var el = document.getElementById('pg');
      if (${ar ? "true" : "false"}) { window.print(); return; } // Arabic: native print shapes letters correctly
      if (window.html2pdf) {
        document.body.classList.add('pdf');
        document.documentElement.classList.add('pdf');
        window.scrollTo(0, 0);
        html2pdf().set({
          margin: 0, filename: '${fname}.pdf',
          image: { type: 'jpeg', quality: 0.96 },
          html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0, x: 0, y: 0, windowWidth: 794 },
          jsPDF: { unit: 'mm', format: 'a4' },
          pagebreak: { mode: ['css', 'legacy'], avoid: ['.entry', '.summary', '.identity', '.foot'] }
        }).from(el).save().then(function(){ document.body.classList.remove('pdf'); document.documentElement.classList.remove('pdf'); })
          .catch(function(){ document.body.classList.remove('pdf'); document.documentElement.classList.remove('pdf'); window.print(); });
      } else { window.print(); }
    }
  <\/script>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("Please allow pop-ups to generate the PDF."); return; }
  w.document.write(html); w.document.close();
}

function CustomerProfileDetail({ customer, cars, addresses, jobs, onBack, onSelectJob, onAddCar, onAddAddress, onNewOrder, onReorder, onEditCustomer, onEditCar, onDeleteCar, onEditAddress, onDeleteAddress }) {
  const [pdfFor, setPdfFor] = useState(null); // car.id whose PDF options are open
  const customerCars = cars.filter(c => c.customer_id === customer.id);
  const customerAddrs = (addresses || []).filter(a => a.customer_id === customer.id);
  const customerJobs = jobs.filter(j => j.customer_id === customer.id).sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
  const totalSpent = customerJobs.reduce((s, j) => s + Number(j.total || 0), 0);

  const [confirmDel, setConfirmDel] = useState(null); // { kind: 'car'|'addr', id }

  // History filters
  const [histCar, setHistCar] = useState("all");
  const [histService, setHistService] = useState("all");
  const serviceOptions = [...new Set(customerJobs.map(j => j.service_type).filter(Boolean))];
  const filteredJobs = customerJobs.filter(j => {
    if (histCar !== "all" && j.car_id !== histCar) return false;
    if (histService !== "all" && j.service_type !== histService) return false;
    return true;
  });
  const filteredTotal = filteredJobs.reduce((s, j) => s + Number(j.total || 0), 0);
  const histFiltered = histCar !== "all" || histService !== "all";

  return (
    <div className="job-detail">
      <button className="detail-back" onClick={onBack}>← Back to Customers</button>

      <div className="detail-hero">
        <div className="detail-hero-top">
          <div>
            <h2>{customer.name}</h2>
            <div className="detail-hero-sub"><a href={`tel:${customer.mobile}`}>{customer.mobile}</a> · {customer.area}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--font-head)", fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>KWD {totalSpent.toFixed(3)}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{customerJobs.length} jobs total</div>
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 8 }}>
              {onEditCustomer && <button className="btn btn-ghost btn-sm" onClick={onEditCustomer}>✎ Edit</button>}
              {onNewOrder && <button className="btn btn-primary btn-sm" onClick={onNewOrder}>+ New Order</button>}
            </div>
          </div>
        </div>
        {customer.notes && <div style={{ fontSize: 13, color: "#B45309", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px" }}>⚠ {customer.notes}</div>}
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Vehicles ({customerCars.length})</h3>
          <button className="btn btn-ghost btn-sm" onClick={() => onAddCar(customer)}>+ Add Vehicle</button>
        </div>
        <div className="card-body">
          {customerCars.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No vehicles on file.</div>}
          {customerCars.map(car => {
            const log = Array.isArray(car.mileage_log) ? [...car.mileage_log].sort((a, b) => new Date(b.date) - new Date(a.date)) : [];
            const latest = car.last_mileage || (log[0] && log[0].km);
            const unit = car.last_mileage_unit || (log[0] && log[0].unit) || "KM";
            return (
            <div key={car.id} className="car-card" style={{ flexDirection: "column", alignItems: "stretch" }}>
             <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div>
                <div className="car-card-info">{car.brand} {car.model} {car.year}</div>
                <div className="car-card-plate">{car.plate}</div>
                {latest ? <div style={{ fontSize: 12, fontWeight: 700, color: "#15803D", marginTop: 3 }}>🧭 {Number(latest).toLocaleString()} {unit} <span style={{ fontWeight: 500, color: "var(--muted)" }}>· last recorded</span></div> : null}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{customerJobs.filter(j => j.car_id === car.id).length} jobs</span>
                <button className="btn btn-ghost btn-sm" title="Service history PDF" onClick={() => setPdfFor(pdfFor === car.id ? null : car.id)}>📄</button>
                {onEditCar && <button className="btn btn-ghost btn-sm" onClick={() => onEditCar(car)}>✎</button>}
                {onDeleteCar && (confirmDel?.kind === "car" && confirmDel?.id === car.id ? (
                  <span style={{ display: "inline-flex", gap: 4 }}>
                    <button className="btn btn-sm" style={{ background: "#DC2626", color: "#fff", fontWeight: 700 }} onClick={() => { onDeleteCar(car.id); setConfirmDel(null); }}>Delete?</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(null)}>✕</button>
                  </span>
                ) : (
                  <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => setConfirmDel({ kind: "car", id: car.id })}>🗑</button>
                ))}
              </div>
             </div>
             {pdfFor === car.id && (
               <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                 <span style={{ fontSize: 12, color: "var(--muted)" }}>Service history PDF:</span>
                 <button className="btn btn-primary btn-sm" onClick={() => { openServiceHistoryPDF(car, customer, jobs, "simple", "en"); setPdfFor(null); }}>Simple</button>
                 <button className="btn btn-ghost btn-sm" onClick={() => { openServiceHistoryPDF(car, customer, jobs, "detailed", "en"); setPdfFor(null); }}>With details</button>
                 <button className="btn btn-ghost btn-sm" onClick={() => { openServiceHistoryPDF(car, customer, jobs, "simple", "ar"); setPdfFor(null); }}>عربي</button>
                 <button className="btn btn-ghost btn-sm" onClick={() => { openServiceHistoryPDF(car, customer, jobs, "detailed", "ar"); setPdfFor(null); }}>عربي مفصّل</button>
               </div>
             )}
             {log.length > 0 && (
               <details style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                 <summary style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", cursor: "pointer" }}>Mileage history ({log.length})</summary>
                 <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                   {log.map((e, i) => {
                     const prev = log[i + 1];
                     const diff = prev && e.km > prev.km ? e.km - prev.km : null;
                     return (
                       <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                         <span style={{ fontWeight: 600 }}>{Number(e.km).toLocaleString()} {e.unit || "KM"}</span>
                         <span style={{ color: "var(--muted)" }}>{e.service || "Service"} · {fmtDate(e.date)}{diff ? ` · +${diff.toLocaleString()}` : ""}</span>
                       </div>
                     );
                   })}
                 </div>
               </details>
             )}
            </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Addresses ({customerAddrs.length})</h3>
          <button className="btn btn-ghost btn-sm" onClick={() => onAddAddress(customer)}>+ Add Address</button>
        </div>
        <div className="card-body">
          {customerAddrs.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No addresses on file.</div>}
          {customerAddrs.map(a => (
            <div key={a.id} className="car-card">
              <div>
                <div className="car-card-info">{a.label || "Address"} — {a.area}</div>
                <div className="car-card-plate">Block {a.block}, St {a.street}{a.lane ? ", Lane " + a.lane : ""}, {a.house}{a.map_link ? " · 📍 map" : ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                {onEditAddress && <button className="btn btn-ghost btn-sm" onClick={() => onEditAddress(a)}>✎</button>}
                {onDeleteAddress && (confirmDel?.kind === "addr" && confirmDel?.id === a.id ? (
                  <span style={{ display: "inline-flex", gap: 4 }}>
                    <button className="btn btn-sm" style={{ background: "#DC2626", color: "#fff", fontWeight: 700 }} onClick={() => { onDeleteAddress(a.id); setConfirmDel(null); }}>Delete?</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(null)}>✕</button>
                  </span>
                ) : (
                  <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => setConfirmDel({ kind: "addr", id: a.id })}>🗑</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header" style={{ flexWrap: "wrap", gap: 8 }}>
          <h3>Service History</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <select className="filter-select" value={histCar} onChange={e => setHistCar(e.target.value)}>
              <option value="all">All vehicles</option>
              {customerCars.map(c => <option key={c.id} value={c.id}>{c.brand} {c.model} {c.year}</option>)}
            </select>
            <select className="filter-select" value={histService} onChange={e => setHistService(e.target.value)}>
              <option value="all">All services</option>
              {serviceOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="card-body">
          {histFiltered && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>{filteredJobs.length} job{filteredJobs.length !== 1 ? "s" : ""} match</span>
              <span style={{ fontWeight: 700, color: "var(--accent)" }}>KWD {filteredTotal.toFixed(3)}</span>
            </div>
          )}
          {filteredJobs.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>{customerJobs.length === 0 ? "No jobs yet." : "No jobs match these filters."}</div>}
          {filteredJobs.map(job => (
            <div key={job.id} className="history-job-card" onClick={() => onSelectJob(job)} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{job.service_type}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{job.car_brand} {job.car_model} · {fmtDate(job.scheduled_at)}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{job.service_details}</div>
                  {(job.items || []).length > 0 && (
                    <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 2 }}>
                      {(job.items || []).map((it, i) => (
                        <div key={i} style={{ fontSize: 11.5, color: it.kind === "labor" ? "var(--muted)" : "var(--text)", display: "flex", gap: 6 }}>
                          <span style={{ color: "var(--muted)", flexShrink: 0 }}>{it.kind === "labor" ? "🔧" : "•"}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>
                            {Number(it.qty) > 1 ? `${it.qty}× ` : ""}{it.kind === "tire" ? `${it.brand || ""} ${it.pattern || ""} ${it.size || ""}`.replace(/\s+/g, " ").trim() : it.name}
                            {Number(it.unit_price) > 0 && <span style={{ color: "var(--muted)" }}> · {(Number(it.unit_price) * (Number(it.qty) || 1)).toFixed(2)} KD</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, color: "var(--accent)" }}>KWD {Number(job.total || 0).toFixed(3)}</div>
                  <StatusPill status={job.status} />
                  {onReorder && <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={(e) => { e.stopPropagation(); onReorder(job); }}>↻ Reorder</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Add Car Modal ────────────────────────────────────────────────────────────
function AddCarModal({ customer, editCar, onClose, onCreated, onUpdated }) {
  const [f, setF] = useState(editCar
    ? { brand: editCar.brand || "", model: editCar.model || "", sub_model: editCar.sub_model || "", year: editCar.year || "", plate: editCar.plate || "" }
    : { brand: "", model: "", sub_model: "", year: "", plate: "" });
  const [saving, setSaving] = useState(false);
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    if (!f.brand || (!editCar && !f.model)) return; // imported cars may lack model — editable without one
    setSaving(true);
    if (editCar) {
      await updateCar(editCar.id, f);
      onUpdated({ ...editCar, ...f });
    } else {
      const car = await createCar({ ...f, customer_id: customer.id, created_at: new Date().toISOString() });
      onCreated(car);
    }
    setSaving(false);
    onClose();
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3>{editCar ? "Edit Vehicle" : "Add Vehicle"} — {customer.name}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-field"><label>Brand *</label><ComboBox value={f.brand} onChange={(v) => setF(p => ({ ...p, brand: v, model: "", sub_model: "" }))} options={carBrandOpts()} placeholder="Toyota" /></div>
            <div className="form-field"><label>Year</label><ComboBox value={f.year} onChange={(v) => setF(p => ({ ...p, year: v }))} options={carYears} placeholder="2023" /></div>
            <div className="form-field"><label>Model *</label><ComboBox value={f.model} onChange={(v) => setF(p => ({ ...p, model: v, sub_model: "" }))} options={carModelOpts(f.brand)} placeholder="Land Cruiser" /></div>
            <div className="form-field"><label>Sub-Model</label><ComboBox value={f.sub_model} onChange={(v) => setF(p => ({ ...p, sub_model: v }))} options={carSubModelOpts(f.brand, f.model)} placeholder="Carrera / VXR / Denali…" /></div>
            <div className="form-field"><label>VIN</label><input value={f.plate} onChange={set("plate")} placeholder="VIN" /></div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : editCar ? "Save Changes" : "Add Vehicle"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Customers View ───────────────────────────────────────────────────────────
// ─── Add Address Modal ────────────────────────────────────────────────────────
function AddAddressModal({ customer, editAddr, onClose, onCreated, onUpdated }) {
  const [f, setF] = useState(editAddr
    ? { label: editAddr.label || "Home", area: editAddr.area || "", governorate: editAddr.governorate || "", block: editAddr.block || "", street: editAddr.street || "", lane: editAddr.lane || "", house: editAddr.house || "", map_link: editAddr.map_link || "" }
    : { label: "Home", area: "", governorate: "", block: "", street: "", lane: "", house: "", map_link: "" });
  const [saving, setSaving] = useState(false);
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  const save = async () => {
    if (!f.area) return;
    setSaving(true);
    const patch = { ...f, governorate: f.governorate || govFor(f.area), map_link: f.map_link || buildMapsLink({ ...f, governorate: f.governorate || govFor(f.area) }) };
    if (editAddr) {
      await updateAddress(editAddr.id, patch);
      onUpdated({ ...editAddr, ...patch });
    } else {
      const a = await createAddress({ ...patch, customer_id: customer.id, created_at: new Date().toISOString() });
      onCreated(a);
    }
    setSaving(false);
    onClose();
  };
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3>{editAddr ? "Edit Address" : "Add Address"} — {customer.name}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-field form-full"><label>Label</label><input value={f.label} onChange={set("label")} placeholder="Home, Office…" /></div>
            <div className="form-field"><label>Area *</label><ComboBox value={f.area} onChange={(v) => setF(p => ({ ...p, area: v, governorate: govFor(v) || p.governorate }))} options={KW_AREA_NAMES} placeholder="Salmiya" /></div>
            <div className="form-field"><label>Governorate</label><input value={f.governorate || govFor(f.area)} readOnly placeholder="auto" style={{ background: "#F3F4F6", color: "var(--muted)" }} /></div>
            <div className="form-field"><label>Block</label><input value={f.block} onChange={set("block")} placeholder="12" /></div>
            <div className="form-field"><label>Street</label><ComboBox value={f.street} onChange={(v) => setF(p => ({ ...p, street: v }))} options={streetsForArea(f.area)} placeholder="33 or name" /></div>
            <div className="form-field"><label>Lane (Jadda)</label><input value={f.lane} onChange={set("lane")} placeholder="optional" /></div>
            <div className="form-field"><label>House #</label><input value={f.house} onChange={set("house")} placeholder="7A" /></div>
            <div className="form-field form-full">
              <label>Google Map Link</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={f.map_link} onChange={set("map_link")} placeholder="https://maps.google.com/…" style={{ flex: 1 }} />
                {f.map_link && <a href={f.map_link} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ whiteSpace: "nowrap" }}>📍 Open</a>}
              </div>
              <PaciPinBuilder
                    onUse={(link) => setF(p => ({ ...p, map_link: link }))}
                    onFill={(a) => setF(p => ({ ...p,
                      area: a.area || p.area,
                      governorate: a.governorate || p.governorate,
                      block: a.block || p.block,
                      street: a.street || p.street,
                      lane: a.lane || p.lane,
                      house: a.house || p.house,
                      map_link: a.mapLink || p.map_link,
                    }))} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : editAddr ? "Save Changes" : "Add Address"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Customer Modal ──────────────────────────────────────────────────────
function EditCustomerModal({ customer, onClose, onUpdated }) {
  const [f, setF] = useState({ name: customer.name || "", mobile: customer.mobile || "", area: customer.area || "", notes: customer.notes || "" });
  const [saving, setSaving] = useState(false);
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  const mobileChanged = f.mobile !== (customer.mobile || "");
  const save = async () => {
    if (!f.name || !f.mobile) return;
    setSaving(true);
    await updateCustomer(customer.id, f);
    onUpdated({ ...customer, ...f });
    setSaving(false);
    onClose();
  };
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3>Edit Customer — {customer.name}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-field"><label>Full Name *</label><input value={f.name} onChange={set("name")} /></div>
            <div className="form-field"><label>Mobile *</label><input value={f.mobile} onChange={set("mobile")} inputMode="tel" /></div>
            <div className="form-field form-full"><label>Area</label><ComboBox value={f.area} onChange={(v) => setF(p => ({ ...p, area: v }))} options={KW_AREA_NAMES} placeholder="Salmiya" /></div>
            <div className="form-field form-full"><label>Notes</label><textarea value={f.notes} onChange={set("notes")} placeholder="VIP, fleet client…" /></div>
            {mobileChanged && (
              <div className="form-full" style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#92400E" }}>
                ⚠ Mobile is what links this customer to their quotes and order history. Change it only to correct a wrong number.
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !f.name || !f.mobile}>{saving ? "Saving…" : "Save Changes"}</button>
        </div>
      </div>
    </div>
  );
}

function CustomersView({ customers, cars, jobs, onSelectCustomer, onNewCustomer }) {
  const [search, setSearch] = useState("");   // everything: name, mobile, area, cars, notes
  const [mobileQ, setMobileQ] = useState(""); // phone only — exact
  const [areaF, setAreaF] = useState("all");
  const [govF, setGovF] = useState("all");
  const [brandF, setBrandF] = useState("all");
  const [sortBy, setSortBy] = useState("name");

  const digits = (s) => (s || "").replace(/\D/g, "");
  const q = search.trim().toLowerCase();
  const mq = digits(mobileQ);
  const mobileExact = mq.length >= 8;

  // per-customer vehicle lookup (brands + count + searchable text)
  const brandsByCust = {}, carCount = {}, carText = {};
  cars.forEach(car => {
    if (!car.customer_id) return;
    (brandsByCust[car.customer_id] = brandsByCust[car.customer_id] || new Set()).add(car.brand);
    carCount[car.customer_id] = (carCount[car.customer_id] || 0) + 1;
    carText[car.customer_id] = `${carText[car.customer_id] || ""} ${car.brand || ""} ${car.model || ""}`.toLowerCase();
  });

  const areaOptions = [...new Set(customers.map(c => c.area).filter(Boolean))].sort();
  const brandOptions = [...new Set(cars.map(c => c.brand).filter(Boolean))].sort();
  const GOVS = ["Al Asimah", "Hawalli", "Farwaniya", "Mubarak Al-Kabeer", "Ahmadi", "Jahra"];

  const filtered = customers.filter(c => {
    if (mq) {
      const m = digits(c.mobile);
      if (mobileExact) { if (m.slice(-8) !== mq.slice(-8)) return false; } // 8 digits → exact
      else if (!m.startsWith(mq)) return false;                            // typing → number starts with
    }
    if (q) {
      const hay = `${c.name || ""} ${c.mobile || ""} ${c.area || ""} ${c.notes || ""}${carText[c.id] || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (areaF !== "all" && c.area !== areaF) return false;
    if (govF !== "all" && govFor(c.area) !== govF) return false;
    if (brandF !== "all" && !(brandsByCust[c.id] && brandsByCust[c.id].has(brandF))) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === "recent") return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    if (sortBy === "vehicles") return (carCount[b.id] || 0) - (carCount[a.id] || 0);
    return (a.name || "").localeCompare(b.name || "");
  });

  const CAP = 200;
  const shown = filtered.slice(0, CAP);
  const hasFilters = q || mq || areaF !== "all" || govF !== "all" || brandF !== "all";
  const clearAll = () => { setSearch(""); setMobileQ(""); setAreaF("all"); setGovF("all"); setBrandF("all"); };

  return (
    <>
      <div className="page-header">
        <div className="page-title">Customers ({customers.length})</div>
        <button className="btn btn-primary" onClick={onNewCustomer}>+ New Customer</button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <div className="search-wrap" style={{ flex: "1 1 170px", minWidth: 160 }}>
          <span className="search-icon">📱</span>
          <input className="search-input" placeholder="Mobile — exact" value={mobileQ}
            onChange={e => setMobileQ(e.target.value)} inputMode="tel" />
        </div>
        <div className="search-wrap" style={{ flex: "1 1 200px", minWidth: 180 }}>
          <span className="search-icon">🔍</span>
          <input className="search-input" placeholder="Search everything…" value={search}
            onChange={e => setSearch(e.target.value)} inputMode="search" />
        </div>
        <select className="filter-select" value={govF} onChange={e => { setGovF(e.target.value); setAreaF("all"); }}>
          <option value="all">All Governorates</option>
          {GOVS.map(g => <option key={g}>{g}</option>)}
        </select>
        <select className="filter-select" value={areaF} onChange={e => setAreaF(e.target.value)}>
          <option value="all">All Areas</option>
          {(govF === "all" ? areaOptions : areaOptions.filter(a => govFor(a) === govF)).map(a => <option key={a}>{a}</option>)}
        </select>
        <select className="filter-select" value={brandF} onChange={e => setBrandF(e.target.value)}>
          <option value="all">All Car Brands</option>
          {brandOptions.map(b => <option key={b}>{b}</option>)}
        </select>
        <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="name">Sort: Name A–Z</option>
          <option value="recent">Sort: Recently added</option>
          <option value="vehicles">Sort: Most vehicles</option>
        </select>
        {hasFilters && <button className="btn btn-ghost btn-sm" onClick={clearAll}>✕ Clear</button>}
      </div>

      {hasFilters && (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
          {filtered.length} customer{filtered.length !== 1 ? "s" : ""} match
          {mobileExact ? " (exact mobile)" : ""}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="empty">
          <h3>No customers found</h3>
          <p>{mq ? "No customer with this mobile — check the number, or create them as new." : "Try different filters or search terms."}</p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
        {shown.map(c => {
          const cCars = cars.filter(car => car.customer_id === c.id);
          const cJobs = jobs.filter(j => j.customer_id === c.id);
          const totalSpent = cJobs.reduce((s, j) => s + Number(j.total || 0), 0);
          const lastJob = cJobs.sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at))[0];
          return (
            <div key={c.id} className="customer-card" onClick={() => onSelectCustomer(c)}>
              <div className="customer-card-name">{c.name}</div>
              <div className="customer-card-meta">
                <span>📱 {c.mobile}</span>
                <span>📍 {c.area}</span>
              </div>
              {cCars.length > 0 && (
                <div className="cars-row">
                  {cCars.map(car => (
                    <span key={car.id} className="car-chip">{car.brand} {car.model} {car.year}</span>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <span className="history-mini">{cJobs.length} job{cJobs.length !== 1 ? "s" : ""} · Last: {lastJob ? fmtDate(lastJob.scheduled_at) : "—"}</span>
                <span style={{ fontWeight: 700, color: "var(--accent)", fontSize: 14 }}>KWD {totalSpent.toFixed(3)}</span>
              </div>
              {c.notes && <div style={{ fontSize: 12, color: "#B45309", marginTop: 6 }}>⚠ {c.notes}</div>}
            </div>
          );
        })}
      </div>

      {filtered.length > CAP && (
        <div style={{ textAlign: "center", padding: "16px 0", fontSize: 13, color: "var(--muted)" }}>
          Showing first {CAP} of {filtered.length} — refine the search or filters to see the rest.
        </div>
      )}
    </>
  );
}



// ─── Truck Settings (owner / sales / purchaser) ───────────────────────────────
function TruckSettingsView({ rows, onReload, owner }) {
  const [testOn, setTestOn] = useState(getTestMode());
  const [saving, setSaving] = useState("");
  const [adding, setAdding] = useState(false);
  const [newTruck, setNewTruck] = useState({ truck: "", start_hour: 11, end_hour: 19 });
  const hourOpts = []; for (let h = 6; h <= 23; h++) hourOpts.push(h);
  const setHours = async (truck, field, val) => { setSaving(truck); await saveTruckConfig(truck, { [field]: field === "password" ? String(val) : Number(val) }); await onReload(); setSaving(""); };
  const toggleActive = async (truck, active) => { setSaving(truck); await saveTruckConfig(truck, { active }); await onReload(); setSaving(""); };
  const addTruck = async () => {
    const code = (newTruck.truck || "").trim().toUpperCase();
    if (!code) { alert("Enter a truck code, e.g. T7"); return; }
    if (rows.some(r => r.truck === code)) { alert(code + " already exists."); return; }
    if (Number(newTruck.end_hour) <= Number(newTruck.start_hour)) { alert("End time must be after start time."); return; }
    setAdding(true);
    const genPw = code.toLowerCase() + "abcdefghjkmnpqrstuvwxyz"[Math.floor(Math.random() * 23)] + String(100 + Math.floor(Math.random() * 900));
    const ok = await addTruckConfig({ truck: code, active: true, password: genPw, start_hour: Number(newTruck.start_hour), end_hour: Number(newTruck.end_hour), sort_order: (Math.max(0, ...rows.map(r => r.sort_order || 0)) + 1) });
    if (ok) alert(`${code} added — technician password: ${genPw}`);
    if (ok) { setNewTruck({ truck: "", start_hour: 11, end_hour: 19 }); await onReload(); }
    setAdding(false);
  };
  const sorted = [...rows].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const th = { textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", padding: "8px 10px", borderBottom: "1px solid var(--border)" };
  const td = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid var(--border)" };
  return (
    <>
      <div className="page-header"><div className="page-title">Truck Settings</div></div>
      <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
        <div className="card-header"><h3>Trucks & working hours</h3></div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Truck</th><th style={th}>Active</th><th style={th}>Start</th><th style={th}>End</th><th style={th}>Shift</th><th style={th}>Password</th></tr></thead>
          <tbody>
            {sorted.map(r => {
              const c = truckColor(r.truck);
              return (
                <tr key={r.truck} style={{ opacity: r.active ? 1 : 0.55 }}>
                  <td style={{ ...td, fontWeight: 700 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: c.solid }} />{r.truck}</span></td>
                  <td style={td}><button className={`btn btn-sm ${r.active ? "btn-primary" : "btn-ghost"}`} disabled={saving === r.truck} onClick={() => toggleActive(r.truck, !r.active)}>{r.active ? "Active" : "Off"}</button></td>
                  <td style={td}><select className="filter-input" value={r.start_hour} disabled={saving === r.truck} onChange={e => setHours(r.truck, "start_hour", e.target.value)}>{hourOpts.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}</select></td>
                  <td style={td}><select className="filter-input" value={r.end_hour} disabled={saving === r.truck} onChange={e => setHours(r.truck, "end_hour", e.target.value)}>{hourOpts.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}</select></td>
                  <td style={{ ...td, color: "var(--muted)" }}>{hourLabel(r.start_hour)} – {hourLabel(r.end_hour)}</td>
                  <td style={td}><input className="filter-input" style={{ width: 92, fontFamily: "monospace" }} defaultValue={r.password || ""} disabled={saving === r.truck}
                    onBlur={e => { const v = e.target.value.trim(); if (v && v !== r.password) setHours(r.truck, "password", v); }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h3>Add a truck</h3></div>
        <div style={{ padding: "14px 16px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="form-field" style={{ maxWidth: 110 }}><label>Code</label><input className="filter-input" placeholder="T7" value={newTruck.truck} onChange={e => setNewTruck(p => ({ ...p, truck: e.target.value }))} /></div>
          <div className="form-field" style={{ maxWidth: 130 }}><label>Start</label><select className="filter-input" value={newTruck.start_hour} onChange={e => setNewTruck(p => ({ ...p, start_hour: e.target.value }))}>{hourOpts.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}</select></div>
          <div className="form-field" style={{ maxWidth: 130 }}><label>End</label><select className="filter-input" value={newTruck.end_hour} onChange={e => setNewTruck(p => ({ ...p, end_hour: e.target.value }))}>{hourOpts.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}</select></div>
          <button className="btn btn-primary" onClick={addTruck} disabled={adding}>{adding ? "Adding…" : "+ Add truck"}</button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 20 }}>Changes apply to the Day Board immediately for everyone. Turning a truck off hides it from new bookings and the board; existing orders are never affected. Colors are preset (T1–T6).</div>

      {owner && (
        <div className="card" style={{ marginBottom: 16, borderColor: testOn ? "#7C3AED" : "var(--border)" }}>
          <div className="card-header"><h3>🧪 Testing mode {testOn ? "· ON" : ""}</h3></div>
          <div style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              While ON, every order shows a purple <strong>⏩ Force complete (test)</strong> button that pushes it through collection, verification, and completion in one tap — so you can fill a realistic test schedule without signing into the truck and distributor.
            </div>
            <button className={`btn btn-sm ${testOn ? "btn-primary" : "btn-ghost"}`}
              onClick={() => { const v = !testOn; setTestMode(v); setTestOn(v); }}>
              {testOn ? "Turn testing mode OFF" : "Turn testing mode ON"}
            </button>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
              This setting lives only on this device. <strong>Turn it OFF before going live</strong> so the team never sees the shortcut.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Costs to fill (purchaser / owner) ────────────────────────────────────────
// Focused worklist of orders whose collectable items are missing a cost.
// Purchaser fills cost per item; saves straight onto the order for accurate margins.
function CostsView({ jobs, onUpdate }) {
  const [savingId, setSavingId] = useState("");
  const [drafts, setDrafts] = useState({}); // {jobId: {itemId: cost}}
  const [supDrafts, setSupDrafts] = useState({}); // {jobId: {itemId: supplier}}
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState("");

  const custOwned = (it) => /customer/i.test(String(it.supplier || "")); // customer-supplied → nothing to cost
  const costable = (it) => !custOwned(it) && !isLaborLine(it) && ((it.kind === "tire" && it.tire_id) || it.kind === "part");
  const needsCost = (it) => costable(it) && !(Number(it.cost) > 0);
  const ql = q.trim().toLowerCase();
  const rows = jobs
    .filter(j => j.status !== "cancelled")
    .filter(j => (j.items || []).some(needsCost) || (showAll && (j.items || []).some(costable))) // labor-only orders never appear
    .filter(j => !ql || `${j.customer_name || ""} ${j.customer_mobile || ""} ${j.invoice_no || ""}`.toLowerCase().includes(ql))
    .sort((a, b) => new Date(b.scheduled_at || b.created_at) - new Date(a.scheduled_at || a.created_at));

  const openCount = jobs.filter(j => j.status !== "cancelled" && (j.items || []).some(needsCost)).length;

  const setDraft = (jobId, itemId, val) => setDrafts(d => ({ ...d, [jobId]: { ...(d[jobId] || {}), [itemId]: val } }));

  const setSupDraft = (jobId, itemId, val) => setSupDrafts(d => ({ ...d, [jobId]: { ...(d[jobId] || {}), [itemId]: val } }));
  const saveJob = async (job) => {
    const d = drafts[job.id] || {};
    const sd = supDrafts[job.id] || {};
    const items = (job.items || []).map(it => {
      let out = it;
      const v = d[it.id];
      if (v !== undefined && v !== "") out = { ...out, cost: Number(v) || 0 };
      const s = sd[it.id];
      if (s !== undefined) out = { ...out, supplier: s };
      return out;
    });
    setSavingId(job.id);
    await onUpdate(job.id, { items });
    setDrafts(prev => { const c = { ...prev }; delete c[job.id]; return c; });
    setSupDrafts(prev => { const c = { ...prev }; delete c[job.id]; return c; });
    setSavingId("");
  };

  const th = { textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", padding: "6px 8px", borderBottom: "1px solid var(--border)" };
  const td = { padding: "6px 8px", fontSize: 13, borderBottom: "1px solid var(--border)" };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Costs to fill</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
            {openCount === 0 ? "✓ All items have costs — margins are complete." : `${openCount} order${openCount !== 1 ? "s" : ""} with items missing a cost.`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="filter-input" style={{ width: 200 }} placeholder="🔍 Search name, mobile, invoice" value={q} onChange={e => setQ(e.target.value)} />
          <button className={`btn btn-sm ${showAll ? "btn-primary" : "btn-ghost"}`} onClick={() => setShowAll(s => !s)}>{showAll ? "Showing all orders" : "Show only missing"}</button>
        </div>
      </div>

      <datalist id="cost-suppliers">
        {OTHER_SUPPLIERS.map(s => <option key={s} value={s} />)}
      </datalist>

      {rows.length === 0 && <div className="empty"><h3>Nothing to fill</h3><p>Every item across your orders has a cost entered. Margins in Reports are accurate.</p></div>}

      {rows.map(job => {
        const items = (job.items || []).filter(costable);
        const missing = items.filter(needsCost).length;
        const dirty = (drafts[job.id] && Object.values(drafts[job.id]).some(v => v !== "" && v !== undefined))
          || (supDrafts[job.id] && Object.keys(supDrafts[job.id]).length > 0);
        return (
          <div key={job.id} className="card" style={{ marginBottom: 14, borderLeft: missing ? "3px solid #B45309" : "3px solid var(--success)" }}>
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <h3 style={{ margin: 0 }}>{job.customer_name} <span style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>· {job.customer_mobile} · {fmtDate(job.scheduled_at)} · {job.assigned_truck || "—"}{job.invoice_no ? ` · ${job.invoice_no}` : ""}</span>
                {(job.car_brand || job.car_model) && <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 3 }}>🚗 {job.car_brand} {job.car_model} {job.car_year || ""}</div>}</h3>
              {missing > 0 ? <span style={{ fontSize: 11, fontWeight: 700, color: "#B45309" }}>{missing} missing</span> : <span style={{ fontSize: 11, fontWeight: 700, color: "var(--success)" }}>✓ complete</span>}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>Item</th><th style={th}>Supplier</th><th style={th}>Qty</th><th style={th}>Price</th><th style={th}>Cost (each)</th></tr></thead>
                <tbody>
                  {items.map(it => {
                    const name = it.kind === "tire" ? `${it.brand} ${it.pattern || ""}`.trim() + (it.size ? ` · ${it.size}` : "") : it.name;
                    const draftVal = (drafts[job.id] || {})[it.id];
                    const has = Number(it.cost) > 0;
                    return (
                      <tr key={it.id} style={{ background: !has && draftVal === undefined ? "#FFFBEB" : "transparent" }}>
                        <td style={{ ...td, fontWeight: 600 }}>{name}{it.sku ? <span style={{ fontSize: 10.5, color: "var(--muted)" }}> · {it.sku}</span> : ""}{it.car_label ? <div style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 500 }}>🚗 {it.car_label}</div> : ""}</td>
                        <td style={td}>
                          <input className="filter-input" style={{ width: 130 }} placeholder="supplier"
                            value={(supDrafts[job.id] || {})[it.id] !== undefined ? (supDrafts[job.id])[it.id] : (it.supplier || "")}
                            onChange={e => setSupDraft(job.id, it.id, e.target.value)}
                            list="cost-suppliers" />
                        </td>
                        <td style={td}>{it.qty}</td>
                        <td style={{ ...td, color: "var(--muted)" }}>{Number(it.unit_price) ? `${Number(it.unit_price).toFixed(3)}` : "—"}</td>
                        <td style={td}>
                          <input className="filter-input" style={{ width: 90 }} type="number" step="0.001" min="0"
                            placeholder={has ? Number(it.cost).toFixed(3) : "0.000"}
                            value={draftVal !== undefined ? draftVal : (has ? Number(it.cost) : "")}
                            onChange={e => setDraft(job.id, it.id, e.target.value)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "10px 12px", display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary btn-sm" disabled={!dirty || savingId === job.id} onClick={() => saveJob(job)}>{savingId === job.id ? "Saving…" : "Save costs"}</button>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ─── Reports (sales) ──────────────────────────────────────────────────────────
// Auto-generated replacement for the manual daily/monthly Excel reports.
// Everything computes live from jobs + quotes + customers. Trengo call counts
// are not in the system yet, so inquiry-based metrics stay in Trengo for now.
const MONTHLY_TARGET = 45000; // KWD — edit here when the target changes

function ReportsView({ jobs, quotes, customers, owner }) {
  const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
  // LOCAL date string — never toISOString here: UTC conversion shifts
  // Kuwait's midnight back to the previous day and skews every preset.
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [from, setFrom] = useState(iso(todayD));
  const [to, setTo] = useState(iso(todayD));

  const preset = (key) => {
    const d = new Date(todayD);
    if (key === "today") { setFrom(iso(d)); setTo(iso(d)); }
    if (key === "week") { const s = new Date(d); s.setDate(d.getDate() - d.getDay()); setFrom(iso(s)); setTo(iso(d)); } // week starts Sunday
    if (key === "month") { setFrom(iso(new Date(d.getFullYear(), d.getMonth(), 1))); setTo(iso(d)); }
    if (key === "lastmonth") {
      setFrom(iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)));
      setTo(iso(new Date(d.getFullYear(), d.getMonth(), 0)));
    }
  };

  const fmtKD = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  // Revenue attribution: SALE DATE (day the order was placed) — shared helper.
  const jobDate = saleDateOf;
  const inRange = jobs.filter(j => j.status !== "cancelled" && jobDate(j) >= from && jobDate(j) <= to);

  // ── headline KPIs ──
  const totalSales = inRange.reduce((s, j) => s + (Number(j.total) || 0), 0);
  const orders = inRange.length;
  const ticket = orders ? totalSales / orders : 0;

  // ── cost: single source of truth = job.items (what the purchaser fills in Costs tab) ──
  const itemCostOf = (it) => (Number(it.cost) || 0) * (Number(it.qty) || 1);
  const jobItemsCost = (j) => (j.items || []).reduce((s, it) => s + itemCostOf(it), 0);
  const custOwnedIt = (it) => /customer/i.test(String(it.supplier || ""));
  const costableIt = (it) => !custOwnedIt(it) && !isLaborLine(it) && ((it.kind === "tire" && it.tire_id) || it.kind === "part");
  // collections: sold & delivered but money not in (either paid signal counts)
  const uncollectedJobs = inRange.filter(j => jobSuccessful(j) && j.payment_status !== "paid" && j.status !== "paid");
  const uncollectedKD = uncollectedJobs.reduce((s, j) => s + (Number(j.total) || 0), 0);
  // margin watchdog: purchasable items sold with no cost entered (matches the Costs tab)
  let zeroCostItems = 0;
  inRange.forEach(j => (j.items || []).forEach(it => {
    if (costableIt(it) && !(Number(it.cost) > 0)) zeroCostItems++;
  }));

  // new vs loyal: customer existed before the period start = loyal
  let newC = 0, loyalC = 0;
  const seen = new Set();
  inRange.forEach(j => {
    const key = j.customer_id || last8(j.customer_mobile);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const c = customers.find(x => x.id === j.customer_id) ||
              customers.find(x => last8(x.mobile) === last8(j.customer_mobile));
    if (c && c.created_at && c.created_at.split("T")[0] < from) loyalC++; else newC++;
  });

  // quotes in range + conversion
  const qInRange = quotes.filter(q => { const d = q.created_at ? iso(new Date(q.created_at)) : ""; return d >= from && d <= to; });
  const qSuccess = qInRange.filter(q => quoteStatus(q, jobs).status === "success").length;
  const qConv = qInRange.length ? Math.round((qSuccess / qInRange.length) * 100) : 0;           // per quote
  const cConv = customerConv(qInRange, q => quoteStatus(q, jobs).status === "success");         // per customer (default)

  // ── month target (always current month, independent of selected range) ──
  const mStart = iso(new Date(todayD.getFullYear(), todayD.getMonth(), 1));
  const monthSales = jobs.filter(j => j.status !== "cancelled" && jobDate(j) >= mStart && jobDate(j) <= iso(todayD))
    .reduce((s, j) => s + (Number(j.total) || 0), 0);
  const tPct = Math.min(100, Math.round((monthSales / MONTHLY_TARGET) * 100));

  // ── per-agent ──
  const agentNames = [...new Set([...SALES_AGENTS, ...inRange.map(j => j.sales_agent).filter(Boolean), ...qInRange.map(q => q.agent).filter(Boolean)])];
  const perAgent = agentNames.map(a => {
    const aj = inRange.filter(j => j.sales_agent === a);
    const aq = qInRange.filter(q => q.agent === a);
    const aqs = aq.filter(q => quoteStatus(q, jobs).status === "success").length;
    const ac = customerConv(aq, q => quoteStatus(q, jobs).status === "success");
    return { agent: a, orders: aj.length, sales: aj.reduce((s, j) => s + (Number(j.total) || 0), 0),
             quotes: aq.length, quotedCust: ac.customers,
             conv: aq.length ? Math.round((aqs / aq.length) * 100) : null,
             convC: aq.length ? ac.pct : null };
  }).filter(p => p.orders || p.quotes).sort((x, y) => y.sales - x.sales);

  // ── services breakdown (count · % of orders · KD · % of sales) ──
  // Revenue comes from service blocks (or job total for imported orders without blocks).
  // Cost comes from ITEMS — the only place the purchaser fills it — attributed to the
  // item's service_type (falls back to the job's headline service).
  const svcStats = {};
  let svcCount = 0;
  const bump = (t) => (svcStats[t] = svcStats[t] || { n: 0, kd: 0, cost: 0 });
  inRange.forEach(j => {
    const blocks = (j.services && j.services.length) ? j.services : [{ service_type: j.service_type || "Other", _fallbackTotal: Number(j.total) || 0 }];
    blocks.forEach(s => {
      const t = s.service_type || "Other";
      const rev = s._fallbackTotal != null ? s._fallbackTotal : serviceTotals(s).total;
      bump(t); svcStats[t].n++; svcStats[t].kd += rev; svcCount++;
    });
    (j.items || []).forEach(it => {
      const c = itemCostOf(it);
      if (!c) return;
      const t = it.service_type || j.service_type || "Other";
      bump(t); svcStats[t].cost += c;
    });
  });
  const svcRows = Object.entries(svcStats).map(([t, v]) => ({ type: t, ...v })).sort((a, b) => b.kd - a.kd);
  const tireKD = svcRows.filter(r => /tire|patch|rotation|wheel/i.test(r.type)).reduce((s, r) => s + r.kd, 0);

  // ── daily bars ──
  const days = [];
  for (let d = new Date(from + "T00:00:00"); iso(d) <= to; d.setDate(d.getDate() + 1)) days.push(iso(d));
  const byDay = days.map(d => ({ d, kd: inRange.filter(j => jobDate(j) === d).reduce((s, j) => s + (Number(j.total) || 0), 0) }));
  const maxDay = Math.max(...byDay.map(x => x.kd), 1);
  const minPos = Math.min(...byDay.filter(x => x.kd > 0).map(x => x.kd), Infinity);

  const th = { textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", padding: "8px 10px", borderBottom: "1px solid var(--border)" };
  const td = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid var(--border)" };

  return (
    <>
      <div className="page-header">
        <div className="page-title">Reports</div>
        <div className="filters">
          <button className="btn btn-ghost btn-sm" onClick={() => preset("today")}>Today</button>
          <button className="btn btn-ghost btn-sm" onClick={() => preset("week")}>This Week</button>
          <button className="btn btn-ghost btn-sm" onClick={() => preset("month")}>This Month</button>
          <button className="btn btn-ghost btn-sm" onClick={() => preset("lastmonth")}>Last Month</button>
          <input type="date" className="filter-input" value={from} onChange={e => setFrom(e.target.value)} />
          <input type="date" className="filter-input" value={to} onChange={e => setTo(e.target.value)} />
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--accent)" }}>KWD {fmtKD(totalSales)}</div><div className="stat-lbl">Total sales</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--text)" }}>{orders}</div><div className="stat-lbl">Orders</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "#1D4ED8" }}>KWD {fmtKD(ticket)}</div><div className="stat-lbl">Avg ticket</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--success)" }}>{cConv.pct}%</div><div className="stat-lbl">Conversion — {cConv.won}/{cConv.customers} customers · per quote {qConv}% ({qSuccess}/{qInRange.length} sent)</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--text)" }}>{loyalC} / {newC}</div><div className="stat-lbl">Loyal / new customers</div></div>
        {owner && (() => {
          const totalCost = svcRows.reduce((s, r) => s + r.cost, 0);
          const profit = totalSales - totalCost;
          const marginPct = totalSales ? Math.round((profit / totalSales) * 100) : 0;
          return (
            <div className="stat-card">
              <div className="stat-num" style={{ color: "#15803D" }}>KWD {fmtKD(profit)}</div>
              <div className="stat-lbl">Gross profit · {marginPct}% margin{zeroCostItems > 0 ? ` · ⚠ ${zeroCostItems} no-cost item${zeroCostItems > 1 ? "s" : ""}` : ""}</div>
            </div>
          );
        })()}
        <div className="stat-card">
          <div className="stat-num" style={{ color: uncollectedKD > 0 ? "#DC2626" : "var(--success)" }}>KWD {fmtKD(uncollectedKD)}</div>
          <div className="stat-lbl">Uncollected ({uncollectedJobs.length} successful unpaid)</div>
        </div>
      </div>

      {/* Month target */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontWeight: 700, fontFamily: "var(--font-head)" }}>Month target · KWD {fmtKD(MONTHLY_TARGET)}</span>
            <span>Now <strong style={{ color: "var(--accent)" }}>KWD {fmtKD(monthSales)}</strong> · Remaining <strong>KWD {fmtKD(Math.max(0, MONTHLY_TARGET - monthSales))}</strong> · <strong>{tPct}%</strong></span>
          </div>
          <div style={{ height: 12, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ width: `${tPct}%`, height: "100%", background: tPct >= 100 ? "var(--success)" : "var(--accent)", transition: "width .3s" }} />
          </div>
        </div>
      </div>

      {/* Daily sales bars */}
      {days.length > 1 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ padding: "14px 16px" }}>
            <div style={{ fontWeight: 700, fontFamily: "var(--font-head)", fontSize: 13, marginBottom: 10 }}>Daily sales</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120, overflowX: "auto", paddingBottom: 4 }}>
              {byDay.map(x => (
                <div key={x.d} title={`${x.d} · KWD ${fmtKD(x.kd)}`} style={{ flex: "1 0 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 14 }}>
                  <span style={{ fontSize: 8.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{x.kd > 0 ? fmtKD(x.kd) : ""}</span>
                  <div style={{ width: "100%", borderRadius: "3px 3px 0 0", height: `${Math.max(2, (x.kd / maxDay) * 90)}px`,
                    background: x.kd === maxDay && x.kd > 0 ? "var(--success)" : (x.kd === minPos && x.kd > 0 ? "#DC2626" : "#1A1A1A") }} />
                  <span style={{ fontSize: 8.5, color: "var(--muted)" }}>{x.d.slice(8)}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Green = best day · Red = lowest (non-zero) day</div>
          </div>
        </div>
      )}

      {/* Per-agent */}
      <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
        <div className="card-header"><h3>Per agent</h3></div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Agent</th><th style={th}>Orders</th><th style={th}>Sales (KD)</th><th style={th}>Quoted — cust (quotes)</th><th style={th}>Conv (customers)</th><th style={th}>Conv (quotes)</th></tr></thead>
          <tbody>
            {perAgent.map(p => (
              <tr key={p.agent}>
                <td style={{ ...td, fontWeight: 600 }}>{p.agent}</td>
                <td style={td}>{p.orders}</td>
                <td style={{ ...td, fontWeight: 700, color: "var(--accent)" }}>{fmtKD(p.sales)}</td>
                <td style={td}>{p.quotedCust}{p.quotes ? ` (${p.quotes})` : ""}</td>
                <td style={{ ...td, fontWeight: 700 }}>{p.convC == null ? "—" : p.convC + "%"}</td>
                <td style={td}>{p.conv == null ? "—" : p.conv + "%"}</td>
              </tr>
            ))}
            {perAgent.length === 0 && <tr><td style={td} colSpan={6}>No activity in this range.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Services breakdown */}
      <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
        <div className="card-header">
          <h3>Services</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Tires {totalSales ? Math.round((tireKD / totalSales) * 100) : 0}% · Other {totalSales ? Math.round(((totalSales - tireKD) / totalSales) * 100) : 0}%</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Service</th><th style={th}>Number</th><th style={th}>KD</th><th style={th}>% of sales</th>{owner && <><th style={th}>Cost</th><th style={th}>Profit</th><th style={th}>Margin</th></>}</tr></thead>
          <tbody>
            {svcRows.map(r => (
              <tr key={r.type}>
                <td style={{ ...td, fontWeight: 600 }}>{r.type}</td>
                <td style={td}>{r.n}</td>
                <td style={{ ...td, fontWeight: 700, color: "var(--accent)" }}>{fmtKD(r.kd)}</td>
                <td style={td}>{totalSales ? Math.round((r.kd / totalSales) * 100) : 0}%</td>
                {owner && <>
                  <td style={td}>{fmtKD(r.cost)}</td>
                  <td style={{ ...td, fontWeight: 700, color: "#15803D" }}>{fmtKD(r.kd - r.cost)}</td>
                  <td style={td}>{r.kd ? Math.round(((r.kd - r.cost) / r.kd) * 100) : 0}%</td>
                </>}
              </tr>
            ))}
            {svcRows.length === 0 && <tr><td style={td} colSpan={owner ? 7 : 4}>No orders in this range.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* ═══ OWNER MARGIN REPORTS ═══ */}
      {owner && (() => {
        const itemRevOf = (it) => (Number(it.unit_price) || 0) * (Number(it.qty) || 1);

        // 1 · PER SERVICE TYPE — margin (already have svcRows with kd+cost)
        const svcMargin = svcRows.map(r => ({ ...r, profit: r.kd - r.cost, margin: r.kd ? Math.round(((r.kd - r.cost) / r.kd) * 100) : 0 }))
          .sort((a, b) => b.profit - a.profit);

        // 2 · PER ORDER — full margin per job
        const orderRows = inRange.map(j => {
          const items = j.items || [];
          const cost = jobItemsCost(j);
          const rev = Number(j.total) || 0;
          // labor-only orders have nothing to cost — never flag them as "missing costs"
          const costableItems = items.filter(costableIt);
          return { id: j.id, name: j.customer_name, date: j.scheduled_at, svc: j.service_type, rev, cost, profit: rev - cost, margin: rev ? Math.round(((rev - cost) / rev) * 100) : 0, hasCost: costableItems.length === 0 || costableItems.some(it => Number(it.cost) > 0) };
        }).sort((a, b) => b.profit - a.profit);

        // 3 · PER SKU / ITEM — which products earn best (real products only:
        // skip labor lines and customer-supplied items so margins aren't fake 100%)
        const skuMap = {};
        inRange.forEach(j => (j.items || []).forEach(it => {
          if (!costableIt(it)) return;
          const key = it.sku || (it.kind === "tire" ? `${it.brand} ${it.pattern || ""} ${it.size || ""}`.trim() : it.name) || "—";
          skuMap[key] = skuMap[key] || { key, name: it.kind === "tire" ? `${it.brand} ${it.pattern || ""}`.trim() : it.name, units: 0, rev: 0, cost: 0 };
          skuMap[key].units += Number(it.qty) || 0;
          skuMap[key].rev += itemRevOf(it);
          skuMap[key].cost += itemCostOf(it);
        }));
        const skuRows = Object.values(skuMap).map(r => ({ ...r, profit: r.rev - r.cost, margin: r.rev ? Math.round(((r.rev - r.cost) / r.rev) * 100) : 0 })).sort((a, b) => b.profit - a.profit);

        const bar = (pct) => (
          <div style={{ display: "inline-block", width: 42, height: 6, borderRadius: 3, background: "var(--border)", verticalAlign: "middle", marginRight: 6 }}>
            <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", borderRadius: 3, background: pct >= 40 ? "#15803D" : pct >= 20 ? "#D97706" : "#DC2626" }} />
          </div>
        );

        return (
          <>
            {/* 1 · Profit by service type */}
            <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
              <div className="card-header"><h3>💰 Profit by service type</h3></div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>Service</th><th style={th}>Orders</th><th style={th}>Revenue</th><th style={th}>Cost</th><th style={th}>Profit</th><th style={th}>Margin</th></tr></thead>
                <tbody>
                  {svcMargin.map(r => (
                    <tr key={r.type}>
                      <td style={{ ...td, fontWeight: 600 }}>{r.type}</td>
                      <td style={td}>{r.n}</td>
                      <td style={td}>{fmtKD(r.kd)}</td>
                      <td style={td}>{fmtKD(r.cost)}</td>
                      <td style={{ ...td, fontWeight: 700, color: "#15803D" }}>{fmtKD(r.profit)}</td>
                      <td style={td}>{bar(r.margin)}{r.margin}%</td>
                    </tr>
                  ))}
                  {svcMargin.length === 0 && <tr><td style={td} colSpan={6}>No orders in this range.</td></tr>}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: "var(--muted)", padding: "8px 12px" }}>Profit = revenue − product cost. Labor-only services show near-100% margin (no product cost).</div>
            </div>

            {/* 2 · Margin per order */}
            <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
              <div className="card-header"><h3>📋 Margin per order — top & bottom</h3></div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>Customer</th><th style={th}>Service</th><th style={th}>Revenue</th><th style={th}>Cost</th><th style={th}>Profit</th><th style={th}>Margin</th></tr></thead>
                <tbody>
                  {(orderRows.length <= 16
                    ? orderRows
                    : [...orderRows.slice(0, 8), { divider: true }, ...orderRows.slice(-8)]).map((r, i) => r.divider
                    ? <tr key="d"><td style={{ ...td, textAlign: "center", color: "var(--muted)", fontSize: 11 }} colSpan={6}>⋯ middle orders hidden ⋯</td></tr>
                    : (
                      <tr key={r.id}>
                        <td style={{ ...td, fontWeight: 600 }}>{r.name}{!r.hasCost && <span title="no costs entered" style={{ color: "#B45309" }}> ⚠</span>}</td>
                        <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>{shortService ? shortService(r.svc) : r.svc}</td>
                        <td style={td}>{fmtKD(r.rev)}</td>
                        <td style={td}>{fmtKD(r.cost)}</td>
                        <td style={{ ...td, fontWeight: 700, color: r.profit >= 0 ? "#15803D" : "#DC2626" }}>{fmtKD(r.profit)}</td>
                        <td style={td}>{bar(r.margin)}{r.margin}%</td>
                      </tr>
                    ))}
                  {orderRows.length === 0 && <tr><td style={td} colSpan={6}>No orders in this range.</td></tr>}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: "var(--muted)", padding: "8px 12px" }}>⚠ = order still missing item costs (fill in the Purchaser's Costs tab for accurate margin).</div>
            </div>

            {/* 3 · Profit by SKU / item */}
            <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
              <div className="card-header"><h3>🏷️ Profit by product (SKU)</h3></div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>Product</th><th style={th}>Units</th><th style={th}>Revenue</th><th style={th}>Cost</th><th style={th}>Profit</th><th style={th}>Margin</th></tr></thead>
                <tbody>
                  {skuRows.slice(0, 30).map(r => (
                    <tr key={r.key}>
                      <td style={{ ...td, fontWeight: 600 }}>{r.name}{r.key !== r.name && <span style={{ fontSize: 10.5, color: "var(--muted)" }}> · {r.key}</span>}</td>
                      <td style={td}>{r.units}</td>
                      <td style={td}>{fmtKD(r.rev)}</td>
                      <td style={td}>{fmtKD(r.cost)}</td>
                      <td style={{ ...td, fontWeight: 700, color: "#15803D" }}>{fmtKD(r.profit)}</td>
                      <td style={td}>{bar(r.margin)}{r.margin}%</td>
                    </tr>
                  ))}
                  {skuRows.length === 0 && <tr><td style={td} colSpan={6}>No product items in this range.</td></tr>}
                </tbody>
              </table>
              {skuRows.length > 30 && <div style={{ fontSize: 11, color: "var(--muted)", padding: "8px 12px" }}>Showing top 30 products by profit.</div>}
            </div>
          </>
        );
      })()}

      {/* Lead sources — marketing ROI */}
      {(() => {
        const leads = {};
        inRange.forEach(j => {
          const k = j.lead_from || "—";
          leads[k] = leads[k] || { n: 0, kd: 0 };
          leads[k].n++; leads[k].kd += Number(j.total) || 0;
        });
        const rows = Object.entries(leads).map(([k, v]) => ({ src: k, ...v })).sort((a, b) => b.kd - a.kd);
        if (!rows.length) return null;
        return (
          <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
            <div className="card-header"><h3>Lead sources</h3></div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>Source</th><th style={th}>Orders</th><th style={th}>Sales (KD)</th><th style={th}>% of sales</th><th style={th}>Avg ticket</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.src}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.src}</td>
                    <td style={td}>{r.n}</td>
                    <td style={{ ...td, fontWeight: 700, color: "var(--accent)" }}>{fmtKD(r.kd)}</td>
                    <td style={td}>{totalSales ? Math.round((r.kd / totalSales) * 100) : 0}%</td>
                    <td style={td}>{fmtKD(r.n ? r.kd / r.n : 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {!owner && zeroCostItems > 0 && (
        <div style={{ fontSize: 12, color: "#B45309", marginBottom: 8 }}>
          ⚠ {zeroCostItems} item{zeroCostItems > 1 ? "s" : ""} in this range missing a cost — please fill the cost when adding parts.
        </div>
      )}
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 20 }}>
        {owner ? "Profit = revenue minus product cost (labor counts as contribution). " : ""}Call counts and total inquiries live in Trengo and are not included here. Conversion above is quote-based.
      </div>
    </>
  );
}

// ─── Quotes Dashboard (sales) ─────────────────────────────────────────────────
// Full quote lifecycle: open → success (order created) or lost (with reason).
// Stamped status is the source of truth; legacy quotes fall back to the
// derived order match. Follow-up ladder: 24h → 3d → 7d, snooze overrides.
function QuotesView({ quotes, jobs, customers, onBook, onSelectJob, onQuoteUpdate }) {
  const [statusF, setStatusF] = useState("all"); // all | success | open | followup | lost
  const [agentF, setAgentF] = useState("all");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState(null); // { id, type: "lost" | "snooze" }
  const [lostReason, setLostReason] = useState(LOST_REASONS[0]);
  const [snoozeDate, setSnoozeDate] = useState("");

  // Date range (matches Reports presets). Default = ALL TIME so open
  // follow-ups from previous days never vanish from the working list.
  const [qFrom, setQFrom] = useState("");
  const [qTo, setQTo] = useState("");
  const qIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const qPreset = (key) => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (key === "all") { setQFrom(""); setQTo(""); return; }
    if (key === "today") { setQFrom(qIso(d)); setQTo(qIso(d)); }
    if (key === "week") { const s0 = new Date(d); s0.setDate(d.getDate() - d.getDay()); setQFrom(qIso(s0)); setQTo(qIso(d)); }
    if (key === "month") { setQFrom(qIso(new Date(d.getFullYear(), d.getMonth(), 1))); setQTo(qIso(d)); }
    if (key === "lastmonth") { setQFrom(qIso(new Date(d.getFullYear(), d.getMonth() - 1, 1))); setQTo(qIso(new Date(d.getFullYear(), d.getMonth(), 0))); }
  };

  const enriched = quotes.filter(q => {
    if (!qFrom && !qTo) return true;
    const d = q.created_at ? qIso(new Date(q.created_at)) : "";
    if (qFrom && d < qFrom) return false;
    if (qTo && d > qTo) return false;
    return true;
  }).map(q => {
    const st = quoteStatus(q, jobs);
    const fu = followupState(q, st.status);
    const cust = customers.find(c => last8(c.mobile) && last8(c.mobile) === last8(q.customer_mobile));
    return { ...q, _st: st.status, _job: st.job, _fu: fu, _cust: cust, _value: quoteValue(q) };
  });

  const agents = [...new Set(enriched.map(q => q.agent || "—"))].sort();
  const total = enriched.length;
  const successCount = enriched.filter(q => q._st === "success").length;
  const lostCount = enriched.filter(q => q._st === "lost").length;
  const openList = enriched.filter(q => q._st === "open");
  const conv = total ? Math.round((successCount / total) * 100) : 0;                 // per quote
  const convCust = customerConv(enriched, q => q._st === "success");                 // per customer (default)
  const pipeline = openList.reduce((s, q) => s + q._value, 0);
  const followupCount = openList.filter(q => q._fu.due).length;

  const perAgent = agents.map(a => {
    const list = enriched.filter(q => (q.agent || "—") === a);
    const b = list.filter(q => q._st === "success").length;
    return { agent: a, total: list.length, success: b, conv: list.length ? Math.round((b / list.length) * 100) : 0 };
  }).sort((x, y) => y.total - x.total);

  // "why we lose" breakdown (shown on the Lost filter)
  const lostByReason = {};
  enriched.filter(q => q._st === "lost").forEach(q => {
    const r = q.lost_reason || "—";
    lostByReason[r] = (lostByReason[r] || 0) + 1;
  });

  const filtered = enriched.filter(q => {
    if (statusF === "success" && q._st !== "success") return false;
    if (statusF === "open" && q._st !== "open") return false;
    if (statusF === "lost" && q._st !== "lost") return false;
    if (statusF === "followup" && !(q._st === "open" && q._fu.due)) return false;
    if (agentF !== "all" && (q.agent || "—") !== agentF) return false;
    if (search) {
      const s = search.toLowerCase();
      const hay = `${q.customer_mobile || ""} ${q.customer_name || ""} ${q._cust?.name || ""} ${q.lost_reason || ""} ${(q.lines || []).map(l => `${l.brand || ""} ${l.pattern || ""} ${l.size || ""}`).join(" ")}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }).sort((a, b) => statusF === "followup"
    ? new Date(a.created_at) - new Date(b.created_at)   // oldest first — coldest lead gets called first
    : new Date(b.created_at) - new Date(a.created_at));

  const QUICK = [
    { key: "all", label: `All (${total})` },
    { key: "success", label: `✓ Success (${successCount})` },
    { key: "open", label: `Open (${openList.length})` },
    { key: "followup", label: `⏰ Follow up (${followupCount})` },
    { key: "lost", label: `✕ Lost (${lostCount})` },
  ];

  const markContacted = (q) => {
    onQuoteUpdate(q.id, { last_contact_at: new Date().toISOString(), followup_count: (Number(q.followup_count) || 0) + 1, followup_at: null });
    setAction(null);
  };
  const confirmLost = (q) => {
    onQuoteUpdate(q.id, { status: "lost", lost_reason: lostReason, lost_at: new Date().toISOString() });
    setAction(null);
  };
  const confirmSnooze = (q) => {
    if (!snoozeDate) return;
    onQuoteUpdate(q.id, { followup_at: new Date(`${snoozeDate}T09:00:00`).toISOString() });
    setAction(null); setSnoozeDate("");
  };
  const reopen = (q) => onQuoteUpdate(q.id, { status: "open", lost_reason: null, lost_at: null, followup_at: null });

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--text)" }}>{convCust.customers}</div><div className="stat-lbl">Customers quoted · {total} quote{total !== 1 ? "s" : ""} sent</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--success)" }}>{successCount}</div><div className="stat-lbl">Success</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--accent)" }}>{convCust.pct}%</div><div className="stat-lbl">Conversion — customers ({convCust.won}/{convCust.customers}) · per quote {conv}%</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "#1D4ED8" }}>KWD {pipeline.toFixed(0)}</div><div className="stat-lbl">Open pipeline (est.)</div></div>
      </div>

      <div className="page-header">
        <div className="page-title">Quotes</div>
        <div className="filters">
          {[["all", "All"], ["today", "Today"], ["week", "This Week"], ["month", "This Month"], ["lastmonth", "Last Month"]].map(([k, l]) => (
            <button key={k} className={`btn btn-sm ${(k === "all" && !qFrom && !qTo) ? "btn-primary" : "btn-ghost"}`} onClick={() => qPreset(k)}>{l}</button>
          ))}
          <input type="date" className="filter-input" value={qFrom} onChange={e => setQFrom(e.target.value)} />
          <input type="date" className="filter-input" value={qTo} onChange={e => setQTo(e.target.value)} />
        </div>
        <div className="filters">
          <input className="filter-input" placeholder="Search mobile, name, tire…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 200 }} />
        </div>
      </div>

      {/* Per-agent performance — tap to filter */}
      {perAgent.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button className={`btn btn-sm ${agentF === "all" ? "btn-primary" : "btn-ghost"}`} onClick={() => setAgentF("all")}>All agents</button>
          {perAgent.map(p => (
            <button key={p.agent} className={`btn btn-sm ${agentF === p.agent ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setAgentF(agentF === p.agent ? "all" : p.agent)}>
              {p.agent} · {p.success}/{p.total} · {p.conv}%
            </button>
          ))}
        </div>
      )}

      {/* Status filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {QUICK.map(qk => (
          <button key={qk.key} className={`btn btn-sm ${statusF === qk.key ? "btn-primary" : "btn-ghost"}`} onClick={() => setStatusF(qk.key)}>{qk.label}</button>
        ))}
      </div>

      {/* Why we lose — reason breakdown, visible on the Lost filter */}
      {statusF === "lost" && lostCount > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14, padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#991B1B" }}>Why we lose:</span>
          {Object.entries(lostByReason).sort((a, b) => b[1] - a[1]).map(([r, n]) => (
            <span key={r} style={{ fontSize: 12, fontWeight: 600, color: "#991B1B", background: "#fff", border: "1px solid #FECACA", borderRadius: 6, padding: "2px 8px" }}>{r}: {n}</span>
          ))}
        </div>
      )}

      {filtered.length === 0 && <div className="empty"><h3>No quotes here</h3><p>Quotes sent from the Tire System appear automatically.</p></div>}

      {filtered.map(q => {
        const isSuccess = q._st === "success";
        const isLost = q._st === "lost";
        const due = q._st === "open" && q._fu.due;
        const custName = q._cust?.name || q.customer_name || "";
        // Staggered when flagged, OR positions are tagged, OR two lines differ (front≠rear).
        const _ls = q.lines || [];
        const _byPos = { front: _ls.find(l => l.position === "front"), rear: _ls.find(l => l.position === "rear") };
        const _twoDiffer = _ls.length === 2 && (
          `${_ls[0].brand}${_ls[0].pattern}${_ls[0].size}` !== `${_ls[1].brand}${_ls[1].pattern}${_ls[1].size}`
        );
        const isStag = q.staggered || (_byPos.front && _byPos.rear) || _twoDiffer;
        const front = isStag ? (_byPos.front || _ls[0]) : null;
        const rear = isStag ? (_byPos.rear || _ls[1]) : null;
        const borderCol = isSuccess ? "var(--success)" : isLost ? "#DC2626" : due ? "#F59E0B" : "var(--border)";
        return (
          <div key={q.id} className="dist-card" style={{ borderLeft: `3px solid ${borderCol}`, opacity: isLost ? .8 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, fontFamily: "var(--font-head)" }}>
                  {custName || "Unknown customer"} · <a href={`tel:${q.customer_mobile}`} style={{ color: "var(--accent)", fontWeight: 600 }}>{q.customer_mobile}</a>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                  {fmtDate(q.created_at)} {fmtTime(q.created_at)} · {quoteAge(q.created_at)}{q.agent ? ` · ${q.agent}` : ""}{q.cash_pct ? ` · cash ${q.cash_pct}%` : ""}
                  {Number(q.followup_count) > 0 ? ` · 📞 ×${q.followup_count}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                {isSuccess ? (
                  <span className="status-pill" style={{ background: "#DCFCE7", color: "#15803D", cursor: q._job ? "pointer" : "default" }} onClick={() => q._job && onSelectJob(q._job)}>✓ Success{q._job ? " →" : ""}</span>
                ) : isLost ? (
                  <span className="status-pill" style={{ background: "#FEE2E2", color: "#991B1B" }}>✕ Lost</span>
                ) : q._fu.snoozed ? (
                  <span className="status-pill" style={{ background: "#EFF6FF", color: "#1D4ED8" }}>💤 {fmtDate(q.followup_at)}</span>
                ) : due ? (
                  <span className="status-pill" style={{ background: "#FEF3C7", color: "#92400E" }}>⏰ Follow up</span>
                ) : (
                  <span className="status-pill" style={{ background: "#F1F5F9", color: "#64748B" }}>Open</span>
                )}
                <span style={{ fontWeight: 700, color: "var(--accent)", fontSize: 13 }}>~KWD {q._value.toFixed(0)}</span>
              </div>
            </div>

            {isLost && (
              <div style={{ fontSize: 12, color: "#991B1B", fontWeight: 600, marginBottom: 6 }}>
                ✕ {q.lost_reason || "No reason recorded"}{q.lost_at ? ` · ${fmtDate(q.lost_at)}` : ""}
              </div>
            )}

            {q.kind === "service" && q.service_type === "Battery" && (q.lines || []).length > 1 ? (
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--bg)", fontSize: 12.5 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: "#0369A1", marginBottom: 5 }}>🛠 BATTERY QUOTE — {q.lines.length} OPTIONS{q.car && (q.car.brand || q.car.model) ? ` · 🚗 ${[q.car.brand, q.car.model, q.car.year].filter(Boolean).join(" ")}` : ""}</div>
                {(q.lines || []).map((l, li) => {
                  const optTotal = (Number(l.qty) || 1) * (Number(l.unit_price) || 0) + (Number(q.labor) || 0) - (Number(q.discount) || 0);
                  return (
                    <div key={li} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "4px 0", borderTop: li ? "1px solid var(--border)" : "none" }}>
                      <div><strong>{l.qty}× {l.name}</strong> <span style={{ color: "var(--accent)", fontWeight: 700 }}>= {optTotal.toFixed(3)} KD</span> <span style={{ color: "var(--muted)", fontSize: 11 }}>incl. labor</span></div>
                      {!isSuccess && <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }} onClick={() => onBook(q, l)}>Book</button>}
                    </div>
                  );
                })}
              </div>
            ) : q.kind === "service" ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--bg)", fontSize: 12.5 }}>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: "#0369A1", marginBottom: 3 }}>🛠 {(q.service_type || "SERVICE").toUpperCase()} QUOTE{q.car && (q.car.brand || q.car.model) ? ` · 🚗 ${[q.car.brand, q.car.model, q.car.year].filter(Boolean).join(" ")}` : ""}</div>
                  {Array.isArray(q.services) && q.services.length > 1 ? (
                    q.services.map((b, bi) => (
                      <div key={bi} style={{ marginBottom: 4, paddingTop: bi ? 4 : 0, borderTop: bi ? "1px dashed var(--border)" : "none" }}>
                        <div style={{ fontWeight: 800, fontSize: 11.5 }}>{b.type}{Object.values(b.variant || {}).length ? ` · ${Object.values(b.variant).join(" / ")}` : ""}</div>
                        {(b.lines || []).map((l, li) => (
                          <div key={li}><strong>{l.qty}× {l.name}</strong> <span style={{ color: "var(--accent)", fontWeight: 700 }}>@ {Number(l.unit_price || 0).toFixed(3)} KD</span></div>
                        ))}
                        {Number(b.labor) > 0 && <div style={{ color: "var(--muted)" }}>Labor: {Number(b.labor).toFixed(3)} KD</div>}
                      </div>
                    ))
                  ) : (
                    (q.lines || []).map((l, li) => (
                      <div key={li}><strong>{l.qty}× {l.name}</strong> <span style={{ color: "var(--accent)", fontWeight: 700 }}>@ {Number(l.unit_price || 0).toFixed(3)} KD</span></div>
                    ))
                  )}
                  {!(Array.isArray(q.services) && q.services.length > 1) && Number(q.labor) > 0 && <div style={{ color: "var(--muted)" }}>Labor: {Number(q.labor).toFixed(3)} KD</div>}
                  {Number(q.discount) > 0 && <div style={{ color: "var(--muted)" }}>Discount: -{Number(q.discount).toFixed(3)} KD</div>}
                </div>
                {!isSuccess && <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }} onClick={() => onBook(q, null)}>Book</button>}
              </div>
            ) : isStag ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {staggeredOptions(q).map((opt, oi) => (
                  <div key={oi} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--bg)", fontSize: 12.5 }}>
                    <div>
                      <div><span style={{ color: "var(--muted)", fontWeight: 700 }}>Front</span> <strong>{opt.front?.brand} {opt.front?.pattern}</strong> <span style={{ color: "var(--muted)" }}>· {opt.front?.size}{opt.front?.year ? ` · ${opt.front.year}` : ""}</span> <span style={{ color: "var(--accent)", fontWeight: 700 }}>@ {Number(opt.front?.price || 0).toFixed(0)} KD</span></div>
                      <div style={{ marginTop: 2 }}><span style={{ color: "var(--muted)", fontWeight: 700 }}>Rear</span> <strong>{opt.rear?.brand} {opt.rear?.pattern}</strong> <span style={{ color: "var(--muted)" }}>· {opt.rear?.size}{opt.rear?.year ? ` · ${opt.rear.year}` : ""}</span> <span style={{ color: "var(--accent)", fontWeight: 700 }}>@ {Number(opt.rear?.price || 0).toFixed(0)} KD</span></div>
                    </div>
                    {!isSuccess && <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }} onClick={() => onBook(q, opt)}>Book</button>}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(q.lines || []).map((line, li) => (
                  <div key={li} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--bg)", fontSize: 12.5 }}>
                    <span>
                      <strong>{line.brand} {line.pattern}</strong> <span style={{ color: "var(--muted)" }}>· {line.size}{line.year ? ` · ${line.year}` : ""} · qty {q.qty || 4}</span>
                      <span style={{ color: "var(--accent)", fontWeight: 700 }}> @ {Number(line.price || 0).toFixed(0)} KD</span>
                    </span>
                    {!isSuccess && <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }} onClick={() => onBook(q, line)}>Book</button>}
                  </div>
                ))}
              </div>
            )}

            {/* Follow-up actions (open quotes only) */}
            {q._st === "open" && (
              <div style={{ marginTop: 8 }}>
                {q._fu.suggestLost && (
                  <div style={{ fontSize: 12, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "6px 10px", marginBottom: 6, fontWeight: 600 }}>
                    ⚠ {q.followup_count} follow-ups with no booking — consider marking it lost.
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => markContacted(q)}>📞 Contacted</button>
                  <button className={`btn btn-sm ${action?.id === q.id && action?.type === "snooze" ? "btn-primary" : "btn-ghost"}`} onClick={() => setAction(action?.id === q.id && action?.type === "snooze" ? null : { id: q.id, type: "snooze" })}>💤 Snooze</button>
                  <button className={`btn btn-sm ${action?.id === q.id && action?.type === "lost" ? "btn-primary" : "btn-ghost"}`} style={{ color: action?.id === q.id && action?.type === "lost" ? undefined : "var(--danger)" }} onClick={() => setAction(action?.id === q.id && action?.type === "lost" ? null : { id: q.id, type: "lost" })}>✕ Lost</button>
                </div>
                {action?.id === q.id && action?.type === "snooze" && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                    <input type="date" className="filter-input" value={snoozeDate} min={today()} onChange={e => setSnoozeDate(e.target.value)} />
                    <button className="btn btn-primary btn-sm" disabled={!snoozeDate} onClick={() => confirmSnooze(q)}>Set follow-up date</button>
                  </div>
                )}
                {action?.id === q.id && action?.type === "lost" && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                    <select className="filter-input" value={lostReason} onChange={e => setLostReason(e.target.value)}>
                      {LOST_REASONS.map(r => <option key={r}>{r}</option>)}
                    </select>
                    <button className="btn btn-sm" style={{ background: "#DC2626", color: "#fff", fontWeight: 700 }} onClick={() => confirmLost(q)}>Confirm lost</button>
                  </div>
                )}
              </div>
            )}

            {isLost && (
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => reopen(q)}>↩ Reopen</button>
              </div>
            )}

            {isSuccess && q._job && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                → Order:
                <span style={{ fontWeight: 600, color: "var(--text)", cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(212,132,10,.4)" }} onClick={() => onSelectJob(q._job)}>
                  {q._job.customer_name} · {fmtDate(q._job.scheduled_at)} · {q._job.assigned_truck}
                </span>
                <StatusPill status={q._job.status} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
// Remembered login (survives pull-to-refresh / page reloads; cleared on Sign out)
const loadSession = () => {
  try { return JSON.parse(localStorage.getItem("bnchr_session") || "null"); } catch { return null; }
};

export default function App() {
  const [authed, setAuthed] = useState(() => !!loadSession());
  const [role, setRole] = useState(() => loadSession()?.role || "sales");
  const [loginTruck, setLoginTruck] = useState(activeTrucks()[0]); // chosen truck at login
  const [, setCfgLoaded] = useState(0);
  useEffect(() => { fetchTruckConfig().then(() => { setCfgLoaded(x => x + 1); setLoginTruck(t => activeTrucks().includes(t) ? t : activeTrucks()[0]); }); }, []);
  const [sessionTruck, setSessionTruck] = useState(() => loadSession()?.truck || null); // locked truck (technician)
  const [loginAgent, setLoginAgent] = useState(SALES_AGENTS[0]);  // chosen agent at login
  const [sessionAgent, setSessionAgent] = useState(() => loadSession()?.agent || null); // locked agent (sales)
  const [isOwner, setIsOwner] = useState(() => !!loadSession()?.owner); // profitability views
  const [ownerMode, setOwnerMode] = useState(false); // discreet owner login (◆ on the login card)
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [cars, setCars] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [catalog, setCatalog] = useState([]); // parts catalog (engine oils, batteries)
  const [truckCfg, setTruckCfg] = useState([]); // truck_config rows (Settings)
  const [cfgTick, setCfgTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("schedule");
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [prefillSlot, setPrefillSlot] = useState(null);
  const [prefillOrder, setPrefillOrder] = useState(null);
  const [upsellLeads, setUpsellLeads] = useState([]);
  // Deep link from the Tire System: ?tire_id=…&qty=4&mobile=… → open New Order prefilled
  const [deepLink, setDeepLink] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("tire_id")) return { tire_id: q.get("tire_id"), qty: Math.max(1, Number(q.get("qty")) || 4), mobile: (q.get("mobile") || "").trim() };
    } catch {}
    return null;
  });
  const [rescheduleJob, setRescheduleJob] = useState(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerMobile, setNewCustomerMobile] = useState("");
  const [newCustomerCallback, setNewCustomerCallback] = useState(null);
  const [showAddCar, setShowAddCar] = useState(false);
  const [addCarTarget, setAddCarTarget] = useState(null);
  const [showAddAddr, setShowAddAddr] = useState(false);
  const [addAddrTarget, setAddAddrTarget] = useState(null);
  const [editCarTarget, setEditCarTarget] = useState(null);
  const [editAddrTarget, setEditAddrTarget] = useState(null);
  const [showEditCustomer, setShowEditCustomer] = useState(false);
  const [usingMock, setUsingMock] = useState(false);

  const saveSession = (truck, agent, owner = false) => {
    try { localStorage.setItem("bnchr_session", JSON.stringify({ role, truck, agent: agent || null, owner })); } catch {}
  };
  const login = () => {
    if (ownerMode) {
      // owner door: Ali's password or master → sales dashboard as Ali, profitability unlocked
      if (pw === SALES_AGENT_PASSWORDS.Ali || pw === PASSWORD) {
        setRole("sales"); setSessionTruck(null); setSessionAgent("Ali"); setIsOwner(true);
        setAuthed(true); setPwErr(false); saveSession(null, "Ali", true);
      } else setPwErr(true);
      return;
    }
    if (role === "technician") {
      // each truck has its own password; log in locked to that truck
      const entered = pw.trim();
      const expected = String(TRUCK_PASSWORDS[loginTruck] || "").trim();
      if (expected && entered === expected) { setSessionTruck(loginTruck); setSessionAgent(null); setIsOwner(false); setAuthed(true); setPwErr(false); saveSession(loginTruck, null); }
      else setPwErr(true);
    } else if (role === "sales" && pw === SALES_AGENT_PASSWORDS[loginAgent]) {
      // per-agent login: orders auto-fill this agent; Ali's login unlocks profitability
      const owner = OWNER_AGENTS.includes(loginAgent);
      setSessionTruck(null); setSessionAgent(loginAgent); setIsOwner(owner); setAuthed(true); setPwErr(false); saveSession(null, loginAgent, owner);
    } else {
      const ok = role === "distributor" ? (pw === DIST_PASSWORD || pw === PASSWORD)
        : role === "purchaser" ? (pw === PURCH_PASSWORD || pw === PASSWORD)
        : pw === PASSWORD;
      if (ok) { const owner = pw === PASSWORD; setSessionTruck(null); setSessionAgent(null); setIsOwner(owner); setAuthed(true); setPwErr(false); saveSession(null, null, owner); }
      else setPwErr(true);
    }
  };

  useEffect(() => {
    if (!authed) return;
    setLoading(true);
    fetchCarCatalog();
    fetchAppSettings().then(setAppSettings);
    Promise.all([fetchTruckConfig(), fetchJobs(), fetchCustomers(), fetchCars(), fetchAddresses(), fetchAllQuotes(), fetchCatalogItems(), fetchUpsellLeads()]).then(([tc, j, c, cr, ad, qs, cat, ul]) => {
      setUpsellLeads(ul || []);
      setTruckCfg(tc);
      setJobs(j);
      setQuotes(qs);
      setCatalog(cat);
      setCustomers(c);
      setCars(cr);
      setAddresses(ad);
      setUsingMock(j.some(x => x.id?.startsWith("mock-")));
      setLoading(false);
    });
  }, [authed]);

  // Silent live sync: jobs + quotes every 60s, and instantly when the app
  // returns to the foreground. Customers/cars/addresses reload on page load
  // only (they change rarely and are heavy on mobile data).
  useEffect(() => {
    if (!authed) return;
    const refreshLive = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const [j, qs, ul] = await Promise.all([fetchJobs(), fetchAllQuotes(), fetchUpsellLeads()]);
        let merged;
        setJobs(prev => (merged = mergeJobs(prev, j)));
        setQuotes(qs);
        setUpsellLeads(ul || []);
        setUsingMock(j.some(x => x.id?.startsWith("mock-")));
        setSelectedJob(prev => prev ? ((merged || j).find(x => x.id === prev.id) || prev) : prev);
      } catch {}
    };
    const iv = setInterval(refreshLive, 60000);
    const onVis = () => { if (document.visibilityState === "visible") refreshLive(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [authed]);

  // Realtime push: any change to jobs/quotes on any device lands here within
  // ~1s. Events are debounced 400ms, then jobs+quotes refetch (small tables).
  // The 60s poll above stays as a fallback for dropped websockets on mobile.
  useEffect(() => {
    if (!authed) return;
    let t = null;
    const bump = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        try {
          const [j, qs, ul] = await Promise.all([fetchJobs(), fetchAllQuotes(), fetchUpsellLeads()]);
          let merged;
          setJobs(prev => (merged = mergeJobs(prev, j)));
          setQuotes(qs);
          setUpsellLeads(ul || []);
          setUsingMock(j.some(x => x.id?.startsWith("mock-")));
          setSelectedJob(prev => prev ? ((merged || j).find(x => x.id === prev.id) || prev) : prev);
        } catch {}
      }, 400);
    };
    const ch = sbRealtime
      .channel("bnchr-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "upsell_leads" }, bump)
      .subscribe();
    return () => { clearTimeout(t); sbRealtime.removeChannel(ch); };
  }, [authed]);

  useEffect(() => {
    if (role === "technician") setTab("myjobs");
    else if (role === "distributor") setTab("distributor");
    else setTab("schedule");
    setSelectedJob(null);
    setSelectedCustomer(null);
  }, [role]);

  useEffect(() => {
    if (!authed || loading || !deepLink) return;
    if (role !== "sales" && role !== "purchaser") return;
    const dl = deepLink; setDeepLink(null);
    try { window.history.replaceState({}, "", window.location.pathname); } catch {}
    (async () => {
      const t = await fetchTireById(dl.tire_id);
      const svc = newService("Tire Change & Balancing");
      if (t) Object.assign(svc, {
        tire_id: t.id, brand: t.brand, pattern: t.pattern, size: tireSize(t), year: t.year,
        cost: t.cost, supplier: t.supplier, unit_price: Number(t.price) || 0,
        load_index: t.load_index || "", speed_rating: t.speed_rating || "", country: t.country || "",
        oem: t.oem || "", tire_note: t.notes || "",
      });
      svc.qty = dl.qty;
      svc.labor = catalogLabor(svc.service_type, svc.variant, dl.qty);
      const digits = (s) => (s || "").replace(/\D/g, "");
      const customer = dl.mobile ? customers.find(x => digits(x.mobile).slice(-8) === digits(dl.mobile).slice(-8)) : null;
      setPrefillOrder({ customer: customer || null, services: [svc], mobile: dl.mobile });
      setShowNew(true);
    })();
  }, [authed, loading, deepLink, role, customers]);

  const handleJobUpdate = (updated) => {
    // Stamp local time so stale realtime echoes of our own in-flight saves
    // (which carry an older/equal updated_at) can never overwrite this row.
    const stamped = { ...updated, updated_at: new Date().toISOString() };
    setJobs(prev => prev.map(j => j.id === stamped.id ? stamped : j));
    if (selectedJob?.id === stamped.id) setSelectedJob(stamped);
  };

  const handleJobAction = async (job, patch) => {
    const next = { ...job, ...patch };
    handleJobUpdate(next);
    await updateJob(job.id, patch);
  };

  const handleNewCustomer = (mobile, cb) => {
    setNewCustomerMobile(mobile || "");
    setNewCustomerName("");
    setNewCustomerCallback(() => cb);
    setShowNewCustomer(true);
  };

  const handleCustomerCreated = (c, newCars = [], newAddrs = []) => {
    setCustomers(prev => [c, ...prev]);
    if (newCars.length) setCars(prev => [...newCars, ...prev]);
    if (newAddrs.length) setAddresses(prev => [...newAddrs, ...prev]);
    if (newCustomerCallback) newCustomerCallback(c);
    setShowNewCustomer(false);
  };

  const handleAddCar = (customer) => {
    setAddCarTarget(customer);
    setShowAddCar(true);
  };

  const handleNewOrderFor = (customer, sourceJob = null) => {
    setSelectedCustomer(null);
    setSelectedJob(null);
    setPrefillSlot(null);
    setPrefillOrder({ customer, sourceJob });
    setShowNew(true);
  };

  // Reorder from any job card: match the customer record by id, then mobile.
  const reorderJob = (job) => handleNewOrderFor(
    customers.find(c => c.id === job.customer_id) ||
    customers.find(c => last8(c.mobile) === last8(job.customer_mobile)) || null,
    job
  );

  // ── Threads: revisits & upsells ──
  const matchCustomerOf = (job) =>
    customers.find(c => c.id === job.customer_id) ||
    customers.find(c => last8(c.mobile) === last8(job.customer_mobile)) || null;

  // Sales: create a linked follow-up order after customer feedback.
  const revisitJob = (job) => {
    setSelectedJob(null); setSelectedCustomer(null); setPrefillSlot(null);
    setPrefillOrder({
      customer: matchCustomerOf(job),
      name: job.customer_name, mobile: job.customer_mobile,
      revisitOf: job,
      noteHint: "Revisit — customer feedback: ",
      linkTo: { parent_job_id: rootJobId(job, jobs), link_type: "revisit" },
      linkLabel: `🔁 Revisit — will be linked to ${job.customer_name}'s order of ${fmtDate(job.scheduled_at)}`,
    });
    setShowNew(true);
  };

  // Technician: log an upsell lead on a completed job.
  const handleCreateUpsell = async (lead) => {
    const r = await createUpsellLead(lead);
    if (r) setUpsellLeads(prev => [r, ...prev]);
    return !!r;
  };

  // Sales: dismiss an open lead with a reason.
  const handleDismissLead = async (lead, reason) => {
    setUpsellLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: "dismissed", dismiss_reason: reason } : l));
    await updateUpsellLead(lead.id, { status: "dismissed", dismiss_reason: reason });
  };

  // Sales: convert an open lead into a linked order (credit frozen to the spotting truck).
  const handleConvertLead = (lead) => {
    const parent = jobs.find(j => j.id === lead.job_id) || null;
    const cust = parent ? matchCustomerOf(parent) : (customers.find(c => last8(c.mobile) === last8(lead.customer_mobile)) || null);
    // Link the car the upsell was spotted on — only if it's really one of this customer's cars.
    const wantCarId = lead.car_id || (parent && parent.car_id) || null;
    const carOk = wantCarId && cust && cars.some(c => c.id === wantCarId && c.customer_id === cust.id);
    setSelectedJob(null); setSelectedCustomer(null); setPrefillSlot(null);
    setPrefillOrder({
      customer: cust,
      name: lead.customer_name, mobile: lead.customer_mobile,
      services: [{ ...newService(lead.service_type || SERVICE_NAMES[0]), labor: Number(SERVICE_CATALOG[lead.service_type]?.flatLabor) || 0, car_id: carOk ? wantCarId : null }],
      revisitOf: parent || undefined, // reuse address carry-over
      leadId: lead.id,
      linkTo: {
        parent_job_id: parent ? rootJobId(parent, jobs) : lead.job_id,
        link_type: "upsell",
        upsell_truck: lead.truck || null,
        upsell_technician: lead.technician || null,
      },
      linkLabel: `⬆ Upsell spotted by ${lead.truck || "truck"}${lead.car_label ? ` on ${lead.car_label}` : ""} — will be linked to the original order`,
    });
    setShowNew(true);
  };

  const handleBookQuote = (quote, line) => {
    setSelectedJob(null);
    setSelectedCustomer(null);
    const built = quoteToService(quote, line);
    const svcList = Array.isArray(built) ? built : [built];
    const customer = customers.find(x => x.id === quote.customer_id) ||
                     customers.find(x => last8(x.mobile) === last8(quote.customer_mobile)) || null;
    // Service quotes carry the car: link the exact car when it's really this customer's,
    // otherwise pre-fill the inline new-car form so sales only taps save.
    if (quote.kind === "service") {
      const carOk = quote.car_id && customer && cars.some(c => c.id === quote.car_id && c.customer_id === customer.id);
      svcList.forEach(svc => {
        if (carOk) svc.car_id = quote.car_id;
        else if (quote.car && quote.car.brand) {
          svc.car_id = null;
        }
      });
      if (!carOk && quote.car && quote.car.brand && svcList[0]) {
        svcList[0].new_car = { brand: quote.car.brand || "", model: quote.car.model || "", sub_model: quote.car.sub_model || "", year: String(quote.car.year || ""), plate: quote.car.vin || "" };
      }
    }
    setPrefillSlot(null);
    setPrefillOrder({ customer, services: svcList, mobile: quote.customer_mobile, name: quote.customer_name || "", quoteId: quote.id });
    setShowNew(true);
  };

  // Stamp a quote as Success the moment its order is created (source of truth)
  const stampQuoteSuccess = (quoteId, job) => {
    if (!quoteId || !job) return;
    setQuotes(prev => prev.map(q => q.id === quoteId ? { ...q, status: "success", booked_job_id: job.id } : q));
    updateQuote(quoteId, { status: "success", booked_job_id: job.id });
  };
  const handleQuoteUpdate = (quoteId, patch) => {
    setQuotes(prev => prev.map(q => q.id === quoteId ? { ...q, ...patch } : q));
    updateQuote(quoteId, patch);
  };

  const handleCarCreated = (car) => {
    setCars(prev => [car, ...prev]);
    setShowAddCar(false);
  };

  // Keep the customer's headline area in step with their addresses:
  // the last address added or edited becomes the area shown on the card.
  const syncCustomerArea = (customerId, area) => {
    if (!customerId || !area) return;
    setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, area } : c));
    setSelectedCustomer(prev => (prev && prev.id === customerId) ? { ...prev, area } : prev);
    updateCustomer(customerId, { area });
  };
  const handleAddressCreated = (addr) => {
    setAddresses(prev => [addr, ...prev]);
    setShowAddAddr(false);
    syncCustomerArea(addr.customer_id, addr.area);
  };
  const handleAddAddress = (customer) => {
    setAddAddrTarget(customer);
    setShowAddAddr(true);
  };

  const handleCarUpdated = (car) => {
    setCars(prev => prev.map(c => c.id === car.id ? car : c));
    setShowAddCar(false); setEditCarTarget(null);
    // Propagate the correction to ACTIVE orders referencing this car.
    // Completed / cancelled / incomplete orders keep their historical snapshot.
    const label = `${car.brand || ""} ${car.model || ""}${car.year ? " " + car.year : ""}`.replace(/\s+/g, " ").trim();
    const frozen = (j) => DONE_STATUSES.includes(j.status) || j.status === "cancelled" || j.status === "incomplete";
    setJobs(prev => prev.map(j => {
      if (frozen(j)) return j;
      const refsTop = j.car_id === car.id;
      const refsItem = (j.items || []).some(it => it.car_id === car.id);
      if (!refsTop && !refsItem) return j;
      const patch = {};
      if (refsTop) {
        patch.car_brand = car.brand || "";
        patch.car_model = car.model || "";
        patch.car_year = car.year || "";
        patch.car_plate = car.plate || "";
      }
      if (refsItem) patch.items = (j.items || []).map(it => it.car_id === car.id ? { ...it, car_label: label } : it);
      updateJob(j.id, patch);
      return { ...j, ...patch };
    }));
  };
  const handleCarDeleted = (id) => {
    setCars(prev => prev.filter(c => c.id !== id));
    deleteCar(id);
  };
  const handleAddressUpdated = (a) => {
    setAddresses(prev => prev.map(x => x.id === a.id ? a : x));
    setShowAddAddr(false); setEditAddrTarget(null);
    syncCustomerArea(a.customer_id, a.area);
  };
  const handleAddressDeleted = (id) => {
    setAddresses(prev => prev.filter(x => x.id !== id));
    deleteAddress(id);
  };
  const handleCustomerUpdated = (c) => {
    setCustomers(prev => prev.map(x => x.id === c.id ? c : x));
    setSelectedCustomer(c);
    setShowEditCustomer(false);
  };

  const [appSettings, setAppSettings] = useState({});
  const incentiveOn = appSettings.incentive_enabled === true;
  const setIncentiveEnabled = async (on) => {
    setAppSettings(p => ({ ...p, incentive_enabled: on }));
    await saveAppSetting("incentive_enabled", on);
  };
  const allTabs = [
    { key: "schedule",   label: "Schedule",        icon: "📅", roles: ["sales", "purchaser"] },
    { key: "quotes",     label: "Quotes",          icon: "📋", roles: ["sales"] },
    { key: "upsells",    label: "Upsells",         icon: "⬆", roles: ["sales"] },
    { key: "reports",    label: "Reports",         icon: "📊", roles: ["sales"] },
    { key: "costs",      label: "Costs",           icon: "💰", roles: ["purchaser"] },
    { key: "settings",   label: "Settings",        icon: "⚙️", roles: ["sales", "purchaser"] },
    { key: "history",    label: "History",         icon: "🕘", roles: ["sales", "purchaser"] },
    { key: "customers",  label: "Customers",       icon: "👥", roles: ["sales", "purchaser"] },
    { key: "myjobs",     label: "My Jobs",         icon: "🔧", roles: ["technician"] },
    { key: "target",     label: "Target",          icon: "🎯", roles: ["technician"] },
    { key: "myhistory",  label: "History",         icon: "🕘", roles: ["technician"] },
    { key: "distributor",label: "Collect",         icon: "📦", roles: ["distributor"] },
    { key: "disthistory",label: "History",         icon: "🕘", roles: ["distributor"] },
  ];
  // Master/owner access sees every page (incl. purchaser Costs, tech views, distributor)
  const tabs = allTabs
    .filter(t => isOwner || t.roles.includes(role))
    .filter(t => t.key !== "target" || incentiveOn || isOwner); // master switch gates the technician dashboard

  if (!authed) {
    return (
      <>
        <StyleTag />
        <div className="login-wrap">
          <div className="login-box" style={{ position: "relative" }}>
            <button type="button" onClick={() => { setOwnerMode(o => !o); setPwErr(false); }}
              style={{ position: "absolute", top: 10, right: 12, background: "none", border: "none", cursor: "pointer",
                fontSize: 13, color: "var(--border)", padding: 4 }} aria-label="owner">◆</button>
            <h1>BNCHR<span>+</span></h1>
            <p>{ownerMode ? "Owner access" : "Scheduling System · Internal"}</p>
            {!ownerMode && <div className="role-grid">
              {ROLES.map(r => (
                <button key={r.key} className={`role-btn ${role === r.key ? "active" : ""}`} onClick={() => { setRole(r.key); setPwErr(false); }}>{r.label}</button>
              ))}
            </div>}
            {!ownerMode && role === "technician" && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginBottom: 6 }}>Select your truck</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {activeTrucks().map(t => {
                    const c = truckColor(t);
                    const active = loginTruck === t;
                    return (
                      <button key={t} type="button" onClick={() => { setLoginTruck(t); setPwErr(false); }}
                        style={{ flex: 1, minWidth: 70, padding: "8px 4px", borderRadius: 8, cursor: "pointer", fontWeight: 700,
                          background: active ? c.solid : c.bg, color: active ? (["T1","T2"].includes(t) ? "#1A1A1A" : "#fff") : c.text,
                          border: `2px solid ${c.solid}` }}>
                        {active ? "✓ " : ""}{t}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {!ownerMode && role === "sales" && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginBottom: 6 }}>Who's working?</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {SALES_AGENTS.filter(a => !OWNER_AGENTS.includes(a)).map(a => {
                    const active = loginAgent === a;
                    return (
                      <button key={a} type="button" onClick={() => { setLoginAgent(a); setPwErr(false); }}
                        style={{ flex: 1, minWidth: 90, padding: "8px 4px", borderRadius: 8, cursor: "pointer", fontWeight: 700,
                          background: active ? "var(--accent)" : "var(--bg)", color: active ? "#fff" : "var(--text)",
                          border: `2px solid ${active ? "var(--accent)" : "var(--border)"}` }}>
                        {active ? "✓ " : ""}{a}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <input type="password" placeholder={role === "technician" ? `${loginTruck} password` : role === "sales" ? `${loginAgent}'s password (or team password)` : "Team password"} value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} />
            {pwErr && <div className="login-error">Incorrect password.</div>}
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={login}>Enter{role === "technician" ? ` as ${loginTruck}` : role === "sales" ? ` as ${loginAgent}` : ""}</button>
          </div>
        </div>
      </>
    );
  }

  const goBack = () => { setSelectedJob(null); setSelectedCustomer(null); };

  return (
    <>
      <StyleTag />
      <div className="app">
        <div className="topbar">
          <div className="topbar-left">
            <div className="logo">BNCHR<span>+</span></div>
            <span className="badge-role">{role}{sessionTruck ? ` · ${sessionTruck}` : ""}{sessionAgent ? ` · ${sessionAgent}` : ""}</span>
            <nav className="nav-tabs">
              {tabs.map(t => (
                <button key={t.key} className={`nav-tab ${tab === t.key ? "active" : ""}`}
                  onClick={() => { setTab(t.key); setSelectedJob(null); setSelectedCustomer(null); }}>
                  {t.label}{t.key === "upsells" && upsellLeads.filter(l => l.status === "open").length > 0 ? <span style={{ marginLeft: 5, fontSize: 10.5, fontWeight: 800, background: "#15803D", color: "#fff", borderRadius: 8, padding: "1px 6px" }}>{upsellLeads.filter(l => l.status === "open").length}</span> : null}
                </button>
              ))}
            </nav>
          </div>
          <div className="topbar-right">
            {usingMock && <span style={{ fontSize: 11, color: "var(--accent)", border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: 6, padding: "2px 8px" }}>Demo Data</span>}
            <button className="btn-logout" onClick={() => { setAuthed(false); setPw(""); setSessionTruck(null); setSessionAgent(null); try { localStorage.removeItem("bnchr_session"); } catch {} }}>Sign out</button>
          </div>
        </div>

        <div className="main">
          {loading && <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>Loading…</div>}

          {!loading && selectedJob && (
            <JobDetail job={selectedJob} role={role} onBack={goBack} onUpdate={handleJobUpdate} onReschedule={setRescheduleJob} onEdit={setEditingJob} onReorder={role === "sales" ? reorderJob : undefined} onRevisit={role === "sales" ? revisitJob : undefined} jobs={jobs} upsellLeads={upsellLeads} onOpenJob={setSelectedJob} onCreateUpsell={handleCreateUpsell} onConvertLead={handleConvertLead} onDismissLead={handleDismissLead} onAction={handleJobAction} />
          )}

          {!loading && !selectedJob && selectedCustomer && tab === "customers" && (
            <CustomerProfileDetail
              customer={selectedCustomer}
              cars={cars}
              addresses={addresses}
              jobs={jobs}
              onBack={() => setSelectedCustomer(null)}
              onSelectJob={(job) => { setSelectedJob(job); }}
              onAddCar={handleAddCar}
              onAddAddress={handleAddAddress}
              onEditCustomer={() => setShowEditCustomer(true)}
              onEditCar={(car) => { setAddCarTarget(selectedCustomer); setEditCarTarget(car); setShowAddCar(true); }}
              onDeleteCar={handleCarDeleted}
              onEditAddress={(a) => { setAddAddrTarget(selectedCustomer); setEditAddrTarget(a); setShowAddAddr(true); }}
              onDeleteAddress={handleAddressDeleted}
              onNewOrder={() => handleNewOrderFor(selectedCustomer)}
              onReorder={(job) => handleNewOrderFor(selectedCustomer, job)}
            />
          )}

          {!loading && !selectedJob && !selectedCustomer && tab === "schedule" && (
            <ScheduleView key={"sched-" + cfgTick} jobs={jobs} customers={customers} role={role} onSelectJob={setSelectedJob} onNewJob={() => { setPrefillSlot(null); setShowNew(true); }} onNewJobAt={(truck, hour, date) => { setPrefillSlot({ truck, hour, date }); setShowNew(true); }} onReschedule={setRescheduleJob} onEdit={setEditingJob} onAction={handleJobAction} />
          )}
          {!loading && !selectedJob && !selectedCustomer && tab === "quotes" && (
            <QuotesView quotes={quotes} jobs={jobs} customers={customers} onBook={handleBookQuote} onSelectJob={setSelectedJob} onQuoteUpdate={handleQuoteUpdate} />
          )}
          {!loading && !selectedJob && !selectedCustomer && tab === "upsells" && (
            <UpsellsView upsellLeads={upsellLeads} jobs={jobs} role={role} onConvert={handleConvertLead} onDismiss={handleDismissLead} onSelectJob={setSelectedJob} />
          )}
          {!loading && !selectedJob && !selectedCustomer && tab === "reports" && (
            <>
              <ReportsView jobs={jobs} quotes={quotes} customers={customers} owner={isOwner} />
              <IncentiveReport jobs={jobs} enabled={incentiveOn} onToggle={setIncentiveEnabled} />
            </>
          )}
          {!loading && !selectedJob && !selectedCustomer && tab === "costs" && (
            <CostsView jobs={jobs} onUpdate={async (id, patch) => { const job = jobs.find(j => j.id === id); if (job) handleJobUpdate({ ...job, ...patch }); await updateJob(id, patch); }} />
          )}
          {!loading && !selectedJob && !selectedCustomer && tab === "settings" && (
            <TruckSettingsView owner={isOwner} rows={truckCfg} onReload={async () => { const tc = await fetchTruckConfig(); setTruckCfg(tc); setCfgTick(x => x + 1); }} />
          )}
          {!loading && !selectedJob && !selectedCustomer && tab === "history" && (
            <HistoryView jobs={jobs} onSelectJob={setSelectedJob} onEdit={role === "sales" ? setEditingJob : undefined} onReorder={role === "sales" ? reorderJob : undefined} />
          )}
          {!loading && !selectedJob && !selectedCustomer && tab === "customers" && (
            <CustomersView customers={customers} cars={cars} jobs={jobs} onSelectCustomer={setSelectedCustomer} onNewCustomer={() => { setNewCustomerName(""); setNewCustomerMobile(""); setNewCustomerCallback(null); setShowNewCustomer(true); }} />
          )}
          {!loading && !selectedJob && !selectedCustomer && tab === "myjobs" && (
            <MyJobsView jobs={jobs} onUpdate={handleJobUpdate} onSelectJob={setSelectedJob} lockedTruck={sessionTruck} onCreateUpsell={handleCreateUpsell} />
          )}
          {!loading && !selectedJob && !selectedCustomer && tab === "target" && (
            <TechTargetView jobs={jobs} truck={sessionTruck} owner={isOwner} />
          )}
          {tab === "myhistory" && !selectedJob && (
            <TechHistoryView jobs={jobs} onSelectJob={setSelectedJob} lockedTruck={sessionTruck} />
          )}
          {!loading && !selectedJob && !selectedCustomer && tab === "distributor" && (
            <DistributorView jobs={jobs} onUpdate={handleJobUpdate} />
          )}
          {!loading && !selectedJob && !selectedCustomer && tab === "disthistory" && (
            <DistributorHistoryView jobs={jobs} />
          )}
        </div>

        {tabs.length > 1 && (
          <nav className="bottom-nav">
            {tabs.map(t => (
              <button key={t.key} className={`bottom-nav-item ${tab === t.key ? "active" : ""}`}
                onClick={() => { setTab(t.key); setSelectedJob(null); setSelectedCustomer(null); }}>
                <span className="bottom-nav-icon" style={{ position: "relative" }}>{t.icon}{t.key === "upsells" && upsellLeads.filter(l => l.status === "open").length > 0 ? <span style={{ position: "absolute", top: -4, right: -10, fontSize: 9, fontWeight: 800, background: "#15803D", color: "#fff", borderRadius: 7, padding: "0px 4px" }}>{upsellLeads.filter(l => l.status === "open").length}</span> : null}</span>
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      {rescheduleJob && (
        <RescheduleModal
          job={rescheduleJob}
          jobs={jobs}
          onClose={() => setRescheduleJob(null)}
          onSaved={(updated) => { handleJobUpdate(updated); setRescheduleJob(null); }}
        />
      )}

      {editingJob && (
        <NewJobModal
          defaultAgent={sessionAgent}
          catalog={catalog}
          onCustomerCreated={(c) => setCustomers(prev => [c, ...prev])}
          editJob={editingJob}
          customers={customers}
          cars={cars}
          addresses={addresses}
          jobs={jobs}
          onClose={() => setEditingJob(null)}
          onEdited={(updated) => { handleJobUpdate(updated); setEditingJob(null); }}
          onNewCustomer={handleNewCustomer}
          onCarCreated={handleCarCreated}
          onAddressCreated={handleAddressCreated}
        />
      )}

      {showNew && (
        <NewJobModal
          defaultAgent={sessionAgent}
          catalog={catalog}
          onCustomerCreated={(c) => setCustomers(prev => [c, ...prev])}
          prefillOrder={prefillOrder}
          customers={customers}
          cars={cars}
          addresses={addresses}
          jobs={jobs}
          prefill={prefillSlot}
          onClose={() => { setShowNew(false); setPrefillSlot(null); setPrefillOrder(null); }}
          onCreated={(j, quoteId) => {
            setJobs(prev => [j, ...prev]);
            stampQuoteSuccess(quoteId, j);
            const leadId = prefillOrder?.leadId;
            if (leadId) {
              setUpsellLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: "converted", converted_job_id: j.id } : l));
              updateUpsellLead(leadId, { status: "converted", converted_job_id: j.id });
            }
          }}
          onNewCustomer={handleNewCustomer}
          onCarCreated={handleCarCreated}
          onAddressCreated={handleAddressCreated}
        />
      )}

      {showNewCustomer && (
        <NewCustomerModal
          initialName={newCustomerName}
          initialMobile={newCustomerMobile}
          onClose={() => setShowNewCustomer(false)}
          onCreated={handleCustomerCreated}
        />
      )}

      {showAddCar && addCarTarget && (
        <AddCarModal
          customer={addCarTarget}
          editCar={editCarTarget}
          onClose={() => { setShowAddCar(false); setEditCarTarget(null); }}
          onCreated={handleCarCreated}
          onUpdated={handleCarUpdated}
        />
      )}

      {showAddAddr && addAddrTarget && (
        <AddAddressModal
          customer={addAddrTarget}
          editAddr={editAddrTarget}
          onClose={() => { setShowAddAddr(false); setEditAddrTarget(null); }}
          onCreated={handleAddressCreated}
          onUpdated={handleAddressUpdated}
        />
      )}

      {showEditCustomer && selectedCustomer && (
        <EditCustomerModal
          customer={selectedCustomer}
          onClose={() => setShowEditCustomer(false)}
          onUpdated={handleCustomerUpdated}
        />
      )}
    </>
  );
}
