/**
 * 本地持久化存储（IndexedDB，零依赖）。
 * 为"长期数据积累 + 未来 ML"设计：容量大、可备份、保留完整每日明细、按维度自动去重。
 * 全部在本地浏览器内，数据不出本机。
 */

const DB_NAME = 'adOptimizer';
const STORE = 'rows';
const CONFIG = 'config';
const VERSION = 2;

/** 去重主键：同一 平台|广告|内容ID|地区|日期 只保留一条（新导入覆盖旧的） */
export const rowKey = (r) => `${r.platform}|${r.campaignName}|${r.contentId ?? ''}|${r.region ?? ''}|${r.date}`;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: '_k' });
        os.createIndex('date', 'date');
        os.createIndex('platform', 'platform');
      }
      if (!db.objectStoreNames.contains(CONFIG)) {
        db.createObjectStore(CONFIG, { keyPath: 'k' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 取全部明细（按日期升序） */
export async function getAllRows() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    const req = t.objectStore(STORE).getAll();
    req.onsuccess = () =>
      resolve(req.result.map(({ _k, ...r }) => r).sort((a, b) => a.date.localeCompare(b.date)));
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

/** 批量写入（upsert，按 rowKey 去重） */
export async function putRows(rows) {
  if (!rows || !rows.length) return 0;
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const os = t.objectStore(STORE);
    for (const r of rows) os.put({ ...r, _k: rowKey(r) });
    t.oncomplete = () => { db.close(); resolve(rows.length); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

/** 清空全部 */
export async function clearRows() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).clear();
    t.oncomplete = () => { db.close(); resolve(); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

/** 读取配置（如每条广告的日预算、目标回收） */
export async function getConfig(k = 'config') {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(CONFIG, 'readonly');
    const req = t.objectStore(CONFIG).get(k);
    req.onsuccess = () => resolve(req.result?.v ?? null);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

/** 写入配置 */
export async function setConfig(v, k = 'config') {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(CONFIG, 'readwrite');
    t.objectStore(CONFIG).put({ k, v });
    t.oncomplete = () => { db.close(); resolve(); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

/** 统计信息 */
export async function stats() {
  const rows = await getAllRows();
  const days = new Set(rows.map((r) => r.date));
  return {
    rows: rows.length,
    days: days.size,
    firstDate: rows[0]?.date ?? null,
    lastDate: rows[rows.length - 1]?.date ?? null,
    platforms: [...new Set(rows.map((r) => r.platform))],
  };
}

/** 一次性迁移旧的 chrome.storage.local 数据到 IndexedDB */
export async function migrateLegacy() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const d = await chrome.storage.local.get('adRows');
      if (d.adRows?.length) {
        await putRows(d.adRows);
        await chrome.storage.local.remove('adRows');
        return d.adRows.length;
      }
    }
  } catch { /* 忽略 */ }
  return 0;
}
