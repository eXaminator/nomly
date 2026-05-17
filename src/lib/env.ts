const required = (key: string): string => {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        "See .env.example for the full list.",
    );
  }
  return value;
};

const optional = (key: string): string | undefined => {
  const v = process.env[key];
  return v && v.trim() !== "" ? v : undefined;
};

const lazy = <T,>(fn: () => T): (() => T) => {
  let cached: { value: T } | undefined;
  return () => {
    if (!cached) cached = { value: fn() };
    return cached.value;
  };
};

export const env = {
  get BASE_URL() {
    return required("BASE_URL");
  },
  get SESSION_SECRET() {
    const s = required("SESSION_SECRET");
    if (s.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters.");
    }
    return s;
  },
  get OIDC_ISSUER() {
    return required("OIDC_ISSUER");
  },
  get OIDC_CLIENT_ID() {
    return required("OIDC_CLIENT_ID");
  },
  get OIDC_CLIENT_SECRET() {
    return required("OIDC_CLIENT_SECRET");
  },
  get OIDC_END_SESSION_URL() {
    return optional("OIDC_END_SESSION_URL");
  },
  get DATABASE_URL() {
    return optional("DATABASE_URL") ?? "./data/nomly.db";
  },
};

/** Validate at boot and surface a single readable error. */
export const assertEnv = lazy(() => {
  void env.BASE_URL;
  void env.SESSION_SECRET;
  void env.OIDC_ISSUER;
  void env.OIDC_CLIENT_ID;
  void env.OIDC_CLIENT_SECRET;
  return true;
});
