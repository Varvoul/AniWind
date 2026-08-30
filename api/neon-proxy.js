// Vercel Serverless Function: Neon Database Proxy
// Location: /api/neon-proxy.js
// Access via: https://ruristream.vercel.app/api/neon-proxy
// 
// This function proxies requests to Neon PostgreSQL database
// using direct connection (bypasses REST API JWT requirement)

import pg from 'pg';

const { Pool } = pg;

// Neon Database Configuration (PostgreSQL)
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_Wdf5XkBVbx1i@ep-super-dawn-azjwdm9a-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  max: 2, // Small pool for serverless
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail fast if can't connect
});

export default async function handler(req, res) {
  // Enable CORS for all origins (required for browser fetch)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const { action } = req.body;

    // Validate action
    if (action !== 'get_frontend_data') {
      return res.status(400).json({ error: `Invalid action: ${action}` });
    }

    console.log(`[Neon Proxy] 🚀 Fetching data at ${new Date().toISOString()}`);

    // Get a client from the pool
    const client = await pool.connect();
    
    try {
      // Execute query - get all columns from frontend_data table
      const result = await client.query(`
        SELECT * FROM public_frontend_data LIMIT 1
      `);
      
      // Check if we got results
      if (!result.rows || result.rows.length === 0) {
        console.warn('[Neon Proxy] ⚠️ No data found in table');
        return res.status(404).json({ 
          error: 'No data found in public_frontend_data table',
          hint: 'Make sure your Cloudflare Worker has populated the table'
        });
      }

      const data = result.rows[0];
      const columnCount = Object.keys(data).length;
      
      console.log(`[Neon Proxy] ✅ Success! Fetched ${columnCount} columns`);

      // Return successful response with data
      return res.status(200).json({
        success: true,
        data: data,
        metadata: {
          columns: columnCount,
          columnNames: Object.keys(data),
          fetchedAt: new Date().toISOString(),
          source: 'neon_postgresql'
        }
      });

    } finally {
      // Always release the client back to the pool
      client.release();
    }

  } catch (error) {
    // Log detailed error for debugging
    console.error('[Neon Proxy] ❌ Error:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });

    // Return user-friendly error
    return res.status(500).json({
      error: 'Database query failed',
      message: error.message,
      code: error.code || 'UNKNOWN'
    });
  }
}

// Health check endpoint for monitoring
export async function healthCheck() {
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return { status: 'healthy', database: 'connected' };
    } finally {
      client.release();
    }
  } catch (error) {
    return { status: 'unhealthy', error: error.message };
  }
}
