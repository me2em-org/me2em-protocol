# P0.8 — ТЗ: доработка `@me2em/core` rc.9 (JCS RFC 8785 + `isRevokedAt`)

**Статус:** на утверждении. Поставка до/параллельно с ТЗ `@me2em/pact` (его фаза M1.0 потребляет оба изменения).
**База:** PACTS.md (adopted design D1–D47); «Границы и плейбуки» §9 (B-1–B-14, P-1–P-6); фиксация решений A1–E2 (B1, A4); спека `specs/v1.0.md`; PACTS Review (К1–К9).
**Закрывает:** **B1** — JCS в core (нужен We2eM + pact), **A4** — `RevocationChecker.isRevokedAt?` аддитивно в core rc.9, **Q5** — единственный содержательный технический риск (канонизация), **Q6** — подтверждён без работ (HKDF уже есть).
**Целевая версия:** `@me2em/core 1.0.0-rc.9`.

---

## 0. Сводка

| | |
|---|---|
| Пакет | `@me2em/core` — только аддитивные изменения |
| Фаза 1 | JCS-модуль RFC 8785 (`crypto/jcs.ts`) — новая канонизация, существующая не трогается |
| Фаза 2 | `RevocationChecker.isRevokedAt?(jti, at)` — опциональный метод интерфейса (D17, Tier 3) |
| Не входит | правка сериализации attestation/session (байт-совместимость), починка payload-проверки `Attestation.issue` (отдельная известная задача, см. §7), API деривации pact-ключей (не требуется — см. §5) |
| Совместимость | строго аддитивно: потребители rc.8 собираются на rc.9 без изменений кода |
| Внешние стандарты | RFC 8785 (JCS), RFC 7493 (I-JSON), ECMAScript `Number::toString` (ES6) |

## 1. Версионирование и релиз

1. Версия `1.0.0-rc.9`; один PR, один merge в main (канон мерж-дисциплины).
2. Обе фазы независимы внутри rc.9, но поставляются одной версией: pact-ТЗ привязывает peer-диапазон к `>=1.0.0-rc.9 <2.0.0-0`.
3. Обратная совместимость обязательна (в отличие от продуктовой политики «пользователей нет» — у core есть потребители: crypto, x402, react, solana и внешние внедрения).

## 2. Фаза 1 — JCS-модуль (RFC 8785)

### 2.1. Размещение и API

Модуль: `packages/core/src/crypto/jcs.ts`; экспорт добавляется в `crypto/index.ts` (`export * from './jcs.js'`) и в корневой `src/index.ts`.

```ts
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Канонические байты (UTF-8) значения по RFC 8785. Бросает CanonicalizationError. */
export function canonicalize(value: JsonValue): Uint8Array;

/** Та же канонизация в виде строки — для отладки/логов; байты = UTF-8(canonicalize). */
export function canonicalizeToString(value: JsonValue): string;
```

`jcs.canonicalize(value)` — первичный контракт (фиксация B1); подписи и хеши пактов вычисляются **только** над этими байтами.

### 2.2. Нормативные требования канонизации

Реализация ДОЛЖНА соответствовать RFC 8785:

1. **Ключи объектов** сортируются по UTF-16 code units (лексикографически; НЕ по code points — это тонкое место для символов за пределами BMP).
2. **Числа** сериализуются по ECMAScript `Number::toString` (RFC 8785 §3.2.2.3 — нормативная ссылка на ES6). Реализация в JS МОЖЕТ опираться на движковый `Number.prototype.toString`/`JSON.stringify` для чисел: начиная с ES6 формат движков нормативно совпадает с RFC. Разрешённый shortcut снижает риск Q5 до нуля для JS-рантаймов.
3. **I-JSON (RFC 7493):** числа вне точного диапазона double (целые > 2^53−1, нецелые за пределами мантиссы) → `CanonicalizationError`; `-0` → `0`; дубликаты ключей при разборе внешнего JSON — вне ответственности модуля (вход — уже разобранное значение), но документируется.
4. **Строки:** управляющие символы < 0x20 эскейпятся по JSON (`\b \t \n \f \r`, иначе `\u00XX`), `"` и `\` экейпятся; остальной Unicode — сырым UTF-8, без `\u`-эскейпов непробельных символов; lone surrogates → `CanonicalizationError`.
5. **Литералы:** `null`, `true`, `false` — как есть; массивы — порядок сохраняется; пробелы запрещены.
6. **Fail-closed:** любой вход вне JSON-представимого (BigInt, undefined, функции, циклы) → `CanonicalizationError` с кодом в стиле core (`MALFORMED @ JCS`).

### 2.3. Чего фаза НЕ делает

- НЕ заменяет сериализацию attestation/session (`JSON.stringify(payload)` с порядком литералов — `attestation.ts:561`, `session.ts:273`). Порядок полей attestation нормативно зафиксирован спекой v1.0; миграция на JCS сломала бы байт-совместимость всех выпущенных токенов. JCS — отдельный экспорт для новых потребителей (pact).
- НЕ вводит protobuf/бинарную канонизацию (D40 отклонено; binary transport — открытое вопрос F5).

## 3. Фаза 2 — `RevocationChecker.isRevokedAt?`

### 3.1. Интерфейс

В `session.ts` (интерфейс `RevocationChecker`, ныне `isRevoked(sessionId): Promise<boolean>`) добавляется опциональный метод:

```ts
export interface RevocationChecker {
  isRevoked(sessionId: string): Promise<boolean>;
  /**
   * Dated revocation lookup (PACTS D17, Tier 3): был ли `jti` отозван
   * на момент `at` (unix seconds) включительно. Реализации без метода
   * означают «отзыв только в настоящем» — вызывающий деградирует до
   * `isRevoked` (ретроспектива недоступна, Tier 3 unsupported).
   */
  isRevokedAt?(sessionId: string, at: number): Promise<boolean>;
}
```

### 3.2. Контракт и границы

1. Метод опционален: существующие реализации (InMemory, Redis — примеры в JSDoc `session.ts:78–95`) совместимы без правок.
2. `Session.verify` НЕ меняется — продолжает `isRevoked` (настоящее). Потребитель ретроспективы (pact `verifyAct`, Tier 3) проверяет наличие метода и деградирует иначе.
3. Core НЕ определяет схему датированного хранилища (`revokedAt`/`compromisedAt` — поля события ROTATE_KEY и записи отзыва) — это ответственность реализаций checker'а и pact-ТЗ; core фиксирует только контракт «дата в секундах, включительно».
4. Терминология: параметр именуется `at`; семантика — «статус на момент `at`», ответ `true` = отозван на `at` или ранее.
5. Идентификатор — **сырой `jti`** из payload, без namespace-префикса (конвенция `isRevoked`: «The `jti` field from the session payload», `session.ts:101`). Namespace-нотация BL-15 (`sess:{jti}`, `att:{jti}`, `pact:{pid}:…`) — уровень журнальных записей и реестров отзыва, не параметра вызова checker'а; pact (ТЗ v1.0 §3.3, Р3) передаёт сырые `jti` аттестаций voucher-цепочки.

## 4. Тест-план

1. **Официальные векторы RFC 8785** (приложение RFC + публичный набор авторов RFC, репозиторий cyberphone/json-canonization) — как fixture в `specs/test-vectors.json` (секция `jcs`, в структуре существующего файла: `spec`, `spec_version`, `vector_file_version`, `algorithm`, `notes`, `vectors`).
2. **Числовые кромки** (самые частые источники несовместимости): `333333333.33333329`, `1e+30`, `2^53−1`, `2^53`, `-0`, `0.000001`, экспоненты с ведущими нулями; BigInt-вход → ошибка.
3. **Строковые кромки**: сортировка ключей по UTF-16 (`\uD800`-диапазон vs U+10000+), управляющие символы, lone surrogate → ошибка, эмодзи (surrogate pair) — без эскейпа.
4. **Свойственные тесты**: canonicalize → parse → canonicalize — идемпотентность байтов; canonicalize(jcs-parsed(x)) == canonicalize(x).
5. **isRevokedAt**: интерфейсный тест с mock-реализацией; тест деградации при отсутствии метода; `Session.verify` — регресс на rc.8-поведении (набор существующих векторов не меняется).

## 5. Anchor-материал для pact: изменений НЕ требуется

Проверка показала: сырые байты ключей-якорей достижимы публичными функциями `crypto/derivation.ts` — отдельный API для pact не нужен:

| Якорь | Получение IKM (уже в core) |
|---|---|
| Identity | `deriveRootKey(seed)` → сырой root-ключ |
| Handle | `deriveHandleKey(rootKey, name)` → сырой ключ handle |
| SubHandle | `deriveSubHandleKey(...)` → сырой ключ subhandle |

Экземпляр `Handle` приватный ключ НЕ раскрывает (`#privateKey`) и не должен: pact-ТЗ принимает `anchorSecretKey: Uint8Array`, полученный функциями деривации выше. В JSDoc `derivation.ts` добавляется абзац-указатель «получение anchor-материала для @me2em/pact» (таблица выше) — единственная документационная правка.

## 6. Definition of Done

- [ ] `crypto/jcs.ts`: `canonicalize`/`canonicalizeToString` + `CanonicalizationError`; экспортирован из `crypto/index.ts` и корневого `index.ts`.
- [ ] Векторы RFC 8785 (официальный набор) зелёные; числовые и строковые кромки §4.2–4.3 зелёные.
- [ ] `RevocationChecker.isRevokedAt?` добавлен; TSDoc-контракт §3.2; регресс `Session.verify` — набор векторов rc.8 без изменений.
- [ ] JSDoc-указатель в `derivation.ts` (§5).
- [ ] Версия `1.0.0-rc.9`; CHANGELOG; один merge в main.
- [ ] CI: Node 22 + браузерный прогон (vitest browser mode) — как для текущих релизов core.

## 7. Риски и связанные работы

| Риск | Мера |
|---|---|
| Тонкости `Number::toString` на не-JS рантаймах | Реализация в JS опирается на движок (§2.2.2); для edge/детерминированных песочниц — те же векторы как контракт |
| Сортировка по UTF-16 перепутана с code points | Кромка-тест §4.3 обязателен |
| Искушение «заодно» перевести attestation на JCS | Запрещено §2.3 — байт-совместимость токенов v1.0 |
| Известная задача: payload-проверка в `Attestation.issue` (размер лимита 2048 B проверяется на issue непоследовательно; связанный issue по decode iat/exp) | Вне скоупа P0.8; поставляется отдельной задачей протокола, pact не зависит (свои лимиты проверяет сам) |
