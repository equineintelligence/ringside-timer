// Ringside Timer — public configuration
// ------------------------------------------------------------------
// Put your Supabase project URL and your PUBLIC anon / publishable key here.
// Both are SAFE to be public: the key only lets the website call your
// Edge Function, and the database table is locked with Row Level Security.
//
// NEVER put your Anthropic API key in this file (or anywhere in this repo).
// That key lives only in Supabase as the secret ANTHROPIC_API_KEY.
//
// These values are also used for sign-in (Supabase Auth). Without them,
// nobody can sign in, so the app can't be used.
window.RINGSIDE_CONFIG = {
  SUPABASE_URL: "https://eigjxfdgnnkkbkqsnfof.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_BOynTow58QDGZ_7ji6WjJg_9U0F5OO0",
  // Optional: an email address people can use for privacy/account requests (POPIA).
  // Shown on the sign-in page. Leave "" to hide it.
  CONTACT_EMAIL: ""
};
