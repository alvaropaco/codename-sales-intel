/**
 * Global fetch guard: when any protected API call returns 401 (expired or
 * missing session), it dispatches a DOM event so the app can drop back to the
 * login screen instead of silently rendering empty data.
 *
 * /api/auth/* calls are excluded because 401 there is the expected "not
 * authenticated" response used to detect the login state on boot.
 */
const originalFetch = window.fetch.bind(window);

window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
  const response = await originalFetch(...args);

  let url = '';
  try {
    const input = args[0];
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof Request) {
      url = input.url;
    } else if (input instanceof URL) {
      url = input.href;
    } else if (input && typeof input === 'object') {
      url = String((input as { url?: string }).url || '');
    }
  } catch {
    // ignore URL extraction failures
  }

  if (response.status === 401 && url.includes('/api/') && !url.includes('/api/auth/')) {
    window.dispatchEvent(new Event('b2base:unauthorized'));
  }

  return response;
};
