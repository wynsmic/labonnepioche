export interface AppEnv {
  Bindings: {
    DB: D1Database;
    ASSETS: Fetcher;
    ANTHROPIC_API_KEY?: string;
    APP_PASSWORD?: string;
    SESSION_SECRET?: string;
    CLAUDE_MODEL: string;
    /** "1": canned Claude answers, no API key needed (local demo). */
    MOCK_CLAUDE?: string;
  };
}
