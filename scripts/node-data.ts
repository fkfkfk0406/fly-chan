// Node(테스트·벤치마크)에서 public/data 를 읽는다.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CONNECTOME_FILES, parseConnectome, type Groups, type Meta } from "../src/sim/data.ts";

export const DATA_DIR = join(import.meta.dirname, "..", "public", "data");

export const hasData = () => existsSync(join(DATA_DIR, "meta.json"));

const json = <T>(name: string): T => JSON.parse(readFileSync(join(DATA_DIR, name), "utf-8"));

function buffer(name: string): ArrayBuffer {
  const b = readFileSync(join(DATA_DIR, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

export function loadAll() {
  const meta = json<Meta>("meta.json");
  const groups = json<Groups>("groups.json");
  const labels = json<Record<string, string>>("labels.json");
  const conn = parseConnectome(meta, CONNECTOME_FILES.map(buffer));
  return { meta, groups, labels, conn };
}
