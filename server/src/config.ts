export const config = {
  port: Number(process.env.PORT ?? 4000),
  isProduction: process.env.NODE_ENV === 'production',
  /** Path to the SQLite file. ":memory:" gives a fresh, seeded database on every start. */
  databasePath: process.env.DATABASE_PATH ?? ':memory:',
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 30),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
} as const;
