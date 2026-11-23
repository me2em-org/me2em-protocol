# P0.8+ — ТЗ: `Handle.deriveResourceKey` — крипто-состояния ресурсов (Фаза 3 rc.9)

**Статус:** принят — реализован как Фаза 3 rc.9 (этот PR). Расширяет действующее ТЗ `specs/tz-core-rc9-jcs-revocation.md` (Фазы 1–2: JCS, `isRevokedAt`) третьей фазой того же релиза.
**База:** вердикт по RFC «Детерминированное управление крипто-состояниями» (разбор дефектов: сигнатура `derivePassword`, запрет `revision: 0`, конфликт имён с BL-55, инъективность конкатенации, канонизация, sync); код `packages/core/src` (handle.ts, canonical-name.ts, crypto/derivation-paths.ts, crypto/derivation.ts, errors.ts); спека `specs/v1.0.md` §3; прецедент векторов — группы `derive_password`/`derive_channel_key` в `specs/test-vectors.json`.
**Закрывает:** прикладной запрос «управление доступом/отзывом/монетизацией ресурсов без доверенного сервера» на уровне протокола — третий домен деривации. Приложение-паттерны (KEB, epoch-ключи, UI-циклы) — **вне скоупа core**, см. §7.
**Целевая версия:** `@me2em/core 1.0.0-rc.9` (тот же релизный поезд, что Фазы 1–2; peer-диапазон `@me2em/pact >=1.0.0-rc.9 <2.0.0-0` уже фиксирует флор — пересмотра pact не требуется).

---

## 0. Сводка

| | |
|---|---|
| Пакет | `@me2em/core` — только аддитивные изменения |
| Состав | 1 новый метод `Handle.deriveResourceKey` (наследуется `SubHandle`); тип `DeriveResourceKeyOptions`; `DERIVATION_PATHS.resource`; 2 паттерна + 2 нормализатора в `canonical-name.ts`; guard'ы состояния; группа векторов `derive_resource_key`; экспорт типа из корневого `index.ts` |
| Домен | соль `me2em/resource/{resourceType}/{resourceId}`, info `me2em/resource/v1[/e{epoch}][/r{revision}]` — третий сиблинг рядом с `me2em/secret/` (password) и `me2em/channel/` (channel) |
| Не входит | BL-55 `deriveStateKey` (react-персистенция `Channel` — имя остаётся за ней, см. §2.1); app-паттерны §3–§5 исходного RFC (KEB, epoch-envelope, blur-превью, перезапуск UI — §7 Приложения, отдельная app-спека); правка существующих методов/сериализаций; перевод attestation на JCS |
| Совместимость | строго аддитивно: потребители rc.8 собираются на rc.9 без изменений кода; существующие info-пути и векторы байт-неизменны (правило derivation-freeze: **добавление** пути — не BREAKING CHANGE) |

## 1. Версионирование и релиз

1. Фаза 3 входит в тот же PR/релиз `1.0.0-rc.9` (PR #93), что и Фазы 1–2 — по явному решению владельца. Фаза автономна: при задержке отрезается в rc.10 без перепланировки Фаз 1–2 (см. §9).
2. Обратная совместимость обязательна — у core есть потребители (crypto, x402, react, solana, pact). Новый salt/info-namespace `me2em/resource/` не пересекается ни с одним существующим, поэтому все ранее выведенные ключи и векторы остаются байт-идентичными.
3. `SubHandle` наследует метод автоматически (публичный метод `Handle`); отдельной правки `subhandle.ts` не требуется.

## 2. Решения по вердикту RFC (design log)

| # | Решение | Обоснование |
|---|---|---|
| 2.1 | Имя — **`deriveResourceKey`**, не `deriveStateKey` | BL-55 уже закрепила `deriveStateKey` под *другую* функцию (session-bound ключ персистенции `Channel` в `@me2em/react`). RFC-метод ключует **ресурс** (параметр и сам RFC называет `resourceType`/`resourceId`); «state» в нём — это значение ревизии, а не ключ. Разделение: BL-55 = состояние приложения, Фаза 3 = состояние доступа к ресурсу. BACKLOG BL-55 дополняется примечанием о разделении (§6.4) |
| 2.2 | База — сиблинг **`deriveChannelKey`**, не `derivePassword` | Вывод — 32-байтный симметричный ключ для AES-GCM: HKDF, sync, `Uint8Array`. Обёртка над `derivePassword` (base64url-строка, sync) потребовала бы второго KDF поверх пароля без соли — антипаттерн, отклонено вердиктом |
| 2.3 | Домен соли — `me2em/resource/…` | Третья запись реестра доменов рядом с `me2em/secret/` и `me2em/channel/`; семантически чужой домен `channel` не используется |
| 2.4 | Кодирование — **структурные поля + строгие charset-паттерны**, никакой склейки строк на стороне приложения | Конкатенация `type:id:anchor` из RFC инъективно небезопасна (`state:chat:a:1:2026` допускает разные разложения). Компоненты соли формирует core из отдельных полей; каждый компонент ограничен алфавитом без `/` и `:`, поэтому join на `/` взаимно однозначен (§3.2) |
| 2.5 | Канонизация — **переиспользуется `normalizeContext`** (NFKC → lowercase → trim) | RFC-склейка обошла бы канонизацию: `'Chat-Msg'` и `'chat-msg'` стали бы молча разными ключами. Здесь канонизация сохранена и расширена паттерном (§3.2); вектор #6 фиксирует эквивалентность |
| 2.6 | **Без прехеша контекста** | Двойной слой sha256→HKDF криптографически бесполезен (HKDF-соль уже доменизирует), а хэш убивает аудируемость: в логах/тестах core видны человекочитаемые контексты. Компромисс: инъективность обеспечена паттернами, а не хэшем |
| 2.7 | `anchor: string` → **`epoch: number`** | Два формата («ISO-дата ИЛИ номер блока») в одном поле — нетканоничность. Числовая монотонная эпоха (день как `20261105`, блок, период подписки) канонична по построению: у целого нет Unicode-представления, NFKC не требуется |
| 2.8 | **`revision ≥ 0`** — отдельный guard состояния | `assertRevision` password/channel требует ≥ 1 (вращение скомпрометированного секрета). Для ресурсов `0` — валидное **закрытое** состояние (ключ заглушки/blur) — центральная идея RFC. Семантика различий задокументирована в TSDoc-таблице (§3.5) |
| 2.9 | **Синхронная** сигнатура, `Uint8Array` (32 байта) | Оба соседних метода sync; async создал бы расслоение API. HKDF @noble синхронен |
| 2.10 | Ошибки — `AttestationError('MALFORMED', 'FORMAT', …)`; не-строки → `TypeError` | Тот же контракт, что у `normalizeContext`/`assertRevision`: структура/использование → `FORMAT`, API-мисюс → `TypeError` |

## 3. Спецификация метода

### 3.1. Публичный контракт

```ts
// packages/core/src/handle.ts

export interface DeriveResourceKeyOptions {
  /**
   * Неотрицательное целое в [0, 2^53−1]; период/эпоха контекста (default `1`).
   * Монотонный якорь уникальности во времени: день (`20261105`), номер блока,
   * номер периода подписки. Явная `1` эквивалентна omission (базовый путь).
   */
  epoch?: number;
  /**
   * Неотрицательное целое в [0, 2^53−1]; числовое состояние доступа
   * (default `1`). `0` — валидное закрытое/отозванное состояние (ключ
   * заглушки); `1` — базовое открытое; `≥ 2` — вращение/новый период.
   * Отличие от `derivePassword`/`deriveChannelKey`, где ревизия строго ≥ 1.
   */
  revision?: number;
}

/**
 * Derives a 32-byte symmetric key for a specific access state of a resource.
 * … (полный TSDoc — эталонный листинг в §3.5 и в packages/core/src/handle.ts)
 */
deriveResourceKey(
  resourceType: string,
  resourceId: string,
  options?: DeriveResourceKeyOptions
): Uint8Array;
```

### 3.2. Каноническое кодирование компонентов (инъективность)

В `canonical-name.ts` добавляются паттерн и нормализаторы (алфавит совпадает с `NAME_PATTERN`, лимиты расширены под hex-хэши):

```ts
/** Тип ресурса: [a-z0-9] стартер + [a-z0-9._@-] тело, ≤ 63 симв. */
export const RESOURCE_TYPE_PATTERN = /^[a-z0-9][a-z0-9._@-]{0,62}$/;

/** Идентификатор ресурса: тот же алфавит, ≤ 128 симв. (64-симв. sha256-hex помещается). */
export const RESOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9._@-]{0,127}$/;

export function normalizeResourceType(raw: string): string;
export function normalizeResourceId(raw: string): string;
```

Контракт обоих нормализаторов: `TypeError` если не строка; `normalizeContext` (NFKC → lowercase → trim, непусто); затем проверка паттерна → `AttestationError('MALFORMED','FORMAT')` при несоответствии.

**Нормативные следствия:**

1. Компоненты не содержат `/`, `:` и пробельных/управляющих символов → строка соли `me2em/resource/{type}/{id}` **инъективна**: разные пары (type, id) дают разные соли; разные (type, id) не могут разложиться в одинаковую склейку. URI/пути как `resourceId` запрещены паттерном — приложение сначала сводит их к хэшу/UUID/слагу.
2. Канонизация сквозная: `'Ｃhat-Msg '`, `'Chat-Msg'`, `'chat-msg'` — один ключ (вектор #6).
3. Ограничение 63/128 символов проверяется **после** канонизации.

### 3.3. Guard'ы состояния

Один общий guard для `epoch` и `revision` (ограничения идентичны; семантика различается в TSDoc):

```ts
function assertStateInteger(value: number | undefined, name: string): void {
  if (
    value !== undefined &&
    (typeof value !== 'number' || !Number.isInteger(value) ||
     value < 0 || value > Number.MAX_SAFE_INTEGER)
  ) {
    throw new AttestationError(
      'MALFORMED', 'FORMAT',
      `${name} must be a non-negative integer in [0, ${Number.MAX_SAFE_INTEGER}], got: ${String(value)}`
    );
  }
}
```

Существующий `assertRevision` (≥ 1) не меняется и остаётся у password/channel — различие guard'ов зафиксировано тестом (§4.2) и таблицей в TSDoc.

### 3.4. `DERIVATION_PATHS.resource`

Единый источник info-строк (файл `crypto/derivation-paths.ts`) пополняется сиблингом `password`/`channel`:

```ts
/**
 * Builds the info string for resource-state key derivation (rc.9, states ТЗ §3).
 * Epoch precedes revision; segment is omitted when the value equals the
 * default `1`, so the base path "me2em/resource/v1" stays frozen.
 * `revision: 0` (locked state) yields "me2em/resource/v1/r0" — a valid,
 * cryptographically independent key, unlike password/channel rotation paths.
 */
resource: (epoch: number = 1, revision: number = 1): string =>
  'me2em/resource/v1' +
  (epoch !== 1 ? `/e${epoch}` : '') +
  (revision !== 1 ? `/r${revision}` : ''),
```

Соль строится в методе: `` `me2em/resource/${type}/${id}` `` (компоненты уже нормализованы §3.2). Вывод: `hkdf(this.#privateKey, salt, info, 32)`.

### 3.5. Эталонная реализация (листинг с TSDoc)

```ts
/**
 * Derives a 32-byte symmetric key for a specific **access state** of a
 * resource — the protocol primitive behind owner-controlled unlock,
 * revocation and re-grant without a trusted server (states ТЗ, rc.9 Фаза 3).
 *
 * The caller controls two independent integer dimensions:
 * - `epoch` — *which period of the context* (day index, block number,
 *   subscription period); default `1`.
 * - `revision` — *the access state within that context*: `0` = locked
 *   (encrypt a blur/stub), `1` = unlocked (default), `≥ 2` = re-granted
 *   period / rotation.
 *
 * **Differences from derivePassword/deriveChannelKey:**
 *
 * | | password / channel | resource |
 * |---|---|---|
 * | argument shape | one `context` string | structured `resourceType` + `resourceId` (charset-validated, injective) |
 * | `revision: 0` | rejected (`revision ≥ 1`) | valid — the locked state |
 * | temporal dimension | none | `epoch` |
 * | output | base64url string / 32 bytes | always 32 bytes (`Uint8Array`) |
 *
 * The context is canonicalized NFKC → lowercase → trim per component and
 * restricted to `[a-z0-9][a-z0-9._@-]{0,62}` (type) / `{0,127}` (id) — the
 * salt join is therefore injective; `'Ｃhat-Msg '`, `'Chat-Msg'` and
 * `'chat-msg'` yield the same key. Identifiers MUST NOT embed separators
 * (URI/path) — pass a hash, UUID or slug instead.
 *
 * @param resourceType - Domain of the resource (e.g. `'chat-msg'`, `'file'`, `'stream'`).
 * @param resourceId - Unique id within the domain (e.g. content sha256-hex, `'msg-105'`).
 * @param options - `epoch` (default 1) and `revision` (default 1, `0` = locked).
 * @returns A 32-byte `Uint8Array` suitable for AES-256-GCM.
 * @throws {TypeError} If `resourceType`/`resourceId` is not a string.
 * @throws AttestationError `MALFORMED`/`FORMAT` if a component is empty or
 *   fails the charset/length pattern, or `epoch`/`revision` is not an
 *   integer in `[0, 2^53−1]`.
 *
 * @example
 * ```ts
 * const hash = 'e3b0c442…'; // sha256 of the image
 * // Unlocked (paid / active): encrypt the original.
 * const original = handle.deriveResourceKey('chat-msg', hash);
 * // Locked: a cryptographically independent key for the blur preview.
 * const blur = handle.deriveResourceKey('chat-msg', hash, { revision: 0 });
 * // Subscription period 2: everyone holding period-1 keys sees nothing new.
 * const month2 = handle.deriveResourceKey('stream', 'ch-42', { revision: 2 });
 * // Daily context: same code, new key each day.
 * const daily = handle.deriveResourceKey('chat-msg', hash, { epoch: 20261105 });
 * ```
 */
deriveResourceKey(
  resourceType: string,
  resourceId: string,
  options: DeriveResourceKeyOptions = {}
): Uint8Array {
  this.#assertNotDisposed();
  assertStateInteger(options.epoch, 'epoch');
  assertStateInteger(options.revision, 'revision');
  const type = normalizeResourceType(resourceType);
  const id = normalizeResourceId(resourceId);
  const salt = new TextEncoder().encode(`me2em/resource/${type}/${id}`);
  const info = new TextEncoder().encode(
    DERIVATION_PATHS.resource(options.epoch ?? 1, options.revision ?? 1)
  );
  return hkdf(this.#privateKey, salt, info, 32);
}
```

### 3.6. Экспорты

- `src/index.ts` (строка экспортов handle): добавить `type DeriveResourceKeyOptions`.
- `crypto/index.ts` уже реэкспортирует `derivation-paths.js` и `canonical-name` не экспортирует — новые паттерны/нормализаторы экспортируются из корня явно (`export { RESOURCE_TYPE_PATTERN, RESOURCE_ID_PATTERN } from './canonical-name.js'`) только если понадобится вне core; по умолчанию — внутренние (минимальная поверхность API).

## 4. Тест-план

1. **Golden-векторы** — новая группа `derive_resource_key` в `specs/test-vectors.json` (структура как у `derive_channel_key`: `seed_hex`, `handle_name`, `resource_type`, `resource_id`, `epoch`, `revision`, `expected_key_hex`; 8 векторов из §5). CI-тест обязан воспроизводить все 8 байт-в-байт.
2. **Guard-кромки**: `revision: -1 / 0 / 1 / 1.5 / NaN / Infinity / 2^53 / 2^53+1` → только `0` и `1` зелёные из кромок, остальные `MALFORMED`/`FORMAT`; то же для `epoch`; опущенные поля ≡ явные `1` (байт-равенство).
3. **Charset/length**: `'chat/a'` → MALFORMED; `'chat:a'` → MALFORMED; `''`/`'   '` → MALFORMED (после канонизации пусто); не-строка → `TypeError`; длины 63/64 и 128/129 — граничные; `'Chat-Msg'` ≡ `'chat-msg'` (канонизация сквозная).
4. **Инъективность (свойство)**: для 100 детерминированно сгенерированных пар (type, id, epoch, revision) ключи попарно различимы при отличии любого поля; повторный вызов даёт байт-идентичный результат.
5. **Независимость состояний**: векторы фиксируют `rev0 ≠ rev1 ≠ rev2 ≠ epoch(20261105)` — ревизии и эпохи дают криптографически независимые ключи.
6. **Жизненный цикл**: после `dispose()` → `DisposedError`; `SubHandle` наследует метод (smoke-тест байт-равенства с ручной деривацией от subhandle-ключа).
7. **Регресс**: группы `derive_password`, `derive_channel_key`, `derive_shared_secret` и все остальные векторы rc.9 — без изменений и зелёные; `assertRevision` password/channel по-прежнему отвергает `0` (защита от регрессии guard'ов).

## 5. Golden-векторы

Сгенерированы эталонной цепочкой core (root/handle — HKDF с пустой солью, как в `crypto/derivation.ts`); санити генератора — байт-точное воспроизведение опубликованного вектора `derive_channel_key` #1 (`110b968a…`). Файл поставки: `derive_resource_key.vectors.json`. Seed/handle — как у существующих групп: `5eb00bbd…`, `'work'`.

| # | type | id | epoch | revision | info | expected_key_hex |
|---|---|---|---|---|---|---|
| 1 | `chat-msg` | `e3b0c442…52b855` | — | — | `me2em/resource/v1` | `d6e1ef252e8ebb086a6288ae90e2395293528a85020e8f411aa6f582dd7c1d03` |
| 2 | `chat-msg` | `e3b0c442…` | — | 0 | `me2em/resource/v1/r0` | `f98e2ff6cd5b5c9df4ba06aa199c2e4502cf8c57b8130e36fd51e7753926da7e` |
| 3 | `stream` | `ch-42` | — | 2 | `me2em/resource/v1/r2` | `b5e71d16ee077e2c038c07fcc80603331903587b2160e6869afa2fb6e2931522` |
| 4 | `chat-msg` | `e3b0c442…` | 20261105 | — | `me2em/resource/v1/e20261105` | `cf3da5dc836f559761d289a060274650f21f4508c49e3f9f7f5ab5a5f3190ca9` |
| 5 | `chat-msg` | `e3b0c442…` | 20261105 | 0 | `me2em/resource/v1/e20261105/r0` | `348c38f53837ae576912431a8aba3e17d625a042097bbfb1f29d5df08e3889f9` |
| 6 | `Ｃhat-Msg ` (raw) | `e3b0c442…` | — | — | как #1 после канонизации | `d6e1ef25…` (= #1 — доказательство NFKC) |
| 7 | `file` | `e3b0c442…` | — | — | `me2em/resource/v1` (другая соль) | `81ef293ad96856d4e31c27585b89b16ee6c6a3d320a1334f330920b96796a170` |
| 8 | `chat-msg` | `msg-105` | — | — | `me2em/resource/v1` (другая соль) | `69678806810556e7018f9f7814e11fb4a0c9f4cb86aaf6af25da37697a9fe311` |

Полные значения `resource_id` #1/#2/#4/#5/#6/#7: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (sha256 пустой строки — маркер «эталонный нулевой контент»). В JSON-файле каждый вектор содержит полный `description` с солью и info.

## 6. Документация

1. **TSDoc метода** — нормативный документ паттернов на уровне core: только контракт ключа (§3.5). Паттерны А/Б (бинарный 0/1, инкремент) упоминаются одной строкой в `@example` — без KEB, blur-превью и UI-циклов (это уровень приложения, §7).
2. **README `@me2em/core`** — раздел деривации пополняется третьей строкой (password / channel / resource) с отличием «`revision: 0` допустим — закрытое состояние».
3. **`specs/v1.0.md` §3** — аддитивная строка в таблице дериваций: `me2em/resource/{type}/{id}` + `me2em/resource/v1[/eE][/rR]`, пометка *since rc.9*; примечание, что добавление namespace не нарушает derivation-freeze существующих путей.
4. **BACKLOG.md** — BL-55 остаётся открытой задачей react-персистенции (`deriveStateKey` + string-keyed brand); к формулировке добавляется примечание: «имя `deriveStateKey` закреплено за BL-55; resource-state ключ rc.9 — `deriveResourceKey` (ТЗ specs/tz-core-rc9-states.md)».
5. **CHANGELOG rc.9** — отдельный пункт «Added: `Handle.deriveResourceKey` — deterministic access-state keys for resources (epoch/revision model, `revision: 0` = locked)».

## 7. Приложение (не нормативно для core): паттерны уровня приложения

Всё содержание §3–§5 исходного RFC **не входит** в контракт core-метода и переносится в отдельную app-спеку (`specs/tz-states-app.md` — отдельная задача, не в rc.9). Здесь фиксируются решения вердикта, чтобы паттерны не потерялись:

1. **Подход А (бинарный 0/1)** — статичный/потребляемый контент: `revision: 1` шифрует оригинал, `revision: 0` — blur/заглушку. Криптообоснование RFC корректно и сохраняется: повторное использование ключа легитимными получателями безопасно, т.к. новый контент = новый `resourceId`. С guard'ом §3.3 пример RFC теперь **валиден** (в исходном виде он упал бы на `revision: 0`).
2. **Подход Б (инкремент)** — динамика/подписки: новый период = инкремент `revision`; ключи прошлых периодов бесполезны для новых данных (offline-защита кэша). Приложение само ведёт счётчик и публикует актуальную ревизию в метаданных ресурса.
3. **KEB (Key Encapsulation Block)** — стандартный envelope encryption: массив «pub_key_hash → ключ под pub ключом участника». Точечный отзыв (§5.2 RFC) — удаление записи из KEB — это **серверная** правка состояния ресурса; протокол уровня core её не описывает, а серверная авторизация правки (только владелец) должна опираться на pact/attestation — прямое потребление `@me2em/pact`.
4. **Оптимизация O(N)** (§5.4 RFC) — принята как рекомендованный паттерн: `deriveResourceKey` группы с инкрементом эпохи оборачивает **Group Epoch Key**, который раздаётся envelope'ом при смене состава, а ключи сообщений шифруются симметрично им. Это sender-key/envelope-комбинация — спека её форматов (метаданные эпохи, границы KEB) — предмет app-спеки.
5. **UI-жизненный цикл** (§4 RFC: принудительный перезапуск компонента по смене ревизии, очистка IndexedDB-кэша) — уровень `@me2em/react`, не core.

## 8. План шагов (Фаза 3 в релизном PR rc.9)

1. `crypto/derivation-paths.ts`: `resource`-билдер (§3.4).
2. `canonical-name.ts`: `RESOURCE_TYPE_PATTERN` / `RESOURCE_ID_PATTERN` + `normalizeResourceType` / `normalizeResourceId` (§3.2).
3. `handle.ts`: `DeriveResourceKeyOptions`, `assertStateInteger`, метод `deriveResourceKey` (§3.5).
4. `src/index.ts`: экспорт `type DeriveResourceKeyOptions`.
5. `specs/test-vectors.json`: группа `derive_resource_key` (8 векторов §5, поля как у `derive_channel_key` + `epoch`/`revision`).
6. Тесты: `handle.spec.ts` — новый `describe('deriveResourceKey')` по плану §4.
7. Документация: README, `specs/v1.0.md` §3, CHANGELOG, BACKLOG BL-55 примечание (§6).
8. Релиз: тот же PR/merge в main, версия уже `1.0.0-rc.9`; peer-диапазоны потребителей не меняются.

## 9. Риски и меры

| Риск | Мера |
|---|---|
| Рост скоупа PR #93 | Фаза автономна: отрезается в rc.10 без перепланировки Фаз 1–2; peer-диапазон pact `>=1.0.0-rc.9` удовлетворяется в обоих случаях |
| `revision: 0` удивит потребителей password/channel (там 0 — ошибка) | TSDoc-таблица различий (§3.5) + тест §4.7, фиксирующий, что старые методы по-прежнему отвергают 0 |
| Инъекция через `epoch`/`revision` → строку info (`/e1e2`, отрицательные) | Guard §3.3: только целые в `[0, 2^53−1]`; `toString(10)` целого каноничен (ES6) |
| Приложения начнут передавать URI/пути в `resourceId` | Паттерн §3.2 отвергает с `MALFORMED`/`FORMAT`; TSDoc прямо требует хэш/UUID/слаг |
| Ложное ожидание «rotating epoch = перезапись истории» | Векторы фиксируют независимость всех ревизий/эпох; доступ к прошлым периодам определяется тем, у кого уже есть ключи — protocol не «стирает» право на расшифровку ранее полученного контента (свойство-envelope, документируется в app-спеке) |
| Соблазн заодно реализовать BL-55 `deriveStateKey` | Запрещено: разные задачи (см. §2.1), BL-55 идёт отдельно с react-персистенцией |

## 10. Definition of Done

- [ ] `DERIVATION_PATHS.resource` добавлен; существующие пути байт-неизменны.
- [ ] `canonical-name.ts`: 2 паттерна + 2 нормализатора с контрактами §3.2.
- [ ] `handle.ts`: `deriveResourceKey` + `DeriveResourceKeyOptions` + `assertStateInteger`; `SubHandle` наследует; `dispose()` → `DisposedError`.
- [ ] Корневой экспорт `DeriveResourceKeyOptions`.
- [ ] Группа `derive_resource_key` (8 векторов) в `specs/test-vectors.json`; CI воспроизводит байт-в-байт.
- [ ] Тест-план §4 полностью зелёный (guard-кромки, charset, инъективность, независимость, lifecycle, регресс).
- [ ] README + `specs/v1.0.md` §3 + CHANGELOG rc.9 + примечание в BL-55.
- [ ] Версия `1.0.0-rc.9` (не меняется), один merge в main, CI Node 22 + браузерный прогон.
- [ ] App-паттерны (§7) вынесены в задачу `specs/tz-states-app.md` — отдельным ТЗ, вне rc.9.

