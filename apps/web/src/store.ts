// Estado do app: projeto + dados do editor + assets, com desfazer/refazer.
import { useCallback, useEffect, useReducer, useRef } from "react";
import { AppState, DEFAULT_SETTINGS, Project } from "./model";

export interface Doc { project: Project | null; app: AppState }
export type Assets = Map<string, Blob>;

interface S { past: Doc[]; now: Doc; future: Doc[] }
type A = { t: "set"; doc: Doc; merge?: boolean } | { t: "undo" } | { t: "redo" } | { t: "reset"; doc: Doc };

const LIMIT = 80;
function reducer(s: S, a: A): S {
  switch (a.t) {
    case "set":
      if (a.merge) return { ...s, now: a.doc }; // ajustes contínuos (arrastar) não empilham
      return { past: [...s.past, s.now].slice(-LIMIT), now: a.doc, future: [] };
    case "undo":
      if (!s.past.length) return s;
      return { past: s.past.slice(0, -1), now: s.past[s.past.length - 1], future: [s.now, ...s.future] };
    case "redo":
      if (!s.future.length) return s;
      return { past: [...s.past, s.now], now: s.future[0], future: s.future.slice(1) };
    case "reset":
      return { past: [], now: a.doc, future: [] };
  }
}

export const emptyDoc = (): Doc => ({ project: null, app: { sources: [], settings: { ...DEFAULT_SETTINGS } } });

export function useDoc() {
  const [s, dispatch] = useReducer(reducer, undefined, () => ({ past: [], now: emptyDoc(), future: [] }));
  const assets = useRef<Assets>(new Map());
  const ref = useRef(s.now);
  ref.current = s.now;
  const update = useCallback((fn: (d: Doc) => Doc, merge = false) => {
    const doc = fn(ref.current);
    if (doc.project) doc.project = { ...doc.project, revision: (doc.project.revision || 0) + (merge ? 0 : 1) };
    dispatch({ t: "set", doc, merge });
  }, []);
  const undo = useCallback(() => dispatch({ t: "undo" }), []);
  const redo = useCallback(() => dispatch({ t: "redo" }), []);
  const reset = useCallback((doc: Doc) => dispatch({ t: "reset", doc }), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [undo, redo]);
  return { doc: s.now, canUndo: s.past.length > 0, canRedo: s.future.length > 0, update, undo, redo, reset, assets: assets.current };
}

// ---------- autosave (IndexedDB) ----------
const DB = "vizuvetor", STORE = "rascunho";
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function autosave(doc: Doc, assets: Assets) {
  try {
    const db = await idb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ doc, assets: [...assets.entries()], at: Date.now() }, "atual");
    await new Promise((r) => (tx.oncomplete = r));
  } catch { /* sem IndexedDB: segue sem autosave */ }
}
export async function loadAutosave(): Promise<{ doc: Doc; assets: Assets; at: number } | null> {
  try {
    const db = await idb();
    const v = await new Promise<any>((res) => { const r = db.transaction(STORE).objectStore(STORE).get("atual"); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
    if (!v?.doc?.project) return null;
    return { doc: v.doc, assets: new Map(v.assets), at: v.at };
  } catch { return null; }
}
export async function clearAutosave() {
  try { const db = await idb(); db.transaction(STORE, "readwrite").objectStore(STORE).delete("atual"); } catch { /* */ }
}
