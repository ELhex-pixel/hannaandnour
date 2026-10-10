/**
 * GET /api/blog
 * Public: list of active blog posts (newest first) or a single post by slug.
 * Open the post page at blog-post.html?slug=<slug>.
 */
const { json, getSupabase, isConfigured } = require('./shared');
const { publicRead, queryResult } = require('./lib/public-read');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204 };
  }
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    if (!isConfigured()) {
      return json(503, { error: 'Supabase is not configured' });
    }
    const sb = getSupabase();
    const slug = String((event.queryStringParameters || {}).slug || '').trim();
    if (slug && !require('../../public/js/content').validSlug(slug)) return json(400, { error: 'Invalid article slug' });
    const { data } = await publicRead('blog', async signal => {
      let query = sb.from('blog_posts').select('slug,title,category,excerpt,body,image,author,read_minutes,published_at').eq('active', true);
      query = slug ? query.eq('slug', slug).maybeSingle() : query.order('published_at', { ascending: false });
      return queryResult(await query.abortSignal(signal));
    }, { log: entry => console.warn(JSON.stringify(entry)) });
    const { generalPost } = require('./lib/brand-copy');
    return json(200, slug ? { post: data ? generalPost(data) : null } : { posts: (data || []).map(generalPost) });
  } catch (err) {
    return json(err.transient ? 503 : 500, { error: 'Articles temporarily unavailable' });
  }
};
