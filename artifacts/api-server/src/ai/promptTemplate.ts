/**
 * AI Prompt Templates — Myanmar language, professional fixed format
 * v1.4 — Updated template per News Dashboard spec
 */

import type { RuleResult } from "../engine/ruleEngine.js";

export interface AnalysisInput {
  eventName: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  ruleResult: RuleResult;
  groupName?: string;
  historicalContext?: string;
  relatedNews?: string[];
}

export function buildFundamentalAnalysisPrompt(input: AnalysisInput): string {
  const { eventName, actual, forecast, previous, ruleResult, groupName, historicalContext, relatedNews } = input;

  const newsSection = relatedNews && relatedNews.length > 0
    ? `\nRelated News:\n${relatedNews.slice(0, 3).map((n) => `- ${n}`).join("\n")}`
    : "";

  const historicalSection = historicalContext
    ? `\nHistorical Context Data:\n${historicalContext}`
    : "";

  const beatMiss =
    actual && forecast &&
    !isNaN(Number(actual.replace(/[^0-9.-]/g, ""))) &&
    !isNaN(Number(forecast.replace(/[^0-9.-]/g, "")))
      ? Number(actual.replace(/[^0-9.-]/g, "")) > Number(forecast.replace(/[^0-9.-]/g, ""))
        ? "BEAT"
        : "MISS"
      : "N/A";

  return `You are a professional Forex and macro fundamental analyst.

Event Data:
Event: ${groupName || eventName}
Actual: ${actual ?? "N/A"}
Forecast: ${forecast ?? "N/A"}
Previous: ${previous ?? "N/A"}
Result: ${beatMiss}

Rule Engine:
- USD Bias: ${ruleResult.usdBias.toUpperCase()} (${ruleResult.usdStrength}/100)
- Risk Sentiment: ${ruleResult.riskSentiment}
- Summary: ${ruleResult.summary}
${historicalSection}
${newsSection}

Write analysis in Myanmar language EXACTLY in this format (no extra text outside this block):

🧠 Fundamental Analysis

📌 Event: ${groupName || eventName}
📊 Actual: ${actual ?? "N/A"}
📈 Forecast: ${forecast ?? "N/A"}
📉 Previous: ${previous ?? "N/A"}

Market Meaning:
• [ဒီ data က market အတွက် ဘာကိုဆိုလိုသလဲ — ၂ ကြောင်း]

USD Impact:
• [UP/DOWN/NEUTRAL — Myanmar ဖြင့် အကြောင်းရင်းတို]

Gold Impact:
• [UP/DOWN/NEUTRAL — Myanmar ဖြင့် အကြောင်းရင်းတို]

Index Impact:
• [S&P500/NASDAQ — UP/DOWN/NEUTRAL — Myanmar ဖြင့်]

Trader Focus:
• [Trader တွေ ဆက်ပြီး ဘာကိုကြည့်သင့်သလဲ — တိုတို]

Maximum 180 words. Professional analyst style.`;
}

export function buildWarningPrompt(
  eventName: string,
  minutesBefore: number,
  forecast: string | null,
  previous: string | null,
): string {
  const urgency =
    minutesBefore <= 1 ? "🔴🔴🔴 URGENT" :
    minutesBefore <= 5 ? "🔴 HIGH ALERT" :
    minutesBefore <= 15 ? "🟠 PREPARE" :
    minutesBefore <= 30 ? "🟡 APPROACHING" : "🟢 UPCOMING";

  return `Create a pre-event Forex warning in Myanmar language.

Event: ${eventName}
Time: ${minutesBefore} minutes before release
Forecast: ${forecast ?? "No forecast available"}
Previous: ${previous ?? "N/A"}
Urgency: ${urgency}

Write EXACTLY this format (Myanmar language):

${urgency} | ${minutesBefore} မိနစ် Warning

📌 Event: ${eventName}
📅 Forecast: ${forecast ?? "N/A"}
📌 Previous: ${previous ?? "N/A"}

💡 [Myanmar ဖြင့် ၁ ကြောင်း — ဘာကိုမျှော်မှန်းရမလဲ၊ risk level ဘယ်လောက်ရှိသလဲ]

Under 60 words total.`;
}

export interface NewsAnalysisInput {
  title: string;
  description: string | null;
  content: string | null;
  source: string;
  publishedAt: string;
  marketContext?: string;
}

export function buildNewsAnalysisPrompt(input: NewsAnalysisInput): string {
  const { title, description, content, source, publishedAt } = input;
  const body = content || description || "(no content)";
  const time = new Date(publishedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  return `You are a professional financial fundamental analyst.

Analyze the provided financial news article.
Explain: what happened, why it matters, market reaction, currency impact, gold impact, index impact, future risk.
Use only the provided data. Do not hallucinate.

News Source: ${source}
Published: ${time}
Title: ${title}
Content: ${body.slice(0, 1500)}

Write the analysis in Myanmar language EXACTLY in this format. No extra text outside the block:

🧠 AI Market Analysis

📌 သတင်းအကျဉ်း:
• [ဘာဖြစ်ခဲ့လဲ — တိုရှင်းပြပါ]

📊 အဓိကအချက်များ:
• [ဘာကြောင့် အရေးကြီးသလဲ — market context နဲ့]

📈 Fundamental Meaning:
• [ဆောင်းပါးရဲ့ fundamental သဘောကို ရှင်းပြပါ]

🌎 Market Impact:

Forex:
• USD: [UP/DOWN/NEUTRAL — Myanmar ဖြင့်]
• EUR: [UP/DOWN/NEUTRAL — Myanmar ဖြင့်]
• GBP: [UP/DOWN/NEUTRAL — Myanmar ဖြင့်]
• JPY: [UP/DOWN/NEUTRAL — Myanmar ဖြင့်]

Gold:
• [UP/DOWN/NEUTRAL — Myanmar ဖြင့်]

Index:
• SPX: [UP/DOWN/NEUTRAL — Myanmar ဖြင့်]
• NASDAQ: [UP/DOWN/NEUTRAL — Myanmar ဖြင့်]

Crypto:
• [UP/DOWN/NEUTRAL — Myanmar ဖြင့်]

🎯 Trader Focus:
• [Trader တွေ ဘာကိုကြည့်သင့်သလဲ — တိုတို]

Rules: Myanmar language only. Bullet points. Professional fundamental analyst style. Short but informative. No unnecessary words. Maximum 200 words.`;
}
