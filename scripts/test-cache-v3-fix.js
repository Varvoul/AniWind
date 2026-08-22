// Test script for Cache API v3.0 fix
// Tests that write operations work without sql.unsafe()

const NEON_CONNECTION_STRING = 'postgresql://neondb_owner:npg_Wdf5XkBVbx1i@ep-super-dawn-azjwdm9a-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

async function testCacheAPI() {
  console.log('🧪 Testing Cache API v3.0 Fix');
  console.log('='.repeat(50));
  
  // Dynamic import to test the module
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(NEON_CONNECTION_STRING);
  
  console.log('✅ Database connection initialized');
  
  const testData = {
    id: 'test-anime-123',
    title: 'Test Anime',
    episodes: 12,
    genre: ['Action', 'Adventure'],
    timestamp: new Date().toISOString()
  };
  
  try {
    // TEST 1: Write operation (this was failing with sql.unsafe)
    console.log('\n📝 TEST 1: Write operation with tagged template literal...');
    await sql`UPDATE site_cache SET hero_slider = ${JSON.stringify([testData])}, updated_at = NOW() WHERE cache_key = 'main_page_cache'`;
    console.log('✅ WRITE SUCCESS: Data written using tagged template literal');
    
    // TEST 2: Read operation
    console.log('\n📖 TEST 2: Read operation...');
    const result = await sql`SELECT hero_slider FROM site_cache WHERE cache_key = 'main_page_cache'`;
    const data = result[0]?.hero_slider;
    
    if (data && Array.isArray(data) && data.length > 0) {
      console.log('✅ READ SUCCESS: Data retrieved successfully');
      console.log(`   Sample data: ${JSON.stringify(data[0]).substring(0, 100)}...`);
    } else {
      throw new Error('No data returned from read');
    }
    
    // TEST 3: Write with dynamic column name
    console.log('\n📝 TEST 3: Write with dynamic column name...');
    const column = 'top_airing';
    const jsonData = JSON.stringify([testData]);
    await sql`UPDATE site_cache SET ${sql(column)} = ${jsonData}, updated_at = NOW() WHERE cache_key = 'main_page_cache'`;
    console.log(`✅ DYNAMIC COLUMN WRITE SUCCESS: Written to ${column}`);
    
    // TEST 4: Update boolean flag
    console.log('\n📝 TEST 4: Update boolean flag...');
    const flagCol = 'top_airing_cached';
    await sql`UPDATE site_cache SET ${sql(flagCol)} = true WHERE cache_key = 'main_page_cache'`;
    console.log(`✅ FLAG UPDATE SUCCESS: ${flagCol} set to true`);
    
    console.log('\n' + '='.repeat(50));
    console.log('🎉 ALL TESTS PASSED! Cache API v3.0 is working correctly.');
    console.log('\nSummary:');
    console.log('  ✅ Tagged template literals work');
    console.log('  ✅ Dynamic column names work via ${sql(column)}');
    console.log('  ✅ No sql.unsafe() needed');
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
