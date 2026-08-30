// Vercel Serverless Function: Neon Database Proxy
// Simple version using node-postgres (pg) which works in Node.js 18+

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

    console.log('[Neon Proxy] 🚀 Connecting to Neon DB at:', new Date().toISOString());

    // Try multiple connection methods
    let data = null;
    
    // Method 1: Try @neondatabase/serverless
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sql = neon('postgresql://neondb_owner:npg_Wdf5XkBVbx1i@ep-super-dawn-azjwdm9a-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
      const result = await sql`SELECT * FROM public_frontend_data LIMIT 1`;
      if (result && result.length > 0) {
        data = result[0];
        console.log('[Neon Proxy] ✅ Connected via @neondatabase/serverless');
      }
    } catch (neonError) {
      console.warn('[Neon Proxy] ⚠️ @neondatabase/serverless failed:', neonError.message);
      
      // Method 2: Try pg (node-postgres)
      try {
        const pg = await import('pg');
        const { Pool } = pg.default || pg;
        
        const pool = new Pool({
          connectionString: 'postgresql://neondb_owner:npg_Wdf5XkBVbx1i@ep-super-dawn-azjwdm9a-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
          max: 1,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 10000,
        });
        
        const client = await pool.connect();
        try {
          const result = await client.query('SELECT * FROM public_frontend_data LIMIT 1');
          if (result.rows && result.rows.length > 0) {
            data = result.rows[0];
            console.log('[Neon Proxy] ✅ Connected via pg (node-postgres)');
          }
        } finally {
          client.release();
          await pool.end();
        }
      } catch (pgError) {
        console.error('[Neon Proxy] ❌ Both methods failed:', { 
          neonError: neonError.message, 
          pgError: pgError.message 
        });
        throw new Error(`DB connection failed: ${pgError.message}`);
      }
    }
    
    if (!data) {
      return res.status(404).json({ 
        error: 'No data found',
        hint: 'Table may be empty'
      });
    }

    return res.status(200).json({
      success: true,
      data: data,
      metadata: {
        columns: Object.keys(data).length,
        columnNames: Object.keys(data),
        fetchedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[Neon Proxy] ❌ Fatal error:', error);
    
    return res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
