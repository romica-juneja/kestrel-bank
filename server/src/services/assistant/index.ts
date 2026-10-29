import type { Db } from '../../db/connection.js';
import { answerWithLlm, type ChatTurn } from './llmAssistant.js';
import { answerWithRules } from './mockAssistant.js';
import { answerWithOpenAi } from './openaiAssistant.js';
import { createReadOnlyTools } from './tools.js';

export interface AssistantOptions {
  apiKey?: string;
  model: string;
  openaiApiKey?: string;
  openaiModel?: string;
  fetchImpl?: typeof fetch;
}

export async function askAssistant(
  db: Db,
  customerId: string,
  message: string,
  history: ChatTurn[],
  opts: AssistantOptions,
  now = new Date(),
): Promise<{ reply: string; source: 'llm' | 'rules' }> {
  const tools = createReadOnlyTools(db, customerId, now);
  if (opts.openaiApiKey) {
    try {
      const reply = await answerWithOpenAi(history, message, tools, {
        apiKey: opts.openaiApiKey,
        model: opts.openaiModel || 'gpt-4o-mini',
        fetchImpl: opts.fetchImpl,
      });
      if (reply) return { reply, source: 'llm' };
    } catch (err) {
      console.warn('Assistant OpenAI call failed, trying the next responder:', (err as Error).message);
    }
  }
  if (opts.apiKey) {
    try {
      const reply = await answerWithLlm(history, message, tools, { apiKey: opts.apiKey, model: opts.model, fetchImpl: opts.fetchImpl });
      if (reply) return { reply, source: 'llm' };
    } catch (err) {
      console.warn('Assistant LLM call failed, falling back to rules:', (err as Error).message);
    }
  }
  return { reply: answerWithRules(message, tools), source: 'rules' };
}
