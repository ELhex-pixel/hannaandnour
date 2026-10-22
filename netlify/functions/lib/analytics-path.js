function internalPath(value) {
  if (typeof value !== 'string') return false;
  const raw = value.split(/[?#]/)[0];
  return /^\/(?:fr\/|en\/|ar\/)?(?:admin|stock|print)(?:\.html)?\/?$/i.test(raw) || /^\/(?:api|\.netlify\/functions)(?:\/|$)/i.test(raw);
}
module.exports = { internalPath };
