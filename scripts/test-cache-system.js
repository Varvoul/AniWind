// ═══════════════════════════════════════════════════════════════════
// END-TO-END CACHE SYSTEM TEST
// Verifies: DB connection, API endpoints, cache operations, full workflow
// ═══════════════════════════════════════════════════════════════════

const CACHE_API_URL = 'http://localhost:3000/api/cache';

async function testCacheSystem() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     🧪 PROFESSIONAL CACHE SYSTEM - E2E TEST SUITE        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };
  
  // Helper function
  async function runTest(name, testFn) {
    console.log(`\n📋 Test: ${name}`);
    console.log('─'.repeat(50));
    
    try {
      const result = await testFn();
      if (result === true || result?.success) {
        console.log(`   ✅ PASSED`);
        results.passed++;
        results.tests.push({ name, status: 'PASS' });
        return true;
      } else {
        console.log(`   ❌ FAILED: ${result?.error || 'Unknown error'}`);
        results.failed++;
        results.tests.push({ name, status: 'FAIL', error: result?.error });
        return false;
      }
    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}`);
      results.failed++;
      results.tests.push({ name, status: 'ERROR', error: error.message });
      return false;
    }
  }

  // ═══ TEST 1: API Endpoint Reachable ═══
  await runTest('API Endpoint is reachable', async () => {
    try {
      const response = await fetch(CACHE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' })
      });
      
      if (!response.ok) {
        return { error: `HTTP ${response.status}` };
      }
      
      const data = await response.json();
      return data.success ? true : { error: 'API returned failure' };
    } catch (error) {
      return { error: error.message };
    }
  });

  // ═══ TEST 2: Cache Status Structure ═══
  await runTest('Cache status has correct structure', async () => {
    const response = await fetch(CACHE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' })
    });
    
    const data = await response.json();
    const required = ['success', 'data', 'data.status', 'data.isValid', 'data.sections'];
    
    for (const field of required) {
      const value = field.split('.').reduce((obj, key) => obj?.[key], data);
      if (value === undefined) {
        return { error: `Missing field: ${field}` };
      }
    }
    
    return true;
  });

  // ═══ TEST 3: Write Operation ═══
  await runTest('Can write data to cache', async () => {
    const testData = [
      { id: 1, title: 'Test Anime 1', type: 'TV', score: '8.5' },
      { id: 2, title: 'Test Movie 1', type: 'Movie', score: '9.0' },
      { id: 3, title: 'Test Series 1', type: 'Series', score: '7.8' }
    ];
    
    const response = await fetch(CACHE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'write',
        section: 'heroSlider',
        data: testData
      })
    });
    
    const result = await response.json();
    return result.success ? true : { error: result.error };
  });

  // ═══ TEST 4: Read Operation ═══
  await runTest('Can read data from cache', async () => {
    const response = await fetch(CACHE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'read',
        section: 'heroSlider'
      })
    });
    
    const result = await response.json();
    
    if (!result.success) {
      return { error: result.error };
    }
    
    if (!result.data?.heroSlider || !Array.isArray(result.data.heroSlider)) {
      return { error: 'Invalid data format' };
    }
    
    if (result.data.heroSlider.length === 0) {
      return { error: 'No data returned' };
    }
    
    return true;
  });

  // ═══ TEST 5: Batch Write Operation ═══
  await runTest('Can batch write multiple sections', async () => {
    const batchData = {
      topAiring: [
        { id: 101, title: 'Top Airing 1', score: '8.9' },
        { id: 102, title: 'Top Airing 2', score: '8.7' }
      ],
      upcoming: [
        { id: 201, title: 'Upcoming 1', releaseDate: '2026-12-01' },
        { id: 202, title: 'Upcoming 2', releaseDate: '2026-12-15' }
      ]
    };
    
    const response = await fetch(CACHE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'write-batch',
        data: batchData
      })
    });
    
    const result = await response.json();
    return result.success ? true : { error: result.error };
  });

  // ═══ TEST 6: Validate Operation ═══
  await runTest('Can validate cache state', async () => {
    const response = await fetch(CACHE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'validate' })
    });
    
    const result = await response.json();
    
    const hasRequired = result.valid !== undefined && 
                       result.needsRefresh !== undefined &&
                       result.currentStatus !== undefined;
    
    return hasRequired ? true : { error: 'Missing validation fields' };
  });

  // ═══ TEST 7: Reset Operation ═══
  await runTest('Can reset cache for refresh', async () => {
    const response = await fetch(CACHE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' })
    });
    
    const result = await response.json();
    return result.success ? true : { error: result.error };
  });

  // ═══ TEST 8: Partial Cache Scenario ═══
  await runTest('Handles partial cache correctly', async () => {
    // Write only some sections
    await fetch(CACHE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'write',
        section: 'heroSlider',
        data: [{ id: 1, title: 'Partial Test' }]
      })
    });
    
    // Check status - should be 'partial'
    const statusRes = await fetch(CACHE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' })
    });
    
    const statusData = await statusRes.json();
    
    // Should be partial since we only wrote 1 of 10 sections
    return statusData.data?.status === 'partial' ? true : 
           { error: `Expected 'partial', got '${statusData.data?.status}'` };
  });

  // ═══ TEST 9: Data Persistence ═══
  await runTest('Data persists between reads', async () => {
    const uniqueId = Date.now();
    const persistData = [{ id: uniqueId, title: 'Persistence Test' }];
    
    // Write
    await fetch(CACHE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'write',
        section: 'mostFavourite',
        data: persistData
      })
    });
    
    // Read back
    const readRes = await fetch(CACHE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'read',
        section: 'mostFavourite'
      })
    });
    
    const readData = await readRes.json();
    const found = readData.data?.mostFavourite?.some(item => item.id === uniqueId);
    
    return found ? true : { error: 'Data not persisted' };
  });

  // ═══ TEST 10: Performance Test ═══
  await runTest('Response time is acceptable (<500ms)', async () => {
    const start = performance.now();
    
    await fetch(CACHE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' })
    });
    
    const duration = performance.now() - start;
    
    console.log(`   ⏱️ Response time: ${Math.round(duration)}ms`);
    
    return duration < 500 ? true : { error: `Too slow: ${Math.round(duration)}ms` };
  });

  // ═══ RESULTS SUMMARY ═══
  console.log('\n\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                  📊 TEST RESULTS                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  
  console.log(`\n   Total Tests: ${results.passed + results.failed}`);
  console.log(`   ✅ Passed: ${results.passed}`);
  console.log(`   ❌ Failed: ${results.failed}`);
  console.log(`   Success Rate: ${Math.round((results.passed / (results.passed + results.failed)) * 100)}%`);
  
  if (results.failed > 0) {
    console.log('\n   ⚠️ Failed Tests:');
    results.tests.filter(t => t.status !== 'PASS').forEach(t => {
      console.log(`      ❌ ${t.name}: ${t.error}`);
    });
  } else {
    console.log('\n   🎉 ALL TESTS PASSED! Cache system is ready.');
  }
  
  console.log('\n' + '═'.repeat(60));
  
  return results;
}

// Run tests
testCacheSystem()
  .then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error('💥 Test suite crashed:', error);
    process.exit(1);
  });
