# ЗАДАНИЕ: Phase 2 — методы выпуска аттестаций + 2 микрофикса

Проект: packages/core протокола Me2em. Уже есть: Identity/Handle/SubHandle
(crypto/derivation-paths.ts, canonical-name.ts с normalizeName), Session,
src/attestation.ts (класс Attestation со статическими issue/decode/
verifySignature/matchNamePattern, типы AttestationGrant/AttestationPayload,
класс AttestationError, константы ATTESTATION_TYPE/ATTESTATION_MAX_PAYLOAD).
135 тестов зелёные, tsc чистый.

## ЖЕЛЕЗНЫЕ ПРАВИЛА

1. Не менять: seed.ts, строковые литералы DERIVATION_PATHS,
   derivePassword/deriveChannelKey/deriveSharedSecret,
   src/attestation.ts (исключение — Микрофикс 1 ниже).
2. Комментарии в коде: ЗАПРЕЩЕНО ссылаться на внешние артефакты ревью
   («фаза», «ревью», «фикс №», «Amendment» и т.п.). Комментарий либо
   полностью самодостаточен по смыслу, либо его нет. История — в
   commit message.
3. НЕ добавлять npm-зависимости. НИКАКОГО Buffer.
4. Конструкция `expr as Type` — всегда одной строкой (oxc-парсер падает
   на переносе `as` на новую строку).
5. Новые тесты — в новом файле test/attestation-issuance.spec.ts.
   Существующие тесты не менять (исключение — Микрофикс 2 ниже).
6. После завершения: pnpm test + npx tsc --noEmit, коммит:
   `feat(attestation): issuance methods on Identity and Handle`.
7. Любое несовпадение с этой спекой — НЕ решать молча: создать NOTES.md
   с секцией "SPEC-MISMATCH" (ожидалось / найдено / что сделал) и
   упомянуть в отчёте.

ЦИКЛЫ ИМПОРТА: src/attestation.ts импортирует только canonical-name,
util, crypto/init — он ни от кого из Identity/Handle не зависит, поэтому
import Attestation в identity.ts и handle.ts циклов не создаёт.

---

## МИКРОФИКС 1 — src/attestation.ts

Конструктор класса Attestation сейчас публичный. Сделать приватным:

    private constructor(payload: AttestationPayload, token: string) {

Вызовы `new Attestation(...)` внутри статического issue продолжают
работать. Если после этого tsc выдаст ошибки В ДРУГИХ файлах —
конструктор обратно НЕ делать публичным: запиши случай в NOTES.md.

## МИКРОФИКС 2 — test/attestation.test.ts

a) Проверь package.json пакета core: есть ли там зависимость
   `@noble/ed25519`. Если она ДОБАВЛЕНА недавно (не была нужна до
   аттестаций) — удали её из package.json. Если была в проекте и раньше —
   оставь, но зафиксируй этот факт в отчёте.
b) В test/attestation.test.ts замени импорт:

    // было: import * as ed from '@noble/ed25519';
    import { ed25519 } from '@noble/curves/ed25519.js';

   и все вызовы `ed.getPublicKey(x)` → `ed25519.getPublicKey(x)`.
c) Прогони тесты — все должны остаться зелёными (оба пакета реализуют
   RFC 8032, подписи и ключи взаимосовместимы).

---

## ОСНОВНОЕ ЗАДАНИЕ

### 1. src/identity.ts — добавить метод в класс Identity

    /**
     * Issues an attestation binding a derived Handle key to its name
     * and grant. The subject public key is always derived internally —
     * it is impossible to attest a foreign key.
     */
    async attestHandle(
      name: string,
      grant: AttestationGrant,
      opts?: { ttlSeconds?: number; expiresAt?: number; jti?: string; now?: number }
    ): Promise<Attestation> {
      const normalized = normalizeName(name);
      const handle = await this.deriveHandle(normalized);
      return Attestation.issue(
        this.privateKey,
        handle.getPublicKey(),
        normalized,
        grant,
        opts ?? {}
      );
    }

Импорты в identity.ts (добавить к существующим):

    import { Attestation, type AttestationGrant } from './attestation.js';

### 2. src/handle.ts — добавить метод в класс Handle

    /**
     * Issues an attestation for a derived SubHandle, binding its
     * derived key to the name and grant. Autonomous: requires only
     * this Handle's own key, no Identity and no network.
     */
    async attestSubHandle(
      subName: string,
      grant: AttestationGrant,
      opts?: { ttlSeconds?: number; expiresAt?: number; jti?: string; now?: number }
    ): Promise<Attestation> {
      const normalized = normalizeName(subName);
      const sub = await this.deriveSubHandle(normalized);
      return Attestation.issue(
        this.privateKey,
        sub.getPublicKey(),
        normalized,
        grant,
        opts ?? {}
      );
    }

Импорт в handle.ts (добавить к существующим):

    import { Attestation, type AttestationGrant } from './attestation.js';

### 3. src/index.ts — БЕЗ изменений (Attestation и AttestationGrant
уже экспортированы).

---

## ТЕСТЫ: test/attestation-issuance.spec.ts

Общий сетап (вверху файла):

    import { describe, it, expect } from 'vitest';
    import { Identity, Attestation } from '../src/index.js';
    import { base64urlEncode, base64urlDecode } from '../src/util.js';

    const testSeed = new Uint8Array(32).fill(42);
    const identity = await Identity.fromSeed(testSeed);

(top-level await в vitest допустим; если линтер ругается — оберни
сетап в функцию и вызывай в каждом it, выбери сам и отметь в отчёте.)

Тесты:

1. attestHandle:
   - handle = await identity.deriveHandle('station-001');
   - att = await identity.attestHandle('Station-001',
       { audiences: ['app.com'], scopes: ['charge:start'], maxSessionTtl: 3600 });
   - att.payload.subjectName === 'station-001'  (нормализация на входе)
   - att.payload.subjectId === base64urlEncode(handle.getPublicKey())
   - await Attestation.verifySignature(att.token, identity.getPublicKey()) === true
   - await Attestation.verifySignature(att.token, handle.getPublicKey()) === false

2. attestSubHandle:
   - handle = await identity.deriveHandle('station-001');
   - att = await handle.attestSubHandle('Connector-CCS',
       { scopes: ['charge:start', 'charge:stop'], maxSessionTtl: 7200 });
   - att.payload.subjectName === 'connector-ccs'
   - await Attestation.verifySignature(att.token, handle.getPublicKey()) === true

3. Привязка к деривации (главное свойство выпуска):
   - subjectId аттестации из теста 2 равен base64urlEncode(pubkey
     субхэндла, полученного через identity.deriveSubHandle('station-001',
     'connector-ccs')) — ключ одинаков через обе точки входа.

4. opts pass-through:
   - att = attestHandle('x', grant, { jti: 'fixed', now: 1700000000, ttlSeconds: 600 })
   - payload.iat === 1700000000; payload.exp === 1700000600; payload.jti === 'fixed'

5. grant pass-through:
   - grant с audiences: ['a.com'] и subNamePatterns: ['c-*'] →
     decoded = Attestation.decode(att.token):
     decoded.grant.audiencestoEqual(['a.com']),
     decoded.grant.subNamePatterns toEqual(['c-*'])

6. Цепочка A→B (заготовка верификации Фазы 3):
   - A = identity.attestHandle('station-001', grantA)
   - handle = identity.deriveHandle('station-001')
   - B = handle.attestSubHandle('connector-1', grantB)
   - verifySignature(A.token, identity.getPublicKey()) === true
   - verifySignature(B.token, base64urlDecode(A.payload.subjectId)) === true

7. Ошибки пробрасываются: attestHandle('a/b', ...) → throws;
   attestHandle('ok', { scopes: ['s'], maxSessionTtl: 0 }) → throws
   AttestationError (проверить code === 'MALFORMED').

## КРИТЕРИИ ПРИЁМКИ

1. pnpm test — все зелёные (135 + ~7 новых).
2. npx tsc --noEmit — чисто.
3. Изменены ТОЛЬКО: attestation.ts (одна строка), identity.ts (метод +
   импорт), handle.ts (метод + импорт), test/attestation.test.ts
   (импорт), НОВЫЙ test/attestation-issuance.spec.ts, package.json
   (только удаление @noble/ed25519 — при условии из Микрофикса 2a).
4. Один коммит: `feat(attestation): issuance methods on Identity and Handle`.

## ОТЧЁТ

Файлы, тесты до/после, tsc, факт по @noble/ed25519 (была ли зависимость
добавлена ранее или появилась в Фазе 1), все SPEC-MISMATCH из NOTES.md.
