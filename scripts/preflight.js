async function preflight(env = process.env, client) {
  if (!env.NETLIFY && !env.CONTEXT) return;
  if (env.NETLIFY_DEV === 'true' || env.CONTEXT === 'dev') return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Publication bloquée : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être disponibles pour le build du site ciblé.');
  if (!client) {
    const { createClient } = require('@supabase/supabase-js');
    const { WebSocket } = require('ws');
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { realtime: { transport: WebSocket }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  }
  try {
    const { data, error } = await client.rpc('commerce_schema_version');
    if (error || data !== 1) throw new Error('schema');
    for (const [table, columns] of [
      ['orders', 'inventory_reserved,stock_issue,confirmation_claimed_at,admin_archived,payment_intent_id,refunded_cents,carrier,stripe_creation_started,refund_restock'],
      ['order_items', 'stock_debited,net_total_cents'],
      ['return_requests', 'evidence_paths'],
      ['products', 'search_vector,fit_fr,measurements_fr,opacity,video_url']
    ]) {
      const { error: tableError } = await client.from(table).select(columns).limit(0);
      if (tableError) throw new Error('schema');
    }
  } catch (error) {
    throw new Error('Publication bloquée : la base du site ciblé doit recevoir supabase/migration_integrity_features.sql (et ses prérequis). Aucune migration distante n’a été exécutée automatiquement.');
  }
  console.log('Compatibilité Supabase vérifiée en lecture seule.');
}

module.exports = { preflight };
