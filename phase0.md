
Ты — разработчик в VSCode с расширением KiloCode. Твоя задача — точно
реализовать спецификацию ниже. Все архитектурные решения ПРИНЯТЫ.
Не проектируй заново, не улучшай, не рефактори за пределами указанного.
Если что-то не описано — делай минимальным способом, не вводя новых
абстракций.

## ЖЕЛЕЗНЫЕ ПРАВИЛА

1. НЕ менять строковые константы DERIVATION_PATHS (identity, handle,
   subhandle) — это протокольные идентификаторы.
2. НЕ трогать файлы seed.ts и методы derivePassword, deriveChannelKey,
   deriveSharedSecret в handle.ts.
3. НЕ добавлять npm-зависимости, кроме dev-зависимости vitest
   (если тест-раннера в проекте нет; если есть — использовать его).
4. Не менять существующие тесты под сломанную реализацию. Если тест
   падает — чинить реализацию, а не тест.
5. После КАЖДОЙ фазы: прогнать тесты + `npx tsc --noEmit`, затем
   коммит с сообщением `feat(attestation): phase N — <описание>`.
6. Работать строго по фазам, в порядке 0 → 4. Не начинать фазу N+1
   до зелёных тестов фазы N.

## СТРУКТУРА ПРОЕКТА (существующая)

src/
  identity.ts         — класс Identity (корень, HKDF-деривация)
  handle.ts           — класс Handle
  subhandle.ts        — класс SubHandle extends Handle
  session.ts          — класс Session (create / verifyStateless)
  seed.ts             — BIP39 утилиты
  crypto/derivation-paths.ts
  crypto/init.js      — экспорт `ed` (@noble/curves)

---

## ФАЗА 0 — Prérequis (обязательная подготовка)

### 0.1 Новый файл src/util.ts

Перенести сюда base64urlEncode и base64urlDecode из session.ts
(реализации скопировать как есть). session.ts должен импортировать их
отсюда и удалить локальные копии.

### 0.2 Новый файл src/canonical-name.ts

```typescript
export const NAME_PATTERN = /^[a-z0-9][a-z0-9._@-]{0,62}$/;

export function normalizeName(raw: string): string {
  if (typeof raw !== 'string') throw new TypeError('Name must be a string');
  const name = raw.normalize('NFKC').toLowerCase().trim();
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid name: ${JSON.stringify(raw)}`);
  }
  return name;
}
```

Требование: символ '/' ЗАПРЕЩЁН паттерном — это критично (разделитель
путей деривации). Не «исправляй» паттерн.

### 0.3 Правки crypto/derivation-paths.ts

Заменить внутреннюю функцию normalize на:

```typescript
import { normalizeName } from '../canonical-name.js';
function assertCanonical(name: string): string {
  const canonical = normalizeName(name);
  if (name !== canonical) {
    throw new Error(`Name must be pre-normalized, got: ${JSON.stringify(name)}`);
  }
  return canonical;
}
```

и использовать assertCanonical в handle() и subhandle().
Строковые литералы путей НЕ менять.

### 0.4 Правки identity.ts

- В deriveHandle и deriveSubHandle: первым делом
  `name = normalizeName(name)` (и handleName, и subName),
  дальше использовать ТОЛЬКО нормализованные значения —
  в DERIVATION_PATHS, в new Handle(..., name), в path.
  Дублирующие .toLowerCase().trim() в конструировании path — удалить
  (нормализация теперь происходит один раз, выше).
- Убрать Buffer.from(seed, 'hex'): реализовать локально

```typescript
function parseHexSeed(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('Seed string must be 64 hex characters');
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
```

### 0.5 Правки handle.ts

- deriveSubHandle: нормализовать вход через normalizeName первым делом;
  удалить ручной .toLowerCase().trim() при конструировании path.
- РАЗРЫВ circular import: заменить value-import SubHandle на
  type-only + динамический импорт внутри метода:

```typescript
import type { SubHandle, SubHandleMetadata } from './subhandle.js';
// ...внутри deriveSubHandle:
const { SubHandle: SubHandleClass } = await import('./subhandle.js');
// ...return new SubHandleClass(subKey, name, path, metadata);
```

- Добавить no-op метод (полиморфная валидация):

```typescript
validateSessionOptions(_options: {
  audience: string; scopes: string[]; ttl: number;
}): void { /* Handle без ограничений */ }
```

### 0.6 Правки subhandle.ts

- Конструктор: assert `path[1] === name` (после нормализации), иначе throw.
- Override: `async deriveSubHandle(): Promise<never> { throw new Error('SubHandle is a leaf (MAX_DEPTH=2)'); }`
- validateSessionOptions оставить как есть (override родителя уже существует).

### 0.7 Правки session.ts

- В SessionPayload добавить `iat: number` (Unix sec, обязательное).
- Session.create: payload.iat = now.
- verifyStateless:
  - required-fields проверка включает iat;
  - УДАЛИТЬ FUTURE_WINDOW_SECONDS и проверку minExpiry;
  - вместо неё: `if (now < payload.iat - CLOCK_SKEW_SECONDS) throw new Error('Token is future-dated');`
- Заменить обе конструкции `handle instanceof SubHandle` на полиморфный вызов:

```typescript
// в create — вместо if (handle instanceof SubHandle) {...}:
handle.validateSessionOptions(options);
// hPath добавлять по наличию: if (payload.hPath) {...}
```
  (требуется геттер/метод: SubHandle уже имеет getPath(); для проверки
  «это SubHandle?» использовать `handle instanceof SubHandle` ТОЛЬКО
  через type-only import + dynamic import, либо проще: добавить в Handle
  метод `getPath(): string[] | undefined { return undefined; }`,
  переопределённый в SubHandle. Выбрать этот вариант — геттер.)

- После реконструкции хэндла в verifyStateless добавить сверку:
  `if (handle.getId() !== payload.hId) throw new Error('hId mismatch');`

### Тесты Фазы 0 (файл test/phase0.test.ts)

1. normalizeName: 'Station-001' → 'station-001'; NFD-вариант 'café'
   равен NFC-варианту; 'a/b' → throw; 'a'.repeat(64) → throw; '' → throw.
2. deriveHandle('Station-001') и deriveHandle('station-001') дают
   ОДИНАКОВЫЙ getPublicKey().
3. identity.deriveSubHandle('S','X') === handle.deriveSubHandle('x')
   с теми же именами → одинаковый pubkey.
4. subhandle.deriveSubHandle('anything') → throws.
5. Session.create с ttl=86400 → verifyStateless проходит СРАЗУ
   (не отклоняется как future-dated).
6. Тамперинг payload → 'Invalid signature...'.