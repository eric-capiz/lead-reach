/** One Google Cloud API key; restrict which APIs it can call in Cloud Console (Maps, Custom Search, etc.). */
export function getGoogleApiKey(): string | undefined {
  const v = process.env.GOOGLE_API_KEY?.trim();
  return v ? v : undefined;
}
