// Vercel Serverless Function: Migrate Studio Data
// Call this endpoint to convert JSON studio data to plain text in Supabase
// GET /api/migrate-studios

export default async function handler(req, res) {
  // Only allow POST or admin requests
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://uhujuwqiadymmogwkxc.supabase.co';
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoanVjd3FpYWR5bW1vZ213a3hjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTUxNjQ0NywiZXhwIjoyMDk3MDkyNDQ3fQ.C6aZ0KJBUn6J9SnX2o4XrITCp1WdoqxACKoV_YjkKBk';

  // Helper: Parse and clean studio JSON to plain text
  function parseStudio(studio) {
    if (!studio) return null;
    
    if (typeof studio === 'string') {
      const trimmed = studio.trim();
      
      if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
        return trimmed || null;
      }
      
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const result = parsed
            .map(s => {
              if (s === null || s === undefined) return '';
              if (typeof s === 'string') {
                const innerTrim = s.trim();
                if ((innerTrim.startsWith('"') && innerTrim.endsWith('"')) ||
                    (innerTrim.startsWith("'") && innerTrim.endsWith("'"))) {
                  try { return JSON.parse(innerTrim); } 
                  catch { return innerTrim.slice(1, -1); }
                }
                return s;
              }
              return String(s);
            })
            .filter(Boolean)
            .join(', ');
          return result || null;
        }
        return String(parsed) || null;
      } catch (e) {
        const match = trimmed.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g);
        if (match) {
          const result = match.map(m => {
            try { return JSON.parse(m); } catch { return m.replace(/^"|"$/g, ''); }
          }).filter(Boolean).join(', ');
          return result || null;
        }
        return trimmed || null;
      }
    }
    
    if (Array.isArray(studio)) {
      return studio.filter(Boolean).map(s => String(s)).join(', ') || null;
    }
    
    return String(studio) || null;
  }

  try {
    // Step 1: Fetch all rows with studio data
    console.log('Fetching data from anime_data table...');
    
    const fetchResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/anime_data?select=mal_id,studios&studios=not.is.null&limit=1000`,
      {
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!fetchResponse.ok) {
      throw new Error(`Failed to fetch data: ${fetchResponse.status} ${fetchResponse.statusText}`);
    }

    const data = await fetchResponse.json();
    
    // Step 2: Identify rows that need updating
    const rowsToUpdate = data.filter(row => {
      const studios = row.studios;
      if (!studios) return false;
      const str = typeof studios === 'string' ? studios : JSON.stringify(studios);
      return str.startsWith('[') || str.startsWith('{');
    });

    // Step 3: Update each row
    let successCount = 0;
    let errorCount = 0;

    for (const row of rowsToUpdate) {
      const cleanedStudio = parseStudio(row.studios);
      
      if (!cleanedStudio || cleanedStudio === row.studios) continue;

      try {
        const updateResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/anime_data?mal_id=eq.${row.mal_id}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ studios: cleanedStudio })
          }
        );
        
        if (updateResponse.ok) successCount++;
        else errorCount++;
        
        await new Promise(resolve => setTimeout(resolve, 30));
      } catch (err) {
        errorCount++;
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Migration completed',
      stats: {
        totalRowsWithStudios: data.length,
        rowsNeedingConversion: rowsToUpdate.length,
        successfullyUpdated: successCount,
        failed: errorCount
      },
      note: 'Studio data has been converted from JSON to plain text format'
    });

  } catch (error) {
    console.error('Migration error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
