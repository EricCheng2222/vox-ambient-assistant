declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    // Service binding to the Vox Flash Cards Worker (Workers on one account
    // cannot reach each other through their public workers.dev URLs).
    FLASHCARDS?: Fetcher;
    BUCKET?: R2Bucket;
    SIP_CALLS?: DurableObjectNamespace;
  }
}
