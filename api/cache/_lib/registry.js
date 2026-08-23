import { fetchHeroSliderData } from './sections/hero-slider.js';

// Phase 3 will add: top_airing, new_releases_all, new_releases_hidden,
// new_on_aniumi, upcoming, recently_completed, trending_now,
// most_favourite, popular_anime, schedule — each following this exact
// same pattern: a fetchXData() function returning { data, isComplete }.
export const SECTION_FETCHERS = {
  hero_slider: fetchHeroSliderData,
};
