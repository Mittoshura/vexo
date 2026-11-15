import type { Page } from 'playwright';

export type PageFile = { field: string; name: string; mime: string; b64: string };

/**
 * fetch() executed inside the logged-in page: genuine cookies, user agent and origin.
 * `form` → multipart (repeated keys allowed), `json` → application/json.
 */
export async function pageFetch(
  page: Page,
  url: string,
  opts: { method?: string; json?: unknown; form?: [string, string][]; files?: PageFile[]; headers?: Record<string, string> } = {},
): Promise<{ status: number; text: string; json: any }> {
  const res = await page.evaluate(
    async ({ url, opts }) => {
      let body: BodyInit | undefined;
      const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
      if (opts.json !== undefined) {
        body = JSON.stringify(opts.json);
        headers['content-type'] = 'application/json';
      } else if (opts.form || opts.files) {
        const fd = new FormData();
        for (const [k, v] of opts.form ?? []) fd.append(k, v);
        for (const f of opts.files ?? []) {
          const bin = atob(f.b64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          fd.append(f.field, new Blob([arr], { type: f.mime }), f.name);
        }
        body = fd;
      }
      const r = await fetch(url, { method: opts.method ?? (body ? 'POST' : 'GET'), body, headers, credentials: 'include' });
      return { status: r.status, text: await r.text() };
    },
    { url, opts },
  );
  let json: any = null;
  try {
    json = JSON.parse(res.text);
  } catch {
    /* not JSON */
  }
  return { ...res, json };
}

export function fail(msg: string, raw?: unknown): never {
  throw Object.assign(new Error(msg), raw === undefined ? {} : { raw });
}

export const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
