# План доработки `@me2em/pact` rc.1 → rc.2 (верифицированный)

**Статус:** план к исполнению. Каждая находка внешнего аудита проверена против кода
(`packages/pact/src/**`) и нормативных документов (`docs/PACTS.md`, `specs/tz-pact.md`).
Итог: **6 находок подтверждены, 2 подтверждены с существенными поправками,
3 отклонены (цитаты spec не соответствуют нормативным документам), остальные —
док-заметки**. Отклонения от аудита обоснованы ниже — это главное отличие
этого плана от ТЗ аудитора.

Политика репо: максимум производительности → минимум кода → архитектура;
fail-closed; обратная совместимость не нужна.

---

## 1. Вердикты по находкам аудита

| # | Аудит заявляет | Вердикт | Основание |
|---|---|---|---|
| Б1 | `finalize` → `SKEW` на исторических журналах | **ПОДТВЕРЖДЕНО**, с поправкой к фиксу | `common.ts:49` гоняет весь prefix через skew-проверку против clock сборки. При этом `tz-pact.md:153` прямо говорит: «при выходе за skew **сборка не защищает** — skew контролирует verify (C3)» — текущий код противоречит собственному ТЗ. Принимаемый тест аудита («новое событие iat = T0+SKEW_FAR → SKEW») **неисполним**: `iat` нового события = `clock.now()` по построению, относительно своего же clock он не бывает перекошен. Тест заменяется (см. P0.1) |
| Б2 | O(N²) replay в `finalize` | **ПОДТВЕРЖДЕНО** — только документировать | Минимализм: не оптимизировать в rc.2 |
| Б3 | `pactRoot` ≠ «PACTS §7.5: SHA-256(JCS(roster))» | **ОТКЛОНЕНО** — аудитор цитирует несуществующее определение | `docs/PACTS.md:29` (единственное определение, §2 «Идентификаторы»): «`pactRoot` = **evHash(GENESIS)** — детерминированное имя пакта». §7.5 — таблица правил подписей, про PactRoot — ничего. Реализация (`verify.ts:116`) и тесты (`verify.spec.ts:68`, `assemble.spec.ts:95`) соответствуют норме. «Слепое сравнение PactRoot» в BL-12 — заявленный амплификатор, вне v0.1 (PACTS.md:161) |
| Б4 | `voucherChain('handle')` — обе аттестации от одного ключа | **ПОДТВЕРЖДЕНО** | `fixtures.ts:76-78`: root и handle-аттестации выпущены одним signer'ом и одним subject'ом — это два self-attestation, а не цепочка root→handle. Поддельная цепочка проходит `verifyChain` (подписи сходятся), семантика handle-якоря не тестируется нигде |
| Б5 | pinned `ep` (D25) не реализован | **ПОДТВЕРЖДЕНО по существу**, механизм — дизайн-поправка | `im` валидируется в codec (`codec.ts:222-225`), но `verify.ts` **ни разу не читает** `im` — все тесты (включая CN2!) идут с `im: 'pinned'` и bearer-поведением. Но: D25 в PACTS.md — «подписи в `sig[]`, различность `p`», **не** pinned; pinned — это D13 (`PACTS.md:182`), и в §7.3 поля `ep` нет. Значит нужна **поправка нормативного документа** (§7.3 + D13), а не только код |
| Б6 | `verifyChain` не проверяет `exp`/`iat` | **ПОДТВЕРЖДЕНО по существу**, цитата §5.4 — выдумана | В `verifyChain` (`verify.ts:488-519`) времени нет вообще. Но §5.4 PACTS.md правила «живы на iat» не содержит — это **дизайн-поправка** (добавить правило в §5.4 + ТЗ §3.3), а не конформность |
| Б7 | `ReferenceX3DH.b64urlDecode64` — нестрогий дубль | **ПОДТВЕРЖДЕНО** | `ReferenceX3DH.ts:143-165`: принимает переллинговые строки (guard `o < out.length`), не проверяет каноничность хвостовых битов. Строгий `b64urlDecode` в codec уже есть |
| Б8 | `Member.signEvent(raw, gen)` — `p` от `this.gen`, подпись от `gen` | **ПОДТВЕРЖДЕНО** | `fixtures.ts:57-58`; сейчас параметр никто не передаёт — латентный минный фикс |
| В1 | `assembleGenesis` не сортирует `ft` — «рекомендую сортировать» | **ОТКЛОНЕНО** | codec **уже требует** строгую сортировку (`codec.ts:326-329`, MALFORMED; PACTS §7.3 — порядок нормативный). Несортированный `ft` fail-closed падает на `finalize`. Тихая нормализация — мёртвый код и ослабление strict-parse политики |
| В2 | `assemble*` не проверяют длину `signerKeys` | **ПОДТВЕРЖДЕНО** (UX) | Упадёт всё равно, но поздно и с `INVALID_QUORUM` вместо раннего `MALFORMED` |
| В3 | `assembleAct` не проверяет `doc↔dh` до `finalize` | **ОТКЛОНЕНО** | Проверка **уже есть** в codec (`codec.ts:386-393`, включая doc-без-dh), запускается через `validateEvent` на `finalize`, покрыта тестом (`assemble.spec.ts:185-192`). Ранний дубль в `assembleAct` — дублирование логики против минимализма |
| В4 | `throw result.error!` | **ПОДТВЕРЖДЕНО** (косметика) | `common.ts:50` |
| В8 | `importJournal` — `split('\n')` | док-заметка | 2-party v0.1 |
| В10 | `verifyJournal.warnings` всегда `[]` | **ПОДТВЕРЖДЕНО** — док-заметка | by design (Р9); TSDoc |
| В12 | `ReferenceX3DH.genesis` не проверяет `g.sig.length === 1` | **ПОДТВЕРЖДЕНО** | `ReferenceX3DH.ts:139` дописывает подпись к любому хвосту; fail-closed, но поздно |

Итог по аудиту: **«8 блокирующих, из них 5 безопасность» не подтверждается.**
Реально: 6 подтверждённых правок (Б1, Б4, Б5, Б6 — с поправками; Б7, Б8 — качество),
3 отклонённых (Б3, В1, В3), 1 док-заметка (Б2) + мелочи. Безопасностно-критичные
по существу: **Б1** (противоречие собственному ТЗ), **Б5** (мёртвый `im: 'pinned'`
во всех тестовых конституциях), **Б6** (просроченные цепочки проходят Tier 3).

---

## 2. Работы rc.2

Ветка: `feature/pact-rc2` (от `develop`), в конце — PR. Порядок: P0 → P1 → доки → CHANGELOG/BACKLOG.

### P0.1 — Б1: skew в сборке (verify.ts, assemble/common.ts, тесты)

- `verifyJournal(events, clock?, opts?: { skewCheck?: 'all' | 'none' })`, дефолт `'all'`.
  **Режим `'last'` из аудита не вводится** — таutологичен: у собранного события
  `iat === clock.now()` по построению, относительно своего clock проверять нечего.
- `replay(events, clock, skewCheck)` — при `'none'` шаг (2) §7.7 пропускает только
  skew-сравнение (подписи/цепочка/кворум — без изменений).
- `finalize`: `verifyJournal([...events, event], clock, { skewCheck: 'none' })`.
- Тесты:
  - новый killer-тест: полный lifecycle собран на историческом prefix с
    `systemClock()` — сборка `ok`;
  - заменить `assemble.spec.ts:173-183` («SKEW at assembly»): событие, собранное с
    `clockAt(T0 + 3600)`, сборкой **принимается** (ТЗ §3.4: сборка не защищает от skew),
    а `verifyJournal(..., clockAt(T0))` его отвергает с `SKEW`;
  - `verify.spec.ts:618` («no clock → SKEW на историческом журнале») остаётся как есть —
    публичный `verifyJournal` сохраняет `'all'`.
- Доки: `tz-pact.md:115` — дописать `opts` в сигнатуру `verifyJournal`; sema §3.3 не меняется.

### P0.2 — Б4: настоящая handle-цепочка в fixtures (testing/fixtures.ts)

- Ключ handle-якоря — **реальная деривация core**: `crypto.deriveHandleKey(rootKey, name)`
  (core `crypto/derivation.ts:64`; PACTS.md:43 это и предписывает).
- `Member`: режим якоря. Конструктор по умолчанию остаётся identity-якорным
  (все текущие тесты не меняются); добавляется фабрика
  `Member.handle(seed, name, gen?)`: `anchorKey = deriveHandleKey(bytes(32,seed), name)`,
  `key = derivePactKey(anchorKey, …)`, `anchorPub()` → pub(handleKey) (= `pp`),
  `rootPub` отдельно (для `vc.rp`).
- `voucherChain`:
  - `identity` → `[self-attestation(root)]` — без изменений;
  - `handle` → `[root_attest(handlePub), handle_self_attest(handlePub)]`:
    issuer первой = **root key**, subject = handle pub; issuer второй = **handle key**,
    subject = handle pub; `vc.rp = rootPub`, `pp = handlePub`.
- `foundersOf`: брать `an`/`pp` из члена (по умолчанию прежние значения).
- Тесты: founder с `an: 'handle'`, `pp = handlePub`, цепочка из двух —
  `verifyChain` проходит и `lastSubject === pp`; существующие ANCHOR_MISMATCH-тесты
  (`verify.spec.ts:460`, `:630`) остаются валидны — проверяют длину, а она теперь честная.

### P0.3 — Б5: pinned `ep` (PACTS.md, types.ts, codec.ts, verify.ts, assemble/invite.ts)

Дизайн-поправка нормативного документа **обязательна** (в §7.3 поля нет):

- PACTS.md: §7.3 `INVITE` — добавить `ep? b64url(32)`; уточнить D13:
  «pinned: приглашение обязано нести `ep` — публичный ключ приглашённого;
  ENROLL подписанта ≠ `ep` ⇒ `INVALID_QUORUM`. bearer: `ep` допустим (per-invite
  ужесточение) или отсутствует. Не-ep-INVITE при `im: 'pinned'` ⇒ `MALFORMED`».
- `types.ts`: `InvitePayload.ep?: string`.
- `codec.ts`: `PAYLOAD_SPECS.INVITE` + `{ name: 'ep', required: false, kind: 'b64', bytes: 32 }`.
- `verify.ts applyEvent('INVITE')`: сохранять `ep`; при
  `cn.im === 'pinned' && ep === undefined` → `MALFORMED`.
- `verify.ts applyEvent('ENROLL')`: если `inv.ep !== undefined && sig.p !== inv.ep`
  → `INVALID_QUORUM` (одна семья с соседним правилом «ровно подпись вступающего»,
  `verify.ts:268`).
- `assembleInvite`: `ep?: string` в `InviteInput`.
- Тесты: pinned без `ep` → `MALFORMED`; pinned, подписант ≠ `ep` → `INVALID_QUORUM`;
  pinned, подписант = `ep` → ok; bearer без `ep` — любой подписант (регрессия bearer);
  bearer с `ep` → чужой подписант отклоняется.
- CN2 в fixtures остаётся `im: 'pinned'` — после фикса тестовые INVITE либо с `ep`,
  либо конституции тестов переводятся на `bearer` (решить по месту, минимум диффа).

### P0.4 — Б6: живость цепочки на `act.iat` (PACTS.md §5.4, verify.ts, тесты)

Дизайн-поправка: §5.4 дополнить — «цепочка должна быть жива на момент акта:
для каждой аттестации `iat ≤ act.iat < exp`, иначе `IDP_UNRESOLVABLE`
(“voucher chain not alive at act.iat”)». Обоснование кода выбора: E1 закрыт,
истечение ≠ отзыв, `IDP_UNRESOLVABLE` — существующий код семейства «цепочка не
разрешается».

- `verifyChain(chain, an, rp, pp, actIat)`; в цикле:
  `if (!(payload.iat <= actIat && actIat < payload.exp)) throw IDP_UNRESOLVABLE`.
  (учитывать, что `exp` может отсутствовать? — в core `exp` обязателен; просто читать).
- `verifyAct` передаёт `act.iat`.
- Тесты: цепочка с `exp < act.iat` → `IDP_UNRESOLVABLE`; с `iat > act.iat` →
  `IDP_UNRESOLVABLE`; живая (гранично: `act.iat === exp - 1`) → ok.
  Текущие тесты не ломаются: фикстуры выпускают аттестации на `T0`, акты — на `T0`.

### P0.5 — Б7: строгий decode в транспорте (transport/ReferenceX3DH.ts)

- Удалить `b64urlDecode64`; в `genesis()` —
  `b64urlDecode(responderSig.s, 'sig.s', 64, 'transport')` (импорт из codec).
- Тест: non-canonical подпись (валидный алфавит, плохой хвост) → `MALFORMED`.

### P0.6 — Б8: `signEvent` согласован по `gen` (testing/fixtures.ts)

- `signEvent(raw, gen = this.gen)`: ключ и `p` деривируются от одного и того же
  `gen`; при `gen === this.gen` — кэшированные `this.key`/`this.pub`.
- Тест: `new Member(2, 0).signEvent(raw, 1).p === new Member(2, 1).pub`.

### P1.1 — В2: ранние проверки `signerKeys` (assemble/{rotate,exit,enroll,dissolve}.ts)

- `assembleRotate`: `signerKeys.length === 2` и пабки различны → иначе `MALFORMED` ('assemble').
- `assembleExit`, `assembleEnroll`: ровно 1. `assembleDissolve`: ≥ 1.
- Тест: rotate с 1 и с 3 ключами → `MALFORMED`; exit с 2 → `MALFORMED`.

### P1.2 — В4: `common.ts:50` → `throw result.error ?? new PactError('MALFORMED','assemble','verification failed without error')`.

### P1.3 — В12: `ReferenceX3DH.genesis` — `if (g.sig.length !== 1) → MALFORMED ('transport')` + тест.

### P1.4 — доки (README, ТЗ, TSDoc)

- README пакета: раздел «Ограничения v0.1»: O(N²) replay в `finalize`
  (инкрементальный replay — rc.3), pinned `ep` введён в rc.2, N-party assembly — v0.2,
  binary transport — v1.0.
- ТЗ §3.4: та же строка про O(N²) (запись аудита Б2).
- TSDoc `verifyJournal`: «`warnings` всегда `[]` — Tier 3 не выполняется (Р9)» (В10).

### Отклонённые пункты аудита — в план не включаются

- **Б3**: без изменений кода. В README/TSDoc `pactRoot` — «evHash(GENESIS), детерминированное
  имя пакта (PACTS §2)»; roster-fingerprint — другой артефакт, точка расширения F8/BL-12
  (ввести отдельным полем в будущем, не переименованием).
- **В1**: строгий reject несортированного `ft` уже нормативен (codec + тесты).
- **В3**: проверка `doc↔dh` уже в codec, покрыта тестами; дубль не заводить.

---

## 3. rc.3+ (BACKLOG, не rc.2)

Согласен с аудитом с урезанием (минимализм):

- **F-rc3-1** инкрементальный `verifyPrefix` — да, закрывает Б2 (карточка в BACKLOG).
- **F-rc3-2** опциональный Clock в `MemoryStore.append` — да, мелко.
- **F-rc3-5** golden-векторы `pact` в `specs/test-vectors.json` — аудитор ошибается,
  что их нет: CHANGELOG rc.1 их декларирует. Проверить наличие и покрытие; если есть — пункт снять.
- **F-rc3-4** zeroize-хелпер — в JS не гарантируется; не делать (заметка).
- **F-rc3-3 / F-rc3-6** — частично: контекст `'codec'` в export — проверить по месту;
  README — только раздел «Ограничения» (P1.4), 7-разделный README — раздутье.
- v0.2/v1.0 аудита (F-v02-*, F-v10-*) — зеркалят уже принятые F1–F9 PACTS.md §8/ТЗ §7 —
  занести в BACKLOG карточками, новых решений не принимать.

## 4. BACKLOG / WORKLOG

- **BACKLOG.md** (существует в корне): дополнить карточками — «O(N²) replay в finalize
  (ограничение v0.1, инкрементальный replay — rc.3)», «transparency-фингерпринт roster
  (F8/BL-12; pactRoot им не является)», «zeroize — отклонено (JS)».
- **WORKLOG.md**: **не создавать** — история решений фиксируется в этом плане и
  CHANGELOG; отдельный журнал дублирует git-историю (минимализм).

## 5. Приёмка

- `pnpm -r test` — все пакеты зелёные; покрытие пакта ≥ 90% (пороги vitest сохранены).
- Тест-диффы: `assemble.spec` (skew-флип + historical ok + ранние проверки),
  `verify.spec` (pinned ep ×4, alive ×3, handle-chain позитив), `transport.spec`
  (non-canonical sig, sig.length), fixtures-тест (signEvent gen).
- Доки: PACTS.md (§7.3 INVITE+ep, D13, §5.4 alive), tz-pact.md (сигнатура verifyJournal,
  §3.4 O(N²)), README (ограничения), CHANGELOG `[1.0.0-rc.2]` со списком ID
  (Б1, Б4, Б5, Б6, Б7, Б8, В2, В4, В12 + отклонённые Б3/В1/В3 с причиной).
- Объём: src ~ +120/−40 строк, тесты ~ +250, доки ~ +50. Одна сессия.
