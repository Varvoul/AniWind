// Test script to verify the optimized upcoming anime fetcher
const ANILIST_GRAPHQL = 'https://graphql.anilist.co';

// Standard anime fields (same as in home file)
const ANILIST_ANIME_FIELDS = `
  id
  idMal
  title { romaji english native }
  format
  status
  description(asHtml: false)
  startDate { year month day }
  endDate { year month day }
  season
  seasonYear
  episodes
  duration
  coverImage { large medium extraLarge }
  bannerImage
  averageScore
  meanScore
  popularity
  trending
  genres
  tags { name rank }
  studios(isMain: true) { nodes { name } }
  nextAiringEpisode { airingAt timeUntilAiring episode }
  source
  countryOfOrigin
  isAdult
  siteUrl
`;

async function fetchAniListUpcomingTV(targetCount = 50) {
  const TARGET_FORMATS = ['TV', 'TV_SHORT'];
  const MAX_PAGES = 4;
  const PAGE_DELAY_MS = 400;
  
  console.log(`[Upcoming Anime] 🎯 Fetching pure Japanese anime (TV/TV_SHORT format)...`);
  console.log(`[Upcoming Anime] Target: ${targetCount} anime | Max pages: ${MAX_PAGES} | Page delay: ${PAGE_DELAY_MS}ms`);
  
  const allMedia = [];
  let currentPage = 1;
  let totalFetched = 0;
  
  while (currentPage <= MAX_PAGES) {
    console.log(`\n[Upcoming Anime] 📄 Fetching page ${currentPage}...`);
    
    const query = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
          }
          media(type: ANIME, status: NOT_YET_RELEASED, format_in: [TV, TV_SHORT], isAdult: false, sort: [POPULARITY_DESC]) {
            ${ANILIST_ANIME_FIELDS}
          }
        }
      }
    `;
    
    try {
      const response = await fetch(ANILIST_GRAPHQL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ query, variables: { page: currentPage, perPage: 50 } })
      });

      const data = await response.json();
      
      if (data.errors) {
        console.error(`[Upcoming Anime] ❌ Page ${currentPage} GraphQL error:`, data.errors[0].message);
        break;
      }
      
      if (!data.data?.Page?.media) {
        console.warn(`[Upcoming Anime] ⚠️ Page ${currentPage} returned no data`);
        break;
      }
      
      const pageMedia = data.data.Page.media;
      const pageInfo = data.data.Page.pageInfo;
      totalFetched += pageMedia.length;
      
      // Count formats on this page
      const tvCount = pageMedia.filter(m => m.format === 'TV').length;
      const tvShortCount = pageMedia.filter(m => m.format === 'TV_SHORT').length;
      const otherFormat = pageMedia.filter(m => !TARGET_FORMATS.includes(m.format)).length;
      
      console.log(`[Upcoming Anime] 📄 Page ${currentPage}: Got ${pageMedia.length} items (${tvCount} TV + ${tvShortCount} TV_SHORT + ${otherFormat} other)`);
      console.log(`[Upcoming Anime]    Total fetched so far: ${totalFetched}`);
      
      // Add valid items to our collection
      for (const m of pageMedia) {
        if (!m.isAdult && TARGET_FORMATS.includes(m.format)) {
          allMedia.push(m);
        }
      }
      
      const validCount = allMedia.length;
      console.log(`[Upcoming Anime] ✅ Valid TV/TV_SHORT so far: ${validCount}/${targetCount} needed`);
      
      // Show progress every page
      if (validCount >= targetCount) {
        console.log(`[Upcoming Anime] 🎉 Reached target of ${targetCount}!`);
        break;
      }
      
      // Check if there are no more pages
      if (!pageInfo.hasNextPage) {
        console.log(`[Upcoming Anime] 📚 No more pages available (last page: ${pageInfo.lastPage})`);
        break;
      }
      
      currentPage++;
      
      // Respectful delay before next page (rate limiting)
      if (currentPage <= MAX_PAGES) {
        console.log(`[Upcoming Anime] ⏳ Waiting ${PAGE_DELAY_MS}ms before fetching page ${currentPage}...`);
        await new Promise(resolve => setTimeout(resolve, PAGE_DELAY_MS));
      }
      
    } catch (error) {
      console.error(`[Upcoming Anime] ❌ Fetch error on page ${currentPage}:`, error.message);
      break;
    }
  }
  
  console.log(`\n[Upcoming Anime] 📊 FINAL RESULTS:`);
  console.log(`   Total raw items fetched: ${totalFetched}`);
  console.log(`   Valid TV/TV_SHORT anime: ${allMedia.length}`);
  
  // Show format distribution
  const tvFinal = allMedia.filter(m => m.format === 'TV').length;
  const tvShortFinal = allMedia.filter(m => m.format === 'TV_SHORT').length;
  console.log(`   Format breakdown: ${tvFinal} TV + ${tvShortFinal} TV_SHORT`);
  
  // Show first 10 results
  console.log(`\n[Upcoming Anime] 🎬 TOP 10 UPCOMING TV/TV_SHORT ANIME:\n`);
  allMedia.slice(0, 10).forEach((anime, index) => {
    const title = anime.title?.english || anime.title?.romaji || 'Unknown';
    const format = anime.format || 'Unknown';
    const season = anime.season || 'TBA';
    const year = anime.startDate?.year || anime.seasonYear || 'TBA';
    const pop = anime.popularity?.toLocaleString() || 'N/A';
    
    console.log(`${index + 1}. ${title}`);
    console.log(`   Format: ${format} | Season: ${season} ${year} | Popularity: ${pop}`);
    console.log('');
  });
  
  return allMedia;
}

// Run the test
fetchAniListUpcomingTV(55);
