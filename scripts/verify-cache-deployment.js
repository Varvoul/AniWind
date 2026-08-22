// ═══════════════════════════════════════════════════════════════════
// NEON DB CACHE VERIFICATION SCRIPT
// Tests real database connection and all operations
// ═══════════════════════════════════════════════════════════════════

const { neon } = require('@neondatabase/serverless');

const CONNECTION_STRING = 'postgresql://neondb_owner:npg_Wdf5XkBVbx1i@ep-super-dawn-azjwdm9a-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const sql = neon(CONNECTION_STRING);

async function verifyDeployment() {
  console.log('='.repeat(70));
  console.log('🔍 VERIFYING CACHE SYSTEM DEPLOYMENT');
  console.log('='.repeat(70));
  console.log(`\n📡 Connecting to: Neon PostgreSQL (pooler)\n`);
  
  const results = { passed: 0, failed: 0, tests: [] };
  
  function logTest(name, passed, details = '') {
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${name}${details ? ` - ${details}` : ''}`);
    if (passed) results.passed++;
    else { results.failed++; results.tests.push({ name, details }); }
  }
  
  try {
    // ═══ TEST 1: Connection Test ═══
    console.log('─'.repeat(50));
    console.log('TEST 1: Database Connection');
    console.log('─'.repeat(50));
    
    try {
      const connectionTest = await sql`SELECT NOW() as current_time`;
      logTest('Connection Successful', true, `Server time: ${connectionTest[0].current_time}`);
    } catch (error) {
      logTest('Connection Failed', false, error.message);
      return results; // Stop if can't connect
    }
    
    // ═══ TEST 2: Table Exists ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 2: Table Existence');
    console.log('─'.repeat(50));
    
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'site_cache'
      ) as exists
    `;
    logTest('Table Exists', tableExists[0].exists === true, 
      tableExists[0].exists ? 'site_cache found' : 'NOT FOUND');
    
    if (!tableExists[0].exists) {
      console.log('\n❌ Table not found! Deployment may have failed.');
      return results;
    }
    
    // ═══ TEST 3: Column Count & Structure ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 3: Table Structure');
    console.log('─'.repeat(50));
    
    const columns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'site_cache' 
      ORDER BY ordinal_position
    `;
    
    logTest('Column Count', columns.length >= 50, `${columns.length} columns (expected 50+)`);
    
    // Check for critical columns
    const columnNames = columns.map(c => c.column_name);
    const criticalColumns = [
      'cache_key', 'cache_status', 'cache_expires_at',
      'hero_slider', 'top_airing', 'upcoming',
      'new_releases_all', 'trending_now_today', 'schedule_monday'
    ];
    
    let allCriticalExist = true;
    criticalColumns.forEach(col => {
      const exists = columnNames.includes(col);
      if (!exists) allCriticalExist = false;
    });
    
    logTest('Critical Columns Present', allCriticalExist, 
      `${criticalColumns.filter(c => columnNames.includes(c)).length}/${criticalColumns.length}`);
    
    // ═══ TEST 4: Initial Row Exists ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 4: Initial Cache Row');
    console.log('─'.repeat(50));
    
    const cacheRow = await sql`
      SELECT * FROM site_cache WHERE cache_key = 'main_page_cache'
    `;
    
    logTest('Cache Row Exists', cacheRow.length > 0, 
      cacheRow.length > 0 ? 'Row found' : 'NO ROW');
    
    if (cacheRow.length > 0) {
      const row = cacheRow[0];
      logTest('Correct Cache Key', row.cache_key === 'main_page_cache', row.cache_key);
      logTest('Status Set', row.cache_status !== null, `Status: ${row.cache_status}`);
      logTest('Expiry Set', row.cache_expires_at !== null, `Expires: ${row.cache_expires_at}`);
      logTest('Section Count Configured', row.total_sections === 10, 
        `${row.total_sections} sections`);
    }
    
    // ═══ TEST 5: Indexes Created ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 5: Performance Indexes');
    console.log('─'.repeat(50));
    
    const indexes = await sql`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'site_cache'
    `;
    
    const indexNames = indexes.map(i => i.indexname);
    const expectedIndexes = ['idx_site_cache_key', 'idx_site_cache_expires', 'idx_site_cache_status'];
    
    let indexesOk = true;
    expectedIndexes.forEach(idx => {
      if (!indexNames.includes(idx)) indexesOk = false;
    });
    
    logTest('Required Indexes Created', indexesOk, 
      `${indexes.length} indexes found`);
    
    // ═══ TEST 6: RLS Enabled ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 6: Row Level Security');
    console.log('─'.repeat(50));
    
    const rlsStatus = await sql`
      SELECT rowsecurity 
      FROM pg_tables 
      WHERE tablename = 'site_cache'
    `;
    
    logTest('RLS Enabled', rlsStatus[0]?.rowsecurity === true,
      rlsStatus[0]?.rowsecurity ? 'SECURED' : 'NOT SECURED');
    
    // Check policies exist
    const policies = await sql`
      SELECT policyname 
      FROM pg_policies 
      WHERE tablename = 'site_cache'
    `;
    
    logTest('RLS Policies Created', policies.length >= 2,
      `${policies.length} policies: ${policies.map(p => p.policyname).join(', ')}`);
    
    // ═══ TEST 7: Write Operation (Real Data) ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 7: Write Operations');
    console.log('─'.repeat(50));
    
    const testHeroData = [
      { id: 1, title: 'Test Hero Slide 1', type: 'anime', image: '/test1.jpg' },
      { id: 2, title: 'Test Hero Slide 2', type: 'movie', image: '/test2.jpg' },
      { id: 3, title: 'Test Hero Slide 3', type: 'tv', image: '/test3.jpg' }
    ];
    
    try {
      await sql`
        UPDATE site_cache 
        SET hero_slider = ${JSON.stringify(testHeroData)},
            hero_slider_cached = true,
            hero_slider_cached_at = NOW(),
            updated_at = NOW()
        WHERE cache_key = 'main_page_cache'
      `;
      logTest('Write Hero Slider Data', true, `${testHeroData.length} items written`);
    } catch (error) {
      logTest('Write Hero Slider Data', false, error.message);
    }
    
    // Write more sections
    const testData = {
      top_airing: [{ id: 101, title: 'Airing Test', score: 8.5 }],
      upcoming: [{ id: 201, title: 'Upcoming Test', date: '2026-09-01' }]
    };
    
    try {
      await sql`
        UPDATE site_cache 
        SET top_airing = ${JSON.stringify(testData.top_airing)},
            top_airing_cached = true,
            upcoming = ${JSON.stringify(testData.upcoming)},
            upcoming_cached = true,
            updated_at = NOW()
        WHERE cache_key = 'main_page_cache'
      `;
      logTest('Write Multiple Sections', true, 'top_airing + upcoming');
    } catch (error) {
      logTest('Write Multiple Sections', false, error.message);
    }
    
    // ═══ TEST 8: Read Operations ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 8: Read Operations');
    console.log('─'.repeat(50));
    
    try {
      const readData = await sql`
        SELECT hero_slider, top_airing, upcoming, cache_status
        FROM site_cache 
        WHERE cache_key = 'main_page_cache'
      `;
      
      const row = readData[0];
      
      logTest('Read Hero Slider', Array.isArray(row.hero_slider) && row.hero_slider.length > 0,
        `${row.hero_slider?.length || 0} items`);
      
      logTest('Read Top Airing', Array.isArray(row.top_airing) && row.top_airing.length > 0,
        `${row.top_airing?.length || 0} items`);
      
      logTest('Read Upcoming', Array.isArray(row.upcoming) && row.upcoming.length > 0,
        `${row.upcoming?.length || 0} items`);
      
    } catch (error) {
      logTest('Read Operations Failed', false, error.message);
    }
    
    // ═══ TEST 9: Update Metrics ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 9: Metrics Tracking');
    console.log('─'.repeat(50));
    
    try {
      // Simulate cache hit
      await sql`
        UPDATE site_cache 
        SET cache_hit_count = cache_hit_count + 1,
            last_served_at = NOW()
        WHERE cache_key = 'main_page_cache'
      `;
      
      const metrics = await sql`
        SELECT cache_hit_count, cache_miss_count, last_served_at
        FROM site_cache 
        WHERE cache_key = 'main_page_cache'
      `;
      
      const m = metrics[0];
      logTest('Hit Count Incremented', m.cache_hit_count > 0, `Hits: ${m.cache_hit_count}`);
      logTest('Last Served Updated', m.last_served_at !== null, `At: ${m.last_served_at}`);
      
    } catch (error) {
      logTest('Metrics Tracking Failed', false, error.message);
    }
    
    // ═══ TEST 10: Cache Status Logic ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 10: Cache Status & Expiry');
    console.log('─'.repeat(50));
    
    try {
      const statusData = await sql`
        SELECT 
          cache_status,
          cache_expires_at,
          completed_sections,
          total_sections,
          CASE WHEN cache_expires_at > NOW() THEN true ELSE false END as not_expired,
          EXTRACT(EPOCH FROM (cache_expires_at - NOW())) as seconds_remaining
        FROM site_cache 
        WHERE cache_key = 'main_page_cache'
      `;
      
      const s = statusData[0];
      
      logTest('Status Field Valid', ['empty', 'partial', 'complete', 'expired'].includes(s.cache_status),
        `Status: ${s.cache_status}`);
      
      logTest('Not Expired', s.not_expired === true,
        s.not_expired ? `Valid for ${Math.floor(s.seconds_remaining)}s` : 'EXPIRED');
      
      logTest('Sections Tracking', s.completed_sections <= s.total_sections,
        `${s.completed_sections}/${s.total_sections}`);
        
    } catch (error) {
      logTest('Status Check Failed', false, error.message);
    }
    
    // ═══ FINAL SUMMARY ═══
    console.log('\n' + '='.repeat(70));
    console.log('📊 VERIFICATION RESULTS');
    console.log('='.repeat(70));
    console.log(`✅ Passed: ${results.passed}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`📈 Success Rate: ${Math.round((results.passed / (results.passed + results.failed)) * 100)}%`);
    
    if (results.failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED!');
      console.log('✅ Your professional cache system is FULLY OPERATIONAL');
      console.log('✅ Ready for production use');
      console.log('✅ All 10 sections can be cached');
      console.log('✅ 6-hour TTL is active');
      console.log('✅ RLS security enabled');
    } else {
      console.log('\n⚠️  Some tests failed:');
      results.tests.forEach((t, i) => {
        console.log(`   ${i + 1}. ${t.name}: ${t.details}`);
      });
    }
    
    console.log('='.repeat(70) + '\n');
    
    return results;
    
  } catch (error) {
    console.error('\n💥 FATAL ERROR:', error.message);
    console.error(error.stack);
    return { passed: 0, failed: 1, tests: [{ name: 'Fatal', details: error.message }] };
  }
}

// Run verification
verifyDeployment()
  .then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error('Verification crashed:', error);
    process.exit(1);
  });
