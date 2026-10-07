/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_LOCAL_TEST_SESSION_ID?: string;
  readonly VITE_LOCAL_TEST_USER_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __ABP_RUNTIME_CONFIG__?: {
    apiBaseUrl?: string;
    localTestUserId?: string;
    localTestSessionId?: string;
  };
}
