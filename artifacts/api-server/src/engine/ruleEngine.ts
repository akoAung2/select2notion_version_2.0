/**
 * Rule Engine — Fundamental analysis logic
 * Determines USD/asset bias based on actual vs forecast
 */

import { normalizeEventName, getEventCategory } from "./normalization.js";

export interface RuleResult {
  usdBias: "bullish" | "bearish" | "neutral";
  usdStrength: number; // -100 to +100
  riskSentiment: "risk_on" | "risk_off" | "neutral";
  affectedAssets: AssetImpact[];
  summary: string;
  details: string;
}

export interface AssetImpact {
  asset: string;
  direction: "up" | "down" | "neutral";
  strength: "strong" | "moderate" | "weak";
  reason: string;
}

function parseNumber(val: string | null): number | null {
  if (!val) return null;
  const cleaned = val.replace(/[%,$,K,M,B,k]/gi, "").replace(/,/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function getMultiplier(val: string): number {
  const upper = val.toUpperCase();
  if (upper.includes("B")) return 1_000_000_000;
  if (upper.includes("M")) return 1_000_000;
  if (upper.includes("K")) return 1_000;
  return 1;
}

function normalizeWithUnit(val: string | null): number | null {
  if (!val) return null;
  const mult = getMultiplier(val);
  const num = parseNumber(val);
  return num !== null ? num * mult : null;
}

export function applyRules(
  eventName: string,
  actual: string | null,
  forecast: string | null,
  previous: string | null,
): RuleResult {
  const canonicalId = normalizeEventName(eventName);
  const category = getEventCategory(canonicalId);

  const actualNum = normalizeWithUnit(actual);
  const forecastNum = normalizeWithUnit(forecast);
  const previousNum = normalizeWithUnit(previous);

  const hasDiff = actualNum !== null && forecastNum !== null;
  const diff = hasDiff ? actualNum! - forecastNum! : 0;
  const pctDiff = hasDiff && forecastNum !== 0 ? (diff / Math.abs(forecastNum!)) * 100 : 0;

  let usdStrength = 0;
  let usdBias: "bullish" | "bearish" | "neutral" = "neutral";
  let riskSentiment: "risk_on" | "risk_off" | "neutral" = "neutral";
  let affectedAssets: AssetImpact[] = [];
  let summary = "";
  let details = "";

  if (!hasDiff) {
    return {
      usdBias: "neutral",
      usdStrength: 0,
      riskSentiment: "neutral",
      affectedAssets: [],
      summary: "No comparable data — actual vs forecast not available.",
      details: `Event: ${eventName}. Actual: ${actual ?? "N/A"}, Forecast: ${forecast ?? "N/A"}.`,
    };
  }

  const beat = diff > 0;
  const miss = diff < 0;
  const strongBeat = Math.abs(pctDiff) > 10;
  const moderateBeat = Math.abs(pctDiff) > 3;

  if (category === "employment") {
    if (beat) {
      usdStrength = strongBeat ? 75 : moderateBeat ? 50 : 25;
      usdBias = "bullish";
      riskSentiment = "risk_on";
      summary = `Strong employment data — USD bullish. ${eventName} beat forecast.`;
      details = `Actual ${actual} vs Forecast ${forecast}. Labor market strength supports Fed hawkishness.`;
      affectedAssets = [
        { asset: "USD", direction: "up", strength: strongBeat ? "strong" : "moderate", reason: "Strong jobs = hawkish Fed expectations" },
        { asset: "GOLD", direction: "down", strength: "moderate", reason: "USD strength pressures gold" },
        { asset: "SPX", direction: "up", strength: "weak", reason: "Employment supports economic growth" },
        { asset: "USDYEN", direction: "up", strength: "moderate", reason: "USD demand from risk-on sentiment" },
      ];
    } else {
      usdStrength = strongBeat ? -75 : moderateBeat ? -50 : -25;
      usdBias = "bearish";
      riskSentiment = "risk_off";
      summary = `Weak employment data — USD bearish. ${eventName} missed forecast.`;
      details = `Actual ${actual} vs Forecast ${forecast}. Weak labor market may slow Fed rate path.`;
      affectedAssets = [
        { asset: "USD", direction: "down", strength: strongBeat ? "strong" : "moderate", reason: "Weak jobs = dovish Fed expectations" },
        { asset: "GOLD", direction: "up", strength: "moderate", reason: "USD weakness boosts gold" },
        { asset: "SPX", direction: "down", strength: "weak", reason: "Recession fears on weak jobs" },
        { asset: "USDYEN", direction: "down", strength: "moderate", reason: "USD weakness, yen safe-haven demand" },
      ];
    }
  } else if (category === "inflation") {
    if (beat) {
      usdStrength = strongBeat ? 80 : moderateBeat ? 55 : 30;
      usdBias = "bullish";
      riskSentiment = "risk_off";
      summary = `Inflation beat — USD bullish, risk-off. ${eventName} higher than expected.`;
      details = `Actual ${actual} vs Forecast ${forecast}. Hot inflation = higher rates = stronger USD.`;
      affectedAssets = [
        { asset: "USD", direction: "up", strength: strongBeat ? "strong" : "moderate", reason: "Hot inflation = Fed keeps rates high" },
        { asset: "GOLD", direction: "down", strength: "moderate", reason: "Higher real yields weigh on gold" },
        { asset: "SPX", direction: "down", strength: "moderate", reason: "Higher rates = lower equity valuations" },
        { asset: "BONDS", direction: "down", strength: "strong", reason: "Rate expectations rise" },
      ];
    } else {
      usdStrength = strongBeat ? -80 : moderateBeat ? -55 : -30;
      usdBias = "bearish";
      riskSentiment = "risk_on";
      summary = `Inflation miss — USD bearish, risk-on. ${eventName} below forecast.`;
      details = `Actual ${actual} vs Forecast ${forecast}. Cool inflation = Fed cut expectations = USD weaker.`;
      affectedAssets = [
        { asset: "USD", direction: "down", strength: strongBeat ? "strong" : "moderate", reason: "Cool inflation = dovish Fed pivot expectations" },
        { asset: "GOLD", direction: "up", strength: "strong", reason: "USD weakness + rate cut expectations boost gold" },
        { asset: "SPX", direction: "up", strength: "moderate", reason: "Rate cut hopes drive equities higher" },
        { asset: "BONDS", direction: "up", strength: "strong", reason: "Rate cut expectations boost bond prices" },
      ];
    }
  } else if (category === "monetary_policy") {
    if (canonicalId === "US_FOMC_RATE") {
      if (beat) {
        usdStrength = 90;
        usdBias = "bullish";
        riskSentiment = "risk_off";
        summary = "Fed rate hike or hawkish surprise — strong USD bullish.";
        details = `Rate decision: ${actual}. Higher than expected = hawkish shock.`;
        affectedAssets = [
          { asset: "USD", direction: "up", strength: "strong", reason: "Direct rate increase strengthens USD" },
          { asset: "GOLD", direction: "down", strength: "strong", reason: "Higher rates = opportunity cost for gold" },
          { asset: "SPX", direction: "down", strength: "strong", reason: "Higher rates compress equity multiples" },
        ];
      } else {
        usdStrength = -90;
        usdBias = "bearish";
        riskSentiment = "risk_on";
        summary = "Fed rate cut or dovish surprise — USD bearish.";
        details = `Rate decision: ${actual}. Cut/hold below expectations = dovish.`;
        affectedAssets = [
          { asset: "USD", direction: "down", strength: "strong", reason: "Rate cut reduces USD yield advantage" },
          { asset: "GOLD", direction: "up", strength: "strong", reason: "Lower rates boost gold" },
          { asset: "SPX", direction: "up", strength: "moderate", reason: "Cheaper credit = higher equity valuations" },
        ];
      }
    }
  } else if (category === "growth") {
    if (beat) {
      usdStrength = strongBeat ? 60 : 35;
      usdBias = "bullish";
      riskSentiment = "risk_on";
      summary = `Strong growth data — USD bullish, risk-on. ${eventName} beat expectations.`;
      details = `Actual ${actual} vs Forecast ${forecast}. Economic strength supports Fed patience.`;
      affectedAssets = [
        { asset: "USD", direction: "up", strength: "moderate", reason: "Growth = delayed rate cuts" },
        { asset: "SPX", direction: "up", strength: "moderate", reason: "Strong economy boosts earnings" },
        { asset: "GOLD", direction: "down", strength: "weak", reason: "Risk-on reduces safe haven demand" },
      ];
    } else {
      usdStrength = strongBeat ? -60 : -35;
      usdBias = "bearish";
      riskSentiment = "risk_off";
      summary = `Weak growth data — USD bearish, risk-off. ${eventName} missed expectations.`;
      details = `Actual ${actual} vs Forecast ${forecast}. Slowdown increases rate cut pressure.`;
      affectedAssets = [
        { asset: "USD", direction: "down", strength: "moderate", reason: "Weak growth = Fed rate cuts ahead" },
        { asset: "GOLD", direction: "up", strength: "moderate", reason: "Safe haven demand on slowdown fears" },
        { asset: "SPX", direction: "down", strength: "moderate", reason: "Weak growth hurts corporate earnings" },
      ];
    }
  } else if (category === "sentiment") {
    if (beat) {
      usdStrength = 30;
      usdBias = "bullish";
      riskSentiment = "risk_on";
      summary = `Positive sentiment data — mild USD bullish. ${eventName} above forecast.`;
      details = `Actual ${actual} vs Forecast ${forecast}. Better sentiment supports consumer activity.`;
      affectedAssets = [
        { asset: "USD", direction: "up", strength: "weak", reason: "Optimism reduces safe-haven need" },
        { asset: "SPX", direction: "up", strength: "weak", reason: "Consumer confidence supports growth" },
      ];
    } else {
      usdStrength = -30;
      usdBias = "bearish";
      riskSentiment = "risk_off";
      summary = `Weak sentiment data — mild USD bearish. ${eventName} below forecast.`;
      details = `Actual ${actual} vs Forecast ${forecast}. Lower confidence signals consumer caution.`;
      affectedAssets = [
        { asset: "USD", direction: "down", strength: "weak", reason: "Weak sentiment = growth concerns" },
        { asset: "GOLD", direction: "up", strength: "weak", reason: "Safe haven buying on uncertainty" },
      ];
    }
  } else {
    // Generic rule
    if (beat) {
      usdStrength = 25;
      usdBias = diff > 0 ? "bullish" : "neutral";
      summary = `${eventName} beat forecast — mildly positive for USD.`;
      details = `Actual ${actual} vs Forecast ${forecast}.`;
      affectedAssets = [{ asset: "USD", direction: "up", strength: "weak", reason: "Positive data = mildly bullish USD" }];
    } else if (miss) {
      usdStrength = -25;
      usdBias = "bearish";
      summary = `${eventName} missed forecast — mildly negative for USD.`;
      details = `Actual ${actual} vs Forecast ${forecast}.`;
      affectedAssets = [{ asset: "USD", direction: "down", strength: "weak", reason: "Miss = mildly bearish USD" }];
    }
  }

  return { usdBias, usdStrength, riskSentiment, affectedAssets, summary, details };
}
