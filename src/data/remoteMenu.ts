import {
  CAFE_INFO,
  MENU_CATEGORIES,
  MENU_ITEMS,
  SYRUP_OPTIONS,
  type BackdropTone,
  type CategoryId,
  type MenuCategory,
  type MenuItem,
  type SyrupOption,
} from './menuData';
import { getApiBaseUrl } from '../admin/api';
import { preloadAndDecodeImage, toThumbSrc } from '../components/FadeInImage';
import type { MenuState } from '../admin/types';

/**
 * Loads the PUBLISHED menu from the PHP backend (GET /api/menu) at startup
 * and swaps it in over the static menu data, in place: MENU_ITEMS,
 * MENU_CATEGORIES and SYRUP_OPTIONS are mutated via splice/push and
 * CAFE_INFO via Object.assign, so every existing consumer (App.tsx and the
 * rest, which import the arrays directly) sees the remote data without
 * any change.
 *
 * Safety rules:
 * - Without VITE_EYVAN_API_BASE this resolves false immediately and makes
 *   no request at all (mock mode / GitHub Pages: static menu, unchanged).
 * - The remote payload is fully validated and mapped into fresh arrays
 *   BEFORE anything is mutated, so a corrupt payload leaves the static
 *   menu untouched.
 * - Any failure (network, timeout, bad JSON, invalid shape) resolves
 *   false. This function never throws.
 * - Prices pass through untouched: the backend seed stores the same bare
 *   thousands the frontend uses (175), despite API.md saying "full
 *   تومان" — no /1000 conversion anywhere.
 *
 * Known gaps (see the integration report): the remote `featured` list and
 * `seo` are ignored — the customer menu has no featured section to wire
 * them to (its "پیشنهادهای محبوب" is just the first 12 items in
 * SearchOverlay) and never reads seo. In Arabic mode the remote cafeInfo
 * is hidden behind the AR_CAFE_INFO overrides in LanguageContext.
 */

const FETCH_TIMEOUT_MS = 3000;

const BACKDROP_TONES: ReadonlySet<string> = new Set([
  'navy',
  'midnight',
  'olive',
  'bronze',
  'plum',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asTone(value: unknown): BackdropTone {
  return typeof value === 'string' && BACKDROP_TONES.has(value)
    ? (value as BackdropTone)
    : 'olive';
}

function asSortOrder(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : Number.MAX_SAFE_INTEGER;
}

/**
 * AdminItem → MenuItem. Drops `available`/`sortOrder`; unavailable items
 * return null (ناموجودها در منوی مشتری دیده نمی‌شوند). The remote
 * cutoutImage is used directly — the FRONT_TO_CUTOUT derivation only
 * applies to the static data.
 */
function mapItem(raw: unknown): { item: MenuItem; sortOrder: number } | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.categoryId !== 'string' || raw.categoryId === '') return null;
  if (typeof raw.name !== 'string' || raw.name === '') return null;
  if (raw.available === false) return null;
  return {
    item: {
      id: raw.id,
      // Admin-created categories have ids outside the static union;
      // at runtime a category id is just a string.
      categoryId: raw.categoryId as CategoryId,
      name: raw.name,
      description: asString(raw.description),
      price: asOptionalNumber(raw.price),
      priceBlend50: asOptionalNumber(raw.priceBlend50),
      priceArabica100: asOptionalNumber(raw.priceArabica100),
      supportsSyrup: asOptionalBoolean(raw.supportsSyrup),
      supportsMilkTemp: asOptionalBoolean(raw.supportsMilkTemp),
      highlight: asOptionalString(raw.highlight),
      isHot: asOptionalBoolean(raw.isHot),
      image: asString(raw.image),
      frontImage: asString(raw.frontImage),
      cutoutImage: asString(raw.cutoutImage),
      vesselType: raw.vesselType === 'tall' ? 'tall' : 'cup',
      prefersFrontView: asOptionalBoolean(raw.prefersFrontView),
      plateAngle: asOptionalNumber(raw.plateAngle),
      backdropTone: asTone(raw.backdropTone),
    },
    sortOrder: asSortOrder(raw.sortOrder),
  };
}

function mapCategory(
  raw: unknown,
): { category: MenuCategory; sortOrder: number } | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.name !== 'string' || raw.name === '') return null;
  return {
    category: {
      id: raw.id as CategoryId,
      name: raw.name,
      shortName: asString(raw.shortName),
      subtitle: asString(raw.subtitle),
      comingSoon: asOptionalBoolean(raw.comingSoon),
      comingSoonDescription: asOptionalString(raw.comingSoonDescription),
      defaultTone: asTone(raw.defaultTone),
      isHotCategory: asOptionalBoolean(raw.isHotCategory),
    },
    sortOrder: asSortOrder(raw.sortOrder),
  };
}

function mapSyrup(raw: unknown): SyrupOption | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.name !== 'string' || raw.name === '') return null;
  if (typeof raw.price !== 'number' || !Number.isFinite(raw.price)) return null;
  return { id: raw.id, name: raw.name, price: raw.price };
}

/**
 * Validates + maps the whole remote state. Returns null when the payload
 * is unusable (not an object, empty items/categories) — the caller then
 * keeps the static menu. An empty items/categories list is treated as
 * invalid: a healthy backend always seeds them, and wiping the customer
 * menu over a wiped/seedless database would be worse than serving the
 * static menu.
 */
function mapRemoteState(data: unknown): {
  items: MenuItem[];
  categories: MenuCategory[];
  syrups: SyrupOption[] | null;
  cafePatch: Partial<typeof CAFE_INFO>;
} | null {
  if (!isRecord(data)) return null;
  const state = data as Partial<MenuState>;
  if (!Array.isArray(state.items) || state.items.length === 0) return null;
  if (!Array.isArray(state.categories) || state.categories.length === 0) {
    return null;
  }

  const mappedCategories = state.categories
    .map(mapCategory)
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (mappedCategories.length === 0) return null;
  const categories = mappedCategories.map((c) => c.category);
  const categoryOrder = new Map(
    categories.map((c, i) => [c.id as string, i] as const),
  );

  // Items grouped by category (in remote category order), each group
  // sorted by sortOrder; items of unknown categories go last.
  const mappedItems = state.items
    .map(mapItem)
    .filter((i): i is NonNullable<typeof i> => i !== null)
    .sort((a, b) => {
      const orderA = categoryOrder.get(a.item.categoryId as string) ?? Infinity;
      const orderB = categoryOrder.get(b.item.categoryId as string) ?? Infinity;
      if (orderA !== orderB) return orderA - orderB;
      return a.sortOrder - b.sortOrder;
    });
  if (mappedItems.length === 0) return null;
  const items = mappedItems.map((i) => i.item);

  const syrups = Array.isArray(state.syrups)
    ? state.syrups
        .map(mapSyrup)
        .filter((s): s is SyrupOption => s !== null)
    : null;

  // Cafe info: only non-empty remote strings overwrite the static values,
  // so a partial/blank field can never blank the menu. CAFE_INFO has no
  // `address` field — the remote address replaces the placeholder
  // `addressStatus` sentence shown in CafeInfoModal/App footer.
  const cafePatch: Partial<typeof CAFE_INFO> = {};
  if (isRecord(state.cafeInfo)) {
    const remote = state.cafeInfo as Record<string, unknown>;
    const fields = [
      'brandName',
      'brandSubtitle',
      'tagline',
      'instagramHandle',
      'instagramUrl',
      'hours',
      'milkTempNote',
      'paymentNote',
      'coordinatesLabel',
    ] as const;
    for (const field of fields) {
      const value = remote[field];
      if (typeof value === 'string' && value.trim() !== '') {
        (cafePatch as Record<string, string>)[field] = value;
      }
    }
    const address = remote.address;
    if (typeof address === 'string' && address.trim() !== '') {
      cafePatch.addressStatus = address;
    }
  }

  return { items, categories, syrups, cafePatch };
}

/**
 * Warms the remote topdown plates. preload.ts runs at import time, before
 * this fetch lands, so it only preloaded the static plates; this top-up
 * covers plates the admin changed or uploaded. Already-decoded plates
 * are skipped by preloadAndDecodeImage's own cache.
 */
function warmRemotePlates(items: MenuItem[]): void {
  const isMobileViewport =
    typeof window !== 'undefined' && window.innerWidth < 1024;
  const uniqueImages = new Set(
    items.map((item) => item.image).filter((src) => src !== ''),
  );
  for (const src of uniqueImages) {
    preloadAndDecodeImage(isMobileViewport ? toThumbSrc(src) : src);
  }
}

export async function initRemoteMenu(): Promise<boolean> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return false;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/menu`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return false;
    const data: unknown = await response.json();
    const mapped = mapRemoteState(data);
    if (!mapped) return false;

    // Apply in place, after all validation — every consumer of the
    // static arrays sees the remote data from the first render.
    MENU_ITEMS.splice(0, MENU_ITEMS.length, ...mapped.items);
    MENU_CATEGORIES.splice(0, MENU_CATEGORIES.length, ...mapped.categories);
    if (mapped.syrups !== null) {
      SYRUP_OPTIONS.splice(0, SYRUP_OPTIONS.length, ...mapped.syrups);
    }
    Object.assign(CAFE_INFO, mapped.cafePatch);

    warmRemotePlates(mapped.items);
    return true;
  } catch {
    // Network error, timeout, invalid JSON: static menu stays in place.
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}
