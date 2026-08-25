export const TRADE_FIELDS = [
  "Name",
  "DOW",
  "Date",
  "Direction",
  "Emotion",
  "Entry Window (New York Time)",
  "Files & media",
  "Followed rules",
  "Lq taken",
  "Month",
  "Negative tags",
  "Pairs",
  "Profit/Loss",
  "Rating(1-5)",
  "Session",
  "Year",
  "entry",
  "reversal /condi",
] as const;

export type TradeField = (typeof TRADE_FIELDS)[number];
