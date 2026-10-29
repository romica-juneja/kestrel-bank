import type { ReadOnlyTools } from './tools.js';
import { CATEGORIES } from './tools.js';
import { runTool, SYSTEM_PROMPT, type ChatTurn } from './llmAssistant.js';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_accounts',
      description: "List the customer's accounts with current balances.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_transactions',
      description: "Most recent transactions across the customer's accounts, newest first.",
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 20 } },
        required: ['limit'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_spending',
      description: 'Total spending (debits, excluding transfers between accounts) by category for a period.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['this_month', 'last_month', 'last_30_days'] },
          category: { type: 'string', enum: [...CATEGORIES] },
        },
        required: ['period'],
        additionalProperties: false,
      },
    },
  },
];

type ToolCall = { id: string; function: { name: string; arguments: string } };

/** Answers using the OpenAI Chat Completions API with the same read-only tools. */
export async function answerWithOpenAi(
  history: ChatTurn[],
  message: string,
  tools: ReadOnlyTools,
  opts: { apiKey: string; model: string; fetchImpl?: typeof fetch },
): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: message },
  ];

  for (let step = 0; step < 5; step++) {
    const res = await doFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({ model: opts.model, max_tokens: 600, messages, tools: TOOLS }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`OpenAI request failed with status ${res.status}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
    };
    const reply = data.choices?.[0]?.message;
    const toolCalls = reply?.tool_calls ?? [];
    if (!reply || toolCalls.length === 0) return (reply?.content ?? '').trim();

    messages.push(reply);
    for (const call of toolCalls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        input = {};
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(runTool(tools, call.function.name, input)),
      });
    }
  }
  return "Sorry, I couldn't work that out. Try asking a simpler question.";
}
