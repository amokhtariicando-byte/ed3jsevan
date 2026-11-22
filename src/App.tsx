import React, {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronRight,
  Clock,
  Disc,
  Eye,
  Globe,
  LayoutGrid,
  MapPin,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Thermometer,
} from 'lucide-react';
import {
  BeanType,
  CAFE_INFO,
  CategoryId,
  MENU_CATEGORIES,
  MENU_ITEMS,
  MenuItem,
} from './data/menuData';
import {
  calculateItemPrice,
  getBackdropHex,
  getDefaultBean,
} from './utils/menuLogic';
import { EyvanLogo } from './components/EyvanLogo';
import { SplashScreen } from './components/SplashScreen';
import { CameraAngle, RotaryTableStage } from './components/RotaryTableStage';
import { InstagramIcon } from './components/InstagramIcon';
import { preloadAndDecodeImage, toThumbSrc } from './components/FadeInImage';
import { prefersReducedMotion } from './utils/motion';
import { getDeviceProfile } from './utils/deviceTier';
import { localizeCategory, localizeItem, useLanguage } from './i18n/LanguageContext';

const SimpleMenuView = lazy(() =>
  import('./components/SimpleMenuView').then((m) => ({
    default: m.SimpleMenuView,
  })),
);
const DrinkCustomizeDrawer = lazy(() =>
  import('./components/DrinkCustomizeDrawer').then((m) => ({
    default: m.DrinkCustomizeDrawer,
  })),
);
const CafeInfoModal = lazy(() =>
  import('./components/CafeInfoModal').then((m) => ({
    default: m.CafeInfoModal,
  })),
);
const SearchOverlay = lazy(() =>
  import('./components/SearchOverlay').then((m) => ({
    default: m.SearchOverlay,
  })),
);
const MobileCategorySheet = lazy(() =>
  import('./components/MobileCategorySheet').then((m) => ({
    default: m.MobileCategorySheet,
  })),
);
const AdminApp = lazy(() =>
  import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })),
);

/**
 * Jump to the top of the page synchronously, with no animation.
 * `behavior: 'instant'` (not 'auto') is required: index.css sets
 * `scroll-behavior: smooth` on <html>, so 'auto' would still animate.
 * Used by the logo button (back to the hero) and by «نمایش روی میز» /
 * search selection (jump to the hero + select the item). Instant is also
 * the reduced-motion-friendly choice (no animation at all).
 */
function scrollToTopInstant(): void {
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/**
 * How long (ms) the old text fades out before the new text fades in.
 * Must stay in sync with `.eyvan-crossfade-out` in index.css (140ms).
 * The swap is sequential — old out, then new in — so old and new text are
 * never visible at the same time (the previous overlapping crossfade read
 * as garbled double text on phones).
 */
const CROSSFADE_OUT_MS = 140;

/**
 * Resize debounce for the category-dock centering listener (P2-5), matching
 * the stage's debounced resize listener (RotaryTableStage, 150ms).
 */
const RESIZE_DEBOUNCE_MS = 150;

/**
 * Background tone crossfade duration (P1-6). Must stay in sync with the
 * `duration-400` on the background overlay layer in the App root.
 */
const BG_FADE_MS = 400;

/**
 * Splash gate timings (P0-1). The splash used to hold 950ms + fade 700ms
 * (1,650ms fixed), hiding content that was already rendered underneath.
 * The 500ms hold lets the 500ms arch draw finish exactly as the fade
 * starts, so the splash still looks complete, not truncated; the 400ms
 * fade keeps the exit soft. Total ~900ms. SPLASH_FADE_MS must stay in sync
 * with the `duration-400` on the splash root in SplashScreen.tsx, and
 * SPLASH_HOLD_MS with the `.eyvan-draw-arch` duration in index.css.
 */
const SPLASH_HOLD_MS = 500;
const SPLASH_FADE_MS = 400;

/**
 * Sequential text swap for a single text spot (title, description, or price)
 * when the active item changes: the previous text fades out first (140ms),
 * then the new text fades in (220ms). The two are never on screen together,
 * so the swap can never read as overlapping / garbled double text.
 *
 * Rapid-step safe: each new change restarts the fade-out from whatever is
 * currently displayed and re-arms the timer, so hammering next/prev can
 * never stack stale text — intermediate items are skipped and only the
 * latest text fades in. Content changes that don't change `itemKey` (e.g.
 * the price updating on a bean switch) swap instantly with no animation.
 * Under prefers-reduced-motion (or on lite devices) the swap is instant;
 * the CSS animations are neutralized in index.css too.
 *
 * Only ever wrap plain text — never interactive controls.
 */
function CrossfadeText({
  itemKey,
  children,
  className,
}: {
  itemKey: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [display, setDisplay] = useState<{
    key: string;
    node: React.ReactNode;
    phase: 'in' | 'out';
  }>({ key: itemKey, node: children, phase: 'in' });
  const lastKeyRef = useRef(itemKey);
  const latestChildrenRef = useRef(children);
  latestChildrenRef.current = children;
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (lastKeyRef.current === itemKey) return;
    lastKeyRef.current = itemKey;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (prefersReducedMotion() || !getDeviceProfile().enableCrossfade) {
      setDisplay({
        key: itemKey,
        node: latestChildrenRef.current,
        phase: 'in',
      });
      return;
    }
    // Phase 1: fade out whatever is currently displayed.
    setDisplay((prev) => ({ key: prev.key, node: prev.node, phase: 'out' }));
    // Phase 2: after the fade-out, fade the new text in.
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setDisplay({
        key: itemKey,
        node: latestChildrenRef.current,
        phase: 'in',
      });
    }, CROSSFADE_OUT_MS);
  }, [itemKey]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <div className={`relative ${className ?? ''}`}>
      <div
        key={`${display.key}-${display.phase}`}
        className={
          display.phase === 'out'
            ? 'eyvan-crossfade-out'
            : 'eyvan-crossfade-in'
        }
      >
        {display.node}
      </div>
    </div>
  );
}

/**
 * Isolated zero-App-rerender background tone crossfade layer.
 * Uses direct DOM style writes on two layers so changing backdrop tone
 * never triggers the 4x cascading re-render on the 1300-line App tree.
 * The layer lives INSIDE the hero <main> (absolute inset-0, first child):
 * it tints only the hero — the list section below has its own solid cream
 * background. It must NOT be fixed/root-level: a fixed overlay would paint
 * above the in-flow list content during its 400ms fade. No -z-10 here:
 * inside <main> (no stacking context) a negative z-index would drop the
 * layer behind the root div's background; as the first positioned child,
 * all hero content (stage, scrims, showcase, bars) paints above it.
 */
const BackdropToneLayer = memo(function BackdropToneLayer({
  hex,
}: {
  hex: string;
}) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const committedHexRef = useRef<string>(hex);

  useEffect(() => {
    const baseEl = baseRef.current;
    const overlayEl = overlayRef.current;
    if (!baseEl || !overlayEl) return;

    if (hex === committedHexRef.current) return;

    overlayEl.style.backgroundColor = hex;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        if (overlayRef.current) {
          overlayRef.current.style.opacity = '1';
        }
      });
    });

    const timer = window.setTimeout(() => {
      committedHexRef.current = hex;
      if (baseRef.current) baseRef.current.style.backgroundColor = hex;
      if (overlayRef.current) overlayRef.current.style.opacity = '0';
    }, BG_FADE_MS + 40);

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      window.clearTimeout(timer);
    };
  }, [hex]);

  return (
    <>
      <div
        ref={baseRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ backgroundColor: committedHexRef.current }}
      />
      <div
        ref={overlayRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-400 ease-out"
        style={{ opacity: 0 }}
      />
    </>
  );
});

export default function App() {
  const { lang, toggleLang, t, cafeInfo, formatDigits, formatPrice } = useLanguage();
  const deviceProfile = getDeviceProfile();
  const [activeCategoryId, setActiveCategoryId] =
    useState<CategoryId>('hot-coffee');
  const [simpleCategoryId, setSimpleCategoryId] = useState<CategoryId | 'all'>(
    'all',
  );
  const [activeItemIndex, setActiveItemIndex] = useState<number>(0);
  const [overviewMode, setOverviewMode] = useState<boolean>(false);
  const [cameraAngle, setCameraAngle] = useState<CameraAngle>('top');
  const [drawerItem, setDrawerItem] = useState<MenuItem | null>(null);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [infoOpen, setInfoOpen] = useState<boolean>(false);
  const [mobileCatsOpen, setMobileCatsOpen] = useState<boolean>(false);
  // Which list the shared mobile category sheet filters: the hero table's
  // category (opened from the hero bar) or the list section's filter
  // (opened from the list). The sheet reads/writes the matching state.
  const [mobileCatsContext, setMobileCatsContext] = useState<'table' | 'list'>(
    'table',
  );
  // The list section below the hero mounts (lazy chunk + 67 cards) only
  // when the user scrolls near it, so the first paint stays light. Once
  // mounted it never unmounts — filter and scroll state are preserved.
  const listSectionRef = useRef<HTMLElement | null>(null);
  const [listInView, setListInView] = useState<boolean>(false);
  const [splash, setSplash] = useState<'show' | 'leaving' | 'gone'>(
    // Reduced motion skips the splash from the very first render — deciding
    // here (not in a useEffect) means reduced-motion users never see even a
    // 1-frame splash flash.
    () => (prefersReducedMotion() ? 'gone' : 'show'),
  );

  // Splash screen: show the arch logo for SPLASH_HOLD_MS, then fade out
  // over SPLASH_FADE_MS. Reduced motion is already 'gone' via the initial
  // state above, so no timers run for those users.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t1 = window.setTimeout(() => setSplash('leaving'), SPLASH_HOLD_MS);
    const t2 = window.setTimeout(
      () => setSplash('gone'),
      SPLASH_HOLD_MS + SPLASH_FADE_MS,
    );
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);
  // Preload the list-section chunk when the browser is idle after first
  // paint, so scrolling down to the list is instant on repeat visits. Only
  // this chunk — never the admin chunk. The cast keeps TypeScript from
  // narrowing `window` to `never` in the fallback branch: lib.dom declares
  // requestIdleCallback as always present, but Safari doesn't implement it.
  useEffect(() => {
    if (!deviceProfile.allowIdlePreload) return;
    const preload = () => {
      import('./components/SimpleMenuView').catch(() => {
        // A failed preload is simply retried when the list mounts.
      });
    };
    const idle = window as unknown as {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout?: number },
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof idle.requestIdleCallback === 'function') {
      const handle = idle.requestIdleCallback(preload, { timeout: 3000 });
      return () => idle.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(preload, 1200);
    return () => window.clearTimeout(timer);
  }, []);
  // Mount the list section the moment its top edge enters the viewport.
  // The -1px bottom rootMargin keeps it from firing on load: the hero is
  // exactly 100svh, so the section top sits precisely on the viewport's
  // bottom edge, and sub-pixel rounding could otherwise mount it early.
  // Once mounted it stays mounted (observer disconnects on first hit).
  useEffect(() => {
    const el = listSectionRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setListInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setListInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -1px 0px', threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Admin panel: `#/admin` (and any `#/admin/...` route) renders the admin
  // app instead of the customer menu. The admin bundle stays lazy-loaded.
  const [isAdmin, setIsAdmin] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      window.location.hash.startsWith('#/admin'),
  );
  useEffect(() => {
    const onHashChange = () => {
      setIsAdmin(window.location.hash.startsWith('#/admin'));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const [selectedBeans, setSelectedBeans] = useState<
    Record<string, BeanType | undefined>
  >({});

  const dockButtonsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const mobileDockButtonsRef = useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );

  const lastKeyStepRef = useRef<number>(0);

  const warmCategoryPlates = useCallback((catId: CategoryId) => {
    const mobile = typeof window !== 'undefined' && window.innerWidth < 1024;
    const urls = new Set(
      MENU_ITEMS.filter((i) => i.categoryId === catId).map((i) =>
        mobile ? toThumbSrc(i.image) : i.image,
      ),
    );
    for (const u of urls) preloadAndDecodeImage(u);
  }, []);

  const localizedCategories = useMemo(
    () => MENU_CATEGORIES.map((c) => localizeCategory(c, lang)),
    [lang],
  );

  const activeCategory = useMemo(
    () =>
      localizedCategories.find((c) => c.id === activeCategoryId) ??
      localizedCategories[0],
    [localizedCategories, activeCategoryId],
  );

  const categoryItems = useMemo(
    () =>
      MENU_ITEMS.filter((item) => item.categoryId === activeCategoryId).map(
        (item) => localizeItem(item, lang),
      ),
    [activeCategoryId, lang],
  );

  const safeIndex =
    categoryItems.length > 0
      ? ((activeItemIndex % categoryItems.length) + categoryItems.length) %
        categoryItems.length
      : 0;
  const activeItem: MenuItem | undefined = categoryItems[safeIndex];

  const activeBean: BeanType | undefined = activeItem
    ? (selectedBeans[activeItem.id] ?? getDefaultBean(activeItem))
    : undefined;

  const activeUnitPrice = activeItem
    ? calculateItemPrice(activeItem, activeBean, null)
    : 0;

  const backdropHex = useMemo(() => {
    const tone = activeItem?.backdropTone ?? activeCategory.defaultTone;
    return getBackdropHex(tone);
  }, [activeItem, activeCategory.defaultTone]);

  // Background tone crossfade (P1-6). The root div used to animate
  // `background-color` over 400ms on every tone-changing item step — a
  // full-viewport repaint for the whole duration. Instead the committed
  // tone sits on the hero's base layer with NO transition, and tone changes
  // crossfade through an opacity-only overlay layer (compositor-only, no
  // repaint): the overlay fades in with the new tone, then the tone commits
  // to the base layer and the overlay hides (its fade-out is invisible —
  // the same color is underneath by then).
  //
  // The layer lives inside the hero <main> only, so the crossfade can never
  // paint above the in-flow list content below (a root-level positioned
  // overlay would). The list section has its own solid cream background.
  //
  // Opacity-only fades are deliberately kept under prefers-reduced-motion
  // (same precedent as the overlay backdrops in index.css), so there is no
  // motion guard here.
  // Backdrop tone crossfade is isolated inside <BackdropToneLayer />.

  // Keep the active category pill centered horizontally inside its own scroll rail (without ever vertically scrolling the page!)
  useEffect(() => {
    const centerInRail = (
      btn: HTMLButtonElement | null | undefined,
      behavior: ScrollBehavior,
    ) => {
      if (!btn || !btn.parentElement) return;
      const rail = btn.parentElement;
      if (rail.clientWidth === 0) return;
      const btnRect = btn.getBoundingClientRect();
      const railRect = rail.getBoundingClientRect();
      const delta =
        btnRect.left -
        railRect.left -
        railRect.width / 2 +
        btnRect.width / 2;
      rail.scrollTo({
        left: rail.scrollLeft + delta,
        behavior,
      });
    };
    const syncDock = (behavior: ScrollBehavior) => {
      centerInRail(dockButtonsRef.current[activeCategoryId], behavior);
      centerInRail(mobileDockButtonsRef.current[activeCategoryId], behavior);
    };
    const raf = window.requestAnimationFrame(() =>
      syncDock(prefersReducedMotion() ? 'auto' : 'smooth'),
    );
    // Debounced (P2-5): an undebounced resize fires syncDock's 4x
    // getBoundingClientRect + 2x scrollTo on every resize event (dozens
    // while rotating / dragging a window edge).
    let resizeTimer: number | undefined;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(
        () => syncDock('auto'),
        RESIZE_DEBOUNCE_MS,
      );
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    };
  }, [activeCategoryId]);

  const handleSelectCategory = useCallback((id: CategoryId) => {
    const nextCat = MENU_CATEGORIES.find((c) => c.id === id);
    setActiveCategoryId(id);
    setActiveItemIndex(0);
    if (nextCat?.comingSoon) {
      setCameraAngle('top');
    }
    setDrawerItem(null);
  }, []);

  const handleStepItem = useCallback(
    (delta: number) => {
      if (categoryItems.length <= 1) return;
      setActiveItemIndex(
        (prev) => (prev + delta + categoryItems.length) % categoryItems.length,
      );
    },
    [categoryItems.length],
  );

  // Stable callbacks for RotaryTableStage (P1-2): the stage is memoized,
  // and fresh inline closures on every render defeated that memo on every
  // item step. Both use only stable setState functions, so the deps are
  // empty. (The component memo itself lives in RotaryTableStage.tsx.)
  const handleSelectIndex = useCallback((idx: number) => {
    setActiveItemIndex(idx);
  }, []);

  const handleExitOverviewToIndex = useCallback((idx: number) => {
    setActiveItemIndex(idx);
    setOverviewMode(false);
  }, []);

  // Stable callback for SimpleMenuView (P1-2): the card row is memoized,
  // and a fresh inline closure on every App render defeated that memo.
  const handleSelectItemDetails = useCallback((item: MenuItem) => {
    setDrawerItem(item);
  }, []);

  // «نمایش روی میز» (list card / search selection): scroll back to the hero
  // and select the item there. The user may be deep in the long list, so
  // jump to the top first — otherwise the hero is off-screen and the
  // selection change is invisible.
  const handleJumpToTableItem = useCallback((item: MenuItem) => {
    const itemsInCat = MENU_ITEMS.filter(
      (i) => i.categoryId === item.categoryId,
    );
    const idx = Math.max(
      0,
      itemsInCat.findIndex((i) => i.id === item.id),
    );
    scrollToTopInstant();
    setActiveCategoryId(item.categoryId);
    setActiveItemIndex(idx);
    setOverviewMode(false);
    setCameraAngle(item.prefersFrontView ? 'front' : 'top');
    setDrawerItem(null);
  }, []);

  const handleSetBeanForItem = useCallback((itemId: string, bean: BeanType) => {
    setSelectedBeans((prev) => ({ ...prev, [itemId]: bean }));
  }, []);

  // The list section opens the shared mobile category sheet in 'list'
  // context (it filters the list); the hero bar opens it in 'table'
  // context (it switches the table's category).
  const handleOpenMobileCategories = useCallback(() => {
    setMobileCatsContext('list');
    setMobileCatsOpen(true);
  }, []);

  // Keyboard navigation for the rotary table (arrow keys step items).
  // Active anywhere on the page — the hero is always rendered — but never
  // while an overlay is open or while typing in an input.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        drawerItem ||
        searchOpen ||
        infoOpen ||
        mobileCatsOpen
      ) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'Escape') {
        if (overviewMode) setOverviewMode(false);
        else if (cameraAngle === 'front') setCameraAngle('top');
      } else if (e.key === 'ArrowLeft' && !overviewMode) {
        const now = Date.now();
        if (now - lastKeyStepRef.current < 220) return;
        lastKeyStepRef.current = now;
        handleStepItem(1);
      } else if (e.key === 'ArrowRight' && !overviewMode) {
        const now = Date.now();
        if (now - lastKeyStepRef.current < 220) return;
        lastKeyStepRef.current = now;
        handleStepItem(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    drawerItem,
    searchOpen,
    infoOpen,
    mobileCatsOpen,
    overviewMode,
    cameraAngle,
    handleStepItem,
  ]);

  const hasDualBean =
    activeItem &&
    typeof activeItem.priceBlend50 === 'number' &&
    typeof activeItem.priceArabica100 === 'number';
  const isArabicaOnly =
    activeItem &&
    typeof activeItem.priceBlend50 !== 'number' &&
    typeof activeItem.priceArabica100 === 'number';

  const drawerCategoryName = useMemo(() => {
    if (!drawerItem) return activeCategory.name;
    return (
      localizedCategories.find((c) => c.id === drawerItem.categoryId)?.name ??
      activeCategory.name
    );
  }, [drawerItem, activeCategory.name, localizedCategories]);

  if (isAdmin) {
    return (
      <Suspense fallback={<SplashScreen compact />}>
        <AdminApp />
      </Suspense>
    );
  }

  // Root overflow-x-clip (NOT hidden): clip contains horizontal overflow
  // without creating a scroll container — overflow-x: hidden would compute
  // overflow-y to auto, making this div the sticky elements' scroll
  // container and breaking the list's sticky category bar (it scrolled away
  // with the page instead of sticking under the header).
  return (
    <div className="relative min-h-screen w-full overflow-x-clip bg-[#F8F7F2] text-[#2F321C]">
      {splash !== 'gone' && <SplashScreen leaving={splash === 'leaving'} />}
      {/* Top Bar — 3-Zone Editorial Header (Official Eyvan Logo · Clean Links · Language Switcher) */}
      <header className="fixed inset-x-0 top-0 z-30 h-12 border-b border-[rgba(107,112,67,0.1)] bg-[#FFFFFF]/96 md:h-16 lg:bg-[#FFFFFF]/96">
        <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6 lg:px-10">
          {/* Zone 1: Official Eyvan Brand Mark */}
          <button
            type="button"
            onClick={() => {
              scrollToTopInstant();
              setOverviewMode(false);
              setCameraAngle('top');
              setDrawerItem(null);
              handleSelectCategory('hot-coffee');
            }}
            aria-label="بازگشت به ابتدای منوی کافه و رستوران ایوان"
            className="shrink-0 rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B7043]"
          >
            <EyvanLogo variant="header" tone="gold" />
          </button>

          {/* Zone 2: Desktop Single-Line Navigation Links */}
          <nav
            aria-label="ناوبری اصلی"
            className="hidden items-center gap-7 text-sm font-normal text-[#57534E] md:flex"
          >
            <button
              type="button"
              onClick={() => {
                setCameraAngle('top');
                setOverviewMode((v) => !v);
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-[#2F321C] ${
                overviewMode ? 'text-[#6B7043]' : ''
              }`}
            >
              {t.overviewTable}
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="whitespace-nowrap shrink-0 transition-colors hover:text-[#2F321C]"
            >
              {t.search}
            </button>
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              className="whitespace-nowrap shrink-0 transition-colors hover:text-[#2F321C]"
            >
              {t.cafeInfo}
            </button>
            <a
              href={CAFE_INFO.instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors hover:text-[#6B7043]"
            >
              <InstagramIcon className="h-4 w-4" />
              <span>{t.instagram}</span>
            </a>
          </nav>

          {/* Zone 3: Language Switcher (FA <-> AR) */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleLang}
              aria-label={t.switchLangAria}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[rgba(107,112,67,0.2)] bg-[#F8F7F2] px-2.5 py-1.5 text-xs font-medium text-[#2F321C] transition-colors hover:border-[#B5945B] hover:bg-[#E8EAD9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B7043] whitespace-nowrap shrink-0 sm:px-3"
            >
              <Globe className="h-3.5 w-3.5 text-[#6B7043]" strokeWidth={1.7} />
              <span>{t.langShort}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Single scrollable page: the rotary table is the hero on top,
      the full list menu is a section below it, then the cafe-info footer.
      No view switching — the «منوی ساده» toggle is gone. */}
      {/* Hero: the rotary table, full-screen. 100svh (not dvh): the small
      viewport height is stable while the mobile browser toolbar
      shows/hides — with dvh the table height tracked the toolbar and the
      card jumped mid-scroll and on tab return. */}
      <main className="relative h-[100svh] min-h-[600px] w-full overflow-hidden">
        <BackdropToneLayer hex={backdropHex} />

        {/* Mobile category bar (directly below the header — never hidden by
        mobile browser toolbars). Absolute inside the hero, so it scrolls
        away with the hero; while the hero is in view it looks identical to
        the old fixed bar (top-12 = directly below the h-12 header). */}
        <nav
          aria-label="انتخاب دسته‌بندی منو در موبایل"
          className="absolute inset-x-0 top-12 z-30 border-b border-[rgba(107,112,67,0.1)] bg-[#F8F7F2]/97 px-2.5 py-1 md:top-16 lg:hidden"
        >
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setMobileCatsContext('table');
                setMobileCatsOpen(true);
              }}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-[rgba(181,148,91,0.55)] bg-[#6B7043] px-2.5 text-[11.5px] font-medium text-white whitespace-nowrap transition-colors hover:bg-[#4F5330]"
            >
              <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.8} />
              <span>{t.categoriesBtn}</span>
            </button>

            <div className="eyvan-scroll-hidden flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {localizedCategories.map((category) => {
                const isActive = category.id === activeCategoryId;
                return (
                  <button
                    key={`mob-${category.id}`}
                    ref={(el) => {
                      mobileDockButtonsRef.current[category.id] = el;
                    }}
                    type="button"
                    onPointerDown={() => warmCategoryPlates(category.id)}
                    onMouseEnter={() => warmCategoryPlates(category.id)}
                    onClick={() => handleSelectCategory(category.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-[8px] px-2.5 text-[11.5px] font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B7043] ${
                      isActive
                        ? 'border border-[rgba(181,148,91,0.58)] bg-[#6B7043] text-white'
                        : 'border border-transparent text-[#57534E] hover:bg-[#FFFFFF] hover:text-[#2F321C]'
                    }`}
                  >
                    <span>{category.shortName}</span>
                    {category.comingSoon && (
                      <span className="text-[9.5px] font-normal text-[#6B7043]">
                        {t.comingSoon}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </nav>
        {/* Layer 1: Giant Rotating Circular Marble Tabletop + 3D Forward Camera Tilt */}
        <RotaryTableStage
          category={activeCategory}
          items={categoryItems}
          activeIndex={safeIndex}
          overviewMode={overviewMode}
          cameraAngle={cameraAngle}
          drawerOpen={Boolean(drawerItem)}
          onSelectIndex={handleSelectIndex}
          onStep={handleStepItem}
          onExitOverviewToIndex={handleExitOverviewToIndex}
          onChangeCameraAngle={setCameraAngle}
        />

        {/* Mobile Soft Bottom Scrim for Ultra-Crisp Persian Text Legibility.
        Two heights crossfade (opacity-only) instead of one layer snapping
        h-[54%] <-> h-[47%] on camera toggle — the snap moved the fade's
        top edge ~7% of the viewport instantly while the camera glided
        600ms. Opacity-only fades are kept under prefers-reduced-motion
        (see index.css), so no motion guard is needed. */}
        {!overviewMode && (
          <>
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[54%] bg-gradient-to-t from-[#F8F7F2] via-[#F8F7F2]/92 to-transparent transition-opacity duration-500 ease-out lg:hidden ${
                cameraAngle === 'front' ? 'opacity-0' : 'opacity-100'
              }`}
            />
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[47%] bg-gradient-to-t from-[#F8F7F2] via-[#F8F7F2]/92 to-transparent transition-opacity duration-500 ease-out lg:hidden ${
                cameraAngle === 'front' ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </>
        )}

        {/* Overview Mode Top Exit Bar */}
        {overviewMode && (
          <div className="eyvan-text-enter pointer-events-none absolute inset-x-0 top-[108px] z-20 flex justify-center px-4 lg:top-[72px]">
            <div className="pointer-events-auto flex items-center gap-3.5 rounded-[12px] border border-[rgba(107,112,67,0.16)] bg-[#F8F7F2]/94 px-4 py-1.5 text-xs text-[#2F321C]">
              <span>{t.overviewBarPrefix} · {activeCategory.name}</span>
              <span aria-hidden="true" className="text-[#A8A29E]">
                ·
              </span>
              <button
                type="button"
                onClick={() => setOverviewMode(false)}
                className="font-medium text-[#6B7043] transition-colors hover:text-[#4F5330]"
              >
                {t.backToSingleView}
              </button>
            </div>
          </div>
        )}

        {/* Layer 2: Right-Side Editorial Product Showcase (Desktop RTL Right / Mobile Lower Sheet) */}
        <section
          aria-label="جزئیات محصول انتخاب‌شده روی میز"
          className={`eyvan-showcase-panel pointer-events-none relative z-20 mx-auto flex h-full max-w-[1440px] flex-col justify-end px-3 pt-28 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-[opacity,transform] duration-300 ease-out sm:px-6 lg:flex-row lg:items-center lg:justify-start lg:px-12 lg:pt-16 lg:pb-16 ${
            overviewMode
              ? 'translate-y-4 opacity-0'
              : 'translate-y-0 opacity-100'
          }`}
        >
          {/* No swipe handlers on the card: item-step swiping lives on the
              table/stage drag only — the card swipe covered the whole display. */}
          <div
            className={`pointer-events-auto w-full max-w-[460px] rounded-[18px] border border-[rgba(107,112,67,0.12)] bg-[#F8F7F2]/94 px-4 py-3.5 lg:max-w-[440px] lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 ${
              overviewMode ? 'pointer-events-none' : ''
            }`}
          >
            {activeCategory.comingSoon ? (
              <div
                key={activeCategory.id}
                className="eyvan-text-enter space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-[#6B7043]">
                    <span>{t.eyvanKitchen}</span>
                    <span aria-hidden="true">·</span>
                    <span>{t.comingSoon}</span>
                  </div>
                  <div className="flex items-center gap-1.5 lg:hidden">
                    <button
                      type="button"
                      onClick={() => setSearchOpen(true)}
                      aria-label="جستجو در منو"
                      className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[rgba(107,112,67,0.16)] bg-[#FFFFFF]/90 text-[#2F321C]"
                    >
                      <Search className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </div>
                </div>

                <h1 className="text-2xl font-semibold leading-tight text-[#2F321C] sm:text-4xl lg:text-[46px]">
                  {activeCategory.name}
                </h1>

                <p className="text-[13px] leading-6 text-[#57534E] sm:text-[15px] sm:leading-7">
                  {activeCategory.comingSoonDescription}
                </p>

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => handleSelectCategory('hot-coffee')}
                    className="rounded-[10px] bg-[#6B7043] px-4 py-2.5 text-xs font-medium text-[#F8F7F2] transition-colors hover:bg-[#4F5330] sm:px-5 sm:text-sm"
                  >
                    {t.viewHotCoffee}
                  </button>
                  <a
                    href={CAFE_INFO.instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-[10px] border border-[rgba(107,112,67,0.22)] bg-[#FFFFFF]/80 px-3.5 py-2.5 text-xs text-[#2F321C] transition-colors hover:border-[#B5945B] sm:px-4 sm:text-sm"
                  >
                    <InstagramIcon className="h-4 w-4 text-[#6B7043]" />
                    <span>{t.followLaunchInstagram}</span>
                  </a>
                </div>
              </div>
            ) : activeItem ? (
              <div className="space-y-2.5 lg:space-y-4">
                {/* Top Row: Category & Counter Metadata + Compact Mobile Quick Tools */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-[#6B7043]">
                    <span>{activeCategory.shortName}</span>
                    <span aria-hidden="true" className="text-[#A8A29E]">
                      ·
                    </span>
                    <span className="tabular-fa text-[#57534E]">
                      {formatDigits(safeIndex + 1)} {t.ofWord}{' '}
                      {formatDigits(categoryItems.length)}
                    </span>
                    {activeItem.highlight && (
                      <>
                        <span aria-hidden="true" className="text-[#A8A29E]">
                          ·
                        </span>
                        <span className="text-[#6B7043]">
                          {activeItem.highlight}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Mobile Compact Utility Buttons */}
                  <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
                    <button
                      type="button"
                      onClick={() => {
                        setCameraAngle('top');
                        setOverviewMode(true);
                      }}
                      aria-label="نمای کلی میز"
                      className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[rgba(107,112,67,0.16)] bg-[#FFFFFF]/90 px-2.5 text-[11px] font-medium text-[#2F321C] transition-colors hover:border-[#B5945B]"
                    >
                      <Disc
                        className="h-3.5 w-3.5 text-[#6B7043]"
                        strokeWidth={1.7}
                      />
                      <span>{t.overviewShort}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSearchOpen(true)}
                      aria-label="جستجو در منو"
                      className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[rgba(107,112,67,0.16)] bg-[#FFFFFF]/90 text-[#2F321C]"
                    >
                      <Search className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </div>
                </div>

                {/* High-Contrast Persian Title (crossfades with the wheel turn) */}
                <CrossfadeText itemKey={activeItem.id}>
                  <h1 className="text-[24px] font-semibold leading-[1.2] text-[#2F321C] sm:text-3xl lg:text-[46px]">
                    {activeItem.name}
                  </h1>
                </CrossfadeText>

                {/* Bright, Scannable Tasting Description (crossfades with the wheel turn) */}
                {/* Fixed 2-line height so the card never jumps when the new
                    description wraps to a different line count. */}
                <CrossfadeText
                  itemKey={activeItem.id}
                  className="min-h-10 lg:min-h-14"
                >
                  <p className="line-clamp-2 text-[13px] leading-5 text-[#57534E] lg:line-clamp-none lg:text-[15px] lg:leading-7">
                    {activeItem.description}
                  </p>
                </CrossfadeText>

                {/* Live Bean Selector + Toman Price (No Trailing Zeros) */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-y border-[rgba(107,112,67,0.13)] py-2.5 lg:py-3">
                  <div>
                    <span className="block text-[10.5px] text-[#78716C] lg:text-[11px]">
                      {t.priceNoZeros}
                    </span>
                    <CrossfadeText itemKey={activeItem.id}>
                      <div className="tabular-fa mt-0.5 text-[22px] font-semibold text-[#6B7043] lg:text-[28px]">
                        {formatPrice(activeUnitPrice)}
                      </div>
                    </CrossfadeText>
                  </div>

                  {hasDualBean ? (
                    <div
                      role="group"
                      aria-label="انتخاب نوع دانه قهوه"
                      className="flex items-center gap-1 rounded-[10px] border border-[rgba(107,112,67,0.18)] bg-[#FFFFFF]/88 p-1"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          handleSetBeanForItem(activeItem.id, 'blend50')
                        }
                        className={`rounded-[7px] px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors lg:px-3 ${
                          activeBean === 'blend50'
                            ? 'bg-[#6B7043] text-[#F8F7F2]'
                            : 'text-[#57534E] hover:text-[#2F321C]'
                        }`}
                      >
                        {t.blend5050}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleSetBeanForItem(activeItem.id, 'arabica100')
                        }
                        className={`rounded-[7px] px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors lg:px-3 ${
                          activeBean === 'arabica100'
                            ? 'bg-[#6B7043] text-[#F8F7F2]'
                            : 'text-[#57534E] hover:text-[#2F321C]'
                        }`}
                      >
                        {t.arabica100}
                      </button>
                    </div>
                  ) : isArabicaOnly ? (
                    <span className="text-xs font-medium text-[#6B7043]">
                      {t.arabicaExclusive}
                    </span>
                  ) : null}
                </div>

                {/* Primary & Secondary Actions: Balanced 2-Column Touch Grid on Mobile / Inline on Desktop */}
                <div className="grid grid-cols-2 gap-2 pt-0.5 lg:flex lg:flex-wrap lg:items-center lg:gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      setCameraAngle((prev) =>
                        prev === 'front' ? 'top' : 'front',
                      )
                    }
                    className={`inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B7043] whitespace-nowrap lg:px-4 lg:py-2.5 lg:text-sm ${
                      cameraAngle === 'front'
                        ? 'border border-[#B5945B] bg-[#6B7043] text-white hover:bg-[#4F5330]'
                        : activeItem.prefersFrontView
                          ? 'bg-[#6B7043] text-[#F8F7F2] hover:bg-[#4F5330]'
                          : 'border border-[rgba(181,148,91,0.46)] bg-[#FFFFFF]/85 text-[#2F321C] hover:border-[#B5945B] hover:bg-[#FFFFFF]'
                    }`}
                  >
                    {cameraAngle === 'front' ? (
                      <>
                        <RotateCcw className="h-3.5 w-3.5 shrink-0 lg:h-4 lg:w-4" strokeWidth={1.7} />
                        <span>{t.backToTopView}</span>
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5 shrink-0 lg:h-4 lg:w-4" strokeWidth={1.7} />
                        <span>
                          {activeItem.prefersFrontView
                            ? t.viewFrontAngle
                            : t.frontCupView}
                        </span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setDrawerItem(activeItem)}
                    className={`inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B7043] whitespace-nowrap lg:px-4 lg:py-2.5 lg:text-sm ${
                      activeItem.prefersFrontView && cameraAngle !== 'front'
                        ? 'border border-[rgba(107,112,67,0.22)] bg-[#FFFFFF]/85 text-[#2F321C] hover:border-[#B5945B]'
                        : 'bg-[#FFFFFF] text-[#2F321C] hover:bg-[#E8EAD9]'
                    }`}
                  >
                    <SlidersHorizontal
                      className="h-3.5 w-3.5 shrink-0 lg:h-4 lg:w-4"
                      strokeWidth={1.6}
                    />
                    <span>
                      {activeItem.supportsSyrup
                        ? t.syrupAndDetails
                        : t.productDetails}
                    </span>
                  </button>
                </div>

                {/* Official Printed Milk Temperature Notice on Hot Bar.
                    Always mounted with a grid-rows collapse so switching
                    between milk-temp and non-milk-temp items animates the
                    card height instead of snapping it (no layout jump). */}
                <div
                  className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                    activeCategory.isHotCategory &&
                    activeItem.supportsMilkTemp
                      ? 'grid-rows-[1fr]'
                      : 'grid-rows-[0fr]'
                  }`}
                >
                  <p className="flex min-h-0 items-start gap-2 overflow-hidden text-[11px] leading-5 text-[#78716C]">
                    <Thermometer
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6B7043]"
                      strokeWidth={1.6}
                    />
                    <span>{cafeInfo.milkTempNote}</span>
                  </p>
                </div>

                {/* Rotary Table Next Control (single right-side ">" button) + Desktop Overview Trigger */}
                <div className="flex items-center justify-between gap-3 pt-0.5 lg:justify-start lg:gap-5 lg:pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleStepItem(1)}
                      aria-label="نوشیدنی بعدی روی میز"
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(107,112,67,0.24)] bg-[#FFFFFF]/90 text-[#2F321C] transition-colors hover:border-[#B5945B] hover:text-[#6B7043] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B7043] lg:h-10 lg:w-10"
                    >
                      <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCameraAngle('top');
                      setOverviewMode(true);
                    }}
                    className="hidden items-center gap-1.5 text-xs font-medium text-[#6B7043] transition-colors hover:text-[#4F5330] lg:inline-flex"
                  >
                    <Disc className="h-3.5 w-3.5" strokeWidth={1.7} />
                    <span>{t.fullTrayView}</span>
                  </button>

                  {/* Interactive pagination dots on mobile for effortless one-thumb navigation */}
                  {categoryItems.length > 1 && (
                    <div
                      className="flex items-center gap-1.5 lg:hidden"
                      role="tablist"
                      aria-label={activeCategory.name}
                    >
                      {categoryItems.map((it, idx) => {
                        const activeDot = idx === safeIndex;
                        return (
                          <button
                            key={it.id}
                            type="button"
                            role="tab"
                            aria-selected={activeDot}
                            aria-label={it.name}
                            onClick={() => handleSelectIndex(idx)}
                            className={`h-2 rounded-full transition-[width,background-color] duration-200 ${
                              activeDot
                                ? 'w-5 bg-[#6B7043]'
                                : 'w-2 bg-[#6B7043]/25 hover:bg-[#6B7043]/50'
                            }`}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* Desktop Bottom Spatial Category Dock (Mobile uses the always-visible top category bar below header) */}
        <nav
          aria-label="دسته‌بندی‌های منوی کافه و رستوران ایوان"
          className="pointer-events-none absolute inset-x-0 bottom-3 z-30 hidden justify-center px-3 lg:flex"
        >
          <div className="pointer-events-auto flex h-[52px] w-auto max-w-[1180px] items-center gap-1.5 rounded-[14px] border border-[rgba(107,112,67,0.16)] bg-[#FFFFFF]/95 p-1.5 shadow-xl">
            <div className="eyvan-scroll-hidden flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {localizedCategories.map((category) => {
                const isActive = category.id === activeCategoryId;
                return (
                  <button
                    key={category.id}
                    ref={(el) => {
                      dockButtonsRef.current[category.id] = el;
                    }}
                    type="button"
                    onPointerDown={() => warmCategoryPlates(category.id)}
                    onMouseEnter={() => warmCategoryPlates(category.id)}
                    onClick={() => handleSelectCategory(category.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B7043] ${
                      isActive
                        ? 'border border-[rgba(181,148,91,0.52)] bg-[#6B7043] text-white'
                        : 'border border-transparent text-[#57534E] hover:bg-[#FFFFFF] hover:text-[#2F321C]'
                    }`}
                  >
                    <span>{category.shortName}</span>
                    {category.comingSoon && (
                      <span className="text-[10px] font-normal text-[#6B7043]">
                        {t.comingSoon}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </nav>
      </main>

      {/* Full list menu, below the hero on the same page. Mounts only when
      the user scrolls near it (see listInView); the 400px placeholder keeps
      the page scrollable before then, and the chunk is idle-preloaded so
      the mount itself is fast. No onReady/scroll-to-top: the list mounts
      while the user is already scrolled down and must never yank them back
      to the hero. */}
      <section
        ref={listSectionRef}
        aria-label="منوی کامل کافه و رستوران ایوان"
        className="relative z-20 bg-[#F8F7F2]"
      >
        {listInView ? (
          <Suspense fallback={<div className="min-h-[400px]" aria-hidden="true" />}>
            <SimpleMenuView
              selectedCategory={simpleCategoryId}
              onSelectCategory={setSimpleCategoryId}
              selectedBeans={selectedBeans}
              onSelectItemDetails={handleSelectItemDetails}
              onInspectOnTable={handleJumpToTableItem}
              onOpenMobileCategories={handleOpenMobileCategories}
            />
          </Suspense>
        ) : (
          <div className="min-h-[400px]" aria-hidden="true" />
        )}
      </section>

      {/* Grounded Editorial Footer (Official Eyvan Logo, Hours, Location, Cashier Note & Instagram).
          No content-visibility here: the old `auto 320px` estimate (real height ~500px)
          jumped the page height when the footer scrolled into view. */}
      <footer className="relative z-20 border-t border-[rgba(107,112,67,0.1)] bg-[#FFFFFF] px-5 pt-8 pb-10 sm:px-8 lg:px-12 lg:pt-12">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-6 md:flex-row md:items-start md:justify-between md:gap-8">
          <div className="flex flex-col items-start gap-3">
            <EyvanLogo
              variant="full"
              tone="gold"
              className="items-start text-right"
            />
            <p className="max-w-sm text-xs leading-6 text-[#78716C]">
              {cafeInfo.tagline}
            </p>
            <p className="text-xs text-[#6B7043]">
              {cafeInfo.paymentNote} · {t.priceTomanNote}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 text-xs text-[#57534E] sm:grid-cols-2 sm:gap-10">
            <div className="space-y-3">
              <p className="text-sm font-medium text-[#2F321C]">
                {t.infoAndHours}
              </p>
              <div className="flex items-center gap-2">
                <Clock
                  className="h-4 w-4 shrink-0 text-[#6B7043]"
                  strokeWidth={1.5}
                />
                <span className="tabular-fa">{cafeInfo.hours}</span>
              </div>
              <div className="flex items-start gap-2">
                <MapPin
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#6B7043]"
                  strokeWidth={1.5}
                />
                <button
                  type="button"
                  onClick={() => setInfoOpen(true)}
                  className="text-right transition-colors hover:text-[#6B7043]"
                >
                  {cafeInfo.addressStatus}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-[#2F321C]">
                {t.contactAndStandard}
              </p>
              <a
                href={CAFE_INFO.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-[#6B7043] transition-colors hover:text-[#4F5330]"
              >
                <InstagramIcon className="h-4 w-4 shrink-0" />
                <span dir="ltr">{CAFE_INFO.instagramHandle}</span>
              </a>
              <p className="max-w-xs leading-6 text-[#78716C]">
                {cafeInfo.milkTempNote}
              </p>
            </div>
          </div>
        </div>
      </footer>

      {/* Drawers & Modals */}
      {drawerItem && (
        <Suspense fallback={<SplashScreen compact />}>
          <DrinkCustomizeDrawer
            item={localizeItem(drawerItem, lang)}
            categoryName={drawerCategoryName}
            selectedBean={
              drawerItem
                ? (selectedBeans[drawerItem.id] ?? getDefaultBean(drawerItem))
                : undefined
            }
            onBeanChange={(bean) => {
              if (drawerItem) handleSetBeanForItem(drawerItem.id, bean);
            }}
            onClose={() => setDrawerItem(null)}
          />
        </Suspense>
      )}

      {searchOpen && (
        <Suspense fallback={<SplashScreen compact />}>
          <SearchOverlay
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            onSelectMenuItem={handleJumpToTableItem}
          />
        </Suspense>
      )}

      {mobileCatsOpen && (
        <Suspense fallback={<SplashScreen compact />}>
          <MobileCategorySheet
            open={mobileCatsOpen}
            activeCategoryId={
              mobileCatsContext === 'list' ? simpleCategoryId : activeCategoryId
            }
            includeAllOption={mobileCatsContext === 'list'}
            onSelect={(catId) => {
              if (mobileCatsContext === 'list') {
                setSimpleCategoryId(catId);
              } else if (catId !== 'all') {
                handleSelectCategory(catId);
              }
            }}
            onClose={() => setMobileCatsOpen(false)}
          />
        </Suspense>
      )}

      {infoOpen && (
        <Suspense fallback={<SplashScreen compact />}>
          <CafeInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
