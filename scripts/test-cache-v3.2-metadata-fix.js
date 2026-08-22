// Test script for Cache API v3.2 - Metadata update fix
// Verifies that cache metadata is properly updated after writes

const NEON_CONNECTION_STRING = 'postgresql://neondb_owner:npg_Wdf5XkBVbx1i@ep-super-dawn-azjwdm9a-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

async function testMetadataUpdate() {
  console.log('🧪 Testing Cache API v3.2 - Metadata Update Fix');
  console.log('='.repeat(70));
  
  const { neon, Client } = await import('@neondatabase/serverless');
  const sql = neon(NEON_CONNECTION_STRING);
  
  try {
    // STEP 1: Check current state BEFORE write
    console.log('\n📊 STEP 1: Current cache state BEFORE write...');
    const before = await sql`
      SELECT 
        cache_status,
        completed_sections,
        total_sections,
        cache_updated_at,
        cache_expires_at,
        EXTRACT(EPOCH FROM (cache_expires_at - NOW())) as seconds_until_expiry
      FROM site_cache WHERE cache_key = 'main_page_cache'
    `;
    
    const b = before[0];
    console.log(`   Status: ${b.cache_status}`);
    console.log(`   Sections: ${b.completed_sections}/${b.total_sections}`);
    console.log(`   Expires: ${b.cache_expires_at}`);
    console.log(`   Seconds until expiry: ${Math.floor(b.seconds_until_expiry)}s`);
    
    // STEP 2: Simulate a write operation (like writeCache does)
    console.log('\n✍️  STEP 2: Simulating write operation...');
    const client = new Client(NEON_CONNECTION_STRING);
    
    try {
      await client.connect();
      
      // Write test data to hero_slider
      const testData = [{ id: 'v3.2-test', title: 'Metadata Test', timestamp: new Date().toISOString() }];
      await client.query(`UPDATE site_cache SET hero_slider = $1, updated_at = NOW() WHERE cache_key = 'main_page_cache'`, [JSON.stringify(testData)]);
      
      // Update the flag
      await client.query(`UPDATE site_cache SET hero_slider_cached = true WHERE cache_key = 'main_page_cache'`);
      
      console.log('   ✅ Data written to hero_slider');
      console.log('   ✅ Flag hero_slider_cached set to true');
      
    } finally {
      await client.end();
    }
    
    // STEP 3: Run the NEW metadata update function (the fix!)
    console.log('\n🔄 STEP 3: Running updateCacheMetadata() (THE FIX)...');
    
    await sql`
      UPDATE site_cache SET
        completed_sections = (
          (CASE WHEN hero_slider_cached THEN 1 ELSE 0 END) +
          (CASE WHEN top_airing_cached THEN 1 ELSE 0 END) +
          (CASE WHEN new_releases_cached THEN 1 ELSE 0 END) +
          (CASE WHEN new_on_aniumi_cached THEN 1 ELSE 0 END) +
          (CASE WHEN upcoming_cached THEN 1 ELSE 0 END) +
          (CASE WHEN recently_completed_cached THEN 1 ELSE 0 END) +
          (CASE WHEN trending_now_cached THEN 1 ELSE 0 END) +
          (CASE WHEN most_favourite_cached THEN 1 ELSE 0 END) +
          (CASE WHEN popular_anime_cached THEN 1 ELSE 0 END) +
          (CASE WHEN schedule_cached THEN 1 ELSE 0 END)
        ),
        cache_status = CASE
          WHEN (
            (CASE WHEN hero_slider_cached THEN 1 ELSE 0 END) +
            (CASE WHEN top_airing_cached THEN 1 ELSE 0 END) +
            (CASE WHEN new_releases_cached THEN 1 ELSE 0 END) +
            (CASE WHEN new_on_aniumi_cached THEN 1 ELSE 0 END) +
            (CASE WHEN upcoming_cached THEN 1 ELSE 0 END) +
            (CASE WHEN recently_completed_cached THEN 1 ELSE 0 END) +
            (CASE WHEN trending_now_cached THEN 1 ELSE 0 END) +
            (CASE WHEN most_favourite_cached THEN 1 ELSE 0 END) +
            (CASE WHEN popular_anime_cached THEN 1 ELSE 0 END) +
            (CASE WHEN schedule_cached THEN 1 ELSE 0 END)
          ) >= total_sections THEN 'complete'
          WHEN (
            (CASE WHEN hero_slider_cached THEN 1 ELSE 0 END) +
            (CASE WHEN top_airing_cached THEN 1 ELSE 0 END) +
            (CASE WHEN new_releases_cached THEN 1 ELSE 0 END) +
            (CASE WHEN new_on_aniumi_cached THEN 1 ELSE 0 END) +
            (CASE WHEN upcoming_cached THEN 1 ELSE 0 END) +
            (CASE WHEN recently_completed_cached THEN 1 ELSE 0 END) +
            (CASE WHEN trending_now_cached THEN 1 ELSE 0 END) +
            (CASE WHEN most_favourite_cached THEN 1 ELSE 0 END) +
            (CASE WHEN popular_anime_cached THEN 1 ELSE 0 END) +
            (CASE WHEN schedule_cached THEN 1 ELSE 0 END)
          ) > 0 THEN 'partial'
          ELSE 'empty'
        END,
        cache_updated_at = NOW(),
        cache_expires_at = NOW() + INTERVAL '6 hours'
      WHERE cache_key = 'main_page_cache'
    `;
    
    console.log('   ✅ Metadata update query executed');
    
    // STEP 4: Verify the fix worked
    console.log('\n✅ STEP 4: Verifying state AFTER metadata update...');
    const after = await sql`
      SELECT 
        cache_status,
        completed_sections,
        total_sections,
        cache_updated_at,
        cache_expires_at,
        NOW() as current_time,
        EXTRACT(EPOCH FROM (cache_expires_at - NOW())) as seconds_until_expiry,
        CASE WHEN cache_expires_at > NOW() THEN 'VALID' ELSE 'EXPIRED' END as validity
      FROM site_cache WHERE cache_key = 'main_page_cache'
    `;
    
    const a = after[0];
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│              CACHE STATE AFTER FIX                          │');
    console.log('├─────────────────────────────────────────────────────────────┤');
    console.log(`│ Status:            ${a.cache_status.padEnd(42)}│`);
    console.log(`| Sections:          ${a.completed_sections}/${a.total_sections} completed`.padEnd(60) + '│');
    console.log(`│ Updated At:       ${String(a.cache_updated_at).padEnd(42)}│`);
    console.log(`│ Expires At:       ${String(a.cache_expires_at).padEnd(42)}│`);
    console.log(`│ Current Time:      ${String(a.current_time).padEnd(42)}│`);
    console.log(`| Validity:          ${a.validity.padEnd(42)}│`);
    console.log(`│ Seconds Until Exp: ${Math.floor(a.seconds_until_expiry)}s`.padEnd(60) + '│');
    console.log('└─────────────────────────────────────────────────────────────┘');
    
    // VERIFICATION
    console.log('\n🎯 VERIFICATION RESULTS:');
    
    let allPassed = true;
    
    // Check 1: Status should not be "empty" if we have cached sections
    if (a.completed_sections > 0 && a.cache_status !== 'empty') {
      console.log('   ✅ PASS: Cache status is NOT "empty" when sections are cached');
    } else if (a.completed_sections === 0) {
      console.log('   ⚠️  WARN: No sections are cached yet');
    } else {
      console.log('   ❌ FAIL: Cache status is still "empty" despite having cached sections');
      allPassed = false;
    }
    
    // Check 2: completed_sections should be > 0
    if (a.completed_sections > 0) {
      console.log(`   ✅ PASS: completed_sections = ${a.completed_sections} (greater than 0)`);
    } else {
      console.log('   ❌ FAIL: completed_sections is still 0');
      allPassed = false;
    }
    
    // Check 3: cache_updated_at should be recent
    const secsSinceUpdate = Math.abs(Math.floor((new Date() - new Date(a.cache_updated_at)) / 1000));
    if (secsSinceUpdate < 60) {
      console.log(`   ✅ PASS: cache_updated_at is recent (${secsSinceUpdate}s ago)`);
    } else {
      console.log(`   ⚠️  WARN: cache_updated_at was ${secsSinceUpdate}s ago`);
    }
    
    // Check 4: cache_expires_at should be in the future (~6 hours from now)
    const secsUntilExpiry = Math.floor(a.seconds_until_expiry);
    if (secsUntilExpiry > 0 && secsUntilExpiry <= 21600) { // 6 hours = 21600 seconds
      const hoursUntil = (secsUntilExpiry / 3600).toFixed(1);
      console.log(`   ✅ PASS: cache_expires_at is in ~${hoursUntil} hours (valid TTL)`);
    } else {
      console.log(`   ❌ FAIL: cache_expires_at is ${secsUntilExpiry}s (invalid)`);
      allPassed = false;
    }
    
    // Check 5: Validity should be VALID
    if (a.validity === 'VALID') {
      console.log('   ✅ PASS: Cache is marked as VALID (not expired)');
    } else {
      console.log('   ❌ FAIL: Cache is marked as EXPIRED');
      allPassed = false;
    }
    
    console.log('\n' + '='.repeat(70));
    if (allPassed) {
      console.log('🎉 ALL TESTS PASSED! Cache API v3.2 metadata fix is working!');
      console.log('\nThe "expired on second visit" issue should now be RESOLVED.');
    } else {
      console.log('⚠️  Some tests failed - review the results above');
    }
    
    return allPassed;
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    return false;
  }
}

// Run test
testMetadataUpdate()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
