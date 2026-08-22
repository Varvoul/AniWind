// Direct database inspection script
// Checks if cache data is actually stored in Neon DB

const NEON_CONNECTION_STRING = 'postgresql://neondb_owner:npg_Wdf5XkBVbx1i@ep-super-dawn-azjwdm9a-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

async function inspectDatabase() {
  console.log('🔍 INSPECTING NEON DATABASE - Cache Data Verification');
  console.log('='.repeat(70));
  
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(NEON_CONNECTION_STRING);
  
  try {
    // TEST 1: Check if row exists
    console.log('\n📋 TEST 1: Check if cache row exists...');
    const rowExists = await sql`
      SELECT EXISTS(SELECT 1 FROM site_cache WHERE cache_key = 'main_page_cache') as exists
    `;
    
    if (rowExists[0]?.exists) {
      console.log('✅ Cache row EXISTS in database');
    } else {
      console.log('❌ Cache row NOT FOUND - this is the problem!');
      return;
    }
    
    // TEST 2: Get full cache status/metadata
    console.log('\n📊 TEST 2: Cache status and metadata...');
    const status = await sql`
      SELECT 
        cache_key,
        cache_status,
        cache_updated_at,
        cache_expires_at,
        NOW() as current_time,
        EXTRACT(EPOCH FROM (cache_expires_at - NOW())) as seconds_until_expiry,
        CASE WHEN cache_expires_at > NOW() THEN 'NOT_EXPIRED' ELSE 'EXPIRED' END as expiry_status,
        cache_version,
        completed_sections,
        total_sections,
        cache_hit_count,
        cache_miss_count,
        last_served_at,
        created_at,
        updated_at
      FROM site_cache 
      WHERE cache_key = 'main_page_cache'
    `;
    
    if (status.length > 0) {
      const s = status[0];
      console.log('\n┌─────────────────────────────────────────────────────────────┐');
      console.log('│                  CACHE METADATA                            │');
      console.log('├─────────────────────────────────────────────────────────────┤');
      console.log(`│ Status:            ${s.cache_status.padEnd(42)}│`);
      console.log(`│ Expiry Status:     ${s.expiry_status.padEnd(42)}│`);
      console.log(`│ Current Time:      ${String(s.current_time).padEnd(42)}│`);
      console.log(`│ Expires At:       ${String(s.cache_expires_at).padEnd(42)}│`);
      console.log(`│ Seconds Until Exp: ${String(Math.floor(s.seconds_until_expiry)).padEnd(42)}│`);
      console.log(`│ Updated At:       ${String(s.cache_updated_at).padEnd(42)}│`);
      console.log(`│ Version:           ${String(s.cache_version).padEnd(42)}│`);
      console.log(`│ Sections:          ${s.completed_sections}/${s.total_sections} completed`.padEnd(60) + '│');
      console.log(`│ Hit/Miss Count:    ${s.cache_hit_count}/${s.cache_miss_count}`.padEnd(60) + '│');
      console.log(`│ Last Served:       ${s.last_served_at ? String(s.last_served_at) : 'NEVER'}`.padEnd(60) + '│');
      console.log('└─────────────────────────────────────────────────────────────┘');
      
      // Analyze the issue
      console.log('\n🔍 ANALYSIS:');
      if (s.expiry_status === 'EXPIRED') {
        console.log('❌ Cache is EXPIRED - this explains "expired" on second visit');
        console.log(`   Reason: cache_expires_at (${s.cache_expires_at}) is in the past`);
        console.log(`   Current time: ${s.current_time}`);
        
        const expirySeconds = Math.floor(s.seconds_until_expiry);
        if (expirySeconds < 0) {
          const hoursAgo = Math.abs(expirySeconds) / 3600;
          console.log(`   Cache expired ${hoursAgo.toFixed(2)} hours ago`);
        }
      } else {
        console.log('✅ Cache is NOT expired - issue might be elsewhere');
      }
      
      if (s.cache_status === 'empty' || s.completed_sections == 0) {
        console.log('⚠️  Cache status shows EMPTY or 0 sections completed');
        console.log('   This means writes are not updating the status correctly');
      }
    }
    
    // TEST 3: Check individual section data
    console.log('\n📦 TEST 3: Individual section data storage...');
    
    const sections = [
      { name: 'heroSlider', column: 'hero_slider', flag: 'hero_slider_cached' },
      { name: 'topAiring', column: 'top_airing', flag: 'top_airing_cached' },
      { name: 'newReleases', column: 'new_releases_all', flag: 'new_releases_cached' },
      { name: 'upcoming', column: 'upcoming', flag: 'upcoming_cached' },
      { name: 'newOnAniumi', column: 'new_on_aniumi', flag: 'new_on_aniumi_cached' },
      { name: 'recentlyCompleted', column: 'recently_completed_page1', flag: 'recently_completed_cached' },
      { name: 'trendingNow', column: 'trending_now_today', flag: 'trending_now_cached' },
      { name: 'mostFavourite', column: 'most_favourite', flag: 'most_favourite_cached' },
      { name: 'popularAnime', column: 'popular_anime', flag: 'popular_anime_cached' },
      { name: 'schedule', column: 'schedule_monday', flag: 'schedule_cached' }
    ];
    
    const sectionData = await sql`
      SELECT 
        hero_slider, hero_slider_cached,
        top_airing, top_airing_cached,
        new_releases_all, new_releases_cached,
        upcoming, upcoming_cached,
        new_on_aniumi, new_on_aniumi_cached,
        recently_completed_page1, recently_completed_cached,
        trending_now_today, trending_now_cached,
        most_favourite, most_favourite_cached,
        popular_anime, popular_anime_cached,
        schedule_monday, schedule_cached
      FROM site_cache 
      WHERE cache_key = 'main_page_cache'
    `;
    
    if (sectionData.length > 0) {
      const data = sectionData[0];
      console.log('\n┌──────────────────────────────────────────────────────────────────────────┐');
      console.log('│                      SECTION DATA STATUS                               │');
      console.log('├──────────────────┬────────────┬─────────────────────────────────────────┤');
      console.log('│ Section          │ Cached Flag│ Data Size                              │');
      console.log('├──────────────────┼────────────┼─────────────────────────────────────────┤');
      
      let cachedCount = 0;
      let dataStoredCount = 0;
      
      for (const section of sections) {
        const flagValue = data[section.flag];
        const dataArray = data[section.column];
        const hasData = dataArray && Array.isArray(dataArray) && dataArray.length > 0;
        const dataSize = hasData ? JSON.stringify(dataArray).length : 0;
        
        const flagStr = flagValue ? '✅ TRUE' : '❌ FALSE';
        if (flagValue) cachedCount++;
        
        const dataStr = hasData ? `${dataArray.length} items (${(dataSize/1024).toFixed(1)}KB)` : '⚠️  EMPTY';
        if (hasData) dataStoredCount++;
        
        console.log(`│ ${section.name.padEnd(16)} │ ${flagStr.padEnd(10)} │ ${dataStr.padEnd(39)} │`);
      }
      
      console.log('├──────────────────┼────────────┼─────────────────────────────────────────┤');
      console.log(`│ Total:           │ ${cachedCount}/10 cached │ ${dataStoredCount}/10 have data`.padEnd(56) + ' │');
      console.log('└──────────────────┴────────────┴─────────────────────────────────────────┘');
      
      // Show sample data from first populated section
      console.log('\n📝 SAMPLE DATA (first populated section):');
      for (const section of sections) {
        const dataArray = data[section.column];
        if (dataArray && Array.isArray(dataArray) && dataArray.length > 0) {
          console.log(`\n   📦 ${section.name} (${dataArray.length} items):`);
          const sample = dataArray[0];
          console.log(`   First item keys: ${Object.keys(sample).join(', ')}`);
          console.log(`   Sample: ${JSON.stringify(sample).substring(0, 200)}...`);
          break; // Only show first one
        }
      }
    }
    
    // TEST 4: Check when data was last written
    console.log('\n⏰ TEST 4: Write timing analysis...');
    const writeTimes = await sql`
      SELECT 
        updated_at,
        cache_updated_at,
        EXTRACT(EPOCH FROM (NOW() - updated_at)) as seconds_since_update,
        EXTRACT(EPOCH FROM (NOW() - cache_updated_at)) as seconds_since_cache_update
      FROM site_cache 
      WHERE cache_key = 'main_page_cache'
    `;
    
    if (writeTimes.length > 0) {
      const wt = writeTimes[0];
      const secsSinceUpdate = Math.floor(wt.seconds_since_update);
      const minsSinceUpdate = (secsSinceUpdate / 60).toFixed(1);
      
      console.log(`   Last DB Update:     ${wt.updated_at}`);
      console.log(`   Last Cache Update:  ${wt.cache_updated_at}`);
      console.log(`   Seconds Ago:        ${secsSinceUpdate}s (${minsSinceUpdate} minutes ago)`);
      
      if (secsSinceUpdate < 300) {
        console.log('   ✅ Data was recently written (within 5 minutes)');
      } else if (secsSinceUpdate < 3600) {
        console.log('   ⚠️  Data was written within the last hour');
      } else {
        console.log('   ❌ Data has not been written recently');
      }
    }
    
    // SUMMARY
    console.log('\n' + '='.repeat(70));
    console.log('🎯 INVESTIGATION SUMMARY');
    console.log('='.repeat(70));
    
    const finalStatus = status[0];
    const isExpired = finalStatus.expiry_status === 'EXPIRED';
    const hasData = dataStoredCount > 0;
    
    console.log('\n1. DATA STORAGE:');
    console.log(`   ${hasData ? '✅' : '❌'} Data IS${hasData ? '' : ' NOT'} stored in database`);
    console.log(`   Sections with data: ${dataStoredCount}/10`);
    
    console.log('\n2. CACHE EXPIRY:');
    console.log(`   ${isExpired ? '❌' : '✅'} Cache IS${isExpired ? '' : ' NOT'} expired`);
    console.log(`   Expires at: ${finalStatus.cache_expires_at}`);
    console.log(`   Current time: ${finalStatus.current_time}`);
    
    if (isExpired && hasData) {
      console.log('\n🔧 DIAGNOSIS:');
      console.log('   ✅ Data IS being written to database successfully');
      console.log('   ❌ BUT cache_expires_at is not being updated correctly after writes');
      console.log('   ⚠️  OR the TTL (6 hours) has legitimately passed');
      console.log('\n💡 RECOMMENDED FIX:');
      console.log('   - Update cache_expires_at to NOW() + 6 hours after each write');
      console.log('   - OR update cache_status to "complete" when all sections are cached');
    }
    
    return { isExpired, hasData, cachedCount, dataStoredCount };
    
  } catch (error) {
    console.error('❌ Database inspection failed:', error.message);
    throw error;
  }
}

// Run inspection
inspectDatabase()
  .then(result => {
    console.log('\n✅ Inspection complete');
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
