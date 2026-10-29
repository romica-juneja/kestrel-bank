import { createApp } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db/connection.js';
import { DEMO_PASSWORD } from './db/seed.js';

const db = openDatabase({ path: config.databasePath });
const app = createApp(db);

app.listen(config.port, () => {
  console.log(`Kestrel Bank API listening on http://localhost:${config.port}`);
  console.log(`Demo users: alex / ${DEMO_PASSWORD}  and  sam / ${DEMO_PASSWORD}`);
  const assistantMode = config.openaiApiKey
    ? `ChatGPT (${config.openaiModel})`
    : config.anthropicApiKey
      ? `Claude (${config.anthropicModel})`
      : 'rule-based (set OPENAI_API_KEY or ANTHROPIC_API_KEY for an LLM)';
  console.log(`Assistant mode: ${assistantMode}`);
});
