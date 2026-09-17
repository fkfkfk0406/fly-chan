// 사용자가 고른 VRM 파일처럼 localStorage 에 넣기엔 큰 파일을 IndexedDB 에 보관한다.
const DB = "fly-chan-files";
const RENAMED_DB = "onna-files"; // 이름 바꾸기 전 DB. 읽기만 한다
const STORE = "blobs";

function open(name = DB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  return (await getFrom(DB, key)) ?? getFrom(RENAMED_DB, key);
}

async function getFrom(name: string, key: string): Promise<Blob | undefined> {
  const db = await open(name);
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function delBlob(key: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
