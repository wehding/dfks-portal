export type ImportOAuthEnvironment = Record<string, string | undefined>;

function normalizedOrigin(value: string, variableName: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} skal være en gyldig http- eller https-adresse`);
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${variableName} skal være en gyldig http- eller https-adresse`);
  }

  return url.origin;
}

export function importOAuthCallbackOrigin(
  requestOrigin: string,
  environment: ImportOAuthEnvironment,
) {
  const explicitOrigin = environment.IMPORT_OAUTH_CALLBACK_ORIGIN?.trim();
  if (explicitOrigin) {
    return normalizedOrigin(explicitOrigin, "IMPORT_OAUTH_CALLBACK_ORIGIN");
  }

  const isLocalDevelopment = !environment.VERCEL_ENV && environment.NODE_ENV !== 'production';
  if (isLocalDevelopment) {
    const requestUrl = new URL(requestOrigin);
    const port = requestUrl.port || environment.PORT?.trim() || '3000';
    return `http://localhost:${port}`;
  }

  const configuredOrigin = environment.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredOrigin) {
    return normalizedOrigin(configuredOrigin, "NEXT_PUBLIC_SITE_URL");
  }

  return normalizedOrigin(requestOrigin, "OAuth request origin");
}
