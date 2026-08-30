// Vercel Serverless Function: Neon Database Proxy
// Uses fetch to call Neon's SQL endpoint (works in Vercel edge)

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action } = req.body;
    
    if (action !== 'get_frontend_data') {
      return res.status(400).json({ error: 'Invalid action' });
    }

    console.log('[Neon Proxy] 🚀 Connecting to Neon DB...');

    // Dynamic import of neon serverless driver (works in Vercel)
    const { neon } = await import('@neondatabase/serverless');
    
    // Create SQL connection
    const sql = neon('postgresql://neondb_owner:npg_Wdf5XkBVbx1i@ep-super-dawn-azjwdm9a-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
    
    // Execute query
    const result = await sql`SELECT * FROM public_frontend_data LIMIT 1`;
    
    if (!result || result.length === 0) {
      return res.status(404).json({ 
        error: 'No data found',
        hint: 'Check if table has data'
      });
    }

    const data = result[0];
    
    console.log(`[Neon Proxy] ✅ Success! ${Object.keys(data).length} columns`);

    return res.status(200).json({
      success: true,
      data: data,
      metadata: {
        columns: Object.keys(data).length,
        columnNames: Object.keys(data),
        fetchedAt: new Date().toISOString(),
        source: 'neon_serverless'
      }
    });

  } catch (error) {
    console.error('[Neon Proxy] ❌ Error:', error);
    
    return res.status(500).json({
      error: error.message,
      type: error.constructor.name
    });
  }
}
