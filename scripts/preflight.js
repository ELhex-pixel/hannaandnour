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
    const inventory = await client.rpc('admin_inventory_schema_version');
    if (inventory.error || inventory.data !== 1) throw new Error('schema');
    const operations = await client.rpc('admin_operations_schema_version');
    if (operations.error || operations.data !== 1) throw new Error('schema');
    const returnEditor = await client.rpc('return_policy_editor_schema_version');
    if (returnEditor.error || returnEditor.data !== 1) throw new Error('schema');
    const catalog = await client.rpc('admin_catalog_schema_version');
    if (catalog.error || catalog.data !== 1) throw new Error('schema');
    for (const [table, columns] of [
      ['orders', 'inventory_reserved,stock_issue,confirmation_claimed_at,admin_archived,payment_intent_id,refunded_cents,carrier,stripe_creation_started,refund_restock,prepared_at,return_policy'],
      ['order_items', 'stock_debited,net_total_cents,prepared_quantity'],
      ['return_requests', 'evidence_paths,category,shipping_payer,decision_note'],
      ['order_returns','sellable_quantity,inspection_note'],
      ['variant_costs','variant_id,unit_cost_cents,currency,updated_at'],
      ['variant_cost_history','id,variant_id,unit_cost_cents,currency,reason,created_at'],
      ['order_item_costs','order_item_id,unit_cost_cents,currency,created_at'],
      ['products', 'search_vector,fit_fr,measurements_fr,opacity,video_url'],
      ['inventory_adjustments', 'id,variant_id,mode,quantity,expected_stock,stock_before,stock_after,reason,product_name,color,size,barcode,created_at']
    ]) {
      const { error: tableError } = await client.from(table).select(columns).limit(0);
      if (tableError) throw new Error('schema');
    }
  } catch (error) {
    throw new Error('Publication bloquée : la base du site ciblé doit recevoir supabase/migration_integrity_features.sql puis supabase/migration_admin_inventory.sql puis supabase/migration_admin_operations.sql puis supabase/migration_return_policy_editor.sql puis supabase/migration_catalog_cleanup.sql (et leurs prérequis). Aucune migration distante n’a été exécutée automatiquement.');
  }
  console.log('Compatibilité Supabase vérifiée en lecture seule.');
}

module.exports = { preflight };
