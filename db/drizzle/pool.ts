import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolConfig } from "pg";

// pg の Pool は idle の接続が切れると 'error' を emit し、listener が無いと uncaught exception で process が終了する
const newPool = (config: PoolConfig) =>
  new Pool(config).on("error", (error) =>
    // biome-ignore lint/plugin: 切れた idle の接続は Pool が作り直すので、失敗として報告しない
    console.error("pg の idle の接続が切れた", error),
  );

// workerd は別の request で開いた socket を使い回せない (taimei-auth #91)
const requestPoolStore = new AsyncLocalStorage<Pool>();
// workerd では Worker の環境変数が process.env にも入るので、DATABASE_URL があっても要求をまたぐ Pool を作らない
const runsOnWorkerd = globalThis.navigator?.userAgent === "Cloudflare-Workers";
const databaseUrl = process.env.DATABASE_URL;
const databaseUrlPool =
  databaseUrl && !runsOnWorkerd
    ? newPool({ connectionString: databaseUrl })
    : undefined;

export const currentPool = () => {
  const pool = requestPoolStore.getStore() ?? databaseUrlPool;
  if (!pool)
    throw new Error(
      "runWithRequestPool の Pool も DATABASE_URL の Pool も無い",
    );
  return pool;
};

// Workers の同時接続は 6 本まで (Service Binding の呼び出しも同じ枠)。taimei-auth と同じ 5 にして 1 本を残す
export const runWithRequestPool = <T>(
  connectionString: string,
  waitUntil: (promise: Promise<unknown>) => void,
  fn: () => Promise<T>,
) => {
  const pool = newPool({ connectionString, max: 5 });
  const result = requestPoolStore.run(pool, fn);
  const end = () => pool.end();
  waitUntil(result.then(end, end));
  return result;
};
