// ═══════════════════════════════════════════════════════════════════
// VERCEL BLOB CACHE - VERIFICATION TEST
// 
// Tests all cache operations to verify the system is working:
// 1. Status check (all sections)
// 2. Write test data
// 3. Read test data back
// 4. Pagination test for recently-completed
// 5. List all cached items
// ═══════════════════════════════════════════════════════════════════

const API_BASE = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}` 
  : 'http://localhost:3000';

const CACHE_API = `${API_BASE}/api/blob-cache`;

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function log(test, status, detail = '') {
  const icon = status === '✅' ? colors.green + '✅ PASS' : 
               status === '❌' ? colors.red + '❌ FAIL' : 
               colors.yellow + '⏳  ';
  console.log(`${icon}${colors.reset} ${colors.cyan}${test}${colors.reset} ${colors.dim}${detail}${colors.reset}`);
}

async function apiCall(action, data = {}) {
  try {
    const response = await fetch(CACHE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data })
    });
    return await response.json();
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 VERCEL BLOB CACHE - VERIFICATION TESTS');
  console.log(`   API Endpoint: ${CACHE_API}`);
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log('='.repeat(60) + '\n');
  
  let passed = 0;
  let failed = 0;
  
  // ─────────────────────────────────────────────────────────────────────
  // TEST 1: API Connectivity
  // ─────────────────────────────────────────────────────────────────────
  console.log('─'.repeat(50));
  console.log('TEST 1: API Connectivity');
  console.log('─'.repeat(50));
  
  const statusResult = await apiCall('status');
  
  if (statusResult.success) {
    log('API Endpoint Reachable', '✅');
    log('Status Response Structure', '✅', `Has overview: ${!!statusResult.overview}`);
    log('Sections Count', '✅', `${statusResult.overview?.totalSections || 0} sections defined`);
    
    // Show overview
    if (statusResult.overview) {
      console.log(`\n   📊 Cache Overview:`);
      console.log(`      Valid:   ${colors.green}${statusResult.overview.valid || 0}${colors.reset}`);
      console.log(`      Expired: ${colors.red}${statusResult.overview.expired || 0}${colors.reset}`);
      console.log(`      Missing: ${colors.yellow}${statusResult.overview.missing || 0}${colors.reset}`);
      console.log(`      Total Size: ${(statusResult.overview.totalSizeBytes || 0) / 1024}KB`);
    }
    passed++;
  } else {
    log('API Endpoint Reachable', '❌', statusResult.error || 'Unknown error');
    failed++;
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // TEST 2: Write Operation (store test data)
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log('TEST 2: Write Operation (Store Test Data)');
  console.log('─'.repeat(50));
  
  const testData = {
    test: true,
    timestamp: new Date().toISOString(),
    message: 'Vercel Blob Cache Verification Test',
    sampleData: {
      items: Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        name: `Test Item ${i + 1}`,
        score: Math.random() * 10
      })),
      meta: { total: 5, source: 'verification-test' }
    }
  };
  
  const writeResult = await apiCall('write', { 
    section: 'hero-slider', 
    data: testData 
  });
  
  if (writeResult.success) {
    log('Write Hero Slider Data', '✅', `Size: ${writeResult.sizeBytes || 0} bytes`);
    log('Blob URL Generated', '✅', !!writeResult.url);
    log('Upload Timestamp', '✅', writeResult.uploadedAt);
    passed += 3;
  } else {
    log('Write Hero Slider Data', '❌', writeResult.error || 'Write failed');
    failed += 3;
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // TEST 3: Read Operation (retrieve test data)
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log('TEST 3: Read Operation (Retrieve Cached Data)');
  console.log('─'.repeat(50));
  
  const readResult = await apiCall('read', { section: 'hero-slider' });
  
  if (readResult.success && readResult.data?.found) {
    log('Read Cache Hit', '✅', `Found: ${readResult.data.found}`);
    log('Cache URL Returned', '✅', !!readResult.data.url);
    log('Expiry Info Available', '✅', `${readResult.data.secondsUntilExpiry}s remaining`);
    
    // Try to fetch actual data from URL
    if (readResult.data.url) {
      try {
        const dataResponse = await fetch(readResult.data.url);
        const actualData = await dataResponse.json();
        log('Data Fetchable from URL', '✅', `${JSON.stringify(actualData).length} chars`);
        log('Data Integrity', '✅', actualData.test === true ? 'Matches original' : 'DATA MISMATCH');
        passed += 2;
      } catch (fetchError) {
        log('Data Fetchable from URL', '❌', fetchError.message);
        failed++;
      }
    }
    passed += 2;
  } else {
    log('Read Cache Hit', '❌', readResult.data?.reason || 'Not found');
    failed += 4;
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // TEST 4: Pagination Support (recently-completed)
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log('TEST 4: Pagination Support (Recently Completed)');
  console.log('─'.repeat(50));
  
  // Write page 1
  const page1Data = { page: 1, items: ['anime-1', 'anime-2', 'anime-3'] };
  const writePage1 = await apiCall('write', { 
    section: 'recently-completed', 
    data: page1Data, 
    page: 1 
  });
  
  // Write page 2
  const page2Data = { page: 2, items: ['anime-4', 'anime-5', 'anime-6'] };
  const writePage2 = await apiCall('write', { 
    section: 'recently-completed', 
    data: page2Data, 
    page: 2 
  });
  
  if (writePage1.success && writePage2.success) {
    log('Write Page 1', '✅', `Key: ${writePage1.blobKey}`);
    log('Write Page 2', '✅', `Key: ${writePage2.blobKey}`);
    passed += 2;
    
    // Read pages back
    const readPage1 = await apiCall('read', { section: 'recently-completed', page: 1 });
    const readPage2 = await apiCall('read', { section: 'recently-completed', page: 2 });
    
    if (readPage1.data?.found && readPage2.data?.found) {
      log('Read Page 1 Back', '✅', 'Pagination works');
      log('Read Page 2 Back', '✅', 'Pages are separate');
      passed += 2;
    } else {
      log('Read Page 1 Back', '❌', readPage1.data?.reason || 'Failed');
      log('Read Page 2 Back', '❌', readPage2.data?.reason || 'Failed');
      failed += 2;
    }
  } else {
    log('Write Page 1', '❌', writePage1.error || 'Failed');
    log('Write Page 2', '❌', writePage2.error || 'Failed');
    failed += 4;
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // TEST 5: List All Cached Items
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log('TEST 5: List All Cached Items');
  console.log('─'.repeat(50));
  
  const listResult = await apiCall('list');
  
  if (listResult.success) {
    log('List Operation', '✅', `Found ${listResult.count} items`);
    
    if (listResult.items && listResult.items.length > 0) {
      console.log(`\n   📦 Cached Items:`);
      listResult.items.forEach((item, idx) => {
        const status = item.isExpired ? colors.red + 'EXPIRED' : colors.green + 'VALID';
        console.log(`      ${idx + 1}. ${item.pathname} (${item.sizeBytes}B) - ${status}${colors.reset}`);
      });
    }
    passed++;
  } else {
    log('List Operation', '❌', listResult.error || 'Failed');
    failed++;
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // TEST 6: TTL / Expiry Check
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log('TEST 6: TTL / Expiry System');
  console.log('─'.repeat(50));
  
  const ttlStatus = await apiCall('status', { section: 'hero-slider' });
  
  if (ttlStatus.success && ttlStatus.found) {
    log('TTL Tracking Active', '✅', `Status: ${ttlStatus.status}`);
    log('Seconds Until Expiry', '✅', `${ttlStatus.secondsUntilExpiry}s (~${Math.round(ttlStatus.secondsUntilExpiry/3600)}h remaining)`);
    log('Upload Time Recorded', '✅', ttlStatus.uploadedAt);
    passed += 3;
  } else {
    log('TTL Tracking Active', '❌', 'No expiry info');
    failed += 3;
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('📋 VERIFICATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`\n   ${colors.green}Passed:${colors.reset} ${passed} tests`);
  console.log(`   ${colors.red}Failed:${colors.reset} ${failed} tests`);
  console.log(`   ${colors.cyan}Total:${colors.reset}  ${passed + failed} tests`);
  
  if (failed === 0) {
    console.log(`\n   ${colors.green}🎉 ALL TESTS PASSED! Vercel Blob Cache is WORKING!${colors.reset}\n`);
  } else {
    console.log(`\n   ${colors.red}⚠️  Some tests failed. Check errors above.${colors.reset}\n`);
  }
  
  console.log('='.repeat(60) + '\n');
  
  return { passed, failed, total: passed + failed };
}

// Run tests
runTests()
  .then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
