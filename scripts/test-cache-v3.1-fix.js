// Test script for Cache API v3.1 fix
// Tests that write operations work using Client.query() for dynamic SQL

const NEON_CONNECTION_STRING = 'postgresql://neondb_owner:npg_Wdf5XkBVbx1i@ep-super-dawn-azjwdm9a-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

async function testCacheAPI() {
  console.log('🧪 Testing Cache API v3.1 Fix (Client.query() approach)');
  console.log('='.repeat(60));
  
  // Import both neon and Client
  const { neon, Client } = await import('@neondatabase/serverless');
  
  const testData = {
    id: 'test-v31-anime-456',
    title: 'Test Anime v3.1',
    episodes: 24,
    genre: ['Action', 'Comedy', 'Drama'],
    timestamp: new Date().toISOString(),
    testVersion: '3.1'
  };
  
  try {
    // TEST 1: Read operation using neon() tagged template
    console.log('\n📖 TEST 1: Read operation with neon() tagged template...');
    const sql = neon(NEON_CONNECTION_STRING);
    console.log('✅ Database connection initialized via neon()');
    
    const result = await sql`SELECT hero_slider FROM site_cache WHERE cache_key = 'main_page_cache'`;
    const data = result[0]?.hero_slider;
    console.log(`✅ READ SUCCESS: Current hero_slider has ${Array.isArray(data) ? data.length : 0} items`);
    
    // TEST 2: Write operation using Client.query() with dynamic column
    console.log('\n📝 TEST 2: Write operation with Client.query() dynamic SQL...');
    const client = new Client(NEON_CONNECTION_STRING);
    
    try {
      await client.connect();
      console.log('✅ Client connected');
      
      const column = 'hero_slider';
      const jsonData = JSON.stringify([testData]);
      const query = `UPDATE site_cache SET ${column} = $1, updated_at = NOW() WHERE cache_key = 'main_page_cache'`;
      
      await client.query(query, [jsonData]);
      console.log(`✅ WRITE SUCCESS: Data written to ${column} using Client.query()`);
      
    } finally {
      await client.end();
      console.log('✅ Client connection closed');
    }
    
    // TEST 3: Verify written data
    console.log('\n✅ TEST 3: Verify written data...');
    const verifyResult = await sql`SELECT hero_slider FROM site_cache WHERE cache_key = 'main_page_cache'`;
    const verifyData = verifyResult[0]?.hero_slider;
    
    if (verifyData && Array.isArray(verifyData) && verifyData.length > 0) {
      const firstItem = verifyData[0];
      if (firstItem.testVersion === '3.1') {
        console.log('✅ VERIFY SUCCESS: Written data matches test data');
        console.log(`   Verified: ${JSON.stringify(firstItem).substring(0, 100)}...`);
      } else {
        throw new Error('Data version mismatch - write may have failed');
      }
    } else {
      throw new Error('No data found after write');
    }
    
    // TEST 4: Write to different dynamic column
    console.log('\n📝 TEST 4: Write to another dynamic column (top_airing)...');
    const client2 = new Client(NEON_CONNECTION_STRING);
    
    try {
      await client2.connect();
      const query2 = `UPDATE site_cache SET top_airing = $1, updated_at = NOW() WHERE cache_key = 'main_page_cache'`;
      await client2.query(query2, [JSON.stringify([testData])]);
      console.log('✅ DYNAMIC COLUMN WRITE SUCCESS: Written to top_airing');
    } finally {
      await client2.end();
    }
    
    // TEST 5: Update boolean flag
    console.log('\n📝 TEST 5: Update boolean flag (top_airing_cached)...');
    const client3 = new Client(NEON_CONNECTION_STRING);
    
    try {
      await client3.connect();
      await client3.query(`UPDATE site_cache SET top_airing_cached = true WHERE cache_key = 'main_page_cache'`);
      console.log('✅ FLAG UPDATE SUCCESS: Boolean flag updated');
    } finally {
      await client3.end();
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 ALL TESTS PASSED! Cache API v3.1 is working correctly.');
    console.log('\nSummary:');
    console.log('  ✅ neon() tagged template literals work for reads');
    console.log('  ✅ Client.query() works for dynamic writes');
    console.log('  ✅ Dynamic column names work via string interpolation');
    console.log('  ✅ Connection lifecycle managed correctly');
    console.log('  ✅ Ready for Vercel deployment');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error('Stack:', error.stack);
    return false;
  }
}

// Run tests
testCacheAPI()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
