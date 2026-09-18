# ЗАДАНИЕ: Iteration D2 — Argon2id (kdf/argon2) + validation + хвосты D1

Проект: packages/crypto, ветка crypto-0.1.0. Состояние: 58 тестов
зелёных, tsc/build чистые, пять коммитов D1.

Цель: Argon2id KDF (парольные сценарии), валидационные утилиты
(seed + password), чистка мелких хвостов D1.

## ЖЕЛЕЗНЫЕ ПРАВИЛА

1. ИЗМЕНЕНИЕ packages/core РАЗРЕШЕНО РОВНО В ОДНОМ ПУНКТЕ (T2.3):
   замена validateSeedPhrase на расширенную реализацию. Всё остальное
   в core/react — НЕ трогать. После T2.3: полный прогон pnpm -r test —
   core 186+, react 287+ должны остаться зелёными. Если какой-то
   существующий тест core упал — T2.3 откатывается, в NOTES.md
   SPEC-MISMATCH, замена переносится в next-версию core.
2. Инвариант headless: ноль react-импортов, ноль 'node:*' в src/.
3. НОВАЯ РАЗРЕШЁННАЯ ЗАВИСИМОСТЬ: hash-wasm (dependencies — это
   runtime-пакет, не dev!). Версия: последняя стабильная (^7.x).
   Никаких других новых зависимостей.
4. Первая строка каждого нового/изменённого файла — path-comment.
5. TSDoc-стандарт D1 (полное описание + Security-блок «почему такие
   параметры» + @example). Безопасность-блоки для Argon2 — обязательны.
6. Комментарии английские. Несовпадение — NOTES.md SPEC-MISMATCH.
7. Команды pnpm.

## ⚠️ ARGON2ID — КРИПТОГРАФИЧЕСКИЕ ТРЕБОВАНИЯ (читать до старта)

- hash-wasm — WASM-реализация, работает в браузере И Node.js (двойное
  окружение, как весь пакет).
- Argon2id — гибрид Argon2i (side-channel resistance) + Argon2d
  (GPU-resistance). Это рекомендованный RFC 9106 вариант.
- Параметры по умолчанию: OWASP-рекомендация для интерактивной
  аутентификации: t=3 (iterations), m=65536 KiB (64 MiB), p=1
  (parallelism), hashLength=32. Для cloud-backup (пароль защищает
  seed!) — рекомендация повышенная: m=262144 (256 MiB). Оба профиля —
  именованные константы.
- Salt: минимум 16 байт, recommended 16 (RFC 9106) или 32. Fresh salt
  на каждое хеширование.
- hash-wasm возвращает Uint8Array при outputType: 'binary'.

---

## T1 — src/kdf/argon2.ts

    // packages/crypto/src/kdf/argon2.ts

    import { argon2id } from 'hash-wasm';
    import { randomBytes } from '../utils/binary.js';
    import { throwCryptoError } from '../errors.js';

    /**
     * Named Argon2id profiles for different security scenarios.
     *
     * ─────────────────────────────────────────────────────────────
     * Why two profiles?
     * ─────────────────────────────────────────────────────────────
     *
     * INTERACTIVE (t=3, m=64 MiB): OWASP recommended minimum for
     * password authentication where users log in frequently. Latency
     * ~100-300ms on modern hardware.
     *
     * SENSITIVE (t=3, m=256 MiB): for scenarios where the password
     * protects HIGH-VALUE material — e.g. encrypting a seed phrase
     * for cloud backup. Latency ~1s. An attacker brute-forcing an
     * offline-stolen envelope faces 4× the memory cost per guess,
     * which multiplies GPU/ASIC attack costs dramatically.
     */
    export const ARGON2_PROFILES = {
      INTERACTIVE: { iterations: 3, memorySizeKiB: 65536, parallelism: 1, hashLength: 32 },
      SENSITIVE:   { iterations: 3, memorySizeKiB: 262144, parallelism: 1, hashLength: 32 },
    } as const;

    export type Argon2Profile = keyof typeof ARGON2_PROFILES;

    export interface Argon2Options {
      /** Named profile: INTERACTIVE (default) or SENSITIVE. */
      profile?: Argon2Profile;
      /** Explicit overrides (rare — prefer profiles). */
      overrides?: { iterations?: number; memorySizeKiB?: number;
                    parallelism?: number; hashLength?: number };
    }

    /**
     * Derives a key from a human password using Argon2id (RFC 9106,
     * hybrid mode — side-channel AND GPU resistant).
     *
     * ─────────────────────────────────────────────────────────────
     * When to use THIS vs hkdf()?
     * ─────────────────────────────────────────────────────────────
     *
     * - argon2id(): the input is a HUMAN PASSWORD (low entropy,
     *   dictionary-attackable). Slow KDF is the point — it makes
     *   offline brute-force expensive.
     * - hkdf(): the input is HIGH-ENTROPY material (derived from a
     *   seed or another key). Fast KDF is correct — there is nothing
     *   to brute-force.
     *
     * Using hkdf() for passwords or argon2id() for key material is a
     * design error: one wastes user time, the other invites
     * brute-force.
     *
     * ─────────────────────────────────────────────────────────────
     * Salt rules
     * ─────────────────────────────────────────────────────────────
     *
     * - FRESH random salt (≥16B) for every new encryption. NEVER
     *   reuse a salt across envelopes.
     * - The salt is NOT secret — store it alongside the envelope.
     * - generateArgon2Salt() produces a compliant salt.
     *
     * @param password - The human password. NFKC-normalized internally.
     * @param salt - ≥16 random bytes. Generate via generateArgon2Salt()
     *   for new envelopes; reuse the stored salt for verification.
     * @param options - Profile or explicit overrides.
     * @returns Derived key material (default 32B) for importAeadKey().
     * @throws {CryptoError} 'KDF/DERIVATION_FAILED' if hash-wasm fails
     *   or params are invalid (salt < 16B, memorySizeKiB < 8 × parallelism,
     *   iterations < 1).
     *
     * @example
     * ```ts
     * // Encrypting a seed backup with a password:
     * const salt = generateArgon2Salt();
     * const key = await deriveKeyArgon2id(userPassword, salt,
     *   { profile: 'SENSITIVE' });
     * const aeadKey = await importAeadKey(key);
     * const { ciphertext, iv } = await encryptAead(aeadKey, seedBytes);
     * // persist: { salt (b64), iv (b64), ciphertext (b64), profile }
     * ```
     */
    export async function deriveKeyArgon2id(
      password: string,
      salt: Uint8Array,
      options: Argon2Options = {}
    ): Promise<Uint8Array>

    /** Generates a fresh Argon2-compliant salt (32 random bytes). */
    export function generateArgon2Salt(): Uint8Array

Реализация deriveKeyArgon2id:
1. Валидация: salt.length >= 16 → иначе CryptoError
   ('KDF', 'INVALID_SALT'); password.length > 0 → иначе CryptoError
   ('KDF', 'INVALID_PARAMETERS').
2. Профиль или overrides (overrides применяются ПОСЛЕ профиля, каждый
   override перекрывает своё поле).
3. password.normalize('NFKC') перед передачей в hash-wasm.
4. await argon2id({ password, salt, iterations, memorySize,
   parallelism, hashLength, outputType: 'binary' }).
5. Обёртка ошибок: try/catch → CryptoError('DERIVATION_FAILED', 'KDF').

Тест test/kdf/argon2.spec.ts:
⚠️ Тесты Argon2 медленные (SENSITIVE = ~1s на хеширование). Для юнит-
   скорости используйте SENSITIVE ОДИН раз, INTERACTIVE — в остальных
   тестах, и ОДИН уменьшенный профиль через overrides
   ({ iterations: 1, memorySizeKiB: 8192 }) для pure-юнит кейсов.
Тесты:
- roundtrip: deriveKeyArgon2id(pw, salt) дважды с теми же входами →
  равные ключи (детерминизм)
- разные salt → разные ключи
- разные password → разные ключи
- profile SENSITIVE ≠ INTERACTIVE на тех же входах
- overrides работают: { iterations: 1, memorySizeKiB: 8192 } → быстрый
  вызов
- salt < 16B → CryptoError INVALID_SALT
- пустой password → CryptoError INVALID_PARAMETERS
- NFKC: password '\uFB01le' (ﬁle лигатура) и 'file' → ОДИНАКОВЫЙ ключ
- generateArgon2Salt: длина 32, два вызова разные
- (один тест) SENSITIVE-профиль реально работает: deriveKeyArgon2id
  с profile: 'SENSITIVE' возвращает 32B (это тест займёт ~1s — приемлемо)

---

## T2 — validation/

### T2.1 — src/validation/seed.ts (унифицированная валидация)

    // packages/crypto/src/validation/seed.ts

    export interface SeedValidationResult {
      isValid: boolean;
      error?: string;
      wordCount: number;
      invalidWords: string[];   // какие слова не в wordlist (UX для UI)
    }

    export function normalizeSeedPhrase(sp: string | string[]): string[]
    export function validateSeedPhrase(words: string[]): SeedValidationResult

Логика (взять ЛУЧШЕЕ из BeSafeChat validation.ts — версия с
invalidWords и wordCount 12|24):
- normalizeSeedPhrase: split по /\s+/, lowercase, trim, filter пустых
- validateSeedPhrase: wordCount 12|24 → иначе invalid;
  каждый word в wordlist (@scure/bip39 english) → invalidWords
  собираются ВСЕ; validateMnemonic → checksum
- ВАЖНО: валидация НЕ зависит от сети и не импортирует react

Тест test/validation/seed.spec.ts:
- валидная фраза (генерировать generateSeedPhrase из core) → valid
- невалидное слово → invalid + invalidWords содержит его
- битая checksum (валидные слова, переставить два) → invalid
- 13 слов → invalid c wordCount=13
- normalize: '  ABANDON   abandon ' → ['abandon', 'abandon']

### T2.2 — src/validation/password.ts

Перенос из BeSafeChat utils/validation.ts С ПРАВКАМИ:

- validatePasswordStrength(password): Promise<PasswordValidationResult>
  — перенос ДОСЛОВНО логики (7 чеков: длина≥14, 4 типа символов,
  уникальность≥12, повторы, последовательности, common-словарь,
  энтропия≥80 бит, HIBP k-anonymity)
- generateSecurePassword(length=16): string — перенос (гарантированные
  2 символа каждого типа + Fisher-Yates)
- quickPasswordValidation(password): { isValid, error? } — перенос
- checkPasswordLeak — ВНУТРЕННЯЯ (не экспортировать из index),
  с TSDoc: k-anonymity (первые 5 hex SHA-1), таймаут-защита через
  AbortController (3s), fail-open (ошибка сети → false, не блокирует
  пользователя)
- COMMON_PASSWORDS: заменить русские записи ('пароль', 'любовь',
  'ангел', 'привет') на их английские эквиваленты + добавить
  'password1', 'qwerty123' (список неполон без них)

Типы (в тот же файл или types.ts):
    export interface PasswordValidationResult {
      score: number; maxScore: number; isSecure: boolean;
      feedback: string[]; suggestions: string[];
      entropy: number; uniqueChars: number; isLeaked: boolean;
    }

Тест test/validation/password.spec.ts:
⚠️ HIBP-тест — МОКАТЬ (vi.stubGlobal fetch), сеть в юнит-тестах запрещена:
- сильный пароль → isSecure true, score высокий
- 'password123!' → isSecure false, feedback не пуст
- последовательность 'abcdefgh1!' → feedback про sequential
- энтропия низкая ('aaaaaaaaaaaaaa!') → feedback про entropy
- HIBP: мок fetch возвращает суффикс → isLeaked true
- HIBP: мок fetch reject → isLeaked false (fail-open)
- generateSecurePassword: длина, минимум 2 символа каждого типа,
  два вызова разные

### T2.3 — packages/core/src/seed.ts: замена validateSeedPhrase

(ЕДИНСТВЕННОЕ разрешённое изменение core — см. Железное правило 1)

Найти в packages/core/src/seed.ts текущую реализацию
validateSeedPhrase (wordCount !== 12 && !== 24 → error; wordlist
includes; validateMnemonic) и ЗАМЕНИТЬ на расширенную версию:

    export interface SeedValidationResult {
      isValid: boolean;
      error?: string;
      wordCount: number;
      invalidWords: string[];
    }

    export function validateSeedPhrase(words: string[]): SeedValidationResult {
      const normalized = normalizeSeedPhrase(words);
      const invalidWords: string[] = [];
      for (const word of normalized) {
        if (!wordlist.includes(word)) invalidWords.push(word);
      }
      if (normalized.length !== 12 && normalized.length !== 24) {
        return { isValid: false,
                 error: `Seed phrase must be 12 or 24 words, got ${normalized.length}`,
                 wordCount: normalized.length, invalidWords };
      }
      if (invalidWords.length > 0) {
        return { isValid: false,
                 error: `Invalid words found: ${invalidWords.join(', ')}`,
                 wordCount: normalized.length, invalidWords };
      }
      const isValid = validateMnemonic(normalized.join(' '), wordlist);
      return { isValid, error: isValid ? undefined : 'Invalid seed phrase checksum',
               wordCount: normalized.length, invalidWords: [] };
    }

ВАЖНО: normalize ДО подсчёта слов (существующий баг H2 из давнего
анализа: подсчёт ДО нормализации ломает фразы с пустыми словами).
Порядок чеков: length → invalidWords → checksum (информативнее).

ВАЖНО: тип возврата МЕНЯЕТСЯ с {isValid, error?} на SeedValidationResult
(добавляются поля) — это ADDITIVE breaking, существующие вызовы
(validation.isValid) продолжают работать. Экспортировать тип из core
index.ts.

Проверка: ВСЕ существующие тесты core и react, использующие
validateSeedPhrase, должны остаться зелёными. Если упали — SPEC-MISMATCH.

### T2.4 — экспорты

packages/crypto/src/index.ts — добавить:
    export { validateSeedPhrase, normalizeSeedPhrase,
             type SeedValidationResult } from './validation/seed.js';
    export { validatePasswordStrength, generateSecurePassword,
             quickPasswordValidation, type PasswordValidationResult }
      from './validation/password.js';
    export { ARGON2_PROFILES, deriveKeyArgon2id, generateArgon2Salt,
             type Argon2Options, type Argon2Profile } from './kdf/argon2.js';
    export type { Argon2Params } from './kdf/argon2.js';  // если введёте тип

packages/core/src/index.ts — добавить type SeedValidationResult
(рядом с validateSeedPhrase).

---

## T3 — чистка хвостов D1

### T3.1 — packages/crypto/src/core/hkdf.ts
Докстринг hkdf(): найти незакрытую скобку/незавершённое предложение:
"(NOT the PBKDF2-based workaround used in some" → дописать "libraries)."

### T3.2 — packages/crypto/test/core/hkdf.spec.ts
Удалить мёртвую переменную TC1_IKM (18-байтовую, артефакт самокоррекции
— рабочая TC1_IKM_FIXED остаётся).

### T3.3 — packages/crypto/package.json: добавить скрипт

    "build-docs": "typedoc"

и в devDependencies: "typedoc": "^0.26.11" (та же версия, что в корне).
Создать packages/crypto/typedoc.json (скопировать структуру из
packages/core/typedoc.json, поправить entryPoint на src/index.ts,
outDir относительно — Cloudflare-проект me2em-docs-crypto соберёт сам).
Проверить: pnpm --filter @me2em/crypto build-docs → docs/ без ошибок.
⚠️ Если в typedoc.json из core есть только entryPoints/OUT — скопировать
и адаптировать. Если typedoc-конфиг в корне общий — использовать его
механику, отметив в отчёте.

### T3.4 — packages/core: identity-context мелочь? НЕТ — это crypto.
В packages/crypto/src/kdf/hash-identity.ts: добавить валидацию
identityId (непустая строка, длина ≤ 256) → CryptoError
('KEY', 'INVALID_PARAMETERS'). Тест: пустой identityId → throw;
identityId.length > 256 → throw.

---

## КОММИТЫ (порядок)

1. `feat(crypto): Argon2id KDF with named security profiles (hash-wasm)`
2. `feat(crypto): validation utilities — seed, password strength, HIBP`
3. `feat(core): enhanced SeedValidationResult with invalidWords`
4. `chore(crypto): typedoc setup, D1 cleanup (dead vector, docstring fix)`
5. `docs(crypto): README update for D2 modules`

## КРИТЕРИИ ПРИЁМКИ

1. pnpm --filter @me2em/crypto test — все зелёные.
   Ожидание: 58 + ~10 (argon2) + ~8 (seed) + ~7 (password) = ~83.
2. pnpm -r test — core и react НЕ сломаны (T2.3 additive).
   Ожидание: core 187+ (1 новый тест wordlist уже был; validateSeedPhrase
   тесты старые должны пройти на новой реализации), react 287.
3. typecheck/build всех трёх пакетов — чисто.
4. pnpm --filter @me2em/crypto build-docs — генерирует docs/ без ошибок.
5. grep -rn "from 'react'" packages/crypto/src/ → пусто.
6. hash-wasm — в dependencies (не dev) packages/crypto/package.json.
7. Коммиты 1-5 в порядке.

## ОТЧЁТ

Файлы, тесты по пакетам (core/react/crypto отдельно), вывод pnpm -r test,
build-docs результат, NOTES.md (SPEC-MISMATCH: T2.3 реакции существующих
тестов core на новую реализацию validateSeedPhrase — если были),
подтверждение: hash-wasm в dependencies.