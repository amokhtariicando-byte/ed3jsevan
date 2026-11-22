import type {
  AdminApi,
  AdminCategory,
  AdminItem,
  CafeInfoEditable,
  FeaturedPick,
  MenuState,
  NewCategoryInput,
  NewItemInput,
  PublishState,
  SeoMeta,
  Syrup,
} from './types';

/**
 * Real HTTP implementation of the AdminApi contract, talking to the PHP
 * backend over fetch. Wired in by api.ts when VITE_EYVAN_API_BASE is set;
 * otherwise the mock (MockAdminApi) stays active and this class is unused.
 *
 * Auth: every /admin/* call sends `Authorization: Bearer <token>` with the
 * token stored in localStorage under TOKEN_KEY. A 401 clears the token,
 * dispatches `eyvan-admin-session-expired` (the admin shell logs out), and
 * throws a Persian session-expired error — except login, which returns
 * false for a wrong password, and changePassword, which returns false for
 * a bad current password or a too-short new one.
 *
 * After every successful mutation the `eyvan-admin-changed` event is
 * dispatched (mirroring MockAdminApi.persist()) so the admin shell
 * refreshes its publish badge. The event is dispatched directly here
 * instead of importing notifyAdminChanged from api.ts to avoid a
 * circular import (api.ts imports this module for the mock/real switch).
 */

const TOKEN_KEY = 'eyvan-admin-token';

const SESSION_EXPIRED_MESSAGE = 'نشست شما منقضی شده؛ دوباره وارد شوید.';

/** Same event MockAdminApi.persist() fires; AdminShell listens for it. */
function notifyChanged(): void {
  window.dispatchEvent(new CustomEvent('eyvan-admin-changed'));
}

/** Lets the admin shell send the user back to the login screen. */
function notifySessionExpired(): void {
  window.dispatchEvent(new CustomEvent('eyvan-admin-session-expired'));
}

function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage unavailable: the session just won't survive a reload.
  }
}

/** Drops the bearer token (logout, or a 401 anywhere). */
export function clearStoredToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clean up.
  }
}

/** Shared 401 handling: clear the token and tell the shell to log out. */
function handleUnauthorized(): void {
  clearStoredToken();
  notifySessionExpired();
}

/** Extracts the server's Persian error message when the body has one. */
async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    return body?.error?.message ?? null;
  } catch {
    return null;
  }
}

function normaliseBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export class RealAdminApi implements AdminApi {
  private readonly baseUrl: string;

  constructor(baseUrl = '/api') {
    // Normalise so '/api/' and '/api' behave the same.
    this.baseUrl = normaliseBase(baseUrl);
  }

  private authHeaders(): HeadersInit {
    const token = getStoredToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  /**
   * Sends an authenticated JSON request and parses the JSON response.
   * Throws a Persian error on failure; a 401 clears the token first.
   */
  private async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...this.authHeaders(),
        ...(init.headers ?? {}),
      },
    });
    if (response.status === 401) {
      handleUnauthorized();
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }
    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(message ?? 'خطایی رخ داد؛ دوباره تلاش کنید.');
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /**
   * Like request(), but for mutations: on success it notifies the admin
   * shell so the publish badge refreshes.
   */
  private async mutate<T>(path: string, init: RequestInit): Promise<T> {
    const result = await this.request<T>(path, init);
    notifyChanged();
    return result;
  }

  /** Like mutate(), but for endpoints with no response body. */
  private async mutateVoid(path: string, init: RequestInit): Promise<void> {
    await this.mutate<unknown>(path, init);
  }

  async getMenu(): Promise<MenuState> {
    return this.request<MenuState>('/admin/menu');
  }

  async getPublishedMenu(): Promise<MenuState> {
    // Public endpoint: no auth header needed.
    const response = await fetch(`${this.baseUrl}/menu`);
    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(message ?? 'خطایی رخ داد؛ دوباره تلاش کنید.');
    }
    return (await response.json()) as MenuState;
  }

  async updateItem(
    id: string,
    patch: Partial<AdminItem>,
  ): Promise<AdminItem> {
    return this.mutate<AdminItem>(`/admin/items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async createItem(input: NewItemInput): Promise<AdminItem> {
    return this.mutate<AdminItem>('/admin/items', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async deleteItem(id: string): Promise<void> {
    await this.mutateVoid(`/admin/items/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async reorderItems(categoryId: string, orderedIds: string[]): Promise<void> {
    await this.mutateVoid('/admin/items/reorder', {
      method: 'POST',
      body: JSON.stringify({ categoryId, orderedIds }),
    });
  }

  async updateCategory(
    id: string,
    patch: Partial<AdminCategory>,
  ): Promise<AdminCategory> {
    return this.mutate<AdminCategory>(
      `/admin/categories/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
    );
  }

  async createCategory(input: NewCategoryInput): Promise<AdminCategory> {
    return this.mutate<AdminCategory>('/admin/categories', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async deleteCategory(id: string): Promise<void> {
    await this.mutateVoid(`/admin/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async reorderCategories(orderedIds: string[]): Promise<void> {
    await this.mutateVoid('/admin/categories/reorder', {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    });
  }

  async updateSyrups(syrups: Syrup[]): Promise<Syrup[]> {
    return this.mutate<Syrup[]>('/admin/syrups', {
      method: 'PUT',
      body: JSON.stringify(syrups),
    });
  }

  async updateFeatured(ids: FeaturedPick): Promise<FeaturedPick> {
    return this.mutate<FeaturedPick>('/admin/featured', {
      method: 'PUT',
      body: JSON.stringify(ids),
    });
  }

  async updateCafeInfo(
    patch: Partial<CafeInfoEditable>,
  ): Promise<CafeInfoEditable> {
    return this.mutate<CafeInfoEditable>('/admin/cafe-info', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async updateSeo(seo: SeoMeta): Promise<SeoMeta> {
    return this.mutate<SeoMeta>('/admin/seo', {
      method: 'PUT',
      body: JSON.stringify(seo),
    });
  }

  async getPublishState(): Promise<PublishState> {
    return this.request<PublishState>('/admin/publish-state');
  }

  async publish(): Promise<PublishState> {
    return this.mutate<PublishState>('/admin/publish', { method: 'POST' });
  }

  async discardDraft(): Promise<MenuState> {
    return this.mutate<MenuState>('/admin/discard-draft', {
      method: 'POST',
    });
  }

  async login(password: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    // A wrong password is a normal outcome, not an exception.
    if (response.status === 401) return false;
    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(message ?? 'خطایی رخ داد؛ دوباره تلاش کنید.');
    }
    const body = (await response.json()) as { ok?: boolean; token?: string };
    if (!body.token) return false;
    storeToken(body.token);
    return true;
  }

  async changePassword(current: string, next: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/admin/change-password`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ current, next }),
    });
    // 401 means the session itself expired, not a bad current password:
    // clear the token and surface it like any other admin call.
    if (response.status === 401) {
      handleUnauthorized();
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }
    // 400/422: bad current password or a new password under 6 characters.
    if (response.status >= 400 && response.status < 500) return false;
    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(message ?? 'خطایی رخ داد؛ دوباره تلاش کنید.');
    }
    return true;
  }

  async exportBackup(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/admin/backup`, {
      headers: this.authHeaders(),
    });
    if (response.status === 401) {
      handleUnauthorized();
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }
    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(message ?? 'خطایی رخ داد؛ دوباره تلاش کنید.');
    }
    // The endpoint returns the JSON backup; return the raw string, mirroring
    // the mock's exportBackup().
    return response.text();
  }
}

export type AdminPhotoSlot = 'image' | 'frontImage' | 'cutoutImage';

/**
 * Uploads one admin photo (item image, front view, or transparent cutout)
 * to POST /api/admin/upload as multipart FormData { file, slot } and returns
 * the public URL from the 201 { url } response.
 */
export async function uploadAdminPhoto(
  file: File,
  slot: AdminPhotoSlot,
  baseUrl = '/api',
): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('slot', slot);
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  // No Content-Type here: the browser sets the multipart boundary itself.
  const response = await fetch(`${normaliseBase(baseUrl)}/admin/upload`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (response.status === 401) {
    handleUnauthorized();
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }
  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message ?? 'خطایی رخ داد؛ دوباره تلاش کنید.');
  }
  const body = (await response.json()) as { url?: string };
  if (!body.url) throw new Error('آپلود انجام شد اما آدرس عکس برگردانده نشد.');
  return body.url;
}

export type SetupAdminResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'already_done' | 'too_short' | 'error';
      message: string;
    };

/**
 * First-run setup: POST /api/admin/setup sets the admin password.
 * 403 means a password already exists; 422 means under 6 characters.
 * (Extra endpoint, not part of the AdminApi contract.)
 */
export async function setupAdminPassword(
  password: string,
  baseUrl = '/api',
): Promise<SetupAdminResult> {
  let response: Response;
  try {
    response = await fetch(`${normaliseBase(baseUrl)}/admin/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    return { ok: false, reason: 'error', message: 'خطایی رخ داد؛ دوباره تلاش کنید.' };
  }
  if (response.ok) return { ok: true };
  if (response.status === 403) {
    return {
      ok: false,
      reason: 'already_done',
      message: 'قبلاً راه‌اندازی شده؛ با رمز وارد شوید.',
    };
  }
  if (response.status === 422) {
    const message = await readErrorMessage(response);
    return {
      ok: false,
      reason: 'too_short',
      message: message ?? 'رمز عبور باید حداقل ۶ کاراکتر باشد.',
    };
  }
  const message = await readErrorMessage(response);
  return {
    ok: false,
    reason: 'error',
    message: message ?? 'خطایی رخ داد؛ دوباره تلاش کنید.',
  };
}

/**
 * Probes whether first-run setup is still needed, without setting anything.
 * Relies on the check order in backend/src/Api.php setup(): the
 * "already done" check (403) runs BEFORE password validation, so an empty
 * password gets 403 when setup is done and 400 when it is still needed.
 * Any other outcome (network error, 5xx, …) is 'unknown' and the caller
 * falls back to the plain login form.
 */
export async function probeSetupNeeded(
  baseUrl = '/api',
): Promise<'needed' | 'done' | 'unknown'> {
  try {
    const response = await fetch(`${normaliseBase(baseUrl)}/admin/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: '' }),
    });
    if (response.status === 403) return 'done';
    if (response.status === 400) return 'needed';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
