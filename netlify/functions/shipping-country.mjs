// Netlify Functions v2 exposes trusted, approximate country metadata in context.
// Only the country is returned: no IP, city, coordinates, logs or external lookup.
export default async function shippingCountry(request, context = {}) {
  const headers = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'private, no-store', 'Netlify-CDN-Cache-Control':'no-store', 'Allow':'GET' };
  if (request.method !== 'GET') return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers});
  const value = context.geo?.country?.code;
  const country = typeof value === 'string' && /^[A-Z]{2}$/i.test(value) ? value.toUpperCase() : null;
  return new Response(JSON.stringify({country}),{status:200,headers});
}
