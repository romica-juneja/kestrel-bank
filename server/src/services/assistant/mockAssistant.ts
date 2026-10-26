import { formatCents } from '../../lib/money.js';
import { CATEGORIES, type Period, type ReadOnlyTools } from './tools.js';

const CATEGORY_SYNONYMS: Record<string, (typeof CATEGORIES)[number]> = {
  grocery: 'groceries', groceries: 'groceries', supermarket: 'groceries', food: 'groceries',
  dining: 'dining', restaurant: 'dining', restaurants: 'dining', coffee: 'dining', eating: 'dining',
  transport: 'transport', travel: 'transport', fuel: 'transport', gas: 'transport', transit: 'transport',
  utilities: 'utilities', bills: 'utilities', power: 'utilities', phone: 'utilities',
  entertainment: 'entertainment', subscriptions: 'entertainment', streaming: 'entertainment',
  shopping: 'shopping', rent: 'housing', housing: 'housing',
};

/**
 * Rule-based fallback used when no LLM API key is configured. Handles the common questions
 * from the brief with the same read-only tools the LLM uses.
 */
export function answerWithRules(message: string, tools: ReadOnlyTools): string {
  const text = message.toLowerCase();

  if (/\b(transfer|send|pay|move|withdraw)\b/.test(text) && !/\b(how much|spent|spend)\b/.test(text)) {
    return "I can only look at your accounts, not move money. To make a transfer, open the Transfer screen.";
  }

  if (/\bbalance|how much (do i have|is in)\b/.test(text)) {
    const accounts = tools.getAccounts();
    const wanted = accounts.filter((a) => text.includes(a.type));
    const shown = wanted.length ? wanted : accounts;
    return shown.map((a) => `Your ${a.name} (${a.number}) balance is ${a.balance}.`).join(' ');
  }

  if (/\b(spend|spent|spending|cost)\b/.test(text)) {
    const period: Period = /last month/.test(text) ? 'last_month' : /30 days/.test(text) ? 'last_30_days' : 'this_month';
    const word = Object.keys(CATEGORY_SYNONYMS).find((w) => new RegExp(`\\b${w}\\b`).test(text));
    const category = word ? CATEGORY_SYNONYMS[word] : undefined;
    const result = tools.getSpending(period, category);
    if (category) {
      const row = result.categories[0];
      return row
        ? `You spent ${row.total} on ${category} ${result.period}, across ${row.transactions} transactions.`
        : `You haven't spent anything on ${category} ${result.period}.`;
    }
    if (!result.categories.length) return `You haven't spent anything ${result.period}.`;
    const total = result.categories.reduce((s, c) => s + c.totalCents, 0);
    const top = result.categories.slice(0, 4).map((c) => `${c.category} ${c.total}`).join(', ');
    return `You spent ${formatCents(total)} ${result.period}. Biggest categories: ${top}.`;
  }

  if (/\b(transactions?|activity|history|purchases)\b/.test(text)) {
    const n = Number(text.match(/\b(\d{1,2})\b/)?.[1] ?? (/\bfive\b/.test(text) ? 5 : /\bten\b/.test(text) ? 10 : 5));
    const rows = tools.getRecentTransactions(n);
    const lines = rows.map((t) => `${t.date}  ${t.description}  ${t.type === 'debit' ? '−' : '+'}${t.amount}`);
    return `Your last ${rows.length} transactions:\n${lines.join('\n')}`;
  }

  return 'I can answer questions about your own accounts, for example "What is my checking balance?", "How much did I spend on groceries this month?" or "Show my last five transactions."';
}
