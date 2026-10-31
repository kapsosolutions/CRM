/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_ADMIN_TOKEN_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
