import { useState, useEffect } from "react";

// ─── Supabase ────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://itpghtviyotueqpspxun.supabase.co";
const SUPABASE_KEY = "sb_publishable_OhL-LX-sjKOo97uFoN7oMQ_G3j579PE";

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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  return res.status === 204 ? null : res.json();
}

// ─── Constants ────────────────────────────────────────────────────────────────
const PASSWORD = "bnchr901";
const TRUCKS = ["T1", "T2", "T4", "T5", "T6"];

const STATUS_FLOW = [
  { key: "booked",     label: "Booked",       color: "#4B5563" },
  { key: "part_ready", label: "Part Ready",   color: "#7C3AED" },
  { key: "assigned",   label: "Assigned",     color: "#2563EB" },
  { key: "en_route",   label: "En Route",     color: "#D97706" },
  { key: "on_site",    label: "On Site",      color: "#EA580C" },
  { key: "done",       label: "Done",         color: "#16A34A" },
  { key: "invoiced",   label: "Invoiced",     color: "#0891B2" },
  { key: "paid",       label: "Paid",         color: "#059669" },
];

const CHECK_LABELS = [
  "Sales — size, specs, customer photos confirmed",
  "Distributor (C1) — physical tires verified before loading",
  "Track team — tires + equipment verified before departure",
  "On-site — tires checked against vehicle before installation",
];

const SERVICE_TYPES = [
  "Tire Change & Balancing",
  "Oil & Filter",
  "Battery Change",
  "Brake Change",
  "Programming",
  "Mechanical Check",
  "Wheel Repair",
  "Rotation",
  "Other",
];

const LEAD_SOURCES = ["WhatsApp", "Signal", "Shopify", "Instagram", "Other"];

const ROLES = [
  { key: "sales",       label: "Sales" },
  { key: "purchaser",   label: "Purchaser" },
  { key: "technician",  label: "Technician" },
  { key: "distributor", label: "Distributor" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().split("T")[0];
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }) : "—";
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";
const statusMeta = (key) => STATUS_FLOW.find((s) => s.key === key) || STATUS_FLOW[0];
const nextStatus = (key) => {
  const idx = STATUS_FLOW.findIndex((s) => s.key === key);
  return idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
};

// ─── Mock data (used when Supabase tables don't exist yet) ────────────────────
const MOCK_JOBS = [
  {
    id: "mock-1",
    customer_name: "Ahmad Al-Salem",
    customer_mobile: "99001234",
    area: "Salmiya",
    block: "12",
    street: "Hamad Al-Mubarak",
    house: "14",
    map_link: "https://maps.google.com/?q=29.3375,48.0838",
    car_brand: "Toyota",
    car_model: "Land Cruiser",
    car_year: "2022",
    car_plate: "Kuwait · 12345 · Private",
    service_type: "Tire Change & Balancing",
    service_details: "215/60R16 Michelin Pilot Sport 4 · Japan 2025",
    qty: 4,
    item_price: 38,
    total: 172,
    assigned_truck: "T2",
    assigned_technician: "Fahad",
    status: "assigned",
    scheduled_at: new Date().toISOString(),
    lead_from: "WhatsApp",
    sales_agent: "Hussain",
    xero_ref: "PO-2026-0041",
    payment_through: "Link",
    payment_status: "paid",
    checks: [true, false, false, false],
    notes: "Customer has Tesla wall charger — park carefully",
    created_at: new Date().toISOString(),
  },
  {
    id: "mock-2",
    customer_name: "Sara Al-Rashidi",
    customer_mobile: "66778899",
    area: "Rumaithiya",
    block: "3",
    street: "Al-Khaleej",
    house: "7A",
    map_link: "",
    car_brand: "Porsche",
    car_model: "Cayenne",
    car_year: "2023",
    car_plate: "Kuwait · 77321 · Private",
    service_type: "Tire Change & Balancing",
    service_details: "295/40R21 Pirelli P Zero · Germany 2025",
    qty: 2,
    item_price: 95,
    total: 200,
    assigned_truck: "T4",
    assigned_technician: "Omar",
    status: "booked",
    scheduled_at: new Date(Date.now() + 3600000 * 3).toISOString(),
    lead_from: "Signal",
    sales_agent: "Alaa",
    xero_ref: "",
    payment_through: "Tabby",
    payment_status: "pending",
    checks: [false, false, false, false],
    notes: "",
    created_at: new Date().toISOString(),
  },
];

// ─── CSS ─────────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #0D0F12;
    --surface:  #141720;
    --card:     #1A1E2A;
    --border:   #252B3B;
    --accent:   #F5A623;
    --accent2:  #E8430A;
    --text:     #F0F2F7;
    --muted:    #7B859A;
    --success:  #22C55E;
    --danger:   #EF4444;
    --radius:   10px;
    --font-head: 'Space Grotesk', sans-serif;
    --font-body: 'Inter', sans-serif;
  }

  body { background: var(--bg); color: var(--text); font-family: var(--font-body); font-size: 14px; line-height: 1.5; min-height: 100vh; }

  /* ── Login ── */
  .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .login-box { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 40px 36px; width: 320px; }
  .login-box h1 { font-family: var(--font-head); font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .login-box p { color: var(--muted); font-size: 13px; margin-bottom: 28px; }
  .login-box input { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 14px; color: var(--text); font-size: 14px; margin-bottom: 12px; outline: none; }
  .login-box input:focus { border-color: var(--accent); }
  .login-error { color: var(--danger); font-size: 12px; margin-bottom: 10px; }
  .role-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px; }
  .role-btn { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 8px; color: var(--muted); font-size: 13px; cursor: pointer; text-align: center; transition: all .15s; }
  .role-btn.active { background: var(--accent); border-color: var(--accent); color: #000; font-weight: 600; }

  /* ── Layout ── */
  .app { display: flex; flex-direction: column; min-height: 100vh; }
  .topbar { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 20px; height: 56px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
  .topbar-left { display: flex; align-items: center; gap: 12px; }
  .logo { font-family: var(--font-head); font-size: 17px; font-weight: 700; letter-spacing: -.3px; }
  .logo span { color: var(--accent); }
  .badge-role { background: var(--border); border-radius: 6px; padding: 3px 10px; font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
  .nav-tabs { display: flex; gap: 2px; }
  .nav-tab { background: none; border: none; color: var(--muted); font-size: 13px; font-weight: 500; padding: 8px 14px; border-radius: 8px; cursor: pointer; transition: all .15s; }
  .nav-tab.active, .nav-tab:hover { background: var(--card); color: var(--text); }
  .topbar-right { display: flex; align-items: center; gap: 10px; }
  .btn-logout { background: none; border: 1px solid var(--border); border-radius: 8px; color: var(--muted); font-size: 12px; padding: 6px 12px; cursor: pointer; }
  .btn-logout:hover { border-color: var(--danger); color: var(--danger); }

  .main { flex: 1; padding: 24px 20px; max-width: 1200px; margin: 0 auto; width: 100%; }

  /* ── Buttons ── */
  .btn { border: none; border-radius: var(--radius); padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all .15s; display: inline-flex; align-items: center; gap: 6px; }
  .btn-primary { background: var(--accent); color: #000; }
  .btn-primary:hover { background: #f0b840; }
  .btn-ghost { background: var(--card); border: 1px solid var(--border); color: var(--text); }
  .btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
  .btn-danger { background: transparent; border: 1px solid var(--danger); color: var(--danger); }
  .btn-sm { padding: 5px 12px; font-size: 12px; }
  .btn-success { background: var(--success); color: #000; }

  /* ── Cards ── */
  .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); }
  .card-header { padding: 14px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .card-header h3 { font-family: var(--font-head); font-size: 15px; font-weight: 600; }
  .card-body { padding: 16px; }

  /* ── Job list ── */
  .jobs-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 10px; }
  .jobs-title { font-family: var(--font-head); font-size: 20px; font-weight: 700; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; }
  .filter-select { background: var(--card); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px; padding: 7px 12px; cursor: pointer; }
  .filter-select:focus { outline: none; border-color: var(--accent); }

  .job-cards { display: flex; flex-direction: column; gap: 10px; }
  .job-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; cursor: pointer; transition: border-color .15s; }
  .job-card:hover { border-color: var(--accent); }
  .job-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .job-card-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
  .job-card-name { font-weight: 600; font-size: 15px; }
  .job-card-service { color: var(--muted); font-size: 13px; margin-top: 3px; }
  .tag { border-radius: 6px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
  .tag-truck { background: #1e2d4a; color: #60A5FA; }
  .tag-time { background: #1e2a1e; color: #86EFAC; font-size: 12px; }
  .tag-total { background: #2a1e12; color: var(--accent); }
  .status-pill { border-radius: 20px; padding: 3px 10px; font-size: 11px; font-weight: 700; letter-spacing: .3px; }

  /* ── Job Detail ── */
  .job-detail { display: flex; flex-direction: column; gap: 16px; }
  .detail-back { background: none; border: none; color: var(--muted); font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 6px; margin-bottom: 4px; padding: 0; }
  .detail-back:hover { color: var(--text); }
  .detail-hero { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; }
  .detail-hero-top { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
  .detail-hero h2 { font-family: var(--font-head); font-size: 20px; font-weight: 700; }
  .detail-hero-sub { color: var(--muted); font-size: 13px; margin-top: 3px; }
  .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .detail-field label { display: block; font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
  .detail-field p { font-size: 14px; }
  .detail-field a { color: var(--accent); text-decoration: none; }
  .detail-field a:hover { text-decoration: underline; }

  /* ── Checks ── */
  .checks-list { display: flex; flex-direction: column; gap: 8px; }
  .check-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; transition: border-color .15s; }
  .check-item.done { border-color: var(--success); background: #0f1f12; }
  .check-item.locked { opacity: .45; cursor: not-allowed; }
  .check-circle { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; }
  .check-circle.done { background: var(--success); border-color: var(--success); color: #000; }
  .check-text { font-size: 13px; }
  .check-num { font-size: 11px; font-weight: 700; color: var(--muted); margin-right: 4px; }

  /* ── Status advance ── */
  .status-section { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .status-flow { display: flex; gap: 4px; flex-wrap: wrap; }
  .flow-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); }
  .flow-dot.active { background: var(--accent); }
  .flow-dot.done { background: var(--success); }

  /* ── Form (new job) ── */
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .form-field { display: flex; flex-direction: column; gap: 5px; }
  .form-field label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
  .form-field input, .form-field select, .form-field textarea { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; color: var(--text); font-size: 14px; font-family: var(--font-body); outline: none; width: 100%; }
  .form-field input:focus, .form-field select:focus, .form-field textarea:focus { border-color: var(--accent); }
  .form-field textarea { resize: vertical; min-height: 70px; }
  .form-section-title { font-family: var(--font-head); font-size: 13px; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: .8px; margin-top: 8px; margin-bottom: 2px; grid-column: 1 / -1; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  .form-full { grid-column: 1 / -1; }

  /* ── My Jobs (technician) ── */
  .my-job-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; cursor: pointer; transition: border-color .15s; }
  .my-job-card:hover { border-color: var(--accent); }
  .my-job-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .my-job-num { font-family: var(--font-head); font-size: 24px; font-weight: 700; color: var(--accent); }
  .my-job-body p { font-size: 13px; color: var(--muted); margin-bottom: 4px; }
  .my-job-body p strong { color: var(--text); }
  .map-btn { display: inline-flex; align-items: center; gap: 6px; background: #1a2540; border: 1px solid #2a3a60; border-radius: 8px; color: #60A5FA; font-size: 13px; font-weight: 600; padding: 8px 14px; text-decoration: none; margin-top: 10px; }

  /* ── Distributor ── */
  .dist-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-bottom: 10px; }
  .dist-card h4 { font-family: var(--font-head); font-size: 15px; font-weight: 600; margin-bottom: 10px; }
  .dist-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .dist-row:last-child { border-bottom: none; }
  .toggle-btn { width: 38px; height: 22px; border-radius: 11px; border: none; cursor: pointer; transition: background .2s; position: relative; flex-shrink: 0; }
  .toggle-btn.on { background: var(--success); }
  .toggle-btn.off { background: var(--border); }
  .toggle-btn::after { content: ''; position: absolute; width: 16px; height: 16px; border-radius: 50%; background: #fff; top: 3px; transition: left .2s; }
  .toggle-btn.on::after { left: 19px; }
  .toggle-btn.off::after { left: 3px; }

  /* ── Empty ── */
  .empty { text-align: center; padding: 60px 20px; color: var(--muted); }
  .empty h3 { font-family: var(--font-head); font-size: 18px; margin-bottom: 8px; color: var(--text); }

  /* ── Overlay / Modal ── */
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 200; display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 40px 16px; }
  .modal { background: var(--card); border: 1px solid var(--border); border-radius: 14px; width: 100%; max-width: 640px; }
  .modal-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .modal-header h3 { font-family: var(--font-head); font-size: 17px; font-weight: 700; }
  .modal-close { background: none; border: none; color: var(--muted); font-size: 20px; cursor: pointer; line-height: 1; }
  .modal-close:hover { color: var(--text); }
  .modal-body { padding: 20px; }
  .modal-footer { padding: 14px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; }

  /* ── Stats ── */
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }
  .stat-card .num { font-family: var(--font-head); font-size: 28px; font-weight: 700; }
  .stat-card .lbl { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .stat-card .accent { color: var(--accent); }
  .stat-card .success { color: var(--success); }

  /* ── Responsive ── */
  @media (max-width: 640px) {
    .form-grid, .detail-grid { grid-template-columns: 1fr; }
    .nav-tabs { display: none; }
    .topbar { padding: 0 12px; }
    .main { padding: 16px 12px; }
    .my-job-num { font-size: 30px; }
  }
`;

// ─── Inject CSS ───────────────────────────────────────────────────────────────
function StyleTag() {
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);
  return null;
}

// ─── Supabase DB layer ────────────────────────────────────────────────────────
async function fetchJobs() {
  try {
    const data = await sb("/jobs?select=*&order=scheduled_at.asc");
    return data || [];
  } catch {
    // Table doesn't exist yet — use mock data
    return MOCK_JOBS;
  }
}

async function createJob(job) {
  try {
    const res = await sb("/jobs", {
      method: "POST",
      body: JSON.stringify(job),
    });
    return res?.[0] || { ...job, id: `local-${Date.now()}` };
  } catch {
    return { ...job, id: `local-${Date.now()}` };
  }
}

async function updateJob(id, patch) {
  try {
    await sb(`/jobs?id=eq.${id}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify(patch),
    });
  } catch {
    // Silently update local state only
  }
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const m = statusMeta(status);
  return (
    <span className="status-pill" style={{ background: m.color + "22", color: m.color }}>
      {m.label}
    </span>
  );
}

// ─── New Job Modal ────────────────────────────────────────────────────────────
function NewJobModal({ onClose, onCreated }) {
  const blank = {
    customer_name: "", customer_mobile: "", area: "", block: "", street: "", house: "",
    map_link: "", car_brand: "", car_model: "", car_year: "", car_plate: "",
    service_type: "Tire Change & Balancing", service_details: "", qty: 1,
    item_price: "", total: "", assigned_truck: "T1", assigned_technician: "",
    lead_from: "WhatsApp", sales_agent: "", xero_ref: "", payment_through: "Link",
    payment_status: "pending", notes: "", status: "booked",
    scheduled_at: new Date().toISOString().slice(0, 16),
    checks: [false, false, false, false],
  };
  const [f, setF] = useState(blank);
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    if (!f.customer_name || !f.area || !f.service_type) return;
    setSaving(true);
    const job = { ...f, scheduled_at: new Date(f.scheduled_at).toISOString(), created_at: new Date().toISOString() };
    const created = await createJob(job);
    onCreated(created);
    setSaving(false);
    onClose();
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>New Job</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-section-title">Customer</div>
            <div className="form-field">
              <label>Name *</label>
              <input value={f.customer_name} onChange={set("customer_name")} placeholder="Ahmad Al-Salem" />
            </div>
            <div className="form-field">
              <label>Mobile</label>
              <input value={f.customer_mobile} onChange={set("customer_mobile")} placeholder="99001234" />
            </div>

            <div className="form-section-title">Location</div>
            <div className="form-field">
              <label>Area *</label>
              <input value={f.area} onChange={set("area")} placeholder="Salmiya" />
            </div>
            <div className="form-field">
              <label>Block</label>
              <input value={f.block} onChange={set("block")} placeholder="12" />
            </div>
            <div className="form-field">
              <label>Street</label>
              <input value={f.street} onChange={set("street")} placeholder="Al-Khaleej" />
            </div>
            <div className="form-field">
              <label>House #</label>
              <input value={f.house} onChange={set("house")} placeholder="7A" />
            </div>
            <div className="form-field form-full">
              <label>Google Map Link</label>
              <input value={f.map_link} onChange={set("map_link")} placeholder="https://maps.google.com/..." />
            </div>

            <div className="form-section-title">Vehicle</div>
            <div className="form-field">
              <label>Brand</label>
              <input value={f.car_brand} onChange={set("car_brand")} placeholder="Toyota" />
            </div>
            <div className="form-field">
              <label>Model</label>
              <input value={f.car_model} onChange={set("car_model")} placeholder="Land Cruiser" />
            </div>
            <div className="form-field">
              <label>Year</label>
              <input value={f.car_year} onChange={set("car_year")} placeholder="2023" />
            </div>
            <div className="form-field">
              <label>Plate / Description</label>
              <input value={f.car_plate} onChange={set("car_plate")} placeholder="Kuwait · 12345 · Private" />
            </div>

            <div className="form-section-title">Service</div>
            <div className="form-field">
              <label>Type *</label>
              <select value={f.service_type} onChange={set("service_type")}>
                {SERVICE_TYPES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>Qty</label>
              <input type="number" value={f.qty} onChange={set("qty")} min={1} />
            </div>
            <div className="form-field form-full">
              <label>Item Details</label>
              <input value={f.service_details} onChange={set("service_details")} placeholder="215/60R16 Michelin Pilot Sport 4 · Japan 2025" />
            </div>
            <div className="form-field">
              <label>Item Price (KD)</label>
              <input type="number" value={f.item_price} onChange={set("item_price")} placeholder="38" />
            </div>
            <div className="form-field">
              <label>Total (KD)</label>
              <input type="number" value={f.total} onChange={set("total")} placeholder="172" />
            </div>

            <div className="form-section-title">Scheduling & Assignment</div>
            <div className="form-field">
              <label>Date & Time</label>
              <input type="datetime-local" value={f.scheduled_at} onChange={set("scheduled_at")} />
            </div>
            <div className="form-field">
              <label>Truck</label>
              <select value={f.assigned_truck} onChange={set("assigned_truck")}>
                {TRUCKS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>Technician</label>
              <input value={f.assigned_technician} onChange={set("assigned_technician")} placeholder="Fahad" />
            </div>
            <div className="form-field">
              <label>Sales Agent</label>
              <input value={f.sales_agent} onChange={set("sales_agent")} placeholder="Hussain" />
            </div>

            <div className="form-section-title">Payment & Admin</div>
            <div className="form-field">
              <label>Lead From</label>
              <select value={f.lead_from} onChange={set("lead_from")}>
                {LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>Payment Through</label>
              <select value={f.payment_through} onChange={set("payment_through")}>
                {["Link", "Tabby", "Warranty", "Cash", "KNET"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>Payment Status</label>
              <select value={f.payment_status} onChange={set("payment_status")}>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
              </select>
            </div>
            <div className="form-field">
              <label>Xero PO Ref</label>
              <input value={f.xero_ref} onChange={set("xero_ref")} placeholder="PO-2026-0041" />
            </div>
            <div className="form-field form-full">
              <label>Notes</label>
              <textarea value={f.notes} onChange={set("notes")} placeholder="Tesla jack pads needed, customer has gate code…" />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Create Job"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Job Detail View ──────────────────────────────────────────────────────────
function JobDetail({ job, onBack, onUpdate, role }) {
  const [j, setJ] = useState(job);

  const advanceStatus = async () => {
    const nx = nextStatus(j.status);
    if (!nx) return;
    const patch = { status: nx.key };
    setJ((p) => ({ ...p, ...patch }));
    await updateJob(j.id, patch);
    onUpdate({ ...j, ...patch });
  };

  const toggleCheck = async (idx) => {
    // Enforce sequential — can only check if previous is checked
    if (idx > 0 && !j.checks[idx - 1]) return;
    const checks = [...j.checks];
    checks[idx] = !checks[idx];
    setJ((p) => ({ ...p, checks }));
    await updateJob(j.id, { checks });
    onUpdate({ ...j, checks });
  };

  const nx = nextStatus(j.status);
  const flowIdx = STATUS_FLOW.findIndex((s) => s.key === j.status);

  return (
    <div className="job-detail">
      <button className="detail-back" onClick={onBack}>← Back to jobs</button>

      {/* Hero */}
      <div className="detail-hero">
        <div className="detail-hero-top">
          <div>
            <h2>{j.customer_name}</h2>
            <div className="detail-hero-sub">{j.car_brand} {j.car_model} {j.car_year} · {j.car_plate || "—"}</div>
          </div>
          <StatusPill status={j.status} />
        </div>

        <div className="detail-grid">
          <div className="detail-field">
            <label>Time</label>
            <p>{fmtDate(j.scheduled_at)} at {fmtTime(j.scheduled_at)}</p>
          </div>
          <div className="detail-field">
            <label>Truck / Tech</label>
            <p>{j.assigned_truck} · {j.assigned_technician || "—"}</p>
          </div>
          <div className="detail-field">
            <label>Location</label>
            <p>{j.area}, Block {j.block}, St {j.street}, {j.house}</p>
          </div>
          <div className="detail-field">
            <label>Map</label>
            <p>{j.map_link ? <a href={j.map_link} target="_blank" rel="noreferrer">Open in Maps ↗</a> : "—"}</p>
          </div>
          <div className="detail-field">
            <label>Mobile</label>
            <p><a href={`tel:${j.customer_mobile}`}>{j.customer_mobile}</a></p>
          </div>
          <div className="detail-field">
            <label>Lead From</label>
            <p>{j.lead_from}</p>
          </div>
          <div className="detail-field">
            <label>Service</label>
            <p>{j.service_type} × {j.qty}</p>
          </div>
          <div className="detail-field">
            <label>Total</label>
            <p style={{ color: "var(--accent)", fontWeight: 700 }}>KWD {Number(j.total).toFixed(3)}</p>
          </div>
          <div className="detail-field" style={{ gridColumn: "1/-1" }}>
            <label>Item Details</label>
            <p>{j.service_details || "—"}</p>
          </div>
          {j.notes && (
            <div className="detail-field" style={{ gridColumn: "1/-1" }}>
              <label>Notes</label>
              <p style={{ color: "var(--accent)" }}>⚠ {j.notes}</p>
            </div>
          )}
          <div className="detail-field">
            <label>Payment</label>
            <p>{j.payment_through} · <span style={{ color: j.payment_status === "paid" ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>{j.payment_status}</span></p>
          </div>
          <div className="detail-field">
            <label>Xero PO Ref</label>
            <p>{j.xero_ref || "—"}</p>
          </div>
          <div className="detail-field">
            <label>Sales Agent</label>
            <p>{j.sales_agent || "—"}</p>
          </div>
        </div>
      </div>

      {/* Status flow */}
      <div className="card">
        <div className="card-header">
          <h3>Status Flow</h3>
          {nx && (
            <button className="btn btn-primary btn-sm" onClick={advanceStatus}>
              Advance → {nx.label}
            </button>
          )}
        </div>
        <div className="card-body">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {STATUS_FLOW.map((s, i) => (
              <span key={s.key} style={{
                padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: i < flowIdx ? "#16A34A22" : i === flowIdx ? s.color + "33" : "var(--surface)",
                color: i < flowIdx ? "var(--success)" : i === flowIdx ? s.color : "var(--muted)",
                border: `1px solid ${i === flowIdx ? s.color : "var(--border)"}`,
              }}>
                {i < flowIdx ? "✓ " : ""}{s.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 4-Check system */}
      <div className="card">
        <div className="card-header">
          <h3>4-Check Verification</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{j.checks.filter(Boolean).length}/4 complete</span>
        </div>
        <div className="card-body">
          <div className="checks-list">
            {CHECK_LABELS.map((label, i) => {
              const done = j.checks[i];
              const locked = i > 0 && !j.checks[i - 1];
              return (
                <div
                  key={i}
                  className={`check-item ${done ? "done" : ""} ${locked ? "locked" : ""}`}
                  onClick={() => !locked && toggleCheck(i)}
                >
                  <div className={`check-circle ${done ? "done" : ""}`}>{done ? "✓" : ""}</div>
                  <div className="check-text">
                    <span className="check-num">#{i + 1}</span>{label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Schedule View (Sales / Purchaser / Office) ───────────────────────────────
function ScheduleView({ jobs, onSelectJob, onNewJob, role }) {
  const [filterTruck, setFilterTruck] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDate, setFilterDate] = useState(today());

  const filtered = jobs.filter((j) => {
    if (filterTruck !== "all" && j.assigned_truck !== filterTruck) return false;
    if (filterStatus !== "all" && j.status !== filterStatus) return false;
    if (filterDate && j.scheduled_at) {
      const d = new Date(j.scheduled_at).toISOString().split("T")[0];
      if (d !== filterDate) return false;
    }
    return true;
  });

  const totalKD = filtered.reduce((s, j) => s + Number(j.total || 0), 0);
  const done = filtered.filter((j) => j.status === "done" || j.status === "invoiced" || j.status === "paid").length;

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="num accent">{filtered.length}</div>
          <div className="lbl">Jobs showing</div>
        </div>
        <div className="stat-card">
          <div className="num success">{done}</div>
          <div className="lbl">Completed</div>
        </div>
        <div className="stat-card">
          <div className="num accent">KWD {totalKD.toFixed(3)}</div>
          <div className="lbl">Revenue (shown)</div>
        </div>
        <div className="stat-card">
          <div className="num" style={{ color: "#60A5FA" }}>{jobs.filter(j=>j.payment_status==="paid").length}</div>
          <div className="lbl">Paid</div>
        </div>
      </div>

      <div className="jobs-header">
        <div className="jobs-title">Schedule</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div className="filters">
            <input type="date" className="filter-select" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
            <select className="filter-select" value={filterTruck} onChange={e => setFilterTruck(e.target.value)}>
              <option value="all">All Trucks</option>
              {TRUCKS.map(t => <option key={t}>{t}</option>)}
            </select>
            <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">All Statuses</option>
              {STATUS_FLOW.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={() => setFilterDate("")}>Clear Date</button>
          </div>
          {role === "sales" && (
            <button className="btn btn-primary" onClick={onNewJob}>+ New Job</button>
          )}
        </div>
      </div>

      <div className="job-cards">
        {filtered.length === 0 && (
          <div className="empty"><h3>No jobs</h3><p>Adjust the filters or create a new job.</p></div>
        )}
        {filtered.map((job) => (
          <div key={job.id} className="job-card" onClick={() => onSelectJob(job)}>
            <div className="job-card-top">
              <div>
                <div className="job-card-name">{job.customer_name}</div>
                <div className="job-card-service">{job.service_type} × {job.qty} · {job.car_brand} {job.car_model}</div>
              </div>
              <StatusPill status={job.status} />
            </div>
            <div className="job-card-meta">
              <span className="tag tag-truck">{job.assigned_truck}</span>
              <span className="tag tag-time">{fmtDate(job.scheduled_at)} · {fmtTime(job.scheduled_at)}</span>
              {job.total && <span className="tag tag-total">KWD {Number(job.total).toFixed(3)}</span>}
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{job.area}</span>
              {job.payment_status === "paid"
                ? <span style={{ fontSize: 11, color: "var(--success)", fontWeight: 700 }}>✓ Paid</span>
                : <span style={{ fontSize: 11, color: "var(--danger)", fontWeight: 600 }}>Unpaid</span>
              }
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── My Jobs View (Technician) ────────────────────────────────────────────────
function MyJobsView({ jobs, role, onSelectJob }) {
  const [myTruck, setMyTruck] = useState("T2");
  const myJobs = jobs
    .filter(j => j.assigned_truck === myTruck)
    .filter(j => {
      const d = j.scheduled_at ? new Date(j.scheduled_at).toISOString().split("T")[0] : "";
      return d === today();
    })
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

  return (
    <>
      <div className="jobs-header">
        <div className="jobs-title">My Jobs — {fmtDate(new Date().toISOString())}</div>
        <select className="filter-select" value={myTruck} onChange={e => setMyTruck(e.target.value)}>
          {TRUCKS.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>
      {myJobs.length === 0 && (
        <div className="empty"><h3>No jobs today</h3><p>You're all clear for {myTruck}.</p></div>
      )}
      <div className="job-cards">
        {myJobs.map((job, i) => (
          <div key={job.id} className="my-job-card" onClick={() => onSelectJob(job)}>
            <div className="my-job-header">
              <div className="my-job-num">#{i + 1}</div>
              <StatusPill status={job.status} />
            </div>
            <div className="my-job-body">
              <p><strong>{job.customer_name}</strong> · <a href={`tel:${job.customer_mobile}`} style={{ color: "var(--accent)" }}>{job.customer_mobile}</a></p>
              <p><strong>Time:</strong> {fmtTime(job.scheduled_at)}</p>
              <p><strong>Address:</strong> {job.area}, Block {job.block}, St {job.street}, House {job.house}</p>
              <p><strong>Car:</strong> {job.car_brand} {job.car_model} {job.car_year} · {job.car_plate || "—"}</p>
              <p><strong>Service:</strong> {job.service_type} × {job.qty}</p>
              <p style={{ color: "var(--muted)", fontSize: 12 }}>{job.service_details}</p>
              {job.notes && <p style={{ color: "var(--accent)", marginTop: 6 }}>⚠ {job.notes}</p>}
            </div>
            {job.map_link
              ? <a className="map-btn" href={job.map_link} target="_blank" rel="noreferrer">📍 Open in Maps</a>
              : <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>No map link — contact sales</div>
            }
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Distributor View ─────────────────────────────────────────────────────────
function DistributorView({ jobs, onSelectJob }) {
  const [localData, setLocalData] = useState({});
  const todayJobs = jobs.filter(j => {
    const d = j.scheduled_at ? new Date(j.scheduled_at).toISOString().split("T")[0] : "";
    return d === today() || j.status === "part_ready" || j.status === "assigned";
  });

  const toggle = (id, field) => {
    setLocalData(p => ({ ...p, [id]: { ...(p[id] || {}), [field]: !(p[id]?.[field]) } }));
  };

  return (
    <>
      <div className="jobs-header">
        <div className="jobs-title">Parts & Logistics</div>
      </div>
      {todayJobs.length === 0 && (
        <div className="empty"><h3>No active orders</h3><p>Nothing to collect today.</p></div>
      )}
      {todayJobs.map(job => {
        const ld = localData[job.id] || {};
        return (
          <div key={job.id} className="dist-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <h4>{job.customer_name} — {job.service_type} × {job.qty}</h4>
              <StatusPill status={job.status} />
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{job.service_details}</div>

            <div className="dist-row">
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Collect from supplier</div>
                <div style={{ fontSize: 13 }}>{job.xero_ref ? `Ref: ${job.xero_ref}` : "No PO ref"}</div>
              </div>
            </div>
            <div className="dist-row">
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Deliver to</div>
                <div style={{ fontSize: 13 }}>{job.assigned_truck} · Meet at {job.area}</div>
              </div>
            </div>
            <div className="dist-row">
              <span style={{ fontSize: 13 }}>Collected ✓</span>
              <button className={`toggle-btn ${ld.collected ? "on" : "off"}`} onClick={() => toggle(job.id, "collected")} />
            </div>
            <div className="dist-row">
              <span style={{ fontSize: 13 }}>Delivered to Truck ✓</span>
              <button className={`toggle-btn ${ld.delivered ? "on" : "off"}`} onClick={() => toggle(job.id, "delivered")} />
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => onSelectJob(job)}>View Full Job</button>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(false);
  const [role, setRole] = useState("sales");
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("schedule");
  const [selectedJob, setSelectedJob] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [usingMock, setUsingMock] = useState(false);

  const login = () => {
    if (pw === PASSWORD) { setAuthed(true); setPwErr(false); }
    else setPwErr(true);
  };

  useEffect(() => {
    if (!authed) return;
    setLoading(true);
    fetchJobs().then(data => {
      const isMock = data.some(j => j.id?.startsWith("mock-"));
      setUsingMock(isMock);
      setJobs(data);
      setLoading(false);
    });
  }, [authed]);

  // Set default tab per role
  useEffect(() => {
    if (role === "technician") setTab("myjobs");
    else if (role === "distributor") setTab("distributor");
    else setTab("schedule");
  }, [role]);

  const handleJobUpdate = (updated) => {
    setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));
    if (selectedJob?.id === updated.id) setSelectedJob(updated);
  };

  if (!authed) {
    return (
      <>
        <StyleTag />
        <div className="login-wrap">
          <div className="login-box">
            <h1>BNCHR<span>+</span></h1>
            <p>Scheduling System · Internal</p>
            <div className="role-grid">
              {ROLES.map(r => (
                <button key={r.key} className={`role-btn ${role === r.key ? "active" : ""}`} onClick={() => setRole(r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
            <input
              type="password" placeholder="Team password"
              value={pw} onChange={e => setPw(e.target.value)}
              onKeyDown={e => e.key === "Enter" && login()}
            />
            {pwErr && <div className="login-error">Incorrect password.</div>}
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={login}>Enter</button>
          </div>
        </div>
      </>
    );
  }

  const tabs = [
    { key: "schedule", label: "Schedule", roles: ["sales", "purchaser"] },
    { key: "myjobs",   label: "My Jobs",  roles: ["technician"] },
    { key: "distributor", label: "Parts & Logistics", roles: ["distributor"] },
    { key: "schedule", label: "Schedule", roles: ["distributor"] },
  ].filter((t, i, arr) => t.roles.includes(role) && arr.findIndex(x => x.key === t.key && x.roles.includes(role)) === i);

  return (
    <>
      <StyleTag />
      <div className="app">
        <div className="topbar">
          <div className="topbar-left">
            <div className="logo">BNCHR<span>+</span></div>
            <span className="badge-role">{role}</span>
            <nav className="nav-tabs">
              {tabs.map(t => (
                <button key={t.key} className={`nav-tab ${tab === t.key ? "active" : ""}`} onClick={() => { setTab(t.key); setSelectedJob(null); }}>
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="topbar-right">
            {usingMock && <span style={{ fontSize: 11, color: "var(--accent)", border: "1px solid var(--accent)", borderRadius: 6, padding: "2px 8px" }}>Demo Data</span>}
            <button className="btn-logout" onClick={() => { setAuthed(false); setPw(""); }}>Sign out</button>
          </div>
        </div>

        <div className="main">
          {loading && <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>Loading…</div>}
          {!loading && selectedJob && (
            <JobDetail
              job={selectedJob}
              role={role}
              onBack={() => setSelectedJob(null)}
              onUpdate={handleJobUpdate}
            />
          )}
          {!loading && !selectedJob && tab === "schedule" && (
            <ScheduleView
              jobs={jobs}
              role={role}
              onSelectJob={setSelectedJob}
              onNewJob={() => setShowNew(true)}
            />
          )}
          {!loading && !selectedJob && tab === "myjobs" && (
            <MyJobsView jobs={jobs} role={role} onSelectJob={setSelectedJob} />
          )}
          {!loading && !selectedJob && tab === "distributor" && (
            <DistributorView jobs={jobs} onSelectJob={setSelectedJob} />
          )}
        </div>
      </div>

      {showNew && (
        <NewJobModal
          onClose={() => setShowNew(false)}
          onCreated={(j) => { setJobs(prev => [j, ...prev]); }}
        />
      )}
    </>
  );
}
