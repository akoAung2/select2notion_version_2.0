/**
 * Event Normalization Engine
 * Maps event aliases from different sources to canonical IDs
 */

export interface NormalizedEvent {
  id: string;
  canonicalId: string;
  name: string;
  currency: string;
  country: string;
  category: string;
  impact: "high" | "medium" | "low";
  time: string; // ISO
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  source: string;
}

export const EVENT_ALIASES: Record<string, string[]> = {
  US_EMPLOYMENT_NFP: [
    "Non Farm Payroll", "Nonfarm Payrolls", "NFP",
    "Non-Farm Employment Change", "Nonfarm Employment Change",
    "Total Nonfarm Payroll",
  ],
  US_UNEMPLOYMENT_RATE: [
    "Unemployment Rate", "Jobless Rate", "U-3 Unemployment",
  ],
  US_AVERAGE_HOURLY_EARNINGS: [
    "Average Hourly Earnings", "Average Hourly Earnings m/m",
    "Avg Hourly Earnings",
  ],
  US_CPI: [
    "CPI", "Consumer Price Index", "CPI m/m", "CPI y/y",
    "Consumer Price Index m/m", "Consumer Price Index y/y",
    "Inflation Rate",
  ],
  US_CORE_CPI: [
    "Core CPI", "Core CPI m/m", "Core CPI y/y",
    "Core Consumer Price Index", "CPI ex Food & Energy",
  ],
  US_PPI: [
    "PPI", "Producer Price Index", "PPI m/m", "PPI y/y",
    "Producer Prices",
  ],
  US_GDP: [
    "GDP", "GDP q/q", "Gross Domestic Product", "GDP Growth",
    "Real GDP", "GDP Annualized",
  ],
  US_RETAIL_SALES: [
    "Retail Sales", "Retail Sales m/m", "Core Retail Sales",
    "Advance Retail Sales",
  ],
  US_ISM_MANUFACTURING: [
    "ISM Manufacturing PMI", "ISM Manufacturing",
    "Manufacturing PMI", "ISM PMI",
  ],
  US_ISM_SERVICES: [
    "ISM Services PMI", "ISM Non-Manufacturing",
    "Services PMI", "ISM Non-Manufacturing PMI",
  ],
  US_FOMC_RATE: [
    "Fed Interest Rate Decision", "FOMC Rate Decision",
    "Federal Funds Rate", "Fed Rate Decision", "FOMC Decision",
    "Interest Rate Decision",
  ],
  US_FOMC_MINUTES: [
    "FOMC Meeting Minutes", "Fed Minutes", "FOMC Minutes",
  ],
  US_FOMC_STATEMENT: [
    "FOMC Statement", "Fed Statement", "Monetary Policy Statement",
  ],
  US_JOBLESS_CLAIMS: [
    "Initial Jobless Claims", "Unemployment Claims",
    "Weekly Jobless Claims", "Jobless Claims",
    "Initial Unemployment Claims",
  ],
  US_DURABLE_GOODS: [
    "Durable Goods Orders", "Core Durable Goods Orders",
    "Durable Goods m/m",
  ],
  US_HOUSING_STARTS: [
    "Housing Starts", "Building Permits", "New Home Sales",
    "Existing Home Sales",
  ],
  US_PCE: [
    "PCE", "Personal Consumption Expenditures", "Core PCE",
    "PCE Price Index", "Core PCE Price Index",
  ],
  US_TRADE_BALANCE: [
    "Trade Balance", "Trade Deficit", "Trade Surplus",
    "Goods Trade Balance",
  ],
  US_CONSUMER_CONFIDENCE: [
    "Consumer Confidence", "CB Consumer Confidence",
    "Conference Board Consumer Confidence",
  ],
  US_MICHIGAN_SENTIMENT: [
    "Michigan Consumer Sentiment", "UoM Consumer Sentiment",
    "U. of Michigan Consumer Sentiment",
    "University of Michigan Consumer Sentiment",
  ],
  US_ADP: [
    "ADP Employment", "ADP Nonfarm Employment Change",
    "ADP Employment Change", "ADP Payrolls",
  ],
  US_FED_SPEECH: [
    "Fed Chair Powell Speech", "Powell Speech", "Fed Chair Speech",
    "FOMC Speech", "Fed Governor Speech", "Fed President Speech",
    "Federal Reserve Chair Speech",
  ],
  US_FACTORY_ORDERS: [
    "Factory Orders", "Factory Orders m/m",
  ],
  US_EMPIRE_STATE: [
    "Empire State Manufacturing", "Empire State Manufacturing Index",
    "NY Empire State Manufacturing",
  ],
  US_PHILLY_FED: [
    "Philly Fed Manufacturing", "Philadelphia Fed Manufacturing Index",
  ],
};

const ALIAS_LOOKUP: Map<string, string> = new Map();
for (const [canonicalId, aliases] of Object.entries(EVENT_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_LOOKUP.set(alias.toLowerCase(), canonicalId);
  }
}

export const CATEGORY_MAP: Record<string, string> = {
  US_EMPLOYMENT_NFP: "employment",
  US_UNEMPLOYMENT_RATE: "employment",
  US_AVERAGE_HOURLY_EARNINGS: "employment",
  US_ADP: "employment",
  US_JOBLESS_CLAIMS: "employment",
  US_CPI: "inflation",
  US_CORE_CPI: "inflation",
  US_PPI: "inflation",
  US_PCE: "inflation",
  US_FOMC_RATE: "monetary_policy",
  US_FOMC_MINUTES: "monetary_policy",
  US_FOMC_STATEMENT: "monetary_policy",
  US_FED_SPEECH: "monetary_policy",
  US_GDP: "growth",
  US_RETAIL_SALES: "growth",
  US_ISM_MANUFACTURING: "sentiment",
  US_ISM_SERVICES: "sentiment",
  US_CONSUMER_CONFIDENCE: "sentiment",
  US_MICHIGAN_SENTIMENT: "sentiment",
  US_HOUSING_STARTS: "housing",
  US_TRADE_BALANCE: "trade",
  US_DURABLE_GOODS: "manufacturing",
  US_FACTORY_ORDERS: "manufacturing",
};

export function normalizeEventName(rawName: string): string {
  const lower = rawName.toLowerCase().trim();
  if (ALIAS_LOOKUP.has(lower)) return ALIAS_LOOKUP.get(lower)!;
  for (const [alias, canonical] of ALIAS_LOOKUP) {
    if (lower.includes(alias) || alias.includes(lower)) return canonical;
  }
  const upper = rawName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return `US_${upper}`;
}

export function getEventCategory(canonicalId: string): string {
  return CATEGORY_MAP[canonicalId] ?? "other";
}

export function normalizeImpact(raw: string): "high" | "medium" | "low" {
  const lower = raw.toLowerCase();
  if (lower.includes("high") || lower === "3" || lower === "red") return "high";
  if (lower.includes("med") || lower === "2" || lower === "orange") return "medium";
  return "low";
}
