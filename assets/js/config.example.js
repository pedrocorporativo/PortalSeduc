window.APP_CONFIG = Object.freeze({
  supabaseUrl: "https://SEU-PROJETO.supabase.co",
  supabaseAnonKey: "SUA_CHAVE_ANON_PUBLICA",
  // Deve retornar exclusivamente o JWT curto da sessão autenticada.
  // Nunca use service_role no navegador.
  getAccessToken: () => window.__SEDUC_ACCESS_TOKEN__ || ""
});
