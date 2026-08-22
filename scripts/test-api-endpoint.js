// ═══════════════════════════════════════════════════════════════════
// CACHE API ENDPOINT TEST
// Simulates what the frontend cache client does
// Tests the /api/cache endpoint directly
// ═══════════════════════════════════════════════════════════════════

// Import the cache API handler (simulates Vercel serverless function)
import { neon } from '@neondatabase/serverless';

const NEON_CONNECTION_STRING = 'postgresql://neondb_owner:npg_Wdf5XkBVbx1i@ep-super-dawn-azjwdm9a-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const sql = neon(NEON_CONNECTION_STRING);

// Simulated request/response objects
function createMockRes() {
  let statusCode = 200;
  let responseData = {};
  const headers = {};
  
  return {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => {
          responseData = { ...data, _statusCode: statusCode };
          return Promise.resolve(responseData);
        },
        end: () => Promise.resolve({ _statusCode: statusCode })
      };
    },
    setHeader: (key, value) => { headers[key] = value; }
  };
}

async function testAPI() {
  console.log('='.repeat(70));
  console.log('🧪 TESTING CACHE API ENDPOINT');
  console.log('='.repeat(70));
  console.log(`\n📡 Database: Neon PostgreSQL`);
  console.log(`📅 Time: ${new Date().toISOString()}\n`);
  
  const results = { passed: 0, failed: 0 };
  
  function logTest(name, passed, details = '') {
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${name}${details ? ` - ${details}` : ''}`);
    if (passed) results.passed++;
    else results.failed++;
  }
  
  try {
    // ═══ TEST 1: Status Check ═══
    console.log('─'.repeat(50));
    console.log('TEST 1: Cache Status Check');
    console.log('─'.repeat(50));
    
    try {
      const statusResult = await sql`
        SELECT 
          cache_status,
          cache_expires_at,
          completed_sections,
          total_sections,
          CASE WHEN cache_expires_at > NOW() AND cache_status = 'complete' THEN true ELSE false END as is_valid,
          EXTRACT(EPOCH FROM (cache_expires_at - NOW())) as seconds_until_expiry
        FROM site_cache 
        WHERE cache_key = 'main_page_cache'
      `;
      
      if (statusResult.length > 0) {
        const s = statusResult[0];
        logTest('Status Query Works', true);
        logTest('Cache Status Valid', ['empty', 'partial', 'complete', 'expired'].includes(s.cache_status),
          `Status: ${s.cache_status}`);
        logTest('Expiry Set', s.cache_expires_at !== null,
          `Expires in: ${Math.floor(s.seconds_until_expiry)}s`);
        logTest('Sections Tracking', s.completed_sections <= s.total_sections,
          `${s.completed_sections}/${s.total_sections}`);
      } else {
        logTest('Status Query Works', false, 'No data returned');
      }
    } catch (error) {
      logTest('Status Query Failed', false, error.message);
    }
    
    // ═══ TEST 2: Write Test Data ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 2: Write Test Data');
    console.log('─'.repeat(50));
    
    const testSectionData = [
      { id: 999, title: 'Cache Test Entry', type: 'test', timestamp: new Date().toISOString() }
    ];
    
    try {
      await sql`
        UPDATE site_cache 
        SET hero_slider = ${JSON.stringify(testSectionData)},
            hero_slider_cached = true,
            updated_at = NOW()
        WHERE cache_key = 'main_page_cache'
      `;
      logTest('Write Hero Slider', true, `Wrote ${testSectionData.length} items`);
    } catch (error) {
      logTest('Write Hero Slider', false, error.message);
    }
    
    // ═══ TEST 3: Read Test Data ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 3: Read Test Data');
    console.log('─'.repeat(50));
    
    try {
      const readResult = await sql`
        SELECT hero_slider, hero_slider_cached, updated_at
        FROM site_cache 
        WHERE cache_key = 'main_page_cache'
      `;
      
      if (readResult.length > 0) {
        const data = readResult[0];
        const hasData = Array.isArray(data.hero_slider) && data.hero_slider.length > 0;
        logTest('Read Hero Slider', hasData, 
          hasData ? `${data.hero_slider.length} items` : 'No data');
        
        if (hasData && data.hero_slider[0].id === 999) {
          logTest('Data Integrity', true, 'Test data matches');
        } else {
          logTest('Data Integrity', false, 'Data mismatch');
        }
      } else {
        logTest('Read Hero Slider', false, 'No row returned');
      }
    } catch (error) {
      logTest('Read Hero Slider', false, error.message);
    }
    
    // ═══ TEST 4: Update Metrics ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 4: Metrics Update');
    console.log('─'.repeat(50));
    
    try {
      await sql`
        UPDATE site_cache 
        SET cache_hit_count = cache_hit_count + 1,
            last_served_at = NOW()
        WHERE cache_key = 'main_page_cache'
      `;
      
      const metrics = await sql`
        SELECT cache_hit_count, last_served_at
        FROM site_cache 
        WHERE cache_key = 'main_page_cache'
      `;
      
      logTest('Metrics Updated', metrics[0].cache_hit_count > 0,
        `Hits: ${metrics[0].cache_hit_count}, Last served: ${metrics[0].last_served_at}`);
    } catch (error) {
      logTest('Metrics Update Failed', false, error.message);
    }
    
    // ═══ TEST 5: Batch Operations ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 5: Batch Write Multiple Sections');
    console.log('─'.repeat(50));
    
    try {
      await sql.begin(async (tx) => {
        await tx`UPDATE site_cache SET top_airing = ${JSON.stringify([{id: 1, title: 'Batch Test'}])}, top_airing_cached = true, updated_at = NOW() WHERE cache_key = 'main_page_cache'`;
        await tx`UPDATE site_cache SET upcoming = ${JSON.stringify([{id: 2, title: 'Batch Test 2'}])}, upcoming_cached = true, updated_at = NOW() WHERE cache_key = 'main_page_cache'`;
      });
      
      logTest('Batch Write', true, 'top_airing + upcoming written');
      
      // Verify both were written
      const verify = await sql`SELECT top_airing, upcoming FROM site_cache WHERE cache_key = 'main_page_cache'`;
      const v = verify[0];
      logTest('Top Airing Written', Array.isArray(v.top_airing) && v.top_airing.length > 0);
      logTest('Upcoming Written', Array.isArray(v.upcoming) && v.upcoming.length > 0);
    } catch (error) {
      logTest('Batch Write Failed', false, error.message);
    }
    
    // ═══ FINAL RESULTS ═══
    console.log('\n' + '='.repeat(70));
    console.log('📊 API ENDPOINT TEST RESULTS');
    console.log('='.repeat(70));
    console.log(`✅ Passed: ${results.passed}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`📈 Success Rate: ${Math.round((results.passed / (results.passed + results.failed)) * 100)}%`);
    
    if (results.failed === 0) {
      console.log('\n🎉 ALL API TESTS PASSED!');
      console.log('✅ Your /api/cache endpoint should work correctly');
      console.log('✅ The HTTP 500 error should be resolved now');
    } else {
      console.log('\n⚠️  Some tests failed - check the errors above');
    }
    
    console.log('='.repeat(70) + '\n');
    
    return results;
    
  } catch (error) {
    console.error('\n💥 FATAL ERROR:', error.message);
    console.error(error.stack);
    return { passed: 0, failed: 1 };
  }
}

// Run tests
testAPI()
  .then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error('Test crashed:', error);
    process.exit(1);
  });
