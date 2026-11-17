# ТЗ `@me2em/react` v1.1 — задача 2: флоу «seed → handle → Solana-кошелёк» (финальное)

> **Ветка реализации:** `feat/react-v11-train` (базис `dd00933`, `@me2em/react` 1.1.0).
> **Статус базиса:** BL-48 (`DISCARD_SEED`) и BL-50 (структурные ошибки флоу и хуков) уже
> реализованы в этом базисе — задача 2 строит поверх них, ничего из них не переписывая.
> **Прототип-эталон:** `packages/demo/demo.ts` (локальный scratch, НЕ коммитится) —
> последовательность S1→S7 проверена вручную; задача 2 формализует S1–S4 + S7 в react-флоу.
> **Связанные документы:** `specs/tz-x402.md` (слои, конвенции), `specs/v1.0.md` §7.2
> (match on `code`, not on `message`), Документ 2 v1.2 §4.1 (SolanaWalletTree), §2.2
> (аллокация индексов), §6 (wallet-binding).

---

## 0. Принципы

### 0.1. React — композиция, не криптография

Флоу не добавляет ни одной новой криптографической операции. Единственные
разрешённые импорты из пакетов Me2eM: `@me2em/core` (сид, Identity, Handle,
ошибки), `@me2em/solana` (SolanaWalletTree, nextPaymentIndex, сети,
isValidSolanaAddress), `@me2em/crypto` (secureWipe). Вся деривация — вызовы
существующих функций; react-слой только упорядочивает их, хранит состояние и
мапит ошибки.

### 0.2. Секреты не живут в React-состоянии

`privateKey` из `SolanaDerivedWallet` **никогда** не попадает ни в состояние
редьюсера, ни в возвращаемое значение хука, ни в замыкания, живущие дольше
одного вызова: `deriveNext()` извлекает адрес и путь и сразу wipe'ит ключ
(`secureWipe`). Дерево (`SolanaWalletTree`) — единственный долгоживущий
носитель секретов; оно хранится в ref, не в state, и уничтожается `dispose()`.

### 0.3. Все параметры — из артефактов

Адрес, путь и индекс возвращаются только из `deriveWallet`/`nextIndex` —
приложение не собирает `m/44'/501'/…'` строками и не вычисляет адреса само.
Единственное, что приложение поставляет — persisted `usedPaths` (источник
истины по v1.2 §2.2: пути из attestation `subjectWalletPath`, которые
пережили рестарт).

### 0.4. Fail-closed и структурные ошибки

Ошибки — по контракту BL-50: `Me2emFlowError { code, message }`, матчинг по
`code`. `TypeError` (нарушение программного контракта core/solana: не-64Б
сид, не-числовой индекс) **пробрасывается** — это ошибка программиста, а не
данные; глотать его — значит маскировать баг. `AttestationError` и
`DisposedError` мапятся в структурные коды (§4.1).

### 0.5. Dispose-паритет (паттерн BL-47)

Каждый async-результат имеет поколение (generation counter): результат,
прилетевший после `reset()`, unmount или повторного `start()`, отбрасывается,
а его материальные ресурсы — wipe'ятся. `dispose()` никогда не вызывается
внутри state updaters (StrictMode double-invoke); ref мутируется только в
event handlers и cleanup effects.

---

## 1. Границы пакета

### 1.1. Входит

| Артефакт | Назначение |
|---|---|
| `src/headless/wallet-flow.ts` | Чистый редьюсер флоу + `initialWalletFlowState` (паттерн `identity-flow.ts`) |
| `src/headless/types.ts` | Новые типы: `WalletFlowState/Event/Status`, `WalletEntry`, расширение `Me2emFlowErrorCode` |
| `src/react/useSolanaWalletFlow.ts` | Хук: владеет деревом в ref, generation counter, маппинг ошибок |
| `test/headless/wallet-flow.spec.ts` | Редьюсер: все переходы, unexpected-events, инварианты |
| `test/react/useWalletFlow.spec.tsx` | Хук: деривация, гигиена, гонки, golden-векторы |
| README-раздел + CHANGELOG | Раздел «Solana wallet flow» в `packages/react/README.md`; запись в CHANGELOG 1.1.0 |
| exports | Реэкспорт новых типов и редьюсера в `src/headless/index.ts` и хука в `src/react/index.ts` |

### 1.2. Не входит

- **x402-хуки** — `tz-x402.md` §9.8 («React-хуки — вне»). Хук отдаёт `tree`,
  приложением из которого собирается `SolanaX402Signer` (пример — §8.2).
- Solana Pay URI / `createPaymentRequestURL` — приложение (demo S6).
- RPC (`getRecentBlockhash`) — приложение (demo S5: инъекция).
- Персистенция `usedPaths` (IDB/localStorage) — приложение; flow принимает
  пути параметром и возвращает новый путь наружу (v1.2 §2.2: «caller
  persists the used paths»).
- EVM и любые другие цепи — только Solana (`@me2em/solana`).
- Визуальные компоненты (SeedPhrase*, PassphraseInput) — не изменяются.

### 1.3. Зависимости

`@me2em/solana` добавляется в `packages/react/package.json` в тот же блок, где
объявлен `@me2em/core` (workspace-зависимость, та же семвер-политика, что у
core). Peer-версии не меняются: `react >=18.0.0`.

---

## 2. Базис: контракты, на которых строится флоу

Проверено по исходникам на базисе; при расхождении — исходник выигрывает, в
ТЗ поднимается правка.

| Контракт | Факт |
|---|---|
| `generateSeedPhrase(128 \| 256)` | 12 или 24 слова; промежуточные силы не exposed |
| `validateSeedPhrase(words)` | `{ isValid, error?, wordCount, invalidWords[] }`; порядок: длина → словоформа → checksum |
| `get64ByteSeedFromMnemonic(words, passphrase='')` | 64-байтный BIP39-сид; `AttestationError('MALFORMED','FORMAT')` на невалидную фразу; NFKD — внутри `@scure/bip39`; passphrase невосстановим (другая фраза → другой сид молча) |
| `Identity.fromSeed(seed)` | Ровно 64 байта (или 128 hex-символов), иначе `MALFORMED/FORMAT` |
| `identity.deriveHandle(name)` | NFKC → lowercase → trim, паттерн `^[a-z0-9][a-z0-9._@-]{0,62}$`; детерминирован |
| `handle.bindWallet(descriptor)` / `getWallet(chain)` | in-memory (WeakMap), не персистится; после рестарта приложение перепривязывает |
| `WalletDescriptor` | `{ chain: CAIP-2, address, derivationPath?, label? }` — descriptor копируется при bind |
| `SolanaWalletTree.fromSeed(seed)` | Ровно 64 байта, тот же сид, что у `Identity.fromSeed` (v1.2 §4.1); seed не ретейнится; `TypeError` иначе |
| `tree.deriveWallet(index)` | `m/44'/501'/{index}'/0'` → SLIP-0010 ed25519 → base58; возвращает `{ address, privateKey, derivationPath }`; `privateKey` — fresh buffer, **обязан** быть wipe'нут вызывающим; `TypeError` если index не safe integer 0..2^31−1 |
| `tree.nextIndex(usedPaths)` / `nextPaymentIndex(paths)` | max(индексы)+1; распознаёт канон 4-уровневый (`m/44'/501'/N'/0'`) и 3-уровневый «phantom» (`m/44'/501'/N'`); padded (`00`) игнорирует; дыры не переиспользуются; работает после `dispose()` |
| `tree.dispose()` | обнуляет мастер-материал; idempotent; после — `DisposedError` (code `DISPOSED`) на key-методах, `nextIndex` продолжает работать |
| `SolanaNetwork` | `mainnet-beta \| devnet \| testnet \| localnet`; CAIP-2 ключ — `solana:${network}`, без алиасов |
| `isValidSolanaAddress(s)` | base58 из 32 байт — проверка формы адреса |
| `secureWipe(buf)` / `secureWipeMultiple(...bufs)` | `@me2em/crypto`; zeroize буферов |
| Ошибки | `AttestationError` с `code` (core-коды), `DisposedError` (code `DISPOSED`), bare `TypeError` — программист |
| Me2emFlowError (BL-50, базис) | `{ code, message }`; коды: `GENERATE_FAILED \| INVALID_WORDS \| DERIVATION_FAILED \| ACTIVATION_FAILED \| APP_FAILURE` |
| `IdentityFlowState.identitySeed` (BL-48) | ретейнится в `'verified'/'imported'` **by design** — источник сида для этого флоу; `DISCARD_SEED` nulls его, когда приложение решило |

---

## 3. Дизайн флоу

### 3.1. Жизненный цикл (сквозной сценарий)

```
identity-flow: GENERATE/IMPORT → CONFIRM_WORDS → статус 'verified'/'imported'
                                     │ identitySeed ещё в состоянии (BL-48)
                                     ▼
useSolanaWalletFlow.start(seed) ──► SolanaWalletTree.fromSeed(seed) в ref
                                     │
              deriveNext() ──► nextIndex(usedPaths ∪ session paths)
                             └► deriveWallet(index) ──► { address, derivationPath }
                             └► secureWipe(privateKey)   ← немедленно
                             └► wallets[] += entry
                                     │
              bind(handle) ──► handle.bindWallet({chain: 'solana:<network>',
                                                address, derivationPath, label?})
                                     │
identity-flow: dispatch DISCARD_SEED ← приложение решает (BL-48)
                                     │
              reset() / unmount / identity swap ──► tree.dispose(), tree = null
```

### 3.2. Редьюсер: состояния и события

Состояния: `'idle' | 'ready' | 'deriving' | 'error'`.
События: `START`, `WALLET { entry }`, `FAIL { code, message }`, `RESET`
(обе формы `START`/`FAIL` согласованы с §4.1: `START` не несёт сида,
`FAIL` — всегда структурный).

| Из \ Событие | `START` | `WALLET` | `FAIL` | `RESET` |
|---|---|---|---|---|
| `idle` | → `ready` | warn, no-op | → `error` | warn, no-op |
| `ready` | (см. §5.к10) | → `ready`, wallets += entry | → `error` | → `idle` |
| `deriving` | warn, no-op | → `ready`, wallets += entry | → `error` | → `idle` |
| `error` | → `ready` (новая попытка после исправления) | warn, no-op | → `error` (замена) | → `idle` |

`WalletFlowState`: `{ status, wallets: readonly WalletEntry[], error: Me2emFlowError | null }`.
`WalletEntry`: `{ index: number, address: string, derivationPath: string }` —
никаких ключей (§0.2). Unexpected-события — `console.warn` + no-op (паттерн
`identity-flow.ts`); редьюсер — чистая функция, диспатчит только хук.

### 3.3. Инварианты

1. **Append-only `wallets[]`** — выведенный кошелёк не редактируется и не
   удаляется до `RESET`.
2. **Индексы без коллизий** — `deriveNext()` планирует от
   `nextIndex([...usedPaths приложения, ...paths выведенных в сессии])`;
   сессия не должна перевыводить уже выведенное.
3. **Одно дерево на флоу** — повторный `start(seed)` сначала dispose'ит
   прежнее дерево (§5.к10); дерево создаётся только в `start()`.
4. **Wipe сразу** — `privateKey` wipe'ится в том же кадре, где получен; в
   отброшенных гонкой результатах — wipe до отбрасывания (§5.к6).

---

## 4. API

### 4.1. Типы (`src/headless/types.ts`)

**Breaking:** `Me2emFlowErrorCode` расширяется тремя значениями —
пометка `**Breaking:**` в CHANGELOG (конвенция tz-x402 §0.6):

```ts
export type Me2emFlowErrorCode =
  | 'GENERATE_FAILED' | 'INVALID_WORDS' | 'DERIVATION_FAILED'
  | 'ACTIVATION_FAILED' | 'APP_FAILURE'        // базис dd00933
  | 'NO_SEED'          // start() без сида — identitySeed уже отброшен (BL-48)
  | 'INVALID_NETWORK'  // параметр network не входит в SolanaNetwork
  | 'DISPOSED';        // дерево/идентити dispose'нуты mid-flight (pass-through core-кода)
```

```ts
export interface WalletEntry {
  readonly index: number;          // Solana payment index (0..2^31−1)
  readonly address: string;        // base58, 32 байта
  readonly derivationPath: string; // 'm/44'/501'/{index}'/0''
}

export type WalletFlowStatus = 'idle' | 'ready' | 'deriving' | 'error';

export interface WalletFlowState {
  readonly status: WalletFlowStatus;
  readonly wallets: readonly WalletEntry[];
  readonly error: Me2emFlowError | null;
}

export type WalletFlowEvent =
  | { type: 'START' }
  | { type: 'WALLET'; entry: WalletEntry }
  | { type: 'FAIL'; code: Me2emFlowErrorCode; message: string }
  | { type: 'RESET' };
```

Событие `START` **не несёт сид** (§0.2): сид передаётся аргументом метода
`start()`, редьюсер его не видит и не хранит; событие только переключает
статус. `FAIL` повторяет форму базиса (BL-50).

### 4.2. Редьюсер (`src/headless/wallet-flow.ts`)

`walletFlowReducer(state, event): WalletFlowState` + `initialWalletFlowState`
— чистые, по образцу `identity-flow.ts`: switch по статусу, unexpected →
`console.warn` + no-op, без побочных эффектов. Весь генеративный код (дерево,
wipe) — в хуке, не в редьюсере.

### 4.3. Хук `useSolanaWalletFlow`

```ts
export interface UseSolanaWalletFlowParams {
  /** Обязательная сеть — без дефолта (деньги; см. register.ts: прод-дефолт mainnet-beta — решение приложения). */
  network: SolanaNetwork;
  /** Персистированные пути (attestation subjectWalletPath) — источник истины v1.2 §2.2. */
  usedPaths?: readonly string[];
  /** Диагностическая метка в WalletDescriptor при bind(). */
  label?: string;
}

export interface UseSolanaWalletFlowResult {
  status: WalletFlowStatus;
  wallets: readonly WalletEntry[];
  /** Дерево для композиции (например SolanaX402Signer) или null; не для деривации руками. */
  tree: SolanaWalletTree | null;
  error: Me2emFlowError | null;
  start(seed: Uint8Array): void;            // TypeError (не-64Б) пробрасывается — §0.4
  deriveNext(): Promise<WalletEntry | null>;
  bind(handle: Handle): Promise<boolean>;
  reset(): void;
}
```

Семантика:

- `start(seed)` — валидирует `network` (`isSolanaNetwork`, иначе `FAIL
  INVALID_NETWORK`, false-путь без throw); dispose прежнего дерева при
  повторном `start`; `SolanaWalletTree.fromSeed(seed)` в ref; generation++;
  dispatch `START`.
- `deriveNext()` — только из `ready` (из `idle` → `FAIL NO_SEED`; из
  `deriving` → `null` без повторного запуска); dispatch-паттерн: `WALLET` на
  успех, `FAIL { code: 'DERIVATION_FAILED' | 'DISPOSED' }` на отказ;
  `privateKey` wipe немедленно после чтения `address`/`derivationPath`;
  результат после смены поколения — wipe + отброс (`null`).
- `bind(handle)` — `false` если `wallets` пуст или флоу не в `ready`;
  иначе `handle.bindWallet({ chain: 'solana:${network}', address:
  wallets.at(-1).address, derivationPath: wallets.at(-1).derivationPath,
  label })` → `true`; `TypeError` core (пустой chain/address) пробрасывается
  — программист собрал descriptor мимо API.
- `reset()` — dispose дерева, `tree = null`, generation++, dispatch `RESET`.
- Unmount / смена identity в провайдере — cleanup-only dispose (§0.5),
  автоматический `RESET` при identity swap (§5.к7).
- `tree` наружу отдаётся только для композиции с x402-сингнером; вызов
  `tree.deriveWallet` в обход флоу ломает инвариант 3.3.2 — документируется
  в JSDoc как «не используйте для деривации».

### 4.4. Экспорты

`src/headless/index.ts`: `walletFlowReducer`, `initialWalletFlowState`, типы
`WalletFlowState/Status/Event`, `WalletEntry`, расширенный `Me2emFlowErrorCode`.
`src/react/index.ts`: `useSolanaWalletFlow` + типы параметров/результата.

---

## 5. Доп. кейсы (обязательные к реализации и тестам)

| # | Кейс | Ожидаемое поведение |
|---|---|---|
| 1 | 12 и 24 слова | Один и тот же путь без ветвлений: оба дают 64-байтный сид; тест-векторы на обеих длинах (§7.2) |
| 2 | Passphrase («25-е слово») | Применяется ТОЛЬКО на этапе сида (`get64ByteSeedFromMnemonic`, identity-flow); wallet-flow принимает готовый 64Б сид; JSDoc-предупреждение: другая passphrase → молча другие адреса |
| 3 | Импорт существующей фразы (Phantom) | Тот же флоу; `usedPaths` с 3-уровневыми phantom-путями `m/44'/501'/N'` учитываются `nextIndex`; коллизий нет; padded (`00`) не блокируют аллокацию |
| 4 | `usedPaths` пуст/undefined | `index = 0`; дыры в нумерации не переиспользуются (max+1) |
| 5 | `discardSeed()` до `start()` / `start()` из `idle` | `FAIL { code: 'NO_SEED' }`; `RESET` возвращает в `idle` |
| 6 | `reset()`/unmount во время in-flight `deriveNext()` | Результат отбрасывается по generation; `privateKey` wipe ДО отброса; статус после RESET — `idle`; повторная деривация на dispose'нутом дереве → `FAIL { code: 'DISPOSED' }` |
| 7 | Identity swap (`activateIdentity` поверх активной) | Авто-`RESET` флоу (cleanup-only dispose), как dispose-паритет BL-47; сид старого identity больше не деривирует |
| 8 | StrictMode double-invoke | Dispose вне state updaters; ref-мутации только в handlers/effects (паттерн BL-47, F3/R15) |
| 9 | Невалидный `network` | `FAIL { code: 'INVALID_NETWORK' }` до построения дерева; реестр не затронут |
| 10 | Повторный `start(seed2)` при живом дереве | Старое дерево dispose, затем новое; `wallets[]` очищается; статус `ready` |
| 11 | `bind()` без выведенных кошельков | `false`, состояние не меняется; повторный `bind` — перезапись (last-wins контракта core bindWallet) |
| 12 | Детерминизм | Тот же seed + index → byte-identical address/path (golden-векторы §7.2); разные индексы → разные адреса |

---

## 6. Гигиена секретов (R15)

| Материал | Где живёт | Кто чистит | Когда |
|---|---|---|---|
| `identitySeed` (Uint8Array) | state identity-flow (BL-48, by design) | приложение dispatch `DISCARD_SEED` | после успешного `start()` флоу кошелька |
| Мастер-материал дерева | ref хука | `tree.dispose()` в `reset()`/unmount/identity-swap/повторном `start` | см. §5 |
| `privateKey` из `deriveWallet` | локальная переменная `deriveNext()` | `secureWipe` в том же вызове | сразу после чтения адреса/пути |
| Мнемоника (слова) | вне задачи 2 (SeedPhrase*) | — | — |

Zeroing базового буфера сида — обязанность владельца (mixed
caller/library ownership, R6 базиса) — флоу не wipe'ит входной `seed`.

---

## 7. Тест-план и критерии приёмки

### 7.1. Файлы

- `test/headless/wallet-flow.spec.ts` — редьюсер: таблица §3.2 целиком,
  unexpected-events (warn, no-op), чистота редьюсера (одинаковый вход →
  одинаковый выход).
- `test/react/useWalletFlow.spec.tsx` — хук: сценарии §5 (к1–к12),
  golden-векторы (§7.3), generation-гонки, wipe/dispose-гигиена (spy/mock
  `secureWipe`), bind-семантика.

### 7.2. Golden-векторы

Фиксированные тестовые мнемоники (12 и 24 слова; стандартные публичные фразы
класса `abandon…` — **только** тест, никогда не реальные средства):

1. `words12 → seed64 (hex) → wallet[0].address, wallet[1].address`
2. `words24 → seed64 (hex) → wallet[0].address, wallet[1].address`
3. phantom-вектор: `usedPaths = ["m/44'/501'/5'"]` → `nextIndex = 6`.

Значения НЕ выдумывать: зафиксировать фактические значения первого прогона в
`test/fixtures/wallet-flow-vectors.json`, затем повторным прогоном подтвердить
детерминизм (два прогона — byte-identical).

### 7.3. Приёмка

- [ ] Все гейты зелёные: `pnpm -r build / typecheck / lint / test`.
- [ ] Coverage 90/90 по новым файлам (конвенция tz-x402 §6).
- [ ] Редьюсер покрыт таблицей §3.2 (включая warn-ветки).
- [ ] §5: к1–к12 — по тесту минимум.
- [ ] Golden-векторы зафиксированы и повторяемы (§7.2).
- [ ] `privateKey` не появляется в состоянии/экспорте: тест, что `wallets[]`
      и `UseSolanaWalletFlowResult` не содержат ключевого материала.
- [ ] Dispose-паритет: гонки к6 + StrictMode к8 зелёные.
- [ ] `dist-artifact.spec.ts` react-пакета (если отсутствует — добавить по
      образцу `packages/solana/test/dist-artifact.spec.ts`).
- [ ] README: раздел «Solana wallet flow» (жизненный цикл §3.1 + пример
      композиции с `SolanaX402Signer` через `tree`); CHANGELOG 1.1.0: задача 2,
      `**Breaking:**` на расширении `Me2emFlowErrorCode`.

---

## 8. Сценарии сборки

### 8.1. Сценарий по умолчанию (демо react-приложения)

`core` + `react` + `solana`: генерация/импорт фразы → identity-flow →
`useSolanaWalletFlow({ network: 'devnet', usedPaths })` → `deriveNext()` →
`bind(handle)` → `DISCARD_SEED`. Приём платежей — вне флоу (адрес уже есть).

### 8.2. Платёжная композиция (через `tree`, без новых хуков)

```ts
const signer = new SolanaX402Signer({
  tree,                       // из useSolanaWalletFlow().tree
  index: wallets.at(-1).index,
  getRecentBlockhash: () => rpc.getLatestBlockhash(), // приложение
});
```

После `reset()` хука сингнер получает `DisposedError` — приложение
пересобирает его после нового `start()`.

---

## 9. Вне скоупа

1. x402-хуки и `useSession`-интеграция платежей (tz-x402 §9.8).
2. Solana Pay URI / QR (demo S6) — приложение.
3. RPC, blockhash, подтверждение транзакций — приложение.
4. Персистенция `usedPaths` (storage-адаптер, IDB) — приложение; интерфейс
   не абстрагируется в react v1.1 (решение по факту второго потребителя).
5. EVM/другие цепи, мультичейн-флоу.
6. Новые визуальные компоненты и стили.
7. Изменения `@me2em/core` / `@me2em/solana` — задача 2 их не трогает; если
   контракта не хватает — правка в это ТЗ, не в core.

---

## 10. Конвенции (дефолт)

| Параметр | Значение |
|---|---|
| Runtime | Node ≥ 22.6.0; браузеры — те же API |
| Модули | ESM; exports через `src/index.ts` → dist |
| Сборка | tsup (dts), без новых external-исключений |
| Тесты | vitest + coverage-v8 (90/90); fake timers для таймерных тестов |
| Линт/типы | ESLint-конфиг репозитория; TS strict |
| Версия | `@me2em/react` 1.1.0 (трейн v1.1; релиз одной версией после обеих задач) |
| Ошибки | матчинг по `code` (specs/v1.0.md §7.2); `TypeError` — программист (§0.4) |
| Стиль кода | паттерны `identity-flow.ts` / `useImportSeed.ts` базиса; JSDoc с `@experimental`-пометками не нужны (стабильный v1.1) |
| Брендинг | Me2eM (human) / me2em (machine) |
