// Bounded retries for public, read-only queries. Never use for commerce writes.
function transient(error) {
  return error && (error.transient === true || [502, 503, 504].includes(error.status) ||
    ['PGRST000', 'PGRST001', 'PGRST002', '57014'].includes(error.code) ||
    ['AbortError', 'TimeoutError', 'TypeError'].includes(error.name) || /^TypeError: fetch failed/.test(error.message || ''));
}

async function publicRead(source, read, options = {}) {
  const timeout = options.timeout || 4000;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => read(controller.signal)),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort();
          const error = new Error('Public read timed out'); error.name = 'TimeoutError'; reject(error);
        }, timeout); })
      ]);
    } catch (error) {
      const cause = error.cause || error;
      const retryable = transient(cause);
      // Only fixed labels/codes: no database message, URL, headers or credentials.
      const code = /^[A-Z0-9_]{1,20}$/.test(cause.code || '') ? cause.code : 'READ_FAILED';
      if (options.log) options.log({ event: 'public_read_failed', source, attempt, code, retryable });
      if (attempt === 2 || !retryable) {
        const failure = new Error('Public data temporarily unavailable');
        failure.transient = retryable; throw failure;
      }
    } finally { clearTimeout(timer); }
  }
}

function queryResult(result) {
  if (result.error) {
    const error = new Error('Public query failed');
    error.cause = { ...result.error, status: result.status };
    throw error;
  }
  return result;
}

module.exports = { publicRead, queryResult };
