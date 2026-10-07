/**
 * Preset sharing: the whole configuration round-trips through the URL hash, so
 * a scenario can be sent to someone else as a link with no server involved.
 *
 * The payload is versioned JSON, UTF-8, base64url-encoded. Nothing here is
 * secret — a shared link exposes every number in the config to whoever holds
 * it, which is the point, but worth knowing before sending one on.
 */

import {
  AssetConfig,
  IncomeConfig,
  Jurisdiction,
  LiabilityConfig,
  ScenarioConfig,
} from "../engine/types";

export const SHARE_VERSION = 1;

export interface SharedState {
  v: number;
  income: IncomeConfig;
  assets: AssetConfig;
  liabilities: LiabilityConfig;
  scenario: ScenarioConfig;
  startJurisdiction: Jurisdiction;
  planToAge: number;
  paths: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function encodeState(state: SharedState): string {
  const json = JSON.stringify(state);
  return toBase64Url(new TextEncoder().encode(json));
}

/** Returns null on anything malformed rather than throwing at the user. */
export function decodeState(encoded: string): SharedState | null {
  try {
    const json = new TextDecoder().decode(fromBase64Url(encoded));
    const parsed = JSON.parse(json) as SharedState;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.v !== SHARE_VERSION ||
      !parsed.income ||
      !parsed.assets ||
      !parsed.liabilities ||
      !parsed.scenario
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readStateFromUrl(): SharedState | null {
  if (typeof window === "undefined") return null;
  const match = /[#&]s=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  return match ? decodeState(match[1]) : null;
}

export function shareUrlFor(state: SharedState): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#s=${encodeState(state)}`;
}

const STORAGE_KEY = "alm-simulator:last";

/** Autosave, so a refresh does not lose a half-finished plan. */
export function saveLocal(state: SharedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, encodeState(state));
  } catch {
    // Private windows and blocked site data throw; a lost autosave is fine.
  }
}

export function loadLocal(): SharedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? decodeState(raw) : null;
  } catch {
    return null;
  }
}

export function clearLocal(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
