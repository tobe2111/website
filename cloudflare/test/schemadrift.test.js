// 마이그레이션이 **실제로 도는가**.
//
// 라이브에서 이렇게 났다:
//
//   D1_ERROR: no such column: map_url
//
// 코드에는 `ALTER TABLE businesses ADD COLUMN map_url …` 이 멀쩡히 적혀 있었다.
// 그런데 안 돌았다. SCHEMA_VERSION 을 52 로 올린 뒤 map_url 을 목록에 더하면서
// 숫자를 그대로 뒀기 때문이다. 라이브 DB 에 이미 52 가 찍혀 있어 패스트패스가
// 곧장 돌아 나갔다.
//
// 눈으로는 절대 안 보이는 사고다 — 마이그레이션은 있고, 문법도 맞고, 새 DB 에서는
// 잘 돈다. **옛 DB 에서만** 안 돈다. 그래서 여기서는 "옛 DB 를 만들어 놓고
// 올려 본다" 를 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { makeD1 } from "./shim.js";
import { ensureSchema, schemaStamp, SCHEMA_VERSION } from "../src/schema.js";

// 코드가 실제로 읽고 쓰는 컬럼들. 하나라도 옛 DB 에 안 생기면 그 화면이 500 으로 죽는다.
const MUST_HAVE = {
  businesses: ["source", "updated_at", "sns_instagram", "sns_youtube", "sns_blog",
    "sns_kakao", "sns_naver", "day_off_date", "map_url", "urdeal_seller_id"],
  associations: ["custom_domain", "dues_amount", "dues_account", "team_scope", "uses_dues"],
};

const fresh = async () => { const db = makeD1(new DatabaseSync(":memory:")); await ensureSchema(db); return db; };
const colsOf = async (db, table) =>
  ((await db.prepare(`PRAGMA table_info(${table})`).all()).results || []).map((c) => c.name);

test("새 DB 에는 필요한 컬럼이 전부 있다", async () => {
  const db = await fresh();
  for (const [table, cols] of Object.entries(MUST_HAVE)) {
    const have = new Set(await colsOf(db, table));
    for (const c of cols) assert.ok(have.has(c), `새 DB 의 ${table} 에 ${c} 가 없다`);
  }
});

test("옛 DB 를 올리면 빠진 컬럼이 채워진다", async () => {
  const db = await fresh();
  // 옛 배포 흉내: 나중에 더해진 컬럼을 지운 상태로 되돌린다
  for (const [table, cols] of Object.entries(MUST_HAVE)) {
    for (const c of cols) await db.prepare(`ALTER TABLE ${table} DROP COLUMN ${c}`).run().catch(() => {});
  }
  for (const [table, cols] of Object.entries(MUST_HAVE)) {
    const have = new Set(await colsOf(db, table));
    assert.ok(cols.some((c) => !have.has(c)), `${table}: 지우기가 안 먹어 시험이 무의미하다`);
  }
  // 옛 배포에는 옛 세대가 찍혀 있다 (지문은 애초에 없던 시절)
  await db.prepare("INSERT INTO settings (key, value) VALUES ('schema_version', '40') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  await ensureSchema(db);
  for (const [table, cols] of Object.entries(MUST_HAVE)) {
    const have = new Set(await colsOf(db, table));
    for (const c of cols) assert.ok(have.has(c), `올렸는데 ${table}.${c} 가 여전히 없다`);
  }
});

// ── 이 시험이 이 파일의 존재 이유다 ──────────────────────────────────────
test("세대 숫자를 안 올려도 마이그레이션은 돈다 — 지문이 대신 잡는다", async () => {
  const db = await fresh();
  for (const c of MUST_HAVE.businesses) {
    await db.prepare(`ALTER TABLE businesses DROP COLUMN ${c}`).run().catch(() => {});
  }
  // 사고 재현: 컬럼은 빠졌는데 **옛 세대 숫자만** 찍혀 있다.
  // 예전에는 이 값이 SCHEMA_VERSION 과 같기만 하면 마이그레이션을 통째로 건너뛰었다.
  await db.prepare("INSERT INTO settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(SCHEMA_VERSION).run();
  await ensureSchema(db);
  const have = new Set(await colsOf(db, "businesses"));
  assert.ok(have.has("map_url"),
    "세대 숫자만 맞으면 마이그레이션을 건너뛴다 — 라이브에서 'no such column: map_url' 이 난 그 경로다");
});

test("지문까지 같으면 건너뛴다 (콜드스타트 비용을 지키기 위한 것)", async () => {
  const db = await fresh();
  // 새로 만든 DB 에는 지문이 찍혀 있다. 그대로 다시 부르면 아무 일도 안 해야 한다.
  const before = (await db.prepare("SELECT value FROM settings WHERE key='schema_version'").first()).value;
  assert.equal(before, schemaStamp(), "새 DB 에 지문이 안 찍혔다");
  let asked = 0;
  const spy = { prepare: (sql) => { asked++; return db.prepare(sql); } };
  await ensureSchema(spy);
  // associations 존재 확인 + 버전 조회, 딱 두 번이면 된다
  assert.ok(asked <= 3, `건너뛰지 않고 ${asked}번이나 물었다 — 콜드스타트가 느려진다`);
});

test("마이그레이션 코드를 고치면 지문이 달라진다", () => {
  // 지문은 migrateColumns 의 소스에서 나온다. 한 글자만 달라도 값이 바뀌어야
  // 패스트패스가 저절로 풀린다. (같은 값이 나오면 이 안전장치가 죽은 것이다)
  const a = schemaStamp();
  assert.ok(/^\d+\.[0-9a-z]+$/.test(a), `지문 모양이 이상하다: ${a}`);
  assert.ok(a.startsWith(SCHEMA_VERSION + "."), "세대 숫자가 앞에 붙어야 사람이 읽을 수 있다");
  assert.notEqual(a, SCHEMA_VERSION, "지문이 안 붙었다 — 예전 그대로다");
});

// 마이그레이션이 막혀 있던 동안 이 동작도 함께 멈춰 있었다.
test("옛 DB 의 한글 주소는 영문으로 바뀌고, 옛 주소가 alias 로 남는다", async () => {
  const db = await fresh();
  // v32 이전 배포 흉내: 한글 주소를 그대로 쓰던 시절
  await db.prepare("INSERT INTO associations (slug, name, brand_color, tagline, kind, preset) VALUES ('리스터코퍼레이션','리스터코퍼레이션','#1F6CFF','t','merchant','franchise')").run();
  await db.prepare("INSERT INTO settings (key, value) VALUES ('schema_version','30') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  await ensureSchema(db);

  const a = (await db.prepare("SELECT id, slug FROM associations WHERE name='리스터코퍼레이션'").first());
  assert.ok(/^[a-z0-9-]+$/.test(a.slug), `영문 주소로 안 바뀌었다: ${a.slug}`);
  // 이미 명함·알림톡으로 나간 옛 주소를 죽이지 않는다
  const alias = await db.prepare("SELECT association_id FROM slug_aliases WHERE slug='리스터코퍼레이션'").first();
  assert.ok(alias, "옛 주소가 alias 로 안 남았다 — 나간 링크가 끊긴다");
  assert.equal(alias.association_id, a.id);
});
