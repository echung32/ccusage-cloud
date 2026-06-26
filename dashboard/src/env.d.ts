/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_AUTH_GATEWAY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
