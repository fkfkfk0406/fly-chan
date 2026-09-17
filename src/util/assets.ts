// 큰 앱 파일(뇌 데이터, VRM) 불러오기.
// 웹: 사이트의 public/ 에서 바로 받는다.
// 데스크톱(Tauri): 설치 파일을 작게 하려고 첫 실행 때 GitHub Releases 에서 받아 Cache Storage 에 보관한다.

export const IS_DESKTOP = "__TAURI_INTERNALS__" in globalThis;

/** Releases 에 올린 파일. 경로(data/…, models/…)와 올린 이름 */
export const RELEASE_TAG = "data-v783";
export const RELEASE_BASE = `https://github.com/fkfkfk0406/fly-chan/releases/download/${RELEASE_TAG}/`;
export const ASSET_FILES = [
  "data/meta.json",
  "data/groups.json",
  "data/labels.json",
  "data/neurons_pos.f32",
  "data/neurons_class.u8",
  "data/csr_offsets.u32",
  "data/csr_targets.u32",
  "data/csr_weights.i16",
  "models/fly-chan.vrm",
] as const;

const CACHE = `fly-chan-assets-${RELEASE_TAG}`;
const cacheKey = (path: string) => new URL(`/__fly-chan-assets/${path}`, location.origin).href;
const releaseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

async function cached(path: string): Promise<Response | undefined> {
  if (!("caches" in globalThis)) return undefined;
  try {
    return await (await caches.open(CACHE)).match(cacheKey(path));
  } catch {
    return undefined;
  }
}

/** 앱 파일을 가져온다. 받아 둔 게 있으면 그걸, 없으면 사이트에서 */
export async function fetchAsset(path: string): Promise<Response> {
  return (await cached(path)) ?? fetch(`${import.meta.env.BASE_URL}${path}`);
}

/** VRM 로더처럼 주소가 필요한 곳에 쓴다. 쓴 뒤 revoke 해야 하면 true */
export async function assetUrl(path: string): Promise<{ url: string; revoke: boolean }> {
  const hit = await cached(path);
  if (!hit) return { url: `${import.meta.env.BASE_URL}${path}`, revoke: false };
  return { url: URL.createObjectURL(await hit.blob()), revoke: true };
}

/**
 * 데스크톱: 아직 안 받은 파일을 Releases 에서 받는다.
 * GitHub 다운로드는 브라우저 CORS 를 허용하지 않아 Tauri HTTP 플러그인(네이티브 요청)으로 받는다.
 */
export async function ensureAssets(onProgress: (loaded: number, label: string) => void): Promise<void> {
  // tauri dev 는 Vite 개발 서버의 public/ 을 그대로 쓴다
  if (!IS_DESKTOP || import.meta.env.DEV) return;
  const { fetch: nativeFetch } = await import("@tauri-apps/plugin-http");
  const cache = await caches.open(CACHE);
  let loaded = 0;
  for (const path of ASSET_FILES) {
    if (await cache.match(cacheKey(path))) continue;
    const res = await nativeFetch(RELEASE_BASE + releaseName(path));
    if (!res.ok || !res.body) throw new Error(`${releaseName(path)} 을 받지 못했어요 (${res.status}). 인터넷 연결을 확인해 주세요.`);
    const size = Number(res.headers.get("content-length")) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Uint8Array<ArrayBuffer>);
      got += value.length;
      loaded += value.length;
      onProgress(loaded, releaseName(path));
    }
    if (size && got !== size) throw new Error(`${releaseName(path)} 다운로드가 중간에 끊겼어요. 다시 실행해 주세요.`);
    await cache.put(cacheKey(path), new Response(new Blob(chunks), { headers: { "content-length": String(got) } }));
  }
  // 데이터가 새 태그로 바뀌었으면 예전에 받아 둔 것을 지운다
  for (const name of await caches.keys()) {
    if (name.startsWith("fly-chan-assets-") && name !== CACHE) await caches.delete(name);
  }
}
