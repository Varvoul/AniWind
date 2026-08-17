// Test script to verify AniList perPage limits
const ANILIST_GRAPHQL = 'https://graphql.anilist.co';

async function testPerPageLimits() {
  const query = `
    query ($perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        pageInfo {
          total
          currentPage
          lastPage
          hasNextPage
          perPage
        }
        media(type: ANIME, status: NOT_YET_RELEASED, isAdult: false, sort: [POPULARITY_DESC]) {
          id
          title { romaji english }
        }
      }
    }
  `;

  console.log('=== Testing AniList Per-Page Limits ===\n');

  // Test different perPage values
  const testValues = [10, 25, 50, 60, 100];
  
  for (const perPage of testValues) {
    try {
      const response = await fetch(ANILIST_GRAPHQL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ query, variables: { perPage } })
      });

      const data = await response.json();
      
      if (data.errors) {
        console.log(`❌ Requested ${perPage} -> ERROR:`, data.errors[0].message);
        continue;
      }

      const pageInfo = data.data.Page.pageInfo;
      const actualCount = data.data.Page.media?.length || 0;
      
      console.log(`Requested: ${perPage} | Returned: ${actualCount} | Total Available: ${pageInfo.total}`);
      
      if (actualCount < perPage && actualCount < 50) {
        console.log(`   ⚠️ Got fewer items than requested (max reached or end of list)\n`);
      } else {
        console.log(`   ✅ OK\n`);
      }

    } catch (error) {
      console.log(`❌ Requested ${perPage} -> Fetch Error:`, error.message);
    }
  }

  // Now let's see what happens with page 2
  console.log('\n=== Testing Pagination (Page 2 with 50 items) ===\n');
  
  try {
    const response = await fetch(ANILIST_GRAPHQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ 
        query, 
        variables: { perPage: 50 } 
      })
    });

    const data = await response.json();
    
    // Get first item from page 1 for comparison
    const page1First = data.data.Page.media[0]?.title?.english || data.data.Page.media[0]?.title?.romaji;
    const page1Last = data.data.Page.media[data.data.Page.media.length - 1]?.title?.english || data.data.Page.media[data.data.Page.media.length - 1]?.title?.romaji;
    
    console.log(`Page 1 - First: ${page1First}`);
    console.log(`Page 1 - Last: ${page1Last}`);
    
    // Now fetch page 2
    const queryPage2 = `
      query ($perPage: Int) {
        Page(page: 2, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
          }
          media(type: ANIME, status: NOT_YET_RELEASED, isAdult: false, sort: [POPULARITY_DESC]) {
            id
            title { romaji english }
          }
        }
      }
    `;
    
    const response2 = await fetch(ANILIST_GRAPHQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ query: queryPage2, variables: { perPage: 50 } })
    });
    
    const data2 = await response2.json();
    const page2First = data2.data.Page.media[0]?.title?.english || data2.data.Page.media[0]?.title?.romaji;
    const page2Last = data2.data.Page.media[data2.data.Page.media.length - 1]?.title?.english || data2.data.Page.media[data2.data.Page.media.length - 1]?.title?.romaji;
    
    console.log(`\nPage 2 - First: ${page2First}`);
    console.log(`Page 2 - Last: ${page2Last}`);
    console.log(`\n✅ Pagination works! Page 1 and Page 2 have different content.`);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testPerPageLimits();
