// Early preload for the default category's table images:
// Matches the exact URL RotaryTableStage will request (256px thumbs on mobile,
// 480px full plates on desktop) so the browser reuses the preloaded bytes
// instead of downloading twice.
import { MENU_ITEMS } from './data/menuData';
import { toThumbSrc } from './components/FadeInImage';

const DEFAULT_CATEGORY_ID = 'hot-coffee';
const isMobileViewport =
  typeof window !== 'undefined' && window.innerWidth < 1024;

const topdowns = Array.from(
  new Set(
    MENU_ITEMS.filter((item) => item.categoryId === DEFAULT_CATEGORY_ID).map(
      (item) => (isMobileViewport ? toThumbSrc(item.image) : item.image),
    ),
  ),
);

for (let i = 0; i < topdowns.length; i++) {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = topdowns[i];
  if (i === 0) {
    link.setAttribute('fetchpriority', 'high');
  }
  document.head.appendChild(link);
}
