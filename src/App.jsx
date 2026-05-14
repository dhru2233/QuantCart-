import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { auth, db, googleProvider } from "./firebase";
import {
  signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut,
  onAuthStateChanged, updateProfile,
} from "firebase/auth";
import {
  collection, addDoc, onSnapshot, doc, deleteDoc,
  setDoc, getDoc, updateDoc, writeBatch,
  query, orderBy, serverTimestamp,
} from "firebase/firestore";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  STATUS_FLOW, SM, PRODUCTS, CATS, RIDERS, NAMES, AREAS, DARK_STORE,
  rand, pick, ts, fmtINR as rupee, C
} from "./constants";
import {
  scheduleOrderAdvancement, resumeOrderAdvancement,
  advanceOrder, cancelOrderAdvancement,
} from "./orderengine";

/* ─── Leaflet icons ──────────────────────────────────────────────── */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});
const mkDivIcon = html => L.divIcon({ className: "", html, iconSize: [38, 38], iconAnchor: [19, 19] });
const ICONS = {
  rider: mkDivIcon(`<div style="background:#B44FFF;border:3px solid #fff;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 14px rgba(180,79,255,0.6)">🛵</div>`),
  store: mkDivIcon(`<div style="background:#0A0A12;border:3px solid #B44FFF;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 14px rgba(180,79,255,0.4)">🏪</div>`),
  home: mkDivIcon(`<div style="background:#00E5B0;border:3px solid #fff;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 14px rgba(0,229,176,0.5)">🏠</div>`),
};

/* ─── Theme tokens ───────────────────────────────────────────────── */
const {
  yellow: ACCENT, black: BK, green: GN, red: RD, blue: BL,
  gray1: G1, gray2: G2, gray3: G3, gray4: G4, white: WH,
  orange: OR, purple: PU, dark2: DK2, dark3: DK3,
} = C;

const DARK_STORE_POS = DARK_STORE.pos;

/* ─── Style helpers ──────────────────────────────────────────────── */
// Card: glass-morphism style with subtle purple border
const card = {
  background: WH,
  borderRadius: 16,
  padding: 20,
  border: `1px solid ${G2}`,
  boxShadow: "0 2px 16px rgba(180,79,255,0.07)",
};

const btn = (bg, fg = WH, p = "9px 18px") => ({
  cursor: "pointer", border: "none", borderRadius: 10, padding: p,
  fontWeight: 700, fontSize: 13, background: bg, color: fg,
  transition: "all .18s", fontFamily: "inherit",
});

const pill = (bg, fg = WH) => ({
  display: "inline-block", background: bg, color: fg,
  borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600,
});

const inp = {
  width: "100%", padding: "10px 13px", borderRadius: 10,
  border: `1.5px solid ${G2}`, fontSize: 13, outline: "none",
  boxSizing: "border-box", fontFamily: "inherit",
  transition: "border-color .18s",
};

/* ─── CSS animations & global styles ────────────────────────────── */
const GLOBAL_CSS = `
  @keyframes shimmer{0%{background-position:-600px 0}100%{background-position:600px 0}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes neonPulse{0%,100%{box-shadow:0 0 8px rgba(180,79,255,0.4)}50%{box-shadow:0 0 22px rgba(180,79,255,0.8)}}
  @keyframes gradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
  @keyframes riderFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
  input:focus { border-color: #B44FFF !important; box-shadow: 0 0 0 3px rgba(180,79,255,0.15) !important; }
  select:focus { border-color: #B44FFF !important; outline: none; }
`;

/* ─── Skeleton ───────────────────────────────────────────────────── */
const Sk = ({ w = "100%", h = 14, r = 8, mb = 0 }) => (
  <div style={{
    width: w, height: h, borderRadius: r, marginBottom: mb,
    background: "linear-gradient(90deg,#ede8ff 25%,#e0d8ff 50%,#ede8ff 75%)",
    backgroundSize: "600px 100%", animation: "shimmer 1.4s ease infinite"
  }} />
);

/* ─── Toast ──────────────────────────────────────────────────────── */
function Toast({ t }) {
  if (!t) return null;
  const bg = { danger: RD, success: GN, order: PU, warning: OR }[t.type] || G4;
  return (
    <div style={{
      position: "fixed", top: 68, right: 16, zIndex: 9999,
      background: bg, color: WH, padding: "12px 18px", borderRadius: 14,
      fontWeight: 600, fontSize: 13, maxWidth: 300,
      boxShadow: `0 8px 28px rgba(0,0,0,0.25)`,
      animation: "fadeUp .3s ease", border: "1px solid rgba(255,255,255,0.2)"
    }}>
      {t.msg}
    </div>
  );
}

/* ─── Logo mark ──────────────────────────────────────────────────── */
const Logo = ({ size = 18, style = {} }) => (
  <div style={{
    background: "linear-gradient(135deg,#B44FFF,#7B2FE0)",
    borderRadius: 10, padding: `4px ${size < 20 ? 10 : 14}px`,
    fontWeight: 900, fontSize: size, color: WH,
    letterSpacing: 1.5, display: "inline-block",
    boxShadow: "0 4px 14px rgba(180,79,255,0.35)",
    ...style,
  }}>
    Q<span style={{ color: "#B44FFF", background: "#fff", borderRadius: 4, padding: "0 3px", marginLeft: 1 }}>C</span>
    <span style={{ marginLeft: 4, fontWeight: 400, fontSize: size - 2, letterSpacing: .5, opacity: .85 }}>QuantCart</span>
  </div>
);

/* ─── Geolocation ────────────────────────────────────────────────── */
function useGeo() {
  const [g, setG] = useState({ address: "Detecting...", lat: null, lng: null, loading: true });
  useEffect(() => {
    if (!navigator.geolocation) { setG(p => ({ ...p, address: "Location unavailable", loading: false })); return; }
    const ok = async pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
        const d = await r.json();
        const a = d.address || {};
        const parts = [a.road || a.neighbourhood, a.suburb || a.city_district, a.city || a.town].filter(Boolean);
        setG({ address: parts.slice(0, 2).join(", ") || "Your location", lat, lng, loading: false });
      } catch { setG({ address: `${lat.toFixed(3)},${lng.toFixed(3)}`, lat, lng, loading: false }); }
    };
    const err = () => setG({ address: "Enable location", lat: 28.5355, lng: 77.3910, loading: false });
    navigator.geolocation.getCurrentPosition(ok, err, { timeout: 10000 });
    const w = navigator.geolocation.watchPosition(ok, err, { timeout: 15000, maximumAge: 60000 });
    return () => navigator.geolocation.clearWatch(w);
  }, []);
  return g;
}

/* ─── Tracker ────────────────────────────────────────────────────── */
function Tracker({ order }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center" }}>
        {STATUS_FLOW.map((s, i) => {
          const done = i <= order.statusIdx, curr = i === order.statusIdx, after = i < order.statusIdx;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", flex: i < STATUS_FLOW.length - 1 ? 1 : "none" }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: done ? SM[s].color : G2,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, color: done ? WH : G3, fontWeight: 700,
                border: `2px solid ${curr ? SM[s].color : done ? "transparent" : G2}`,
                flexShrink: 0, transition: "all .4s",
                boxShadow: curr ? `0 0 0 4px ${SM[s].color}35, 0 0 12px ${SM[s].color}50` : "none",
                animation: curr ? "neonPulse 2s ease infinite" : "none",
              }}>
                {curr ? SM[s].icon : done ? "✓" : i + 1}
              </div>
              {i < STATUS_FLOW.length - 1 && (
                <div style={{
                  flex: 1, height: 3, borderRadius: 2,
                  background: after
                    ? `linear-gradient(90deg,${SM[STATUS_FLOW[i]].color},${SM[STATUS_FLOW[i + 1]].color})`
                    : G2,
                  transition: "background .5s",
                  boxShadow: after ? `0 0 6px ${SM[STATUS_FLOW[i]].color}60` : "none",
                }} />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
        {STATUS_FLOW.map((s, i) => (
          <div key={s} style={{
            flex: 1, fontSize: 7,
            textAlign: i === 0 ? "left" : i === STATUS_FLOW.length - 1 ? "right" : "center",
            color: i <= order.statusIdx ? G4 : G3,
            fontWeight: i === order.statusIdx ? 700 : 400, lineHeight: 1.2,
          }}>
            {SM[s].label}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Map ────────────────────────────────────────────────────────── */
function FlyTo({ pos }) {
  const map = useMap();
  useEffect(() => { if (pos) map.flyTo(pos, 14, { duration: 1 }); }, [pos, map]);
  return null;
}
function RiderMap({ order, destPos }) {
  const [pos, setPos] = useState(DARK_STORE_POS);
  const step = useRef(0);
  const STEPS = 30;
  useEffect(() => {
    if (order.statusIdx < 4) { setPos(DARK_STORE_POS); step.current = 0; return; }
    if (order.statusIdx >= 5) { setPos(destPos); return; }
    step.current = 0;
    const iv = setInterval(() => {
      step.current = Math.min(step.current + 1, STEPS);
      const t = step.current / STEPS;
      setPos([DARK_STORE_POS[0] + (destPos[0] - DARK_STORE_POS[0]) * t, DARK_STORE_POS[1] + (destPos[1] - DARK_STORE_POS[1]) * t]);
      if (step.current >= STEPS) clearInterval(iv);
    }, 200);
    return () => clearInterval(iv);
  }, [order.statusIdx, destPos]);
  return (
    <div style={{ borderRadius: 16, overflow: "hidden", border: `1px solid ${G2}`, boxShadow: "0 4px 20px rgba(180,79,255,0.15)" }}>
      <MapContainer center={DARK_STORE_POS} zoom={13} style={{ height: 220, width: "100%" }} zoomControl={false} scrollWheelZoom={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Marker position={DARK_STORE_POS} icon={ICONS.store} />
        <Marker position={destPos} icon={ICONS.home} />
        <Marker position={pos} icon={ICONS.rider} />
        <Polyline positions={[DARK_STORE_POS, destPos]} pathOptions={{ color: ACCENT, weight: 3, dashArray: "8 6", opacity: .9 }} />
        <FlyTo pos={pos} />
      </MapContainer>
      <div style={{ padding: "6px 12px", background: WH, fontSize: 11, color: G3, display: "flex", gap: 14, justifyContent: "center" }}>
        <span>🏪 Store</span><span>🛵 Rider</span><span>🏠 You</span>
      </div>
    </div>
  );
}

/* ─── Countdown ──────────────────────────────────────────────────── */
function Countdown({ eta, status }) {
  const [secs, setSecs] = useState((eta || 10) * 60);
  useEffect(() => {
    if (status === "delivered") return;
    const iv = setInterval(() => setSecs(p => Math.max(0, p - 1)), 1000);
    return () => clearInterval(iv);
  }, [status]);
  const m = Math.floor(secs / 60), s = secs % 60;
  const pct = secs / ((eta || 10) * 60);
  const r = 40, circ = 2 * Math.PI * r;
  return (
    <svg width={96} height={96}>
      <defs>
        <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#B44FFF" />
          <stop offset="100%" stopColor="#4FC3FF" />
        </linearGradient>
      </defs>
      <circle cx={48} cy={48} r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={6} />
      <circle cx={48} cy={48} r={r} fill="none" stroke="url(#ringGrad)" strokeWidth={6}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
        strokeLinecap="round" transform="rotate(-90 48 48)"
        style={{ transition: "stroke-dashoffset 1s linear", filter: "drop-shadow(0 0 6px rgba(180,79,255,0.7))" }} />
      <text x={48} y={44} textAnchor="middle" fontSize={20} fontWeight={800} fill={WH}>{m}:{s.toString().padStart(2, "0")}</text>
      <text x={48} y={60} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.7)">mins left</text>
    </svg>
  );
}

/* ─── Pay Modal ──────────────────────────────────────────────────── */
function PayModal({ total, onSuccess, onClose }) {
  const [step, setStep] = useState("choose");
  const [upi, setUpi] = useState("");
  const [card, setCard] = useState({ num: "", exp: "", cvv: "" });
  const finalTotal = total + Math.round(total * 0.02);

  const process = method => {
    setStep("processing");
    setTimeout(() => { setStep("done"); setTimeout(() => onSuccess(method, finalTotal), 1200); }, 2000);
  };

  const hdrGrad = "linear-gradient(135deg,#1E1A3A,#2D1B5E)";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,10,18,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 600, padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: WH, borderRadius: 22, width: "100%", maxWidth: 360, overflow: "hidden", boxShadow: "0 28px 70px rgba(180,79,255,0.3), 0 8px 24px rgba(0,0,0,0.4)" }}>
        <div style={{ background: hdrGrad, padding: "18px 22px", borderBottom: "1px solid rgba(180,79,255,0.3)" }}>
          <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>Secure Checkout · QuantCart</div>
          <div style={{ color: WH, fontWeight: 900, fontSize: 24, marginTop: 4 }}>{rupee(finalTotal)}</div>
          <div style={{ color: "rgba(180,79,255,0.8)", fontSize: 11, marginTop: 2 }}>incl. 2% tax · free delivery</div>
        </div>

        {step === "choose" && (
          <div style={{ padding: 22 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14, color: BK }}>Choose payment method</div>
            {[
              { id: "upi", icon: "📱", label: "UPI / GPay / PhonePe", sub: "Instant, no charges", accent: "#B44FFF" },
              { id: "card", icon: "💳", label: "Credit / Debit Card", sub: "Visa, Mastercard, RuPay", accent: "#4FC3FF" },
              { id: "cod", icon: "💵", label: "Cash on Delivery", sub: "Pay when delivered", accent: "#00E5B0" },
            ].map(m => (
              <div key={m.id} onClick={() => m.id === "cod" ? process("COD") : setStep(m.id)}
                style={{
                  display: "flex", gap: 14, alignItems: "center", padding: "12px 14px", borderRadius: 14,
                  border: `1.5px solid ${G2}`, marginBottom: 9, cursor: "pointer", transition: "all .2s"
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = m.accent; e.currentTarget.style.background = G1; e.currentTarget.style.boxShadow = `0 4px 16px ${m.accent}25`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = G2; e.currentTarget.style.background = WH; e.currentTarget.style.boxShadow = "none"; }}>
                <span style={{ fontSize: 24 }}>{m.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{m.label}</div>
                  <div style={{ fontSize: 11, color: G3 }}>{m.sub}</div>
                </div>
                <span style={{ color: G3, fontSize: 16 }}>›</span>
              </div>
            ))}
          </div>
        )}

        {step === "upi" && (
          <div style={{ padding: 22 }}>
            <button onClick={() => setStep("choose")} style={{ ...btn("transparent", G3, "0"), fontSize: 12, marginBottom: 14 }}>← Back</button>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Enter UPI ID</div>
            <input value={upi} onChange={e => setUpi(e.target.value)} placeholder="name@okicici" style={{ ...inp, marginBottom: 12 }} />
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {["GPay", "PhonePe", "Paytm", "BHIM"].map(a => (
                <button key={a} onClick={() => setUpi(`demo@${a.toLowerCase()}`)}
                  style={{ padding: "5px 12px", borderRadius: 20, border: `1px solid ${G2}`, background: G1, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{a}</button>
              ))}
            </div>
            <button onClick={() => upi && process("UPI")}
              style={{ ...btn(upi ? "linear-gradient(135deg,#B44FFF,#7B2FE0)" : G2, upi ? WH : G3, "12px 0"), width: "100%", borderRadius: 12, boxShadow: upi ? "0 4px 16px rgba(180,79,255,0.4)" : "none" }}>
              Pay {rupee(finalTotal)}
            </button>
          </div>
        )}

        {step === "card" && (
          <div style={{ padding: 22 }}>
            <button onClick={() => setStep("choose")} style={{ ...btn("transparent", G3, "0"), fontSize: 12, marginBottom: 14 }}>← Back</button>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Card Details</div>
            <input value={card.num} onChange={e => setCard(p => ({ ...p, num: e.target.value.replace(/\D/g, "").slice(0, 16) }))} placeholder="Card number" style={{ ...inp, marginBottom: 9 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 16 }}>
              <input value={card.exp} onChange={e => setCard(p => ({ ...p, exp: e.target.value }))} placeholder="MM/YY" style={inp} />
              <input value={card.cvv} onChange={e => setCard(p => ({ ...p, cvv: e.target.value.slice(0, 4) }))} placeholder="CVV" style={inp} />
            </div>
            <button onClick={() => card.num.length >= 16 && process("Card")}
              style={{ ...btn(card.num.length >= 16 ? "linear-gradient(135deg,#4FC3FF,#1A73E8)" : G2, card.num.length >= 16 ? WH : G3, "12px 0"), width: "100%", borderRadius: 12 }}>
              Pay {rupee(finalTotal)}
            </button>
          </div>
        )}

        {step === "processing" && (
          <div style={{ padding: 52, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 14, display: "inline-block", animation: "spin 1s linear infinite" }}>⚙️</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: BK }}>Processing payment...</div>
            <div style={{ color: G3, fontSize: 12, marginTop: 6 }}>Secured by QuantCart</div>
          </div>
        )}
        {step === "done" && (
          <div style={{ padding: 52, textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 800, fontSize: 18, color: GN }}>Payment Successful!</div>
            <div style={{ color: G3, fontSize: 13, marginTop: 6 }}>{rupee(finalTotal)} paid</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LOGIN PAGE
═══════════════════════════════════════════════════════════════════ */
function LoginPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("customer");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [loading, setL] = useState(false);
  const [err, setErr] = useState("");
  const ADMIN = "admin@quantcart.com";

  const saveUser = async (u, r) => {
    await setDoc(doc(db, "users", u.uid), {
      name: u.displayName || name || email.split("@")[0],
      email: u.email || "", phone: u.phoneNumber || "",
      role: r, photo: u.photoURL || "", updatedAt: serverTimestamp(),
    }, { merge: true });
  };

  const gLogin = async () => {
    setL(true); setErr("");
    try { const r = await signInWithPopup(auth, googleProvider); const r2 = r.user.email === ADMIN ? "admin" : "customer"; await saveUser(r.user, r2); onLogin(r.user, r2); }
    catch (e) { setErr(e.message); } finally { setL(false); }
  };

  const eLogin = async () => {
    if (!email || !pw) { setErr("Fill all fields"); return; }
    setL(true); setErr("");
    try {
      let u;
      if (mode === "signup") { u = await createUserWithEmailAndPassword(auth, email, pw); if (name) await updateProfile(u.user, { displayName: name }); }
      else { u = await signInWithEmailAndPassword(auth, email, pw); }
      const r2 = email === ADMIN || role === "admin" ? "admin" : "customer";
      await saveUser(u.user, r2); onLogin(u.user, r2);
    } catch (e) {
      const m = { "auth/user-not-found": "No account found", "auth/wrong-password": "Wrong password", "auth/email-already-in-use": "Email already registered", "auth/weak-password": "Password too weak" };
      setErr(m[e.code] || e.message);
    } finally { setL(false); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(145deg,#0A0A12 0%,#1a0b2e 50%,#0D0A1F 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "'Segoe UI',system-ui,sans-serif", position: "relative", overflow: "hidden" }}>
      {/* Decorative orbs */}
      <div style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle,rgba(180,79,255,0.12),transparent 70%)", top: -100, right: -80, pointerEvents: "none" }} />
      <div style={{ position: "absolute", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle,rgba(79,195,255,0.08),transparent 70%)", bottom: -50, left: -60, pointerEvents: "none" }} />

      <div style={{ width: "100%", maxWidth: 420, position: "relative", zIndex: 1 }}>
        {/* Brand hero */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "rgba(180,79,255,0.12)", border: "1px solid rgba(180,79,255,0.3)", borderRadius: 16, padding: "12px 28px", marginBottom: 12 }}>
            <span style={{ fontSize: 28, animation: "riderFloat 2s ease infinite" }}>🛵</span>
            <span style={{ fontWeight: 900, fontSize: 28, color: WH, letterSpacing: 2 }}>QuantCart</span>
          </div>
          <div style={{ color: "rgba(180,79,255,0.7)", fontSize: 13, fontWeight: 500 }}>⚡ Quantum-speed grocery delivery</div>
        </div>

        <div style={{ background: "rgba(255,255,255,0.97)", borderRadius: 22, padding: 28, boxShadow: "0 28px 80px rgba(180,79,255,0.25), 0 8px 24px rgba(0,0,0,0.4)", border: "1px solid rgba(180,79,255,0.15)" }}>
          {/* Role toggle */}
          <div style={{ display: "flex", gap: 6, marginBottom: 22, background: G1, borderRadius: 12, padding: 4 }}>
            {["customer", "admin"].map(r => (
              <button key={r} onClick={() => setRole(r)} style={{
                flex: 1, padding: "8px 0", borderRadius: 9, border: "none",
                background: role === r ? "linear-gradient(135deg,#B44FFF,#7B2FE0)" : "transparent",
                fontWeight: 700, fontSize: 12, color: role === r ? WH : G3, cursor: "pointer",
                boxShadow: role === r ? "0 4px 12px rgba(180,79,255,0.35)" : "none",
                transition: "all .2s",
              }}>
                {r === "admin" ? "🛡️ Admin" : "🛒 Customer"}
              </button>
            ))}
          </div>

          <h2 style={{ fontWeight: 800, fontSize: 20, marginBottom: 3, color: BK }}>{mode === "login" ? "Welcome back!" : "Create account"}</h2>
          <p style={{ color: G3, fontSize: 12, marginBottom: 18 }}>{mode === "login" ? "Sign in to QuantCart" : "Join QuantCart today"}</p>

          {err && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "9px 12px", fontSize: 12, color: RD, marginBottom: 14, fontWeight: 600 }}>{err}</div>}

          {mode === "signup" && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: G3, display: "block", marginBottom: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>Full Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" style={inp} />
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: G3, display: "block", marginBottom: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={role === "admin" ? "admin@quantcart.com" : "you@gmail.com"} style={inp} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, color: G3, display: "block", marginBottom: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>Password</label>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="••••••••" style={inp} onKeyDown={e => e.key === "Enter" && eLogin()} />
          </div>

          <button onClick={eLogin} disabled={loading} style={{ ...btn("linear-gradient(135deg,#B44FFF,#7B2FE0)", WH, "13px 0"), width: "100%", borderRadius: 12, boxShadow: "0 6px 20px rgba(180,79,255,0.4)", opacity: loading ? .65 : 1, fontSize: 14 }}>
            {loading ? "⚙️ Loading..." : mode === "login" ? "Sign In →" : "Create Account →"}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0" }}>
            <div style={{ flex: 1, height: 1, background: G2 }} /><span style={{ fontSize: 11, color: G3 }}>or</span><div style={{ flex: 1, height: 1, background: G2 }} />
          </div>

          <button onClick={gLogin} disabled={loading} style={{ ...btn(G1, G4, "11px 0"), border: `1.5px solid ${G2}`, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 12 }}>
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width={16} height={16} alt="G" />
            Continue with Google
          </button>

          <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: G3 }}>
            {mode === "login" ? "Don't have an account? " : "Already registered? "}
            <span onClick={() => { setMode(p => p === "login" ? "signup" : "login"); setErr(""); }} style={{ color: PU, fontWeight: 700, cursor: "pointer" }}>
              {mode === "login" ? "Sign up free" : "Sign in"}
            </span>
          </div>

          {role === "admin" && <div style={{ marginTop: 14, background: "#F5F0FF", border: "1px solid #D8B4FE", borderRadius: 10, padding: "8px 12px", fontSize: 11, color: "#6B21A8", textAlign: "center" }}>Use: admin@quantcart.com</div>}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ADMIN PANEL
═══════════════════════════════════════════════════════════════════ */
function AdminPanel({ user, store }) {
  const { inv, orders, users, notifications, adminToast, pushN } = store;

  const [tab, setTab] = useState("live");
  const [liveOn, setLiveOn] = useState(true);
  const [selOrder, setSelOrder] = useState(null);
  const [invSearch, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});
  const [stockMod, setStockMod] = useState(null);
  const [sAdj, setSAdj] = useState({ type: "IN", qty: "", note: "" });
  const [imgOk, setImgOk] = useState({});
  const liveRef = useRef();

  const active = orders.filter(o => o.status !== "delivered");
  const delivered = orders.filter(o => o.status === "delivered");
  const revenue = delivered.reduce((a, o) => a + (o.total || 0), 0);
  const outOfStock = inv.filter(i => i.qty === 0);
  const lowStock = inv.filter(i => i.qty > 0 && i.qty <= i.msL);

  // Neon purple admin header gradient
  const adminHeaderBg = "linear-gradient(135deg,#1E1A3A,#2D1B5E)";

  /* ── Simulation ── */
  useEffect(() => {
    if (!liveOn || inv.length === 0) return;
    liveRef.current = setInterval(async () => {
      const avail = inv.filter(i => i.qty > 0);
      if (!avail.length) return;
      const items = [...avail].sort(() => Math.random() - .5).slice(0, rand(1, 3)).map(p => ({ sku: p.sku, name: p.name, emoji: p.emoji, qty: rand(1, 2), price: p.price }));
      const customer = pick(NAMES), area = pick(AREAS), total = items.reduce((a, i) => a + i.qty * i.price, 0);
      const oid = `ORD-${rand(300, 999)}`, rider = pick(RIDERS);
      const o = { id: oid, customer, area, items, total, status: "placed", statusIdx: 0, rider, time: ts(), eta: rand(8, 14), paymentMethod: "COD", log: [{ status: "placed", time: ts(), msg: "Order placed!" }], createdAt: serverTimestamp() };
      try {
        const ref = await addDoc(collection(db, "orders"), o);
        items.forEach(async itm => { const ii = inv.find(i => i.sku === itm.sku); if (ii) await updateDoc(doc(db, "inventory", ii.fid), { qty: Math.max(0, ii.qty - itm.qty) }); });
        pushN(`📱 New order ${oid} from ${customer} — ${rupee(total)}`, "order", "admin");
        scheduleOrderAdvancement(ref.id, ns => {
          if (ns === "error") pushN(`❌ ${oid} update failed`, "danger", "admin");
          else pushN(`${SM[ns]?.icon || ""} ${oid} → ${SM[ns]?.label || ns}`, "info", "admin");
        });
      } catch (e) { console.error("sim order error:", e); }
    }, rand(12000, 18000));
    return () => clearInterval(liveRef.current);
  }, [liveOn, inv]);

  /* ── Heartbeat ── */
  useEffect(() => {
    if (!liveOn || orders.length === 0) return;
    const iv = setInterval(() => {
      orders.filter(o => o.status !== "delivered").forEach(o => {
        const age = Date.now() - (o.createdAt?.seconds * 1000 || Date.now());
        if (age > 20000 && o.fid) resumeOrderAdvancement(o, ns => { if (ns !== "error") pushN(`⚡ Resumed ${o.id} → ${SM[ns]?.label}`, "info", "admin"); });
      });
    }, 15000);
    return () => clearInterval(iv);
  }, [liveOn, orders.length]);

  const saveInv = async () => {
    if (!form.name || !form.sku || !form.price || !form.qty) { pushN("Fill required fields", "danger", "admin"); return; }
    const e = { ...form, price: +form.price, cost: +form.cost || 0, qty: +form.qty, msL: +form.msL || 10 };
    try {
      if (editId) { await setDoc(doc(db, "inventory", String(editId)), e, { merge: true }); }
      else { const nid = Date.now(); await setDoc(doc(db, "inventory", String(nid)), { ...e, id: nid }); }
      pushN(editId ? "Product updated ✅" : "Product added ✅", "success", "admin");
      setShowForm(false); setEditId(null);
    } catch (er) { pushN("Error: " + er.message, "danger", "admin"); }
  };

  const adjStock = async () => {
    if (!sAdj.qty || +sAdj.qty <= 0) { pushN("Enter valid qty", "danger", "admin"); return; }
    const q = +sAdj.qty, item = inv.find(i => i.id === stockMod.id || i.fid === stockMod.fid);
    if (!item) { pushN("Item not found", "danger", "admin"); return; }
    const newQty = sAdj.type === "IN" ? item.qty + q : Math.max(0, item.qty - q);
    try {
      await updateDoc(doc(db, "inventory", item.fid || String(item.id)), { qty: newQty });
      pushN(`Stock ${sAdj.type}: ${stockMod.name} → ${newQty}`, "success", "admin");
      setStockMod(null);
    } catch (e) { pushN("Error: " + e.message, "danger", "admin"); }
  };

  const delProduct = async item => {
    if (!window.confirm("Delete this product?")) return;
    try { await deleteDoc(doc(db, "inventory", item.fid || String(item.id))); pushN("Deleted", "success", "admin"); }
    catch (e) { pushN("Error: " + e.message, "danger", "admin"); }
  };

  const NAVS = [
    { id: "live", label: "Live Orders", badge: active.length },
    { id: "inventory", label: "Inventory", badge: outOfStock.length + lowStock.length },
    { id: "customers", label: "Customers", badge: users.length },
    { id: "stores", label: "Local Stores", badge: 1 },
    { id: "analytics", label: "Analytics", badge: 0 },
    { id: "log", label: "Activity", badge: 0 },
  ];

  return (
    <div style={{ minHeight: "100%", background: G1, fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <Toast t={adminToast} />

      {/* Header */}
      <div style={{ background: adminHeaderBg, padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 58, position: "sticky", top: 0, zIndex: 40, boxShadow: "0 4px 20px rgba(180,79,255,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ background: "rgba(180,79,255,0.2)", border: "1px solid rgba(180,79,255,0.4)", borderRadius: 10, padding: "4px 14px", fontWeight: 900, fontSize: 16, color: WH, letterSpacing: 1.5 }}>QuantCart</div>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 500 }}>Admin · Saket Delhi</span>
          <div style={{ display: "flex", alignItems: "center", gap: 5, background: liveOn ? "rgba(0,229,176,0.12)" : "rgba(255,61,107,0.12)", borderRadius: 20, padding: "3px 10px", border: `1px solid ${liveOn ? "rgba(0,229,176,0.35)" : "rgba(255,61,107,0.35)"}` }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: liveOn ? GN : RD, animation: liveOn ? "pulse 1.5s ease infinite" : "none" }} />
            <span style={{ fontSize: 11, color: liveOn ? GN : RD, fontWeight: 700 }}>{liveOn ? "LIVE" : "PAUSED"}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{orders.length} orders · <strong style={{ color: WH }}>{rupee(revenue)}</strong></span>
          <button onClick={() => { active.forEach(o => { if (o.fid) resumeOrderAdvancement(o, ns => pushN(`🛠️ Fixed ${o.id}`, "success", "admin")); }); }}
            style={{ ...btn("rgba(255,255,255,0.1)", WH, "6px 12px"), border: "1px solid rgba(255,255,255,0.2)", fontSize: 11 }}>🛠️ Fix Stuck</button>
          <button onClick={() => setLiveOn(p => !p)} style={{ ...btn(liveOn ? "rgba(255,61,107,0.8)" : "rgba(0,229,176,0.8)", WH, "6px 14px"), borderRadius: 8 }}>{liveOn ? "⏸ Pause" : "▶ Resume"}</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: DK3, borderBottom: `1px solid rgba(180,79,255,0.2)`, padding: "0 16px", display: "flex", gap: 2, overflowX: "auto" }}>
        {NAVS.map(n => (
          <button key={n.id} onClick={() => setTab(n.id)} style={{
            ...btn("transparent", tab === n.id ? WH : "rgba(255,255,255,0.4)", "11px 14px"),
            borderBottom: tab === n.id ? `2.5px solid ${ACCENT}` : "2.5px solid transparent",
            borderRadius: 0, fontWeight: tab === n.id ? 700 : 500, fontSize: 13, whiteSpace: "nowrap",
          }}>
            {n.label}
            {n.badge > 0 && <span style={{ ...pill(RD), fontSize: 9, marginLeft: 5, padding: "1px 5px" }}>{n.badge}</span>}
          </button>
        ))}
      </div>

      <div style={{ padding: 16 }}>

        {/* LIVE ORDERS */}
        {tab === "live" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
              {[{ l: "Active", v: active.length, c: ACCENT }, { l: "Delivered", v: delivered.length, c: GN }, { l: "Revenue", v: rupee(revenue), c: BL }, { l: "Alerts", v: outOfStock.length + lowStock.length, c: RD }].map(k => (
                <div key={k.l} style={{ ...card, borderTop: `3px solid ${k.c}`, padding: 14, boxShadow: `0 4px 16px ${k.c}15` }}>
                  <div style={{ fontSize: 10, color: G3, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".5px" }}>{k.l}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: BK }}>{k.v}</div>
                </div>
              ))}
            </div>
            {orders.length === 0 && (
              <div style={{ ...card, textAlign: "center", padding: 60, color: G3 }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>⏳</div>
                <div style={{ fontWeight: 600, fontSize: 15, color: G4 }}>Waiting for orders...</div>
              </div>
            )}
            <div style={{ display: "grid", gap: 10 }}>
              {orders.map(o => (
                <div key={o.fid} onClick={() => setSelOrder(o)}
                  style={{
                    ...card, borderLeft: `4px solid ${SM[o.status]?.color || G2}`, cursor: "pointer", transition: "all .18s",
                    boxShadow: `0 2px 12px ${SM[o.status]?.color || G3}15`
                  }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 6px 24px ${SM[o.status]?.color || G3}30`; e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = `0 2px 12px ${SM[o.status]?.color || G3}15`; e.currentTarget.style.transform = "none"; }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <span style={{ fontWeight: 800, fontSize: 14, color: BK }}>{o.id}</span>
                      <span style={{ color: G3, fontSize: 12, marginLeft: 8 }}>{o.customer} · {o.area}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ ...pill(SM[o.status]?.color || G3), padding: "4px 10px" }}>{SM[o.status]?.label}</span>
                      <span style={{ fontWeight: 800, color: GN, fontSize: 14 }}>{rupee(o.total)}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  </div>
                  <Tracker order={o} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* INVENTORY */}
        {tab === "inventory" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 800, color: BK }}>Inventory</h2>
                <p style={{ color: G3, fontSize: 12, marginTop: 2 }}>{inv.length} products · <span style={{ color: RD }}>{outOfStock.length} out</span> · <span style={{ color: "#D97706" }}>{lowStock.length} low</span></p>
              </div>
              <button onClick={() => { setForm({ name: "", sku: "", cat: "Dairy", emoji: "📦", img: "", price: "", cost: "", qty: "", msL: "", vendor: "", desc: "" }); setEditId(null); setShowForm(true); }}
                style={{ ...btn("linear-gradient(135deg,#B44FFF,#7B2FE0)", WH, "9px 18px"), boxShadow: "0 4px 14px rgba(180,79,255,0.35)", borderRadius: 10 }}>
                + Add Product
              </button>
            </div>
            <input placeholder="Search products..." value={invSearch} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: 260, marginBottom: 14 }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(175px,1fr))", gap: 12 }}>
              {inv.filter(i => (i.name || "").toLowerCase().includes(invSearch.toLowerCase())).map(item => {
                const st = item.qty === 0 ? "out" : item.qty <= item.msL ? "low" : "ok";
                return (
                  <div key={item.fid || item.id} style={{ background: WH, borderRadius: 14, overflow: "hidden", border: `1px solid ${G2}`, boxShadow: "0 2px 8px rgba(180,79,255,0.06)", transition: "all .2s" }}
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 8px 24px rgba(180,79,255,0.15)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(180,79,255,0.06)"; e.currentTarget.style.transform = "none"; }}>
                    <div style={{ position: "relative", height: 120, overflow: "hidden", background: G1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {!imgOk[item.id] && <Sk h={120} r={0} />}
                      {item.img && <img src={item.img} alt={item.name} onLoad={() => setImgOk(p => ({ ...p, [item.id]: true }))} onError={() => setImgOk(p => ({ ...p, [item.id]: true }))} style={{ width: "100%", height: 120, objectFit: "cover", display: imgOk[item.id] ? "block" : "none" }} />}
                      {!imgOk[item.id] && <span style={{ position: "absolute", fontSize: 36 }}>{item.emoji}</span>}
                      {st !== "ok" && <div style={{ position: "absolute", top: 7, right: 7, ...pill(st === "out" ? RD : "#F59E0B", st === "out" ? WH : BK), fontSize: 9 }}>{st === "out" ? "OUT" : "LOW"}</div>}
                    </div>
                    <div style={{ padding: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: BK, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                      <div style={{ fontSize: 10, color: G3, marginBottom: 8 }}>{item.cat} · <strong style={{ color: st === "out" ? RD : st === "low" ? "#D97706" : GN }}>Qty: {item.qty}</strong></div>
                      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8, color: PU }}>{rupee(item.price)}</div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => { setStockMod(item); setSAdj({ type: "IN", qty: "", note: "" }); }} style={{ ...btn(GN, WH, "4px 0"), flex: 1, fontSize: 10, borderRadius: 7 }}>Stock</button>
                        <button onClick={() => { setForm({ ...item, price: String(item.price), cost: String(item.cost || 0), qty: String(item.qty), msL: String(item.msL || 10) }); setEditId(item.id || item.fid); setShowForm(true); }} style={{ ...btn(BL, WH, "4px 0"), flex: 1, fontSize: 10, borderRadius: 7 }}>Edit</button>
                        <button onClick={() => delProduct(item)} style={{ ...btn("#FEF2F2", RD, "4px 0"), border: `1px solid #FECACA`, flex: 1, fontSize: 10, borderRadius: 7 }}>Del</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ANALYTICS */}
        {tab === "analytics" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: BK }}>Analytics Dashboard</h2>
              <div style={{ fontSize: 11, color: G3 }}>Last updated: {ts()}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 16 }}>
              <div style={card}>
                <div style={{ fontSize: 10, color: G3, fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>Total Revenue</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: GN }}>{rupee(revenue)}</div>
                <div style={{ fontSize: 10, color: G3, marginTop: 4 }}>from {delivered.length} orders</div>
              </div>
              <div style={card}>
                <div style={{ fontSize: 10, color: G3, fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>Avg Order Value</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: PU }}>{rupee(delivered.length ? Math.round(revenue / delivered.length) : 0)}</div>
                <div style={{ fontSize: 10, color: G3, marginTop: 4 }}>per successful delivery</div>
              </div>
              <div style={card}>
                <div style={{ fontSize: 10, color: G3, fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>Inventory Value</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: BL }}>{rupee(inv.reduce((a, i) => a + (i.qty * i.price), 0))}</div>
                <div style={{ fontSize: 10, color: G3, marginTop: 4 }}>across {inv.length} items</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div style={card}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: PU }}>Inventory Health</div>
                {[{ l: "Healthy", v: inv.filter(i => i.qty > i.msL).length, c: GN }, { l: "Low Stock", v: lowStock.length, c: "#D97706" }, { l: "Out of Stock", v: outOfStock.length, c: RD }].map(r => (
                  <div key={r.l} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}><span style={{ color: G3 }}>{r.l}</span><span style={{ color: r.c, fontWeight: 700 }}>{r.v}</span></div>
                    <div style={{ background: G2, borderRadius: 6, height: 6 }}><div style={{ background: r.c, width: inv.length ? `${(r.v / inv.length) * 100}%` : "0%", height: 6, borderRadius: 6, transition: "width .5s", boxShadow: `0 0 6px ${r.c}80` }} /></div>
                  </div>
                ))}
              </div>
              <div style={card}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: PU }}>Stock Metrics</div>
                {[{ l: "Inventory Cost", v: rupee(inv.reduce((a, i) => a + (i.qty || 0) * (i.cost || 0), 0)), c: PU }, { l: "Potential Sales", v: rupee(inv.reduce((a, i) => a + (i.qty || 0) * (i.price || 0), 0)), c: GN }, { l: "Target Fill Rate", v: "98.5%", c: BL }].map(r => (
                  <div key={r.l} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${G1}`, fontSize: 13 }}>
                    <span style={{ color: G3 }}>{r.l}</span><span style={{ fontWeight: 700, color: r.c }}>{r.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* CUSTOMERS */}
        {tab === "customers" && (
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: BK, marginBottom: 14 }}>Customers ({users.length})</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {users.map(u => (
                <div key={u.fid} style={{ ...card, display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#B44FFF,#7B2FE0)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: WH, fontWeight: 900 }}>{u.name?.charAt(0) || "U"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name || "Unknown User"}</div>
                    <div style={{ color: G3, fontSize: 11 }}>{u.email} · {u.role === "admin" ? "🛡️ Admin" : "🛒 Customer"}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: G3 }}>Orders</div>
                    <div style={{ fontWeight: 800, color: PU }}>{orders.filter(o => o.userId === u.fid).length}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STORES */}
        {tab === "stores" && (
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: BK, marginBottom: 14 }}>Dark Stores</h2>
            <div style={{ ...card, borderLeft: `4px solid ${ACCENT}`, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{DARK_STORE.name}</div>
                  <div style={{ color: G3, fontSize: 12 }}>{DARK_STORE.address}</div>
                </div>
                <span style={{ ...pill(GN), height: "fit-content" }}>Active</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ background: G1, padding: 10, borderRadius: 10 }}>
                  <div style={{ fontSize: 10, color: G3, textTransform: "uppercase" }}>Current Capacity</div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{Math.round((inv.reduce((a, i) => a + i.qty, 0) / 5000) * 100)}% Used</div>
                </div>
                <div style={{ background: G1, padding: 10, borderRadius: 10 }}>
                  <div style={{ fontSize: 10, color: G3, textTransform: "uppercase" }}>Orders Today</div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{orders.length}</div>
                </div>
              </div>
            </div>
            <div style={{ background: "rgba(180,79,255,0.05)", border: `1.5px dashed ${G2}`, borderRadius: 16, padding: 30, textAlign: "center" }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>🏪</div>
              <div style={{ color: G3, fontSize: 13, fontWeight: 600 }}>Expansion Mode: Scaling to South Delhi next month</div>
            </div>
          </div>
        )}

        {/* ACTIVITY LOG */}
        {tab === "log" && (
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: BK, marginBottom: 14 }}>Activity Log</h2>
            {notifications.length === 0 && <div style={{ ...card, textAlign: "center", padding: 40, color: G3 }}>No activity yet</div>}
            <div style={{ display: "grid", gap: 6 }}>
              {notifications.map(n => (
                <div key={n.id} style={{ background: WH, borderRadius: 10, padding: "9px 13px", borderLeft: `3px solid ${n.type === "danger" ? RD : n.type === "success" ? GN : n.type === "order" ? PU : OR}`, display: "flex", justifyContent: "space-between", gap: 8, border: `1px solid ${G2}` }}>
                  <span style={{ fontSize: 12, color: G4 }}>{n.msg}</span>
                  <span style={{ fontSize: 10, color: G3, whiteSpace: "nowrap" }}>{n.time}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Order detail modal */}
      {selOrder && (() => {
        const o = orders.find(x => x.fid === selOrder.fid) || selOrder;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(10,10,18,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setSelOrder(null); }}>
            <div style={{ background: WH, borderRadius: 20, padding: 22, width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 28px 70px rgba(180,79,255,0.25)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <div><div style={{ fontWeight: 800, fontSize: 16 }}>{o.id}</div><div style={{ color: G3, fontSize: 12, marginTop: 2 }}>{o.customer} · {o.area} · {o.time}</div></div>
                <button onClick={() => setSelOrder(null)} style={{ ...btn(G1, G4, "4px 12px"), fontSize: 12 }}>✕</button>
              </div>
              <Tracker order={o} />
              <div style={{ marginTop: 14 }}>
                {(o.items || []).map(i => (
                  <div key={i.sku} style={{ display: "flex", justifyContent: "space-between", background: G1, borderRadius: 8, padding: "8px 12px", marginBottom: 6, fontSize: 13 }}>
                    <span style={{ color: G4 }}>{i.emoji} {i.name} ×{i.qty}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 15, padding: "11px 0", borderTop: `1px solid ${G2}` }}>
                  <span style={{ color: G3 }}>Total</span><span style={{ color: GN }}>{rupee(o.total)}</span>
                </div>
              </div>
              {o.rider && (
                <div style={{ marginTop: 10, background: G1, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: G4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>🛵 <strong>{o.rider.name}</strong> · ⭐{o.rider.rating}</span>
                  <a href={`tel:${o.rider.phone}`} style={{ color: BL, textDecoration: "none", fontWeight: 700 }}>📞 Call</a>
                </div>
              )}
              {o.statusIdx < STATUS_FLOW.length - 1 && (
                <div style={{ marginTop: 16, borderTop: `1px solid ${G2}`, paddingTop: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: G3, marginBottom: 10, textTransform: "uppercase" }}>Manual Controls</div>
                  <button onClick={async () => {
                    const nextIdx = o.statusIdx + 1, nextStatus = STATUS_FLOW[nextIdx], docId = o.fid;
                    if (!docId) { pushN("Cannot advance: missing Firestore ID", "danger", "admin"); return; }
                    try { cancelOrderAdvancement(docId); await advanceOrder(docId, nextIdx); pushN(`Order ${o.id} → ${SM[nextStatus].label}`, "success", "admin"); }
                    catch (e) { pushN("Failed: " + e.message, "danger", "admin"); }
                  }} style={{ ...btn("linear-gradient(135deg,#B44FFF,#7B2FE0)", WH, "12px 0"), width: "100%", borderRadius: 12, boxShadow: "0 4px 16px rgba(180,79,255,0.4)" }}>
                    Advance to: <strong>{SM[STATUS_FLOW[o.statusIdx + 1]].label}</strong> →
                  </button>
                  <p style={{ fontSize: 10, color: G3, textAlign: "center", marginTop: 8 }}>Manual advancement cancels the auto-timer.</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Add/Edit modal */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,10,18,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div style={{ background: WH, borderRadius: 20, padding: 22, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 28px 70px rgba(180,79,255,0.25)" }}>
            <h3 style={{ marginBottom: 14, fontWeight: 800, fontSize: 16 }}>{editId ? "Edit Product" : "Add New Product"}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[{ l: "Name *", k: "name", t: "text", f: true }, { l: "SKU *", k: "sku", t: "text" }, { l: "Emoji", k: "emoji", t: "text" }, { l: "Image URL", k: "img", t: "text", f: true }, { l: "MRP ₹ *", k: "price", t: "number" }, { l: "Cost ₹", k: "cost", t: "number" }, { l: "Stock *", k: "qty", t: "number" }, { l: "Min Level", k: "msL", t: "number" }, { l: "Vendor", k: "vendor", t: "text", f: true }, { l: "Description", k: "desc", t: "text", f: true }].map(f => (
                <div key={f.k} style={{ gridColumn: f.f ? "span 2" : "span 1" }}>
                  <label style={{ fontSize: 11, color: G3, display: "block", marginBottom: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>{f.l}</label>
                  <input type={f.t} value={form[f.k] || ""} onChange={e => setForm(p => ({ ...p, [f.k]: e.target.value }))} style={inp} />
                </div>
              ))}
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ fontSize: 11, color: G3, display: "block", marginBottom: 4, fontWeight: 700, textTransform: "uppercase" }}>Category</label>
                <select value={form.cat || "Dairy"} onChange={e => setForm(p => ({ ...p, cat: e.target.value }))} style={{ ...inp, background: WH }}>{CATS.slice(1).map(c => <option key={c}>{c}</option>)}</select>
              </div>
            </div>
            {form.img && <img src={form.img} alt="" style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 10, marginTop: 10 }} />}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={saveInv} style={{ ...btn("linear-gradient(135deg,#B44FFF,#7B2FE0)", WH, "11px 0"), flex: 1, fontWeight: 700, borderRadius: 10, boxShadow: "0 4px 14px rgba(180,79,255,0.35)" }}>{editId ? "Save Changes" : "Add Product"}</button>
              <button onClick={() => setShowForm(false)} style={{ ...btn(G1, G4, "11px 0"), border: `1px solid ${G2}`, flex: 1, borderRadius: 10 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Stock modal */}
      {stockMod && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,10,18,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setStockMod(null); }}>
          <div style={{ background: WH, borderRadius: 20, padding: 22, width: "100%", maxWidth: 340, boxShadow: "0 28px 70px rgba(180,79,255,0.25)" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
              {stockMod.img && <img src={stockMod.img} alt="" width={52} height={52} style={{ borderRadius: 10, objectFit: "cover" }} />}
              <div><div style={{ fontWeight: 800, fontSize: 15 }}>{stockMod.name}</div><div style={{ color: G3, fontSize: 12 }}>Current: <strong>{stockMod.qty}</strong></div></div>
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {[["IN", GN, WH], ["OUT", RD, WH], ["DAMAGE", "#F59E0B", BK]].map(([t, bg, fg]) => (
                <button key={t} onClick={() => setSAdj(p => ({ ...p, type: t }))} style={{ ...btn(sAdj.type === t ? bg : G1, sAdj.type === t ? fg : G4, "8px 0"), flex: 1, border: `1px solid ${sAdj.type === t ? bg : G2}`, fontWeight: 700, borderRadius: 8 }}>{t}</button>
              ))}
            </div>
            <input value={sAdj.note} onChange={e => setSAdj(p => ({ ...p, note: e.target.value }))} placeholder="Reason (optional)" style={{ ...inp, marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={adjStock} style={{ ...btn(sAdj.type === "IN" ? GN : sAdj.type === "OUT" ? RD : "#F59E0B", sAdj.type === "DAMAGE" ? BK : WH, "11px 0"), flex: 1, fontWeight: 700, borderRadius: 8 }}>Confirm</button>
              <button onClick={() => setStockMod(null)} style={{ ...btn(G1, G4, "11px 0"), border: `1px solid ${G2}`, flex: 1, borderRadius: 8 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CUSTOMER PANEL
═══════════════════════════════════════════════════════════════════ */
function CustomerPanel({ user, store }) {
  const { inv, orders, custToast, pushN } = store;
  const geo = useGeo();
  const [page, setPage] = useState("home");
  const [cat, setCat] = useState("All");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]);
  const [selProd, setSelProd] = useState(null);
  const [myIds, setMyIds] = useState(() => { try { return JSON.parse(sessionStorage.getItem("myOrderIds") || "[]"); } catch { return []; } });
  const [trackId, setTrackId] = useState(null);
  const [showPay, setShowPay] = useState(false);
  const [pending, setPending] = useState(null);
  const [imgOk, setImgOk] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (!store.loading) setLoading(false); }, [store.loading]);
  useEffect(() => { try { sessionStorage.setItem("myOrderIds", JSON.stringify(myIds)); } catch { } }, [myIds]);

  const myOrders = useMemo(() => orders.filter(o => myIds.includes(o.id) || o.userId === user.uid), [orders, myIds, user.uid]);

  const addCart = (item, qty = 1) => setCart(p => { const ex = p.find(x => x.sku === item.sku); if (ex) return p.map(x => x.sku === item.sku ? { ...x, qty: Math.min(x.qty + qty, item.qty) } : x); return [...p, { ...item, qty }]; });
  const removeCart = sku => setCart(p => p.filter(x => x.sku !== sku));
  const changeQty = (sku, d) => setCart(p => p.map(x => x.sku === sku ? { ...x, qty: Math.max(1, x.qty + d) } : x));
  const cartTotal = cart.reduce((a, i) => a + i.qty * i.price, 0);
  const cartCount = cart.reduce((a, i) => a + i.qty, 0);
  const cartFinal = cartTotal + Math.round(cartTotal * 0.02);

  const initiateCheckout = () => {
    if (!cart.length) return;
    setPending(cart.map(c => ({ sku: c.sku, name: c.name, emoji: c.emoji, qty: c.qty, price: c.price, img: c.img || "" })));
    setShowPay(true);
  };

  const onPaySuccess = async (method, chargedTotal) => {
    setShowPay(false);
    if (!pending) return;
    const oid = `ORD-${rand(300, 999)}`, rider = pick(RIDERS);
    const o = { id: oid, customer: user.displayName || user.email, userId: user.uid, area: geo.address.split(",")[0] || "Delhi", items: pending, total: chargedTotal, status: "placed", statusIdx: 0, rider, time: ts(), eta: rand(8, 14), paymentMethod: method, isCustomer: true, log: [{ status: "placed", time: ts(), msg: "Your order has been placed!" }], createdAt: serverTimestamp() };
    try {
      const ref = await addDoc(collection(db, "orders"), o);
      pending.forEach(async itm => { const ii = inv.find(i => i.sku === itm.sku); if (ii) await updateDoc(doc(db, "inventory", ii.fid), { qty: Math.max(0, ii.qty - itm.qty) }); });
      setMyIds(p => [oid, ...p]); setCart([]); setPending(null);
      setTrackId(oid); setPage("tracking");
      pushN(`✅ Order ${oid} placed! ETA ~${o.eta} mins`, "success", "cust");
      scheduleOrderAdvancement(ref.id, ns => { if (ns !== "error") pushN(`${SM[ns]?.icon || ""} ${oid}: ${SM[ns]?.msg || ns}`, "info", "cust"); });
    } catch (e) { pushN("Order failed: " + e.message, "danger", "cust"); }
  };

  const filtered = useMemo(() => inv.filter(i => i.qty > 0 && (cat === "All" || i.cat === cat) && i.name.toLowerCase().includes(search.toLowerCase())), [inv, cat, search]);

  /* Hero gradient cycling */
  const heroStyle = {
    background: "linear-gradient(145deg,#0A0A12 0%,#1a0b2e 50%,#0D0A1F 100%)",
    padding: "26px 18px 30px", position: "relative", overflow: "hidden",
  };

  return (
    <div style={{ minHeight: "100%", background: G1, fontFamily: "'Segoe UI',system-ui,sans-serif", color: BK }}>
      <Toast t={custToast} />
      {showPay && <PayModal total={cartTotal} onSuccess={onPaySuccess} onClose={() => setShowPay(false)} />}

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#1E1A3A,#2D1B5E)", padding: "0 14px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, position: "sticky", top: 0, zIndex: 40, boxShadow: "0 4px 20px rgba(180,79,255,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ background: "rgba(180,79,255,0.2)", border: "1px solid rgba(180,79,255,0.4)", borderRadius: 10, padding: "4px 14px", fontWeight: 900, fontSize: 16, color: WH, letterSpacing: 1.5, cursor: "pointer" }} onClick={() => setPage("home")}>QuantCart</div>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.15)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <span style={{ fontSize: 13 }}>📍</span>
            <div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>Deliver to</div>
              <div style={{ fontSize: 11, color: WH, fontWeight: 700, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{geo.loading ? "Detecting..." : geo.address}</div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setPage("orders")} style={{ ...btn("rgba(255,255,255,0.1)", WH, "6px 12px"), border: "1px solid rgba(255,255,255,0.2)", fontSize: 12, borderRadius: 8 }}>
            Orders
            {myOrders.filter(o => o.status !== "delivered").length > 0 && (
              <span style={{ ...pill(PU), fontSize: 9, marginLeft: 5, padding: "1px 5px" }}>{myOrders.filter(o => o.status !== "delivered").length}</span>
            )}
          </button>
          <button onClick={() => setPage("cart")} style={{ ...btn("linear-gradient(135deg,#B44FFF,#7B2FE0)", WH, "6px 14px"), fontWeight: 700, fontSize: 13, borderRadius: 10, boxShadow: "0 4px 14px rgba(180,79,255,0.4)" }}>
            🛒{cartCount > 0 ? ` (${cartCount}) · ${rupee(cartFinal)}` : " Cart"}
          </button>
        </div>
      </div>

      {/* HOME */}
      {page === "home" && (
        <div>
          {/* Hero */}
          <div style={heroStyle}>
            {/* Orbs */}
            <div style={{ position: "absolute", width: 250, height: 250, borderRadius: "50%", background: "radial-gradient(circle,rgba(180,79,255,0.15),transparent 70%)", top: -60, right: -40, pointerEvents: "none" }} />
            <div style={{ position: "absolute", width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle,rgba(79,195,255,0.1),transparent 70%)", bottom: -40, left: 20, pointerEvents: "none" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative", zIndex: 1 }}>
              <div>
                <div style={{ fontSize: 10, color: ACCENT, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8, textTransform: "uppercase", background: "rgba(180,79,255,0.12)", border: "1px solid rgba(180,79,255,0.3)", borderRadius: 20, padding: "3px 12px", display: "inline-block" }}>⚡ Quantum Commerce</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: WH, lineHeight: 1.2, marginBottom: 8 }}>
                  Delivered in{" "}
                  <span style={{ background: "linear-gradient(135deg,#B44FFF,#4FC3FF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>10 minutes</span>
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>📍</span> {geo.loading ? "Detecting..." : geo.address}
                </div>
              </div>
              <div style={{ fontSize: 64, flexShrink: 0, animation: "riderFloat 2.5s ease infinite" }}>🛵</div>
            </div>
          </div>

          <div style={{ padding: "14px 14px 0" }}>
            {/* Search */}
            <div style={{ position: "relative", marginBottom: 14 }}>
              <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 15, color: G3 }}>🔍</span>
              <input placeholder="Search groceries..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, paddingLeft: 36, borderRadius: 12 }} />
            </div>

            {/* Category pills */}
            <div style={{ display: "flex", gap: 7, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
              {CATS.map(c => (
                <button key={c} onClick={() => setCat(c)} style={{
                  ...btn(cat === c ? "linear-gradient(135deg,#B44FFF,#7B2FE0)" : WH, cat === c ? WH : G4, "6px 14px"),
                  border: `1px solid ${cat === c ? "transparent" : G2}`, fontSize: 12,
                  fontWeight: cat === c ? 700 : 500, whiteSpace: "nowrap", flexShrink: 0,
                  borderRadius: 20, boxShadow: cat === c ? "0 4px 14px rgba(180,79,255,0.35)" : "none",
                  transition: "all .2s",
                }}>{c}</button>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: BK }}>{cat === "All" ? "All Products" : cat}</div>
              <div style={{ fontSize: 11, color: G3 }}>{filtered.length} items</div>
            </div>

            {/* Product grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 11, paddingBottom: 20 }}>
              {loading && [1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} style={{ background: WH, borderRadius: 14, overflow: "hidden", border: `1px solid ${G2}` }}>
                  <Sk h={135} r={0} /><div style={{ padding: 11 }}><Sk h={11} mb={6} /><Sk w="55%" h={10} mb={9} /><Sk h={32} r={8} /></div>
                </div>
              ))}
              {!loading && filtered.map(item => {
                const inCart = cart.find(x => x.sku === item.sku);
                return (
                  <div key={item.fid || item.id} style={{ background: WH, borderRadius: 14, overflow: "hidden", border: `1px solid ${G2}`, boxShadow: "0 2px 10px rgba(180,79,255,0.06)", transition: "all .2s" }}
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 8px 26px rgba(180,79,255,0.15)"; e.currentTarget.style.transform = "translateY(-3px)"; }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 2px 10px rgba(180,79,255,0.06)"; e.currentTarget.style.transform = "none"; }}>
                    <div onClick={() => { setSelProd(item); setPage("product"); }} style={{ background: G1, height: 135, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative", cursor: "pointer" }}>
                      {!imgOk[item.id] && <Sk h={135} r={0} />}
                      <img src={item.img} alt={item.name} onLoad={() => setImgOk(p => ({ ...p, [item.id]: true }))} onError={e => { e.target.style.display = "none"; setImgOk(p => ({ ...p, [item.id]: true })); }} style={{ width: "100%", height: 135, objectFit: "cover", display: imgOk[item.id] ? "block" : "none" }} />
                      {imgOk[item.id] && !item.img && <span style={{ fontSize: 44 }}>{item.emoji}</span>}
                      {item.qty < 10 && <div style={{ position: "absolute", top: 7, left: 7, background: "linear-gradient(135deg,#FF8C42,#FF3D6B)", color: WH, borderRadius: 8, padding: "2px 8px", fontSize: 9, fontWeight: 700 }}>Only {item.qty} left</div>}
                    </div>
                    <div style={{ padding: "9px 11px" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2, color: BK, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                      <div style={{ fontSize: 10, color: G3, marginBottom: 7 }}>{item.desc}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontWeight: 900, fontSize: 14, color: PU }}>{rupee(item.price)}</span>
                        <span style={{ fontSize: 9, color: GN, fontWeight: 600 }}>{item.qty} in stock</span>
                      </div>
                      {inCart ? (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(135deg,#B44FFF,#7B2FE0)", borderRadius: 10, padding: "4px 8px" }}>
                          <button onClick={() => changeQty(item.sku, -1)} style={{ ...btn("rgba(255,255,255,0.15)", WH, "0 8px"), fontSize: 17, fontWeight: 900 }}>−</button>
                          <span style={{ fontWeight: 800, fontSize: 13, color: WH }}>{inCart.qty}</span>
                          <button onClick={() => addCart(item)} style={{ ...btn("rgba(255,255,255,0.15)", WH, "0 8px"), fontSize: 17, fontWeight: 900 }}>+</button>
                        </div>
                      ) : (
                        <button onClick={() => addCart(item)} style={{ ...btn("linear-gradient(135deg,#B44FFF,#7B2FE0)", WH, "7px 0"), width: "100%", fontSize: 12, fontWeight: 700, borderRadius: 10, boxShadow: "0 3px 10px rgba(180,79,255,0.3)", transition: "all .2s" }}>+ Add</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* PRODUCT DETAIL */}
      {page === "product" && selProd && (() => {
        const item = inv.find(i => i.id === selProd.id) || selProd;
        const inCart = cart.find(x => x.sku === item.sku);
        return (
          <div style={{ padding: 14, maxWidth: 500, margin: "0 auto" }}>
            <button onClick={() => setPage("home")} style={{ ...btn(WH, G4, "6px 13px"), border: `1px solid ${G2}`, marginBottom: 12, fontSize: 12, borderRadius: 10 }}>← Back</button>
            <div style={{ ...card, overflow: "hidden", padding: 0 }}>
              <div style={{ height: 240, overflow: "hidden", background: G1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {!imgOk[`p${item.id}`] && <Sk h={240} r={0} />}
                <img src={item.img} alt={item.name} onLoad={() => setImgOk(p => ({ ...p, [`p${item.id}`]: true }))} style={{ width: "100%", height: 240, objectFit: "cover", display: imgOk[`p${item.id}`] ? "block" : "none" }} />
              </div>
              <div style={{ padding: 18 }}>
                <div style={{ fontWeight: 800, fontSize: 19, marginBottom: 3 }}>{item.name}</div>
                <div style={{ color: G3, fontSize: 13, marginBottom: 10 }}>{item.desc}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <span style={{ fontSize: 22, fontWeight: 900, color: PU }}>{rupee(item.price)}</span>
                  <span style={{ fontSize: 11, color: GN, fontWeight: 600 }}>{item.qty} in stock</span>
                </div>
                {inCart ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 22, background: "linear-gradient(135deg,#B44FFF,#7B2FE0)", borderRadius: 14, padding: "14px 18px", boxShadow: "0 6px 20px rgba(180,79,255,0.4)" }}>
                    <button onClick={() => changeQty(item.sku, -1)} style={{ ...btn("rgba(255,255,255,0.15)", WH, "0 14px"), fontSize: 22, fontWeight: 900, borderRadius: 8 }}>−</button>
                    <span style={{ fontWeight: 800, fontSize: 17, color: WH }}>{inCart.qty} in cart</span>
                    <button onClick={() => addCart(item)} style={{ ...btn("rgba(255,255,255,0.15)", WH, "0 14px"), fontSize: 22, fontWeight: 900, borderRadius: 8 }}>+</button>
                  </div>
                ) : (
                  <button onClick={() => addCart(item)} style={{ ...btn("linear-gradient(135deg,#B44FFF,#7B2FE0)", WH, "12px 0"), width: "100%", fontSize: 14, fontWeight: 700, borderRadius: 12, boxShadow: "0 6px 20px rgba(180,79,255,0.4)" }}>🛒 Add to Cart — {rupee(item.price)}</button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* CART */}
      {page === "cart" && (
        <div style={{ padding: 14, maxWidth: 480, margin: "0 auto" }}>
          <button onClick={() => setPage("home")} style={{ ...btn(WH, G4, "6px 13px"), border: `1px solid ${G2}`, marginBottom: 12, fontSize: 12, borderRadius: 10 }}>← Continue Shopping</button>
          <h2 style={{ fontWeight: 800, fontSize: 19, marginBottom: 13 }}>Your Cart 🛒</h2>
          {cart.length === 0 && (
            <div style={{ textAlign: "center", padding: 56, color: G3 }}>
              <div style={{ fontSize: 48, marginBottom: 10 }}>🛒</div>
              <div style={{ fontWeight: 600, fontSize: 15, color: G4 }}>Cart is empty</div>
              <button onClick={() => setPage("home")} style={{ ...btn("linear-gradient(135deg,#B44FFF,#7B2FE0)", WH, "11px 24px"), marginTop: 14, fontWeight: 700, borderRadius: 10, boxShadow: "0 4px 14px rgba(180,79,255,0.35)" }}>Shop Now</button>
            </div>
          )}
          {cart.map(item => (
            <div key={item.sku} style={{ ...card, display: "flex", gap: 11, alignItems: "center", marginBottom: 8, padding: 11 }}>
              <img src={item.img || ""} alt="" width={54} height={54} style={{ borderRadius: 10, objectFit: "cover", flexShrink: 0, background: G1 }} />
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13 }}>{item.name}</div><div style={{ color: G3, fontSize: 11, marginTop: 1 }}>{rupee(item.price)} each</div></div>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: G1, borderRadius: 10, padding: "4px 9px", border: `1px solid ${G2}` }}>
                  <button onClick={() => changeQty(item.sku, -1)} style={{ ...btn("transparent", G4, "0 4px"), fontSize: 16, fontWeight: 800 }}>−</button>
                  <span style={{ fontWeight: 700, minWidth: 16, textAlign: "center" }}>{item.qty}</span>
                  <button onClick={() => addCart(item)} style={{ ...btn("transparent", PU, "0 4px"), fontSize: 16, fontWeight: 800 }}>+</button>
                </div>
                <span style={{ fontWeight: 800, fontSize: 13, minWidth: 44, textAlign: "right", color: PU }}>{rupee(item.qty * item.price)}</span>
                <button onClick={() => removeCart(item.sku)} style={{ ...btn(WH, RD, "3px 7px"), border: `1px solid #FECACA`, fontSize: 13, borderRadius: 7 }}>✕</button>
              </div>
            </div>
          ))}
          {cart.length > 0 && (
            <div style={{ ...card, marginTop: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12 }}>Order Summary</div>
              {[{ l: "Subtotal", v: rupee(cartTotal) }, { l: "Delivery fee", v: "FREE 🎉" }, { l: "Taxes (2%)", v: rupee(Math.round(cartTotal * 0.02)) }].map(r => (
                <div key={r.l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 7, fontSize: 13 }}><span style={{ color: G3 }}>{r.l}</span><span style={{ color: r.v === "FREE 🎉" ? GN : BK, fontWeight: r.v === "FREE 🎉" ? 700 : 400 }}>{r.v}</span></div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: 17, padding: "11px 0", borderTop: `2px solid ${G2}`, marginTop: 6 }}><span>Total</span><span style={{ color: PU }}>{rupee(cartFinal)}</span></div>
              <div style={{ background: "linear-gradient(135deg,rgba(180,79,255,0.07),rgba(79,195,255,0.04))", borderRadius: 10, padding: 10, marginBottom: 14, fontSize: 12, color: PU, border: `1px solid ${G2}` }}>⚡ ~{rand(8, 14)} min delivery · 📍 {geo.address}</div>
              <button onClick={initiateCheckout} style={{ ...btn("linear-gradient(135deg,#B44FFF,#7B2FE0)", WH, "13px 0"), width: "100%", fontSize: 14, fontWeight: 700, borderRadius: 12, boxShadow: "0 6px 20px rgba(180,79,255,0.4)" }}>⚡ Pay — {rupee(cartFinal)}</button>
            </div>
          )}
        </div>
      )}

      {/* ORDERS LIST */}
      {page === "orders" && (
        <div style={{ padding: 14, maxWidth: 500, margin: "0 auto" }}>
          <button onClick={() => setPage("home")} style={{ ...btn(WH, G4, "6px 13px"), border: `1px solid ${G2}`, marginBottom: 12, fontSize: 12, borderRadius: 10 }}>← Back</button>
          <h2 style={{ fontWeight: 800, fontSize: 19, marginBottom: 13 }}>My Orders 📦</h2>
          {myOrders.length === 0 && (
            <div style={{ textAlign: "center", padding: 56, color: G3 }}>
              <div style={{ fontSize: 48, marginBottom: 10 }}>📦</div>
              <div style={{ fontWeight: 600, color: G4 }}>No orders yet</div>
              <button onClick={() => setPage("home")} style={{ ...btn("linear-gradient(135deg,#B44FFF,#7B2FE0)", WH, "11px 24px"), marginTop: 14, fontWeight: 700, borderRadius: 10, boxShadow: "0 4px 14px rgba(180,79,255,0.35)" }}>Shop Now</button>
            </div>
          )}
          {myOrders.map(o => (
            <div key={o.fid || o.id} onClick={() => { setTrackId(o.id); setPage("tracking"); }}
              style={{ ...card, marginBottom: 10, borderLeft: `4px solid ${SM[o.status]?.color || G2}`, cursor: "pointer", transition: "all .2s", boxShadow: `0 2px 12px ${SM[o.status]?.color || G3}15` }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 6px 24px ${SM[o.status]?.color || G3}30`; e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = `0 2px 12px ${SM[o.status]?.color || G3}15`; e.currentTarget.style.transform = "none"; }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div><div style={{ fontWeight: 700, fontSize: 14 }}>{o.id}</div><div style={{ color: G3, fontSize: 11, marginTop: 2 }}>🕐 {o.time} · {o.paymentMethod}</div></div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ ...pill(SM[o.status]?.color || G3), fontSize: 11, padding: "4px 10px" }}>{SM[o.status]?.label}</span>
                  <div style={{ fontWeight: 800, fontSize: 14, marginTop: 5, color: PU }}>{rupee(o.total)}</div>
                </div>
              </div>
              <Tracker order={o} />
              <div style={{ marginTop: 8, fontSize: 11, color: PU, fontWeight: 600 }}>Tap to track →</div>
            </div>
          ))}
        </div>
      )}

      {/* ORDER TRACKING */}
      {page === "tracking" && (() => {
        const o = myOrders.find(x => x.id === trackId) || myOrders[0];
        if (!o) return (<div style={{ padding: 40, textAlign: "center", color: G3 }}>Order not found.<button onClick={() => setPage("home")} style={{ ...btn("linear-gradient(135deg,#B44FFF,#7B2FE0)", WH, "9px 18px"), marginLeft: 10, borderRadius: 10 }}>Home</button></div>);
        const destPos = geo.lat ? [geo.lat, geo.lng] : DARK_STORE_POS;
        const isDelivered = o.status === "delivered";
        return (
          <div style={{ padding: 14, maxWidth: 520, margin: "0 auto" }}>
            <button onClick={() => setPage("orders")} style={{ ...btn(WH, G4, "6px 13px"), border: `1px solid ${G2}`, marginBottom: 12, fontSize: 12, borderRadius: 10 }}>← My Orders</button>

            {/* Status hero */}
            <div style={{ background: `linear-gradient(135deg,${SM[o.status]?.color || G3}DD,${SM[o.status]?.color || G3}88)`, borderRadius: 20, padding: 24, marginBottom: 14, color: WH, textAlign: "center", boxShadow: `0 8px 32px ${SM[o.status]?.color || G3}40`, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,0.05)", top: -80, right: -60, pointerEvents: "none" }} />
              <div style={{ fontSize: 48, marginBottom: 8, position: "relative" }}>{SM[o.status]?.icon}</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 5 }}>{SM[o.status]?.label}</div>
              <div style={{ fontSize: 13, opacity: .9, marginBottom: isDelivered ? 0 : 16 }}>{SM[o.status]?.msg}</div>
              {!isDelivered && <div style={{ display: "flex", justifyContent: "center" }}><Countdown eta={o.eta} status={o.status} /></div>}
            </div>

            {/* Rider */}
            {o.rider && o.statusIdx >= 1 && (
              <div style={{ ...card, display: "flex", gap: 11, alignItems: "center", marginBottom: 14, boxShadow: "0 4px 16px rgba(180,79,255,0.1)" }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg,#B44FFF,#7B2FE0)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0, boxShadow: "0 4px 12px rgba(180,79,255,0.4)", animation: "riderFloat 2s ease infinite" }}>🛵</div>
                <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{o.rider.name}</div><div style={{ fontSize: 11, color: G3, marginTop: 1 }}>Delivery partner · ⭐{o.rider.rating}</div></div>
                <a href={`tel:${o.rider.phone}`} style={{ ...btn("linear-gradient(135deg,#00E5B0,#0EA472)", WH, "7px 13px"), fontSize: 12, textDecoration: "none", borderRadius: 9, boxShadow: "0 3px 10px rgba(0,229,176,0.3)" }}>📞 Call</a>
              </div>
            )}

            {/* Map */}
            {o.statusIdx >= 4 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 7, color: BK }}>🗺️ Live Tracking</div>
                <RiderMap order={o} destPos={destPos} />
              </div>
            )}

            {/* Journey */}
            <div style={{ ...card, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Order Journey</div>
              <Tracker order={o} />
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 0 }}>
                {STATUS_FLOW.map((s, i) => {
                  const done = i <= o.statusIdx, curr = i === o.statusIdx;
                  const logEntry = (o.log || []).find(l => l.status === s);
                  return (
                    <div key={s} style={{ display: "flex", gap: 11 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: done ? SM[s].color : G2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: curr ? 14 : 11, flexShrink: 0, border: curr ? `2px solid ${SM[s].color}` : "2px solid transparent", boxShadow: curr ? `0 0 0 3px ${SM[s].color}25, 0 0 12px ${SM[s].color}50` : "none" }}>
                          {done ? SM[s].icon : <span style={{ fontWeight: 700, color: G3 }}>{i + 1}</span>}
                        </div>
                        {i < STATUS_FLOW.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 20, background: i < o.statusIdx ? SM[s].color : G2, margin: "2px 0", borderRadius: 2, boxShadow: i < o.statusIdx ? `0 0 6px ${SM[s].color}60` : "none" }} />}
                      </div>
                      <div style={{ paddingBottom: i < STATUS_FLOW.length - 1 ? 14 : 0, paddingTop: 4, flex: 1 }}>
                        <div style={{ fontWeight: curr ? 700 : 600, fontSize: 13, color: done ? BK : G3 }}>{SM[s].label}</div>
                        {logEntry && <div style={{ fontSize: 11, color: G3, marginTop: 1 }}>{logEntry.time}</div>}

                        {curr && <div style={{ fontSize: 10, color: SM[s].color, fontWeight: 600, marginTop: 2, animation: "pulse 1.5s ease infinite" }}>● Live</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Items */}
            <div style={{ ...card, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 11 }}>Your Items</div>
              {(o.items || []).map(i => (
                <div key={i.sku} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${G1}`, fontSize: 13 }}>
                  <span style={{ color: G4 }}>{i.emoji} {i.name} ×{i.qty}</span>
                  <span style={{ fontWeight: 700, color: PU }}>{rupee(i.qty * i.price)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 15, paddingTop: 10 }}><span>Total</span><span style={{ color: PU }}>{rupee(o.total)}</span></div>
              <div style={{ marginTop: 4, fontSize: 11, color: G3 }}>Paid via {o.paymentMethod}</div>
            </div>

            {/* Delivered */}

            {isDelivered && (
              <div style={{ background: "linear-gradient(135deg,rgba(0,229,176,0.1),rgba(180,79,255,0.07))", borderRadius: 18, padding: 24, textAlign: "center", border: `2px solid ${GN}`, boxShadow: `0 8px 28px rgba(0,229,176,0.15)` }}>
                <div style={{ fontSize: 48, marginBottom: 10 }}>🎉</div>
                <div style={{ fontWeight: 800, color: GN, fontSize: 18, marginBottom: 5 }}>Order Delivered!</div>
                <div style={{ color: G3, fontSize: 13, marginBottom: 16 }}>Enjoy your groceries from QuantCart!</div>
                <button onClick={() => setPage("home")} style={{ ...btn("linear-gradient(135deg,#B44FFF,#7B2FE0)", WH, "10px 28px"), fontWeight: 700, borderRadius: 12, boxShadow: "0 4px 16px rgba(180,79,255,0.4)" }}>Order Again 🛒</button>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SHARED STORE
 ═══════════════════════════════════════════════════════════════════ */
function useSharedStore() {
  const [inv, setInv] = useState([]);
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [notifications, setNotifs] = useState([]);
  const [adminToast, setAToast] = useState(null);
  const [custToast, setCToast] = useState(null);
  const [loading, setLoading] = useState(true);

  const pushN = useCallback((msg, type = "info", target = "both") => {
    const n = { id: Date.now() + Math.random(), msg, type, time: ts(), read: false };
    setNotifs(p => [n, ...p].slice(0, 80));
    if (target === "admin" || target === "both") { setAToast(n); setTimeout(() => setAToast(null), 3200); }
    if (target === "cust" || target === "both") { setCToast(n); setTimeout(() => setCToast(null), 3200); }
  }, []);

  useEffect(() => {
    const uI = onSnapshot(collection(db, "inventory"), async snap => {
      if (snap.empty) {
        const batch = writeBatch(db);
        PRODUCTS.forEach(p => batch.set(doc(db, "inventory", String(p.id)), p));
        await batch.commit().catch(console.error);
      } else {
        setInv(snap.docs.map(d => ({ ...d.data(), fid: d.id })));
      }
    });
    const uO = onSnapshot(
      query(collection(db, "orders"), orderBy("createdAt", "desc")),
      snap => { setOrders(snap.docs.map(d => ({ fid: d.id, ...d.data() }))); setLoading(false); },
      err => { console.error("orders listener:", err); setLoading(false); }
    );
    const uU = onSnapshot(collection(db, "users"), snap => {
      setUsers(snap.docs.map(d => ({ fid: d.id, ...d.data() })));
    });
    return () => { uI(); uO(); uU(); };
  }, []);

  return { inv, orders, users, notifications, adminToast, custToast, pushN, loading };
}

/* ═══════════════════════════════════════════════════════════════════
   ROOT APP
 ═══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [authLoading, setAuthLoad] = useState(true);
  const store = useSharedStore();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async u => {
      if (u) {
        try { const snap = await getDoc(doc(db, "users", u.uid)); setAuthUser(u); setUserRole(snap.exists() ? snap.data().role : "customer"); }
        catch { setAuthUser(u); setUserRole("customer"); }
      } else { setAuthUser(null); setUserRole(null); }
      setAuthLoad(false);
    });
    return unsub;
  }, []);

  const handleLogin = (u, r) => { setAuthUser(u); setUserRole(r); };
  const handleLogout = async () => { await signOut(auth); setAuthUser(null); setUserRole(null); };

  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(145deg,#0A0A12,#1a0b2e)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
        <div style={{ background: "linear-gradient(135deg,#B44FFF,#7B2FE0)", borderRadius: 14, padding: "12px 28px", fontWeight: 900, fontSize: 28, color: WH, letterSpacing: 2, marginBottom: 14, boxShadow: "0 8px 28px rgba(180,79,255,0.5)" }}>QuantCart</div>
        <div style={{ color: "rgba(180,79,255,0.6)", fontSize: 13, animation: "pulse 1.5s ease infinite" }}>Loading...</div>
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <style>{GLOBAL_CSS}</style>
      {!authUser ? (
        <LoginPage onLogin={handleLogin} />
      ) : userRole === "admin" ? (
        <>
          <AdminPanel user={authUser} store={store} />
          <button onClick={handleLogout} style={{ position: "fixed", bottom: 20, right: 20, zIndex: 999, ...btn("linear-gradient(135deg,#FF3D6B,#E53935)", WH, "10px 20px"), fontSize: 13, boxShadow: "0 4px 18px rgba(255,61,107,0.45)", borderRadius: 12 }}>Sign Out</button>
        </>
      ) : (
        <CustomerPanel user={authUser} store={store} />
      )}
      {authUser && (
        <div style={{ position: "fixed", bottom: 20, left: 20, zIndex: 9999 }}>
          <button onClick={() => setUserRole(userRole === "admin" ? "customer" : "admin")}
            style={{ ...btn("linear-gradient(135deg,#1E1A3A,#2D1B5E)", WH, "10px 18px"), boxShadow: "0 6px 22px rgba(180,79,255,0.45)", borderRadius: 30, fontSize: 11, border: "2px solid rgba(180,79,255,0.5)" }}>
            🔄 Switch to {userRole === "admin" ? "Customer" : "Admin"} View
          </button>
        </div>
      )}
    </div>
  );
}