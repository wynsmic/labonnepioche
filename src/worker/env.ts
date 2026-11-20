export interface AppEnv {
  Bindings: {
    DB: D1Database;
    ASSETS: Fetcher;
    /** "openai" (default) or "claude". */
    LLM_PROVIDER?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL: string;
    ANTHROPIC_API_KEY?: string;
    CLAUDE_MODEL: string;
    APP_PASSWORD?: string;
    SESSION_SECRET?: string;
    /** "1": canned answers, no API key needed (local demo). */
    MOCK_AI?: string;
  };
}
