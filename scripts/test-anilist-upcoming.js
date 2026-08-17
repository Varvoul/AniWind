// Test script to verify AniList upcoming anime API response
const ANILIST_GRAPHQL = 'https://graphql.anilist.co';

// Standard anime fields used in the project
const ANILIST_ANIME_FIELDS = `
  id
  title { romaji english native }
  format
  status
  episodes
  startDate { year month day }
  endDate { year month day }
  season
  seasonYear
  averageScore
  meanScore
  popularity
  genres
  isAdult
  coverImage { extraLarge large medium color }
  bannerImage
  synonyms
  description(asHtml: false)
  studios(isMain: true) { nodes { name } }
  nextAiringEpisode { airingAt timeUntilAiring episode }
  externalLinks { url site type }
  source
  duration
  tags { name rank }
  rankings { rank type year allTime }
  trailer { id site thumbnail }
  idMal
  siteUrl
`;

async function fetchUpcomingAnime(perPage = 60) {
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
          ${ANILIST_ANIME_FIELDS}
        }
      }
    }
  `;

  console.log('=== Testing AniList Upcoming Anime API ===\n');
  console.log(`Query Parameters:`);
  console.log(`- Type: ANIME`);
  console.log(`- Status: NOT_YET_RELEASED (Upcoming)`);
  console.log(`- Adult: false (filtered out)`);
  console.log(`- Sort: POPULARITY_DESC`);
  console.log(`- Per Page: ${perPage}\n`);

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
      console.error('❌ GraphQL Errors:');
      console.error(JSON.stringify(data.errors, null, 2));
      return;
    }

    const pageData = data.data.Page;
    const mediaItems = pageData.media || [];
    const pageInfo = pageData.pageInfo;

    console.log('=== Response Summary ===\n');
    console.log(`Total upcoming anime available: ${pageInfo.total}`);
    console.log(`Requested per page: ${pageInfo.perPage}`);
    console.log(`Actually returned: ${mediaItems.length}`);
    console.log(`Current page: ${pageInfo.currentPage}`);
    console.log(`Last page: ${pageInfo.lastPage}`);
    console.log(`Has next page: ${pageInfo.hasNextPage}\n`);

    // Check if we got all requested items
    if (mediaItems.length === perPage) {
      console.log(`✅ SUCCESS: Received all ${perPage} requested items\n`);
    } else if (mediaItems.length < perPage) {
      console.log(`⚠️ PARTIAL: Received ${mediaItems.length} of ${perPage} requested items`);
      console.log(`   This means there are only ${mediaItems.length} upcoming anime matching criteria\n`);
    }

    console.log('=== First 10 Upcoming Anime ===\n');
    mediaItems.slice(0, 10).forEach((anime, index) => {
      const title = anime.title?.english || anime.title?.romaji || 'Unknown';
      const format = anime.format || 'Unknown';
      const season = anime.season || 'TBA';
      const year = anime.startDate?.year || 'TBA';
      const score = anime.averageScore || 'N/A';
      const pop = anime.popularity?.toLocaleString() || 'N/A';
      
      console.log(`${index + 1}. ${title}`);
      console.log(`   Format: ${format} | Season: ${season} ${year}`);
      console.log(`   Score: ${score} | Popularity: ${pop}`);
      console.log(`   Status: ${anime.status}`);
      console.log('');
    });

    console.log('=== Last 5 Upcoming Anime ===\n');
    mediaItems.slice(-5).forEach((anime, index) => {
      const title = anime.title?.english || anime.title?.romaji || 'Unknown';
      const format = anime.format || 'Unknown';
      const pop = anime.popularity?.toLocaleString() || 'N/A';
      
      console.log(`${mediaItems.length - 4 + index}. ${title}`);
      console.log(`   Format: ${format} | Popularity: ${pop}`);
      console.log(`   Status: ${anime.status}`);
      console.log('');
    });

    console.log('=== Data Quality Checks ===\n');
    
    // Check for missing titles
    const missingTitles = mediaItems.filter(m => !m.title?.english && !m.title?.romaji);
    console.log(`Missing titles: ${missingTitles.length}`);
    
    // Check for missing cover images
    const missingCovers = mediaItems.filter(m => !m.coverImage?.large);
    console.log(`Missing cover images: ${missingCovers.length}`);
    
    // Check for missing dates
    const missingDates = mediaItems.filter(m => !m.startDate?.year);
    console.log(`Missing start dates: ${missingDates.length}`);
    
    // Status distribution
    const statusCounts = {};
    mediaItems.forEach(m => {
      statusCounts[m.status] = (statusCounts[m.status] || 0) + 1;
    });
    console.log('\nStatus distribution:', JSON.stringify(statusCounts));
    
    // Format distribution
    const formatCounts = {};
    mediaItems.forEach(m => {
      formatCounts[m.format] = (formatCounts[m.format] || 0) + 1;
    });
    console.log('Format distribution:', JSON.stringify(formatCounts));

    // Year distribution for start dates
    const yearCounts = {};
    mediaItems.forEach(m => {
      const year = m.startDate?.year || 'Unknown';
      yearCounts[year] = (yearCounts[year] || 0) + 1;
    });
    console.log('Start year distribution:', JSON.stringify(yearCounts));

    return data;

  } catch (error) {
    console.error('❌ Fetch Error:', error.message);
  }
}

// Run the test
fetchUpcomingAnime(60);
