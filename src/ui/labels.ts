import { AssetClass, Jurisdiction } from "../engine/types";

export const JURISDICTION_LABELS: Record<Jurisdiction, string> = {
  seattle: "Seattle, WA",
  nyc: "New York City, NY",
  jerseycity: "Jersey City, NJ",
  la: "Los Angeles, CA",
};

export const JURISDICTION_SHORT: Record<Jurisdiction, string> = {
  seattle: "Seattle",
  nyc: "NYC",
  jerseycity: "Jersey City",
  la: "LA",
};

export const ASSET_LABELS: Record<AssetClass, string> = {
  usEquity: "US equity",
  intlEquity: "Intl equity",
  usTreasuries: "US Treasuries",
  corporateBonds: "Corporate bonds",
  cash: "Cash",
};

export const CAT_COLORS = [
  "var(--cat-1)",
  "var(--cat-2)",
  "var(--cat-3)",
  "var(--cat-4)",
  "var(--cat-5)",
  "var(--cat-6)",
  "var(--cat-7)",
  "var(--cat-8)",
];
