import { doc, updateDoc, arrayUnion, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import { STATUS_FLOW, SM } from "./constants";

/* ─── Active timers registry (prevents duplicate advancement) ─────────── */
const activeTimers = new Map(); // orderId → [timeoutId, ...]

/**
 * Clears all pending timers for an order.
 */
export const cancelOrderAdvancement = (orderId) => {
  const timers = activeTimers.get(orderId) || [];
  timers.forEach(clearTimeout);
  activeTimers.delete(orderId);
};

/**
 * Writes a single status step to Firestore.
 * Returns true on success, false on failure.
 */
export const advanceOrder = async (orderId, statusIdx) => {
  const newStatus = STATUS_FLOW[statusIdx];
  if (!newStatus) return false;

  // Guard: don't regress status
  try {
    const snap = await getDoc(doc(db, "orders", orderId));
    if (!snap.exists()) throw new Error("Order document not found");
    const current = snap.data().statusIdx ?? 0;
    if (statusIdx <= current && statusIdx !== 0) {
      console.warn(`[orderengine] Skipping regression: ${orderId} is already at step ${current}`);
      return false;
    }
  } catch (err) {
    console.error(`[orderengine] Guard check failed for ${orderId}:`, err.message);
    // Don't block — attempt the write anyway
  }

  const orderRef = doc(db, "orders", orderId);
  await updateDoc(orderRef, {
    statusIdx,
    status: newStatus,
    log: arrayUnion({
      status: newStatus,
      msg: SM[newStatus]?.msg || "Order updated",
      time: new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    }),
  });
  return true;
};

/**
 * Schedules the full order journey from step 1 → delivered.
 * - Deduplicates: cancels any existing timers for this orderId first.
 * - onStatusChange(statusString | "error") called after each write.
 * - Delays: 5–10 s per step (total ≈ 25–50 s for 5 steps).
 */
export const scheduleOrderAdvancement = (orderId, onStatusChange) => {
  if (!orderId) {
    console.error("[orderengine] scheduleOrderAdvancement called with no orderId");
    return;
  }

  // Cancel any duplicate scheduling for this order
  cancelOrderAdvancement(orderId);

  const timers = [];
  let totalDelay = 0;

  for (let i = 1; i < STATUS_FLOW.length; i++) {
    const stepDelay = Math.floor(Math.random() * 5000) + 5000; // 5–10 s
    totalDelay += stepDelay;
    const statusIdx = i; // capture

    const tid = setTimeout(async () => {
      try {
        const ok = await advanceOrder(orderId, statusIdx);
        if (ok && onStatusChange) onStatusChange(STATUS_FLOW[statusIdx]);
      } catch (err) {
        console.error(
          `[orderengine] Failed to advance ${orderId} → step ${statusIdx}:`,
          err.message
        );
        if (onStatusChange) onStatusChange("error");
      }
    }, totalDelay);

    timers.push(tid);
  }

  activeTimers.set(orderId, timers);
};

/**
 * Resumes advancement for a stuck/partially-advanced order.
 * Safely resolves the Firestore doc ID from order.fid.
 */
export const resumeOrderAdvancement = (order, onStatusChange) => {
  // Always use fid (real Firestore doc ID), never the display ID like "ORD-456"
  const docId = order?.fid;
  if (!docId) {
    console.warn("[orderengine] resumeOrderAdvancement: order.fid is missing", order);
    if (onStatusChange) onStatusChange("error");
    return;
  }

  const currentIdx = typeof order.statusIdx === "number" ? order.statusIdx : 0;
  if (currentIdx >= STATUS_FLOW.length - 1) return; // already delivered

  // Cancel any existing timers to avoid double-advancing
  cancelOrderAdvancement(docId);

  const timers = [];
  let totalDelay = 0;

  for (let i = currentIdx + 1; i < STATUS_FLOW.length; i++) {
    const stepDelay = Math.floor(Math.random() * 5000) + 5000;
    totalDelay += stepDelay;
    const statusIdx = i;

    const tid = setTimeout(async () => {
      try {
        const ok = await advanceOrder(docId, statusIdx);
        if (ok && onStatusChange) onStatusChange(STATUS_FLOW[statusIdx]);
      } catch (err) {
        console.error(
          `[orderengine] Resume failed ${docId} → step ${statusIdx}:`,
          err.message
        );
        if (onStatusChange) onStatusChange("error");
      }
    }, totalDelay);

    timers.push(tid);
  }

  activeTimers.set(docId, timers);
};