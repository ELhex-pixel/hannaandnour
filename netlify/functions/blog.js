/**
 * GET /api/blog
 * Public: list of active blog posts (newest first) or a single post by slug.
 * Open the post page at blog-post.html?slug=<slug>.
 */
const { json, getSupabase, isConfigured } = require('./shared');

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

    if (slug) {
      try {
        const { data, error } = await sb
          .from('blog_posts')
          .select('*')
          .eq('slug', slug)
          .eq('active', true)
          .maybeSingle();
        if (error) throw error;
        return json(200, { post: data || null });
      } catch (err) {
        return json(200, { post: null });
      }
    }

    try {
      const { data, error } = await sb
        .from('blog_posts')
        .select('*')
        .eq('active', true)
        .order('published_at', { ascending: false });
      if (error) throw error;
      return json(200, { posts: data || [] });
    } catch (err) {
      return json(200, { posts: [], note: 'Table blog_posts indisponible' });
    }
  } catch (err) {
    console.error('blog.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};