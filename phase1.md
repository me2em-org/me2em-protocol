# ЗАДАНИЕ: Phase 1 — тип Attestation (новый файл src/attestation.ts)

Ты работаешь в KiloCode над протоколом Me2em (packages/core). Phase 0
завершена: в проекте есть canonical-name.ts (normalizeName), util.ts
(base64urlEncode/base64urlDecode), session.ts с обязательным iat,
106+2 = 108 зелёных тестов, tsc чистый.

Твоя задача — создать модуль аттестаций. Все решения ПРИНЯТЫ.
Не проектируй заново, не улучшай существующие файлы.

## ЖЕЛЕЗНЫЕ ПРАВИЛА

1. НЕ менять существующие файлы, КРОМЕ src/index.ts (только добавление
   экспортов, указано ниже).
2. НЕ менять: seed.ts, DERIVATION_PATHS, derivePassword/deriveChannelKey/
   deriveSharedSecret.
3. НЕ добавлять npm-зависимости.
4. НИКАКОГО Buffer. Только Uint8Array/btoa/atob/TextEncoder.
5. TypeScript-трюк проекта: НЕ разбивай `as SomeType` на отдельную
   строку — парсер oxc падает с PARSE_ERROR. Пиши `expr as T` одной
   строкой.
6. Новый тест-файл: test/attestation.test.ts. Существующие тесты не трогать.
7. После завершения: `pnpm test` + `npx tsc --noEmit`, затем коммит:
   `feat(attestation): phase 1 — attestation type`.
8. Если что-то не совпадает с описанным — создать NOTES.md секцию
   "SPEC-MISMATCH", применить ближайший к смыслу вариант, упомянуть в отчёте.

---

## СПЕЦИФИКАЦИЯ src/attestation.ts

### Константы и типы

export const ATTESTATION_TYPE = 'me2em/attestation/v1';
export const ATTESTATION_MAX_PAYLOAD = 2048;

export interface AttestationGrant {
  // undefined = не ограничено; [] = запрещено всё (fail-closed)
  audiences?: string[];
  scopes: string[];            // точные строки, БЕЗ wildcard-логики в v1
  maxSessionTtl: number;       // секунд, положительное конечное
  // разрешён только у аттестации Identity→Handle; ТОЛЬКО трейлинг '*':
  subNamePatterns?: string[];  // например ['connector-*', 'meter-*']
}

export interface AttestationPayload {
  typ: typeof ATTESTATION_TYPE;   // литерал 'me2em/attestation/v1'
  subjectName: string;            // каноническое (normalizeName)
  subjectId: string;              // base64url публичного ключа субъекта
  grant: AttestationGrant;
  iat: number;                    // Unix sec
  exp: number;                    // Unix sec
  jti: string;
}

export type AttestationErrorCode =
  | 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'NOT_YET_VALID'
  | 'REVOKED' | 'PATH_MISMATCH' | 'NAME_NOT_PERMITTED'
  | 'SCOPE_EXCEEDED' | 'AUDIENCE_NOT_PERMITTED' | 'TTL_EXCEEDED'
  | 'CHAIN_INCOMPLETE' | 'SUBJECT_MISMATCH' | 'SESSION_OUTLIVES_ATTESTATION';

export type AttestationLevel =
  | 'ROOT' | 'HANDLE_ATTESTATION' | 'SUB_ATTESTATION' | 'SESSION' | 'FORMAT';

export class AttestationError extends Error {
  constructor(
    public readonly code: AttestationErrorCode,
    public readonly level: AttestationLevel,
    msg: string
  ) { super(`[${level}/${code}] ${msg}`); }
}

### Класс Attestation

Приватный конструктор. Поля: payload, token, jti (геттеры без копий
объекта payload делать не нужно — возвращать как есть).

Приватный статический хелпер parseToken(token: string):
  1. token — string, иначе AttestationError('MALFORMED','FORMAT')
  2. split('.') → ровно 2 части, иначе MALFORMED/FORMAT
  3. regex /^[A-Za-z0-9_-]+$/ на обе части, иначе MALFORMED/FORMAT
  4. base64urlDecode(payloadB64) (из util.ts); bytes.length >
     ATTESTATION_MAX_PAYLOAD → MALFORMED/FORMAT
  5. JSON.parse в try/catch → MALFORMED/FORMAT
  Возвращает { payloadBytes, signatureBytes, payload }.

static decode(token: string): AttestationPayload
  = parseToken + проверка структуры БЕЗ подписи и БЕЗ времени:
  - payload.typ === ATTESTATION_TYPE, иначе MALFORMED/FORMAT
  - типы полей (иначе MALFORMED/FORMAT, с указанием поля в сообщении):
    subjectName: string; subjectId: string;
    grant: object не null и не массив;
    grant.scopes: массив строк;
    grant.maxSessionTtl: number, Number.isFinite, > 0
      (важно: JSON.stringify(NaN/Infinity) даёт null — тип-проверка
       это поймает, отдельный случай не нужен);
    grant.audiences: если присутствует — массив строк;
    grant.subNamePatterns: если присутствует — массив строк;
    iat: number; exp: number; jti: string
  Возвращает payload.

static async verifySignature(token: string, signerPublicKey: Uint8Array):
  Promise<boolean>
  = parseToken → ed.verify(signatureBytes, payloadBytes, signerPublicKey)
  (ed из './crypto/init.js'). Ничего не бросать на невалидную подпись —
  возвращать false. MALFORMED может проброситься из parseToken.

static matchNamePattern(name: string, patterns: string[]): boolean
  true если хотя бы один pattern:
  - равен name, ИЛИ
  - оканчивается на '*' и name.startsWith(pattern.slice(0, -1))
  Одиночный '*' матчит всё.

static async issue(
  signerPrivateKey: Uint8Array,
  subjectPublicKey: Uint8Array,
  subjectName: string,
  grant: AttestationGrant,
  opts?: { ttlSeconds?: number; expiresAt?: number; jti?: string; now?: number }
): Promise<Attestation>

Порядок операций:
  1. const name = normalizeName(subjectName)  // из './canonical-name.js'
  2. subjectPublicKey.length !== 32 → throw Error('subject public key must be 32 bytes')
  3. Валидация grant (иначе AttestationError('MALFORMED','FORMAT')):
     - scopes: массив строк
     - maxSessionTtl: number, Number.isFinite, > 0
     - audiences: если !== undefined — массив строк
     - subNamePatterns: если !== undefined — массив строк, и КАЖДЫЙ
       паттерн либо не содержит '*', либо оканчивается '*'
       ('connector-*' ok, '*' ok, 'a*b' → MALFORMED)
  4. now = opts?.now ?? Math.floor(Date.now() / 1000)
     exp = opts?.expiresAt ?? (now + (opts?.ttlSeconds ?? 31536000))
     jti = opts?.jti ?? crypto.randomUUID()
  5. Детерминированная сборка grant — ПОЛЯ В ФИКСИРОВАННОМ ПОРЯДКЕ,
     undefined-поля НЕ включать (JSON.stringify отбрасывает undefined,
     но собирай явно):
       const grantJson: Record<string, unknown> = {};
       if (grant.audiences !== undefined) grantJson.audiences = [...grant.audiences];
       grantJson.scopes = [...grant.scopes];
       grantJson.maxSessionTtl = grant.maxSessionTtl;
       if (grant.subNamePatterns !== undefined)
         grantJson.subNamePatterns = [...grant.subNamePatterns];
  6. payload литералом в порядке:
       { typ: ATTESTATION_TYPE, subjectName: name,
         subjectId: base64urlEncode(subjectPublicKey),
         grant: grantJson, iat: now, exp, jti }
  7. payloadBytes = TextEncoder(JSON.stringify(payload))
     signature = await ed.sign(payloadBytes, signerPrivateKey)
     token = `${base64urlEncode(payloadBytes)}.${base64urlEncode(signature)}`
  8. return new Attestation(payload, token)

Геттеры: get payload(), get token(), get jti().

### Экспорты в src/index.ts (добавить, ничего не удаляя):
Attestation, AttestationError, ATTESTATION_TYPE, ATTESTATION_MAX_PAYLOAD
(значения) и AttestationGrant, AttestationPayload, AttestationErrorCode,
AttestationLevel (типы).

---

## ТЕСТЫ test/attestation.test.ts

Сетап:
  const testSeed = new Uint8Array(32).fill(42);
  const identity = await Identity.fromSeed(testSeed);
  const rootPriv — недоступен (Identity не отдаёт приватник), поэтому
  для issue генерируй отдельный ключ эмитента:
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed.getPublicKey(signerKey);   // ed из '@noble/curves'
  (ed можно импортировать в тесте напрямую из '@noble/curves/ed25519.js';
   это dev-тест, допустимо.)

Хелпер ассертов кодов (сверху файла):
  async function expectAttestationError(
    promise: Promise<unknown>, code: string, level: string
  ) {
    try { await promise; expect.unreachable('should have thrown'); }
    catch (e) {
      expect(e).toBeInstanceOf(AttestationError);
      expect((e as AttestationError).code).toBe(code);
      expect((e as AttestationError).level).toBe(level);
    }
  }
Для синхронного decode — аналог без Promise (try/catch вокруг вызова).

Тесты:

1. Roundtrip issue → decode: все поля payload совпадают; subjectName
   нормализован (issue с 'Station-001' → payload.subjectName ===
   'station-001'); subjectId === base64urlEncode(signerPub... нет —
   субъекта); typ === ATTESTATION_TYPE.
2. Детерминизм: два issue с одинаковыми входами И opts {jti: 'fixed',
   now: 1700000000} → tokens ПОБАЙТОВО равны.
3. Валидация паттернов в issue: ['connector-*'] ok; ['*'] ok;
   ['a*b'] → expectAttestationError(..., 'MALFORMED', 'FORMAT');
   ['*b'] → MALFORMED/FORMAT.
4. matchNamePattern:
   ('connector-1', ['connector-*']) → true
   ('meter-1', ['connector-*']) → false
   ('anything', ['*']) → true
   ('connector-1', ['connector-1']) → true (точное)
   ('connector-1', ['meter-*','connector-*']) → true (любой из)
5. decode отвергает (каждый → MALFORMED/FORMAT):
   - 'no-dot-here'
   - 'bad chars!.sig' (невалидные base64url символы)
   - payload > 2048 байт (собрать JSON с длинной строкой, подпись любая)
   - payload не JSON (base64url от 'not json{{{')
   - валидный JSON но без jti (собрать payload вручную без jti,
     подписать, verifySignature не нужен — decode не проверяет подпись)
   - typ !== ATTESTATION_TYPE
   - maxSessionTtl: 0; maxSessionTtl: -5; maxSessionTtl: NaN
     (JSON.stringify(NaN) → null — тип-проверка должна поймать)
6. verifySignature: с ключом эмитента → true; с чужим ключом → false;
   tampered payload (изменить scopes в JSON, пересобрать b64, старая
   подпись) → false.
7. subjectPublicKey 16 байт → throw /32 bytes/.
8. Отсутствие undefined-полей в сериализации: grant без audiences и
   subNamePatterns → в сыром JSON токена (decode первой части, JSON.parse)
   НЕТ ключей 'audiences' и 'subNamePatterns' внутри grant; при этом
   grant.audiences = [] → ключ ЕСТЬ и равен [].
9. decode не проверяет время: payload с iat/exp в прошлом decode
   проходит без ошибок (время проверяет только verify в Фазе 3).

## КРИТЕРИИ ПРИЁМКИ

1. pnpm test: все зелёные (существующие 108 + новые, ожидаемо ~25).
2. npx tsc --noEmit чисто.
3. Изменены ТОЛЬКО: src/attestation.ts (новый), src/index.ts (экспорты),
   test/attestation.test.ts (новый).
4. Коммит: `feat(attestation): phase 1 — attestation type`.

## ОТЧЁТ

Файлы, число тестов до/после, tsc, все отклонения по правилу 8.
