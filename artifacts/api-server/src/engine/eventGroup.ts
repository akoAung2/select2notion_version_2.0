/**
 * Event Group Engine
 * Groups related economic events for combined analysis
 */

export interface EventGroupDef {
  id: string;
  name: string;
  description: string;
  canonicalIds: string[];
  currency: string;
}

export const EVENT_GROUPS: EventGroupDef[] = [
  {
    id: "US_EMPLOYMENT_REPORT",
    name: "US Employment Report",
    description: "Monthly jobs report — NFP, Unemployment, Average Earnings",
    canonicalIds: ["US_EMPLOYMENT_NFP", "US_UNEMPLOYMENT_RATE", "US_AVERAGE_HOURLY_EARNINGS"],
    currency: "USD",
  },
  {
    id: "US_INFLATION_REPORT",
    name: "US Inflation Report",
    description: "CPI and Core CPI released together",
    canonicalIds: ["US_CPI", "US_CORE_CPI"],
    currency: "USD",
  },
  {
    id: "US_GDP_REPORT",
    name: "US GDP Report",
    description: "GDP growth advance/preliminary/final",
    canonicalIds: ["US_GDP"],
    currency: "USD",
  },
  {
    id: "US_FOMC_PACKAGE",
    name: "FOMC Policy Package",
    description: "Fed rate decision + statement + press conference",
    canonicalIds: ["US_FOMC_RATE", "US_FOMC_STATEMENT", "US_FED_SPEECH"],
    currency: "USD",
  },
  {
    id: "US_PCE_REPORT",
    name: "US PCE Inflation Report",
    description: "Fed's preferred inflation measure",
    canonicalIds: ["US_PCE"],
    currency: "USD",
  },
];

export function findEventGroup(canonicalId: string): EventGroupDef | null {
  return EVENT_GROUPS.find((g) => g.canonicalIds.includes(canonicalId)) ?? null;
}

export function getGroupForEvents(canonicalIds: string[]): EventGroupDef | null {
  for (const group of EVENT_GROUPS) {
    const overlap = group.canonicalIds.filter((id) => canonicalIds.includes(id));
    if (overlap.length >= 1) return group;
  }
  return null;
}
