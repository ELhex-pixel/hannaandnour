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
    const journal = await client.rpc('inventory_journal_schema_version');
    if (journal.error || journal.data !== 1) throw new Error('schema');
    const refunds = await client.rpc('admin_refunds_schema_version');
    if (refunds.error || refunds.data !== 1) throw new Error('schema');
    const categories = await client.rpc('catalog_categories_schema_version');
    if (categories.error || categories.data !== 1) throw new Error('schema');
    const deletion = await client.rpc('product_catalog_deletion_schema_version');
    if (deletion.error || deletion.data !== 1) throw new Error('schema');
    const returnsList = await client.rpc('return_lists_schema_version');
    if (returnsList.error || returnsList.data !== 1) throw new Error('schema');
    const physical = await client.rpc('physical_sales_schema_version');
    if (physical.error || physical.data !== 1) throw new Error('schema');
    const maintenance=await client.rpc('admin_maintenance_schema_version');
    if(maintenance.error||maintenance.data!==1)throw new Error('schema');
    const physicalPrices=await client.rpc('physical_prices_schema_version');
    if(physicalPrices.error||physicalPrices.data!==1)throw new Error('schema');
    const checkoutPickup=await client.rpc('checkout_pickup_schema_version');
    if(checkoutPickup.error||checkoutPickup.data!==1)throw new Error('schema');
    const activityPeriods=await client.rpc('activity_periods_schema_version');
    if(activityPeriods.error||activityPeriods.data!==1)throw new Error('schema');
    const orderShipping=await client.rpc('order_shipping_schema_version');
    if(orderShipping.error||orderShipping.data!==1)throw new Error('schema');
    const blogCommunity=await client.rpc('blog_community_schema_version');
    if(blogCommunity.error||blogCommunity.data!==1)throw new Error('schema');
    const authorizedCheckout=await client.rpc('authorized_checkout_schema_version');
    if(authorizedCheckout.error||authorizedCheckout.data!==1)throw new Error('schema');
    const promoLimits=await client.rpc('promo_customer_limits_schema_version');
    if(promoLimits.error||promoLimits.data!==1)throw new Error('schema');
    const shippingCountries=await client.rpc('shipping_country_rules_schema_version');
    if(shippingCountries.error||shippingCountries.data!==1)throw new Error('supabase/migration_shipping_country_rules.sql');
    for (const [table, columns] of [
      ['promo_codes','max_uses_per_customer'],
      ['orders', 'inventory_reserved,stock_issue,confirmation_claimed_at,admin_archived,payment_intent_id,refunded_cents,carrier,stripe_creation_started,refund_restock,prepared_at,return_policy,sale_channel,external_payment_method,pickup_point_data,payment_flow,checkout_lang,relance_sent_at,reminder_24h_sent_at'],
      ['order_payment_captures','order_id,session_id,payment_intent_id,amount_cents,currency,state,reason,created_at,updated_at'],
      ['order_items', 'stock_debited,net_total_cents,prepared_quantity,catalog_unit_price_cents,physical_price_note'],
      ['return_requests', 'evidence_paths,category,shipping_payer,decision_note,admin_hidden_at'],
      ['order_returns','sellable_quantity,inspection_note'],
      ['variant_costs','variant_id,unit_cost_cents,currency,updated_at'],
      ['variant_cost_history','id,variant_id,unit_cost_cents,currency,reason,created_at'],
      ['order_item_costs','order_item_id,unit_cost_cents,currency,created_at'],
      ['products', 'search_vector,fit_fr,measurements_fr,opacity,video_url,catalog_deleted_at'],
      ['inventory_adjustments', 'id,variant_id,mode,quantity,expected_stock,stock_before,stock_after,reason,product_name,color,size,barcode,created_at'],
      ['inventory_journal_resets', 'id,archived_count,created_at'],
      ['inventory_journal_archives', 'adjustment_id,reset_id'],
      ['order_refund_operations', 'id,order_id,kind,request,amount_cents,shipping_cents,currency,base_refunded_cents,lines,status,stripe_refund_id,stripe_started_at,email_claimed_at'],
      ['physical_sale_operations','id,order_id,request,result,created_at'],
      ['admin_maintenance_operations','id,kind,reason,request,result,created_at'],
      ['admin_activity_periods','id,previous_id,started_at,reason'],
      ['order_shipping_operations','id,order_id,request,provider_request,order_guard,state,result,created_at,confirmed_at'],
      ['blog_posts','translations'],
      ['blog_submissions','id,user_id,author_name,title,category,body,image,lang,status,decision_note,published_post_id,published_slug,created_at,updated_at'],
      ['blog_submission_decisions','id,submission_id,request,result'],
      ['blog_editorial_backups','post_id,revision,snapshot']
    ]) {
      const { error: tableError } = await client.from(table).select(columns).limit(0);
      if (tableError) throw new Error('schema');
    }
  } catch (error) {
    if(error.message==='supabase/migration_shipping_country_rules.sql')throw new Error('Publication bloquée : exécuter et confirmer supabase/migration_shipping_country_rules.sql. Aucune migration distante automatique.');
    throw new Error('Publication bloquée : vérifier les migrations existantes, dont supabase/migration_integrity_features.sql, supabase/migration_admin_inventory.sql, supabase/migration_admin_operations.sql, supabase/migration_return_policy_editor.sql, supabase/migration_catalog_cleanup.sql, supabase/migration_inventory_journal.sql, supabase/migration_partial_refunds.sql, supabase/migration_catalog_categories.sql, supabase/migration_catalog_return_cleanup.sql, supabase/migration_physical_sales.sql, supabase/migration_admin_maintenance.sql, supabase/migration_physical_prices.sql, supabase/migration_checkout_pickup.sql, supabase/migration_activity_periods.sql, supabase/migration_order_shipping.sql, supabase/migration_blog_community.sql, supabase/migration_authorized_checkout.sql et supabase/migration_promo_customer_limits.sql. Aucune migration distante n’a été exécutée automatiquement.');
  }
  console.log('Compatibilité Supabase vérifiée en lecture seule.');
}

module.exports = { preflight };
