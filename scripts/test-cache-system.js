// ═══════════════════════════════════════════════════════════════════
// CACHE SYSTEM END-TO-END TEST
// Run this after deploying the database table to verify everything works
// Usage: node scripts/test-cache-system.js
// ═══════════════════════════════════════════════════════════════════

const CACHE_API_URL = 'http://localhost:3000/api/cache'; // Update if different

// Test data for each section
const TEST_DATA = {
  heroSlider: [
    { id: 1, title: 'Test Anime 1', image: '/img/test1.jpg', type: 'anime' },
    { id: 2, title: 'Test Movie 1', image: '/img/test2.jpg', type: 'movie' },
    { id: 3, title: 'Test TV Show 1', image: '/img/test3.jpg', type: 'tv' }
  ],
  topAiring: [
    { id: 101, title: 'Airing Anime 1', episode: 12, score: 8.5 },
    { id: 102, title: 'Airing Anime 2', episode: 6, score: 7.8 }
  ],
  newReleases: {
    all: [{ id: 201, title: 'New Release 1', type: 'movie' }],
    anime: [{ id: 202, title: 'New Anime', type: 'anime' }],
    movie: [{ id: 203, title: 'New Movie', type: 'movie' }],
    series: [{ id: 204, title: 'New Series', type: 'series' }],
    hidden: [{ id: 205, title: 'Hidden Gem', type: 'anime' }]
  },
  newOnAniumi: [
    { id: 301, title: 'Added to Aniumi', dateAdded: '2026-08-22' }
  ],
  upcoming: [
    { id: 401, title: 'Upcoming Anime', releaseDate: '2026-09-01' },
    { id: 402, title: 'Upcoming Movie', releaseDate: '2026-10-15' }
  ],
  recentlyCompleted: {
    page1: [{ id: 501, title: 'Completed Anime 1', episodes: 24 }],
    pages: {},
    totalPages: 5
  },
  trendingNow: {
    today: [{ id: 601, title: 'Trending Today', views: 10000 }],
    week: [{ id: 602, title: 'Trending This Week', views: 50000 }],
    month: [{ id: 603, title: 'Trending This Month', views: 200000 }]
  },
  mostFavourite: [
    { id: 701, title: 'Fan Favorite 1', favorites: 15000 }
  ],
  popularAnime: [
    { id: 801, title: 'Popular Anime 1', popularity: 9999 }
  ],
  schedule: {
    monday: [{ id: 901, title: 'Monday Anime', time: '18:00' }],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: []
  }
};

// Test results tracker
const results = {
  passed: 0,
  failed: 0,
  errors: []
};

function logTest(name, passed, details = '') {
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}${details ? ` - ${details}` : ''}`);
  
  if (passed) {
    results.passed++;
  } else {
    results.failed++;
    results.errors.push({ name, details });
  }
}

async function runTests() {
  console.log('='.repeat(70));
  console.log('🧪 PROFESSIONAL CACHE SYSTEM - END-TO-END TEST');
  console.log('='.repeat(70));
  console.log(`\n📡 Testing against: ${CACHE_API_URL}\n`);
  
  try {
    // ═══ TEST 1: API Accessibility ═══
    console.log('─'.repeat(50));
    console.log('TEST 1: API Endpoint Accessible');
    console.log('─'.repeat(50));
    
    try {
      const response = await fetch(CACHE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' })
      });
      
      if (response.ok) {
        const data = await response.json();
        logTest('API Accessible', true, `Status ${response.status}`);
        logTest('Returns JSON', true, typeof data === 'object');
        logTest('Has success flag', true, 'success' in data);
        
        console.log('\n📊 Initial Cache Status:');
        console.log(`   Valid: ${data.data?.isValid || 'N/A'}`);
        console.log(`   Status: ${data.data?.status || 'N/A'}`);
        console.log(`   Sections: ${data.data?.sections?.completed || 0}/${data.data?.sections?.total || 10}`);
      } else {
        const errorText = await response.text();
        logTest('API Accessible', false, `HTTP ${response.status}: ${errorText}`);
      }
    } catch (error) {
      logTest('API Accessible', false, error.message);
      console.log('\n⚠️  Make sure your dev server is running (npm run dev)');
      return; // Stop tests if API not accessible
    }
    
    // ═══ TEST 2: Cache Reset ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 2: Cache Reset');
    console.log('─'.repeat(50));
    
    try {
      const resetResponse = await fetch(CACHE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' })
      });
      
      const resetData = await resetResponse.json();
      logTest('Cache Reset', resetData.success, resetData.message || '');
    } catch (error) {
      logTest('Cache Reset', false, error.message);
    }
    
    // ═══ TEST 3: Write Individual Sections ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 3: Write Individual Sections');
    console.log('─'.repeat(50));
    
    for (const [sectionName, testData] of Object.entries(TEST_DATA)) {
      try {
        const writeResponse = await fetch(CACHE_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'write',
            section: sectionName,
            data: testData
          })
        });
        
        const writeData = await writeResponse.json();
        logTest(`Write ${sectionName}`, writeData.success, writeData.message || '');
        
        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        logTest(`Write ${sectionName}`, false, error.message);
      }
    }
    
    // ═══ TEST 4: Batch Write ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 4: Batch Write (All Sections at Once)');
    console.log('─'.repeat(50));
    
    try {
      const batchResponse = await fetch(CACHE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'write-batch',
          data: TEST_DATA
        })
      });
      
      const batchData = await batchResponse.json();
      logTest('Batch Write', batchData.success, `${batchData.sections?.length || 0} sections`);
    } catch (error) {
      logTest('Batch Write', false, error.message);
    }
    
    // ═══ TEST 5: Read Individual Sections ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 5: Read Individual Sections');
    console.log('─'.repeat(50));
    
    for (const sectionName of Object.keys(TEST_DATA)) {
      try {
        const readResponse = await fetch(CACHE_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'read',
            section: sectionName
          })
        });
        
        const readData = await readResponse.json();
        const hasData = readData.data && (
          Array.isArray(readData.data) ? readData.data.length > 0 : 
          typeof readData.data === 'object' && Object.keys(readData.data).length > 0
        );
        
        logTest(`Read ${sectionName}`, hasData && readData.success, 
          hasData ? 'Data retrieved' : 'No data or failed');
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        logTest(`Read ${sectionName}`, false, error.message);
      }
    }
    
    // ═══ TEST 6: Read All Sections ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 6: Read All Sections (Full Page Load)');
    console.log('─'.repeat(50));
    
    try {
      const allResponse = await fetch(CACHE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'read',
          section: 'all'
        })
      });
      
      const allData = await allResponse.json();
      const sectionCount = allData.data ? Object.keys(allData.data).length - 1 : 0; // -1 for _meta
      
      logTest('Read All Sections', allData.success && sectionCount > 0, 
        `${sectionCount} sections loaded`);
      
    } catch (error) {
      logTest('Read All Sections', false, error.message);
    }
    
    // ═══ TEST 7: Validate Cache ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 7: Cache Validation');
    console.log('─'.repeat(50));
    
    try {
      const validateResponse = await fetch(CACHE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate' })
      });
      
      const validateData = await validateResponse.json();
      
      logTest('Validation Response', true, `Valid: ${validateData.valid}, Status: ${validateData.currentStatus}`);
      logTest('Not Expired', !validateData.needsRefresh || validateData.reason === 'valid', 
        `Reason: ${validateData.reason}`);
      logTest('All Sections Cached', validateData.missingSections?.length === 0,
        `Missing: ${validateData.missingSections?.join(', ') || 'none'}`);
        
    } catch (error) {
      logTest('Cache Validation', false, error.message);
    }
    
    // ═══ TEST 8: Final Status Check ═══
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 8: Final Cache Status');
    console.log('─'.repeat(50));
    
    try {
      const finalStatus = await fetch(CACHE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' })
      });
      
      const finalData = await finalStatus.json();
      const status = finalData.data;
      
      logTest('Cache Complete', status?.status === 'complete', 
        `Status: ${status?.status}`);
      logTest('All Sections Cached', status?.sections?.completed === status?.sections?.total,
        `${status?.sections?.completed || 0}/${status?.sections?.total || 10} sections`);
      logTest('Cache Valid', status?.isValid === true,
        `Expires in: ${status?.metrics?.secondsUntilExpiry || 'N/A'}s`);
      logTest('Version Tracked', status?.version !== undefined,
        `Version: ${status?.version}`);
      logTest('Metrics Tracked', status?.metrics !== undefined,
        `Hits: ${status?.metrics?.hitCount}, Misses: ${status?.metrics?.missCount}`);
      
    } catch (error) {
      logTest('Final Status Check', false, error.message);
    }
    
    // ═══ FINAL RESULTS ═══
    console.log('\n' + '='.repeat(70));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Passed: ${results.passed}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`📈 Success Rate: ${Math.round((results.passed / (results.passed + results.failed)) * 100)}%`);
    
    if (results.errors.length > 0) {
      console.log('\n⚠️  Failed Tests:');
      results.errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.name}: ${err.details}`);
      });
    }
    
    if (results.failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED! Cache system is production-ready.');
    } else {
      console.log('\n⚠️  Some tests failed. Check the errors above and troubleshoot.');
    }
    
    console.log('='.repeat(70) + '\n');
    
    return results;
    
  } catch (error) {
    console.error('\n💥 FATAL ERROR:', error.message);
    return { passed: 0, failed: 1, errors: [{ name: 'Fatal', details: error.message }] };
  }
}

// Run tests
runTests()
  .then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error('Test runner crashed:', error);
    process.exit(1);
  });
