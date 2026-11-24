# ТЗ `@me2em/pact` — v1.0 (к реализации)

**Статус:** финальное к реализации. **Редакция 2** — применены правки ревью ТЗ (Р1–Р10, §12); правки проверки готовности кода (редакция 1) учтены (§12).
**База-документ:** PACTS.md (adopted design D1–D47), раздел «Границы и плейбуки» (B-1–B-14, P-1–P-6), фиксация решений A1–E2.
**Политика проекта:** замороженных пакетов нет; документация изменяема; обратная совместимость не нужна (пользователей нет); приоритеты: максимальная производительность → минимум кода → хорошая архитектура.
**База:** `@me2em/core` 1.0.0-rc.8 (реализовано) → rc.9 по P0.8 (JCS + `isRevokedAt`); `@me2em/crypto` 1.1.0-rc.2 (реализовано); спека `specs/v1.0.md`; `specs/test-vectors.json` (структура).
**Целевые версии:** `@me2em/core 1.0.0-rc.9` (P0.8), `@me2em/pact 1.0.0-rc.1`.
**Область:** библиотека горизонтального доверия: детерминированные Pact Keys, append-only Pact Journal, верификация журнала и актов (Tier 1+2+3), сборка 2-party, хранилище с CAS-аппендом, побайтовый экспорт/импорт, инъекция транспорта.
**Вне скоупа (F1–F9):** nested pacts (D30), FROST/BLS (D24), zombie N-party expiry (D37), роли (D29), binary transport (D40), replication profile (`@me2em/server`), Session.create-адаптер, transparency feed (BL-12/13 — только интерфейсные точки), кошелёк/эскроу пакта (отдельное ТЗ поверх D46).

---

## 0. Принципы пакета

Наследуются из PACTS Review и нормативны для реализации:

| # | Принцип | Проверка |
|---|---|---|
| P1 | Данные вместо инфраструктуры | Все серверы исчезли → verifyJournal/verifyAct работают (Tier 1) |
| P2 | Ядро — чистые функции | derive/verify — детерминированы, без I/O; всё внешнее — инъекция (`JournalStore`, `Channel`, `Clock`, `RevocationChecker`) |
| P3 | Детерминизм всюду | JCS, целые секунды, отсортированные ростеры; хеш-равенство = репликация без консенсуса |
| P4 | Fail-closed + версии | `typ: me2em/pact-event/v1`; неизвестное поле ⇒ reject |
| P5 | Authority — только capability | `pact:sign` через гранты core (D9); никакого ambient-доступа |
| P6 | Корни не сливаются | В артефактах пакта — только производные ключи (§4 PACTS) |
| P7 | Честный blast radius | Заморозка per-type (D28), `compromisedAt` (D20), история до форка валидна (D27) |
| P8 | Юридический мост нейтрален | Протокол производит записи; сила — адаптер (D10, RFC 3161 в `doc`) |
| P9 | Амплификаторы опциональны | Transparency feed/слепое сравнение — усиление, не зависимость (паттерн BL-10) |
| P10 | Sneakernet — первоклассный режим | exportJournal/importJournal побайтово точны (D47/B-14); reference-сервер — средство производительности |

## 1. Зависимости и граф

```
@me2em/pact 1.0.0-rc.1
  peer:            @me2em/core   >=1.0.0-rc.9 <2.0.0-0   // hkdf, sha256, ed25519, jcs.canonicalize, RevocationChecker.isRevokedAt?
  peerOptional:    @me2em/crypto >=1.1.0-rc.2 <2.0.0-0   // только для ReferenceX3DH (transport)
  dev:             typescript, vitest, @vitest/coverage-v8
```

**Правило (B2):** pact зависит **только** от core. Транспорт — инъекция `Channel`; `@me2em/crypto` подключается опционально и exclusively reference-адаптером. Никаких runtime-зависимостей от x402/solana/react.

**Что потребляется из core:** `hkdf(ikm, salt, info, length)` (произвольный info — проверено, `crypto/hkdf.ts`), `sha256`, `sign/verify/getPublicKey` (ed25519), `jcs.canonicalize` (rc.9, P0.8), `RevocationChecker.isRevokedAt?` (rc.9, P0.8). Интерфейс `Signer` (core `types.ts:18`) pact-машиной **не потребляется** (Р5): подпись — прямой вызов `crypto.sign(pactKey, msg)`; адаптер PactKey→`Signer` для `Attestation.issue`/`Session.create` — F7.

**Anchor-материал** (IKM для деривации) — **приватный ключ узла-якоря** как `Uint8Array`, полученный через namespace-экспорт core (`export * as crypto from './crypto/index.js'`, core `index.ts:46`): Identity — `crypto.deriveRootKey(seed)`; Handle — `crypto.deriveHandleKey(rootKey, name)`; SubHandle — `crypto.deriveSubHandleKey(handleKey, handleName, subName)` (сигнатуры проверены в rc.8). Экземпляры `Identity`/`Handle` не принимаются (их `#privateKey` не раскрывается) — Р2.

## 2. Структура пакета

```
packages/pact/
  src/
    index.ts                 // публичный API
    types.ts                 // Event, Payload per type, Constitution, Threshold, Founder, RosterEntry, Clock, VoucherChain, WarningCode
    errors.ts                // PactError + коды (§6)
    codec.ts                 // encode/decode событий: JCS + b64url + strict parse
    derive.ts                // pactKey(anchor, gen) — info "me2em/pact/v1/{pid}/{ch}/g{gen}"
    verify.ts                // verifyJournal, verifyAct, verifyPrefix (Tier 1+2+3)
    assemble/                // 2-party в v0.1 (A2); по файлу на тип события
      genesis.ts  invite.ts  revokeInvite.ts  enroll.ts  exit.ts
      evict.ts    rotate.ts act.ts  reverseAct.ts  amend.ts  dissolve.ts
    store/
      JournalStore.ts        // интерфейс (CAS-append, C1)
      MemoryStore.ts
      Export.ts              // exportJournal / importJournal (D47)
    transport/
      Channel.ts             // интерфейс (инъекция, C4)
      ReferenceX3DH.ts       // опциональный адаптер через @me2em/crypto
    testing/
      fixtures.ts            // golden vectors, mock store, mock channel, фиксированный Clock
  test/                      // §10
  specs/tz-pact.md           // этот документ (копия в репозиторий)
```

## 3. Публичный API

### 3.1. Типы

```ts
export type Anchor = 'identity' | 'handle' | 'subhandle';
export type EventType = 'GENESIS' | 'INVITE' | 'REVOKE_INVITE' | 'ENROLL' | 'EXIT'
  | 'EVICT' | 'ROTATE_KEY' | 'ACT' | 'REVERSE_ACT' | 'AMEND' | 'DISSOLVE';
export type ThresholdMode = 'all' | 'any' | 'k-of-active' | 'founder';
export interface Threshold { m: ThresholdMode; k?: number }
export interface Constitution { th: Partial<Record<EventType, Threshold>>; im: 'pinned' | 'bearer'; w: boolean }
export interface Signature { p: string; s: string }              // pactPub b64url(32) + Ed25519 b64url(64)
export interface Event {
  typ: 'me2em/pact-event/v1'; pid: string; sq: number; ph: string;
  ty: EventType; pl: Record<string, unknown>; iat: number; sig: Signature[];
}
export interface Founder { p: string; pp: string; an: Anchor; w?: number; vc?: Voucher }
export interface Voucher { rh: string; rp: string }   // rh — b64url SHA-256(JCS(voucher-цепочки)), hash-commit (D34); rp — b64url(32) root pub якорной Identity
export type VoucherChain = { chain: string[] }        // out-of-band артефакт [A] / [A, B] (§3 PACTS): сериализованные аттестации, root first
export type WarningCode = 'PRE_COMPROMISE_ACT' | 'TIER3_UNSUPPORTED' | 'NO_VOUCHER' | 'VOUCHER_UNRESOLVED';
export interface Clock { now(): number }              // unix seconds; инъекция (C3, Р4)
export interface RosterEntry { p: string; w: number; e: string } // enrollEvHash; ростер отсортирован по p
```

Payload'ы каждого типа (`pl`) — **нормативно по PACTS §7.3** (перечисление полей; `?` = опционально) — ТЗ их не переопределяет (Р6). Codec: отсутствие обязательного или наличие неизвестного поля ⇒ `MALFORMED` (strict parse); лимиты §4.12.

### 3.2. Деривация (D3+D38)

```ts
export function derivePactKey(anchorSecretKey: Uint8Array, pid: string, ch: string, gen: number): Uint8Array;
```

- `pid` — b64url(16); `ch` — b64url(SHA-256(canonical(context))); info-строка: `me2em/pact/v1/{pid}/{ch}/g{gen}` (UTF-8), salt — пустой, L=32; `gen=0` при вступлении, `+1` на ROTATE_KEY.
- Публичный ключ пакта — производная, **отдельной деривации нет** (Р1): `pactPub = core.crypto.getPublicKey(pactKey)`.
- Anchor-материал (Р2) — приватный ключ узла-якоря, пример: `const handleKey = crypto.deriveHandleKey(rootKey, 'contracts'); const pactKey = derivePactKey(handleKey, pid, ch, 0);` (Identity: `crypto.deriveRootKey(seed)`; SubHandle: `crypto.deriveSubHandleKey(handleKey, handleName, subName)`).
- Возврат приватного материала — только в память вызывающего; wipe-политика как в core (best-effort zeroize).
- `ch` внутри info ⇒ любое расхождение текста контекста = другой ключ = fail-closed (D4); AMEND ключей не касается (B-4).

### 3.3. Верификация (D17)

```ts
export interface VerifyResult {
  ok: boolean; error?: PactError;
  roster?: RosterEntry[]; pactRoot?: string; journalHead?: string; seq?: number;
  tier3?: 'supported' | 'unsupported';                    // только в verifyAct (Р10)
  warnings?: Array<{ code: WarningCode; evHash?: string }>; // пустой массив = предупреждений нет; evHash — id события или membership id
}
export function verifyJournal(events: Event[], clock?: Clock,
                              opts?: { skewCheck?: 'all' | 'none' }): VerifyResult; // sync: Tier 1+2; skewCheck 'none' — структурная сверка вне окна ±30 с (finalize, архивы)
export function verifyAct(events: Event[], evHash: string, revocations?: RevocationChecker,
                          chains?: Map<string, VoucherChain>, clock?: Clock): Promise<VerifyResult>; // async: Tier 1+2+3
export function verifyPrefix(events: Event[], head: string, clock?: Clock): VerifyResult;            // sync: Tier 1+2 на префиксе (B-7)
export class JournalVerifier {                                                                        // rc.3 (F-rc3-1, RC3-D4)
  constructor(clock?: Clock, opts?: { skewCheck?: 'all' | 'none' });
  apply(event: Event): void;            // полный чек §7.7 + применение; ошибка — PactError, состояние не меняется
  applySuffix(events: Event[]): void;   // integrity pass префикса (RC3-D2) + полный чек суффикса
  get height(): number; get head(): string; snapshot(): VerifyResult;
}
export function createJournalVerifier(clock?: Clock, opts?: { skewCheck?: 'all' | 'none' }): JournalVerifier;
```

Порядок проверки — нормативный (§7.7 PACTS): (1) цепочка `sq`/`ph`, `ph[0] = ZERO32`; (2) strict parse, skew ±30 с, известный `ty`, лимиты, различность pub, Ed25519 по TBS; (3) кворум по конституции, действующей на seq события; самособытия (ENROLL/EXIT/ROTATE) освобождены от правила ACTIVE-подписантов.

**Распределение тиров (Р9):** `verifyJournal` — синхронный, Tier 1 (подписи) + Tier 2 (replay ростера на seq события) — оба детерминированы журналом; Tier 3 в нём не выполняется. `verifyAct` — асинхронный, Tier 1+2+3. `verifyPrefix` — синхронный, Tier 1+2 на префиксе `[0..k−1]` с контролем `journalHead == head`; Tier 3 не выполняет.

**Tier 3 — нормативный поток (Р3; D6, D17, D34, §5.4 PACTS):**

1. `chains` — out-of-band артефакты voucher-цепочек, ключ — membership id (`evHash(ENROLL)`); журнал хранит только hash-commit (D34).
2. Для каждого подписанта с `vc`: артефакт отсутствует в `chains` ⇒ предупреждение `VOUCHER_UNRESOLVED` (не ошибка); `SHA-256(JCS(chain)) ≠ vc.rh` ⇒ `MALFORMED`; подписи цепочки не верифицируются против `vc.rp` ⇒ `IDP_UNRESOLVABLE` (fail-closed: dial включён — это проверяемое обещание ответственности); цепочка не жива на `act.iat` (`iat ≤ act.iat < exp` для каждой аттестации, §5.4) ⇒ `IDP_UNRESOLVABLE`.
3. Каждый `jti` валидной цепочки: `revocations.isRevokedAt(jti, act.iat)` — идентификатор **сырой `jti`** (конвенция core `isRevoked`, `session.ts:101`; namespace-нотация BL-15 — для журнальных отзывов пакта, не для параметра checker'а); `true` ⇒ `ok: false`, `REVOKED @ SUB_ATTESTATION`.
4. Подписант без `vc` при включённом Tier 3 ⇒ предупреждение `NO_VOUCHER` (D6: dial осознанно выключен — не ошибка, Р7).
5. `revocations` не передан или без `isRevokedAt` ⇒ `tier3: 'unsupported'`, предупреждение `TIER3_UNSUPPORTED`, `ok: true` (Tier 1+2 пройдены — деградация, не ошибка).

`compromisedAt` (D20): акты с `iat > compromisedAt` — `REVOKED @ ROTATE_KEY`; более старые — валидны с флагом `PRE_COMPROMISE_ACT`.

### 3.4. Сборка (2-party в v0.1, A2)

```ts
export function assembleGenesis(input: GenesisInput): Event;    // ко-подпись учредителей
export function assembleEnroll(input: EnrollInput): Event;
export function assembleExit(...): Event;      // подпись текущим ключом выходящего (D18a)
export function assembleDissolve(...): Event;  // 2-party: any
export function assembleRotate(...): Event;    // подпись родителя обязательна + новый ключ (D39)
export function assembleAct(...): Event;
export function assembleAmend(...): Event;     // порог, действовавший ДО события (B-4/D23)
export function assembleInvite(...): Event;
export function assembleEvict(...): Event;     // 2-party недостижим ≡ DISSOLVE (D26′)
```

Каждый сборщик: строит TBS = JCS(событие без `sig`), собирает подписи, возвращает Event. Время `iat` — из инъектированного `Clock` (Р4): каждый `assemble*` принимает опциональный `clock` (по умолчанию — системный); при выходе за skew сборка не защищает — skew контролирует verify (C3; `finalize` ре-верифицирует префикс в режиме `skewCheck: 'none'`, так что сборка поверх исторического журнала с системным clock работает). Сборщик НЕ пишет в store — запись делает вызывающий через `JournalStore.append` (оптимистичный append, конкурентность = модель FORK_DETECTED, C2). N-party сборка в v0.1 не реализуется; verifier generic — N-party replay тестируется вручную собранными событиями. Сложность сборки (rc.3): последовательный lifecycle верифицирует только новое событие — `finalize` держит коммитнутый инкрементальный replay (`JournalVerifier`; integrity-проход префикса ~9 µs/событие, без подписей и state machine; расхождение переданного массива с коммитнутым состоянием ⇒ `FORK_DETECTED`, RC3-D2/D7), чужой префикс (промах кэша) — полный replay O(N). Доминирующая стоимость lifecycle (Ed25519 + state machine) линейна (Б2 закрыт; дизайн — `specs/tz-pact-rc3-incremental.md`).

### 3.5. Хранилище и экспорт (C1, D47)

```ts
export interface JournalStore {
  append(expectedHead: string, event: Event): Promise<void>;  // CAS: head ≠ expectedHead ⇒ FORK_DETECTED
  read(): Promise<Event[]>;
  head(): Promise<string>;                                    // JournalHead (evHash последнего) или ZERO32
}
export class MemoryStore implements JournalStore {}
export function exportJournal(events: Event[]): Uint8Array;   // построчно: JCS(событие целиком, с sig[]) + \n
export function importJournal(bytes: Uint8Array): Event[];    // strict parse, построчно
```

Формат экспорта: newline-delimited canonical JCS каждого события **с** `sig[]`. Нормативно (Р8): разделитель — только `\n` (LF, не CRLF); экспорт всегда завершает последнюю строку `\n`, импорт допускает отсутствие финального `\n`; пустые строки и пробельные символы вокруг строк ⇒ `MALFORMED`; событие, нарушающее лимиты D35 (в т.ч. > 4096 B), ⇒ `PAYLOAD_TOO_LARGE` — fail-closed, «пропустить и продолжить» запрещено. Формат детерминирован и побайтово обратим (parse→canonicalize идемпотентны, покрыто векторами). B-8: равенство evHash не доказывает побайтовое равенство реплик — сверка реплик обязана включать наборы подписей, export/import это сохраняет.

### 3.6. Транспорт (C4)

```ts
export interface Offer { typ: 'me2em/pact-offer/v1';  pid: string; ch: string; cx?: string; ep?: string }
export interface Accept { typ: 'me2em/pact-accept/v1'; pid: string; pactPub: string }
export interface Channel {
  offer(o: Offer): Promise<Accept>;
  genesis(g: Event): Promise<Event>;   // возвращает ко-подписанный GENESIS
}
```

Оба типа кодируются JCS + UTF-8, поля b64url; `cx` ≤ 2048 B. OFFER/ACCEPT — НЕ journal-события, в журнал не попадают. Транспорт обязан быть аутентифицированным (X3DH в reference-адаптере); MITM-окно финализации `ch` — документированное ограничение §8 PACTS, амплификаторы (PactRoot blind-сравнение) — вне v0.1.

## 4. Нормативные инварианты

1. Все хеши и подписи — только над `jcs.canonicalize` (core rc.9); JCS-векторы RFC 8785 обязательны.
2. `evHash = SHA-256(JCS(событие без sig))` (D32); `typ`/`pid` в TBS ⇒ доменная сепарация и анти-replay.
3. `ph[i] == evHash(prev)`, `ph[0] == ZERO32`; `sq` строго монотонна.
4. CAS-append: несовпадение `expectedHead` ⇒ `FORK_DETECTED` (C1); история до точки расщепления валидна (D27).
5. Clock — инъекция; `iat` вне ±30 с ⇒ `SKEW` (C3).
6. Tier 1 (подписи) вечный офлайн; Tier 2 (roster replay) с журналом; Tier 3 (`isRevokedAt`) с датированным store (A4).
7. B-5: валидация конституции отвергает `k(DISSOLVE) > n_founders`; кворум в момент проверки = `min(k, n_active)`.
8. B-6: вес назначает INVITE, ENROLL повторяет дословно; расхождение ⇒ `WEIGHT_MISMATCH`.
9. B-7: подписант обязан проверить весь префикс — `verifyPrefix` есть в публичном API; сборка событий требует переданный верифицированный префикс.
10. B-12/D19: акты не удаляются и не редактируются — только REVERSE_ACT (SUPERSEDE/REVERSAL).
11. D34 hash-commit: журнал хранит хеши; тяжёлый материал (cx/doc/voucher) — out-of-band; inline-поля check-верифицируются (`SHA-256 == dh/ch`).
12. Лимиты (D35): payload события ≤ 4096 B; inline `doc`/`cx` ≤ 2048 B; ≤ 16 подписей на событие; `dn` ≤ 64, `rs` ≤ 256, `no` ≤ 32.

## 5. Коды ошибок (E1)

Единый стиль core — `CODE @ CONTEXT`. Таблица нормативна:

| Код | Когда | Context |
|---|---|---|
| `MALFORMED` | strict parse: неизвестное/недостающее поле, неверный тип/кодировка, битая b64url, `ch` ≠ SHA-256(cx), `vc.rh` ≠ SHA-256(JCS(chain)) | этап проверки |
| `FORK_DETECTED` | `ph`-несовпадение; CAS `expectedHead` ≠ head; два события на один seq | store/verify |
| `INVALID_QUORUM` | `n_active < k(type)` — тип события заморожен (D28), кроме EXIT/DISSOLVE | verify/assemble |
| `REVOKED` | смерть в chain-контексте (`isRevokedAt` = true — `@ SUB_ATTESTATION`); акт после `compromisedAt` — `@ ROTATE_KEY`; journal-отзыв | verifyAct/verifyJournal |
| `SKEW` | `iat` вне ±30 с от инъектированного Clock | verify |
| `UNKNOWN_EVENT_TYPE` | `ty` вне реестра v1 | verify |
| `ANCHOR_MISMATCH` | поле `anchor`/`an` противоречит длине voucher-цепочки (D12, fail-closed) | verify |
| `WEIGHT_MISMATCH` | ENROLL `w` ≠ INVITE `w` (B-6) | verify |
| `IDP_UNRESOLVABLE` | voucher-цепочка с `vc` не верифицируется против `vc.rp` (root-ключ недоступен, подпись не сходится) для Tier 3 | verifyAct |
| `PAYLOAD_TOO_LARGE` | превышение лимитов §4.12 (D35) — codec, export, import | codec/export |
| `SIGNATURE_INVALID` | Ed25519 по TBS не сходится | verify |

`PactError extends Error { code; context }`.

## 6. Тест-векторы (B3)

Расширение `specs/test-vectors.json` (структура существующего файла сохраняется; секция `pact`):

1. **JCS** — официальные RFC 8785 (поставляются P0.8, потребляются по ссылке).
2. **Деривация** — `pactKey` для фиксированных `(anchorSecretKey, pid, ch, gen)`; отрицательный: подменённый `ch` ⇒ другой ключ ⇒ fail-closed; все `gen` 0..2.
3. **Envelope** — encode/decode всех 11 типов; strict parse (неизвестное поле ⇒ `MALFORMED`); лимиты кромкой (4096/2048/16).
4. **Replay** — verifyJournal: 2-party полный жизненный цикл (GENESIS→INVITE→ENROLL→ACT→REVERSE_ACT→AMEND→ROTATE→EXIT→DISSOLVE); N-party replay с ручной сборкой (assembly не реализован).
5. **Fork** — конкурентные события на один seq ⇒ `FORK_DETECTED`; префикс до форка валиден; CAS-тест store.
6. **Quorum** — кромки `k-of-active`, weights (B-6: расхождение INVITE/ENROLL), B-5 (`min(k, n_active)`, отказ `k(DISSOLVE) > n_founders` на GENESIS и AMEND).
7. **Compromise** — окна `compromisedAt`: акт до/после; флаг `PRE_COMPROMISE_ACT`.
8. **Tier 3** — `isRevokedAt` present/absent (`TIER3_UNSUPPORTED` + `tier3: 'unsupported'`, `ok: true`); цепочка отсутствует в `chains` (`VOUCHER_UNRESOLVED`); `vc.rh` mismatch (`MALFORMED`); подписант без `vc` (`NO_VOUCHER`); цепочка не верифицируется против `vc.rp` (`IDP_UNRESOLVABLE`); `REVOKED @ SUB_ATTESTATION`; кромка: `act.iat == revokedAt` ⇒ отозван («на `at` включительно»).
9. **Skew** — `iat` за ±30 с ⇒ `SKEW`; кромки ровно на границе.
10. **Export/import** — побайтовая идемпотентность, включая различия наборов подписей (B-8).

## 7. Фазы реализации (M1)

| Шаг | Содержание | Оценка | Зависит от |
|---|---|---|---|
| M1.0 | Core rc.9 по P0.8: JCS + `isRevokedAt?` + векторы RFC 8785 | ~1 нед. | — |
| M1.1 | `types.ts`, `errors.ts`, `codec.ts` (JCS + b64url + strict parse) | ~1 нед. | M1.0 |
| M1.2 | `derive.ts` + golden vectors (вкл. отрицательный `ch`) | ~0.5 нед. | M1.1 |
| M1.3 | `verify.ts`: verifyJournal/verifyPrefix — sync (Tier 1+2), verifyAct — async (Tier 1+2+3; fork, quorum, skew) | ~1.5 нед. | M1.2 |
| M1.4 | `assemble/` 2-party — 11 типов событий | ~1 нед. | M1.3 |
| M1.5 | `store/`: JournalStore, MemoryStore, Export (CAS + byte-exact) | ~0.5 нед. | M1.1 |
| M1.6 | `transport/`: Channel + ReferenceX3DH (опционально) | ~0.5 нед. | M1.4 |
| M1.7 | `testing/`: fixtures, mock store/channel, фиксированный Clock | ~0.5 нед. | M1.5 |
| **Итого** | | **~6–7 нед.** | verifier-driven: M1.4 не считается готовым, пока M1.3 не зелёный на векторах |

Ветка `feature/pact-package`; релизный поезд `@me2em/pact@1.0.0-rc.1` после зелёного DoD.

## 8. Definition of Done (v0.1 / rc.1)

- [ ] Core rc.9 (P0.8) принят: JCS + `isRevokedAt?` с векторами RFC 8785.
- [ ] `@me2em/pact@1.0.0-rc.1`: API §3, инварианты §4, коды ошибок §5.
- [ ] Векторы §6 — все зелёные, включая отрицательные (подменённый `ch`, форк, вес).
- [ ] `verifyJournal` + `verifyAct` (Tier 1+2+3) — покрытие ≥ 90 %.
- [ ] Assembly 2-party — все 11 типов; N-party — replay-тесты без assembly.
- [ ] `exportJournal`/`importJournal` — побайтово точны (B-8 включает sig[]).
- [ ] `Channel` + опциональный `ReferenceX3DH`; `Clock` инъекция.
- [ ] `testing/fixtures` пригодны для интеграций We2eM/AS.
- [ ] README + TSDoc на публичном API; бэклог-карточка BL-58 вставлена в BACKLOG.md.
- [ ] CI: Node 22 + browser (vitest browser mode).

## 9. Риски и меры

| Риск | Мера |
|---|---|
| JCS-несоответствие core | M1.0 раньше всего; если векторы не проходят — фикс core до старта pact (единственный содержательный риск Q5) |
| Ошибка в verifyJournal ломает всё | Verifier-driven порядок; assembly блокирован зелёным verify на векторах |
| Tier 3 зависит от rc.9 | M1.0 в скоупе; при сдвиге rc.9 — v0.1 выпускается с Tier 1+2, Tier 3 за feature-flag |
| Числовая точность JCS вне Node | Векторы как контракт; для edge-рантаймов движковый shortcut §2.2 P0.8 |
| Расхождение экспорта/импорта | Идемпотентность parse→canonicalize в векторах §6.10 |

## 10. Отложено (F1–F9)

F1 nested pacts (D30) · F2 FROST/BLS (D24) · F3 zombie N-party expiry (D37 — не импровизировать в деплойменте, P-4) · F4 роли (D29) · F5 binary transport (D40) · F6 replication profile — отдельное ТЗ `@me2em/server` (пары с BL-22) · F7 Session.create-адаптер (`audience: pact:{pid}`) · F8 transparency feed (BL-12/13 — только интерфейсные точки PactRoot/JournalHead) · F9 кошелёк/эскроу пакта — отдельное ТЗ поверх D46 (ротационно-стабильные деривации без `g{gen}`; эскроу `(pid, evHash(ACT))`).

## 11. Бэклог-карточка (к вставке в BACKLOG.md)

> **Правка против PACTS-документа:** карточка в черновике была пронумерована BL-35 — номер в бэклоге занят («Publish automation via CI»); перенумеровано в **BL-58** (максимальный занятый номер — BL-57). Implementer исправлен на отдельный пакет (A1) против черновика «@me2em/core».

```
- **BL-58 · open · Pacts — horizontal trust primitive.** Signed agreements
  between independent Identities without merging trust roots: deterministic
  Pact Keys (HKDF `me2em/pact/v1/{pid}/{ch}/g{gen}`), append-only Pact
  Journal (11 event types, evHash chaining), anchors Identity/Handle/
  SubHandle as lifetime policy, 2-party co-sign profile first, N-party
  constitution/quotas second. Implementable spec: `specs/tz-pact.md`
  (ТЗ v1.0, rev. 2); base design PACTS.md (D1–D47) lands in `docs/`
  separately. Implementer: separate package @me2em/pact, peer
  @me2em/core >=1.0.0-rc.9 (JCS + isRevokedAt, P0.8); transport via
  injected Channel, optional @me2em/crypto peer. Depends on: BL-15
  (namespace convention); amplified by BL-12. Target: pact 1.0.0-rc.1
  (M1.0–M1.7, ~6–7 нед.).
```

## 12. Приложение — нормативная основа (фиксация A1–E2)

| ID | Решение |
|---|---|
| A1 | Отдельный пакет `@me2em/pact` (не в core) |
| A2 | v0.1: 2-party assembly, generic verifier; ~5–6 нед. |
| A3 | AMEND в v0.1 — да |
| A4 | Tier 3 включён; `isRevokedAt?` аддитивно в core rc.9 |
| B1 | JCS (RFC 8785) в core rc.9 — P0.8 |
| B2 | Зависимость только от core; transport — инъекция `Channel`; crypto — опциональный peer |
| B3 | Тест-векторы обязательны (§6) |
| C1 | `JournalStore` — CAS-append `append(expectedHead, event)` ⇒ `FORK_DETECTED` |
| C2 | Оптимистичный append + fork detection; v0.1 — 2-party assembly |
| C3 | Clock инъекция; за skew ±30 с ⇒ reject, код `SKEW` |
| C4 | OFFER `{pid, ch, cx?, ep?}`, ACCEPT `{pid, pactPub}` — wire-типы §3.6 |
| D1–D10 | Границы из PACTS Review К1–К9 (B-1–B-14) — норма ТЗ; D10 (двойная личная подпись, вне цепочки) — вне v0.1 |
| E1 | Коды ошибок §5 |
| E2 | `@me2em/pact@1.0.0-rc.1`; peer core `>=1.0.0-rc.9 <2.0.0-0`; crypto опциональный peer |
| F1–F9 | Отложено (§10) |

**Правки проверки готовности (редакция 1):** peer-версия crypto исправлена `>=0.8.0` → `>=1.1.0-rc.2` (фактическая версия пакета); BL-35 → BL-58 (коллизия номеров бэклога); формат экспорта журнала определён (NL-канонический JCS с sig[]); anchor-материал — через публичные функции деривации core без правок core (`derivePactPublicKey`, добавленный в редакции 1, убран в Р1).

**Правки ревью ТЗ (Р1–Р10, редакция 2):**

| ID | Правка | Блокировала |
|---|---|---|
| Р1 | `derivePactPublicKey` убран: `pactPub = core.crypto.getPublicKey(pactKey)` — отдельной деривации нет (§3.2) | нет |
| Р2 | Anchor-материал = приватный ключ узла через `crypto.deriveRootKey/deriveHandleKey/deriveSubHandleKey` (namespace-экспорт `index.ts:46`, сигнатуры проверены); пример в §3.2 | нет |
| Р3 | Tier 3 детализирован: `vc.rh` = SHA-256(JCS(chain)) hash-commit (D34), `vc.rp` = root pub; `verifyAct(..., chains?)`; нормативный поток §3.3; идентификатор — сырой `jti` (конвенция core `isRevoked`), BL-15-нотация — не в параметре | **да** |
| Р4 | `Clock { now(): number }` объявлен в types.ts; `assemble*` принимают опциональный clock (§3.1, §3.4) | нет |
| Р5 | `Signer` исключён из потребления pact-машиной — подпись через `crypto.sign` напрямую; адаптер — F7 (§1) | нет |
| Р6 | Payload'ы — нормативно PACTS §7.3; strict parse в codec (§3.1) | нет |
| Р7 | `NO_VOUCHER` — предупреждение, не ошибка (D6: dial off) — внутри Р3/Р10 | нет |
| Р8 | Экспорт: LF-only, финальный `\n`, пустые строки ⇒ `MALFORMED`, нарушение D35 ⇒ `PAYLOAD_TOO_LARGE` (§3.5) | нет |
| Р9 | `verifyJournal`/`verifyPrefix` — sync (Tier 1+2); `verifyAct` — async (Tier 1+2+3) (§3.3) | **да** |
| Р10 | `VerifyResult.tier3?: 'supported' \| 'unsupported'`; `WarningCode` = PRE_COMPROMISE_ACT \| TIER3_UNSUPPORTED \| NO_VOUCHER \| VOUCHER_UNRESOLVED (§3.1, §3.3) | **да** |
