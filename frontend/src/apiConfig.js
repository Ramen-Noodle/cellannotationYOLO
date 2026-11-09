const configuredApiUrl = process.env.REACT_APP_API_BASE_URL?.trim()
if (!configuredApiUrl) {
  throw new Error('Set REACT_APP_API_BASE_URL in the repository root .env file.')
}

export const API_BASE_URL = configuredApiUrl.replace(/\/+$/, '')
