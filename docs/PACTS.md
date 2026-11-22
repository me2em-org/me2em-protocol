# PACTS — Pact Agreement & Compact Trust System: базовый дизайн (D1–D47)

**Статус:** adopted design (норматив для `specs/tz-pact.md` и реализации `@me2em/pact`).
**База:** спека `specs/v1.0.md` (Identity/Handle/Session), BL-15 (namespace-конвенция), BL-58.
**Политика:** приоритеты — максимальная производительность → минимум кода → хорошая архитектура; обратная совместимость не нужна (пользователей нет); fail-closed везде.

---

## 1. Модель

**Pact** — соглашение между независимыми Identity без слияния корней доверия.
У каждого пакта:

- **Pact ID** (`pid`) — b64url(16) случайных байт; задаётся при сборке GENESIS, живёт до DISSOLVE.
- **Context** (`cx`) — текстовое описание предмета пакта (что и на каких условиях). Нормативная форма `ch` — b64url(32) = SHA-256(UTF-8(cx)); inline `cx` в GENESIS check-верифицируется против `ch`. Контекст может быть полностью out-of-band — тогда `ch` — чистый commit. `ch` входит в info-строку ключей пакта ⇒ расхождение текста контекста = другой ключ = fail-closed (D4).
- **Pact Journal** — append-only журнал событий (11 типов, §3), связанный evHash-цепочкой. Журнал — единственный источник истины о составе и конституции; хеш-равенство голов = репликация без консенсуса (P3).
- **Roster** — текущий состав: отсортированный по `p` массив `RosterEntry { p, w, e }`, где `e` — evHash события членства (ENROLL или GENESIS). Порядок — нормативный (детерминизм Tier 2).
- **Pact Key** — ключ члена в контексте пакта: HKDF от приватного ключа якорного узла (D3/D38, см. ТЗ §3.2). Публичный `pactPub = getPublicKey(pactKey)` — производная; отдельной деривации нет (Р1). Корни (seed/root) в артефактах пакта не появляются (P6).
- **Anchor** — узел иерархии core, от которого выведен pact key: identity | handle | subhandle (D1–D3). Якорь задаёт политику жизни ключа (P7): Handle/SubHandle изолированы от root-ключа.

**Принципы пакета P1–P10** — наследуются из ТЗ §0 (нормативны).

## 2. Идентификаторы

| Идентификатор | Определение |
|---|---|
| `evHash` | b64url(SHA-256(TBS)), TBS = JCS(событие без `sig`) (D32). `typ`/`pid` в TBS ⇒ доменная сепарация и анти-replay |
| `ZERO32` | b64url(32 нулевых байта) — `ph` первого события; пустой `head()` store |
| `pactRoot` | evHash(GENESIS) — детерминированное имя пакта, корень доверия (интерфейсная точка BL-12) |
| `journalHead` | evHash последнего события журнала; ZERO32 для пустого |
| membership id | evHash события членства: evHash(GENESIS) для учредителей, evHash(ENROLL) для вступивших; ключи в `chains` (Tier 3, D34) |

## 3. События и журнал

Envelope события (единственный wire-формат, D32):

```
Event { typ: 'me2em/pact-event/v1', pid, sq, ph, ty, pl, iat, sig: Signature[] }
Signature { p: b64url(32), s: b64url(64) }   // pactPub + Ed25519(JCS(event без sig))
```

- `sq` — строго монотонная последовательность с 0; `ph[i] == evHash(prev)`.
- Типы (v1, D28 — реестр закрыт; `UNKNOWN_EVENT_TYPE` иначе):
  `GENESIS, INVITE, REVOKE_INVITE, ENROLL, EXIT, EVICT, ROTATE_KEY, ACT, REVERSE_ACT, AMEND, DISSOLVE`.
- Payload `pl` — строгая таблица §7.3: неизвестное поле или недостающее обязательное ⇒ `MALFORMED`.
- Лимиты — §7.4 (D35), нарушения ⇒ `PAYLOAD_TOO_LARGE`.

## 4. Конституция и кворум

```
Constitution { th: Partial<Record<EventType, Threshold>>, im: 'pinned' | 'bearer', w: boolean }
Threshold { m: 'all' | 'any' | 'k-of-active' | 'founder', k?: number }
```

- **D28, freeze per-type:** кворум события определяется конституцией, действующей на `sq` события. AMEND меняет конституцию только для последующих событий; кворум самого AMEND — по конституции ДО события (B-4/D23).
- **Defaults** при отсутствии `th[ty]`: DISSOLVE — `{ m: 'any' }` (deadlock-free выход, 2-party A2); все остальные — `{ m: 'all' }` (консервативный минимум).
- **Требование к подписной массе** (ACTIVE на seq события; вес — при `w: true`, иначе единичные):
  - `any` → 1;
  - `all` → масса всех ACTIVE (сжимается к составу — B-5);
  - `k-of-active` → `min(k, масса всех ACTIVE)` (B-5); `k ≥ 1` обязателен;
  - `founder` → подписи всех учредителей (из GENESIS).
- **B-5, валидация конституции** (GENESIS и каждая новая в AMEND): отвергается `k(DISSOLVE) > n_founders` (иначе раствор пакта блокируется навсегда).
- **INVALID_QUORUM:** подписная масса меньше требования. Подпись ключа, не входящего в ACTIVE на seq (для типов с требованием ACTIVE), в кворум не засчитывается.
- **D9:** право подписывать события — capability `pact:sign` в терминах грантов core; ни одного ambient-доступа. Сборка требует передачу верифицированного префикса (B-7).

## 5. Ростер и членство

| Правило | Содержание |
|---|---|
| **B-6, веса** | вес назначает INVITE; ENROLL повторяет `w` дословно; расхождение ⇒ `WEIGHT_MISMATCH` |
| **D18a, EXIT** | подпись текущим ключом выходящего; единственная подпись события; ростер уменьшается |
| **EVICT** | цель — ACTIVE член (`tp`); цель подписи не даёт; при n_active = 2 EVICT недостижим по кворуму `all` ≡ DISSOLVE (D26′) |
| **D39, ROTATE_KEY** | подписи: старый ключ (ACTIVE на seq) + новый (`np ≠ p`); ростер обновляет `p → np`, `e`/`w` сохраняются |
| **self-events** | ENROLL / EXIT / ROTATE_KEY освобождены от правила «подписант — ACTIVE»: ENROLL подписывает новичок, EXIT — выходящий, ROTATE — уходящий+новый; кворум §7.5 |

## 5.4. Voucher chains (Tier 3, D6/D12/D34)

Voucher-цепочка — out-of-band артефакт `{ chain: string[] }` — сериализованные аттестации core от корня: `[A]` для anchor=identity, `[A, B]` для handle, `[A, B, C]` для subhandle (root first; D12 — длина цепочки обязана соответствовать `an`, иначе `ANCHOR_MISMATCH`).

- Журнал хранит только **hash-commit** (D34): `vc = { rh, rp }`, `rh = b64url(SHA-256(JCS(chain)))`, `rp = b64url(32)` — публичный ключ корневой Identity якоря. Тяжёлый материал (`cx`, `doc`, цепочки) — вне журнала.
- Уровни (D17): **Tier 1** — подписи журнала (вечный офлайн); **Tier 2** — replay ростера (нужен журнал); **Tier 3** — датированные отзывы цепочек (`isRevokedAt`, core rc.9) + проверка цепочек.
- Dial (проверка цепочки в момент акта) осознанно выключен (D6): подписант **без** `vc` — предупреждение `NO_VOUCHER`, не ошибка (Р7). Подписант **с** `vc` даёт проверяемое обещание ответственности: непроверяемая цепочка — fail-closed (`IDP_UNRESOLVABLE` / `MALFORMED`).

## 6. Компрометация (D20)

ROTATE_KEY несёт `ca` (compromisedAt, unix seconds, опционально). Семантика:

- акты (ACT/REVERSE_ACT/AMEND), подписанные старым ключом с `iat > ca` ⇒ `REVOKED @ ROTATE_KEY`;
- акты с `iat ≤ ca` — валидны с предупреждением `PRE_COMPROMISE_ACT` (P7: честный blast radius, история до компрометации не переписывается);
- без `ca` ротация — плановая: все акты старым ключом остаются валидными.

## 7. Wire format

### 7.1. Кодирование

События, OFFER/ACCEPT и voucher-цепочки кодируются JCS (RFC 8785, core rc.9) + UTF-8. Бинарные поля — unpadded b64url (RFC 4648 §5). Экспорт журнала — §3.5 ТЗ (NL-канонический JCS, LF-only, финальный `\n`; побайтовая обратимость D47).

### 7.2. TBS и подпись

TBS = байты JCS события **без поля `sig`**. Подпись Ed25519 под TBS-байты. `evHash` = b64url(SHA-256(TBS)) — включает `typ`/`pid` ⇒ доменная сепарация и анти-replay (D32).

### 7.3. Payload-таблицы (норматив; `?` = опционально; типы b64url с длиной)

| Тип | Поля `pl` |
|---|---|
| `GENESIS` | `ch` b64url(32) · `cx?` string ≤2048 (при наличии SHA-256(UTF-8(cx)) == ch) · `cn` Constitution · `ft` Founder[] 1..16, отсортированы по `p`, различны |
| `INVITE` | `dn?` ≤64 · `w?` целое ≥1 (при `cn.w` обязателен) · `an` Anchor |
| `REVOKE_INVITE` | `ref` b64url(32)=evHash(INVITE) · `rs?` ≤256 |
| `ENROLL` | `ref` b64url(32)=evHash(INVITE) · `dn?` ≤64 · `w?` (дословно из INVITE, B-6) · `vc?` Voucher (D34) |
| `EXIT` | `rs?` ≤256 |
| `EVICT` | `tp` b64url(32)=pactPub цели · `rs?` ≤256 |
| `ROTATE_KEY` | `np` b64url(32) новый pactPub, ≠ старому · `ca?` unix seconds (D20) |
| `ACT` | `dh?` b64url(32) · `doc?` string ≤2048 (при наличии обязателен `dh`, SHA-256(UTF-8(doc)) == dh) · `no?` ≤32 |
| `REVERSE_ACT` | `ref` b64url(32)=evHash(ACT) · `k` `'supersede' \| 'reversal'` (D19) · `rs?` ≤256 |
| `AMEND` | `cn` Constitution (полная новая) · `no?` ≤32 |
| `DISSOLVE` | `rs?` ≤256 |

```
Founder { p: b64url(32) pactPub · pp: b64url(32) pub якорного узла · an: Anchor · w? вес · vc? Voucher }
Voucher { rh: b64url(32) = SHA-256(JCS(chain)) · rp: b64url(32) root pub якоря }
```

- GENESIS: конституция `cn` — обязательна; `ft` — учредители; валидация B-5 по `ft.length`.
- Не более одного `vc` на событие членства: учредители разделяют membership id (evHash GENESIS), поэтому артефакт цепочки (ключ — membership id, §5.4) разрешается однозначно только при одном `vc` на GENESIS; codec отвергает два `vc` в `ft`.
- При `cn.w = true` каждый учредитель несёт `w ≥ 1`.
- REVERSE_ACT `ref` обязан ссылаться на ACT по `ref`-хешу и типу цели (D19); `rs` — причина ≤ 256.
- `ENROLL.w` присутствует ⟺ `INVITE.w` присутствует (B-6).

### 7.4. Лимиты (D35)

payload события (JCS `pl`) ≤ 4096 B; inline `doc`/`cx` ≤ 2048 B; ≤ 16 подписей на событие; `dn` ≤ 64 символов; `rs` ≤ 256; `no` ≤ 32; `ft` ≤ 16. Нарушение ⇒ `PAYLOAD_TOO_LARGE` (codec/export/import — fail-closed, «пропустить и продолжить» запрещено, Р8).

### 7.5. Правила подписей (2-party v0.1, A2)

| Тип | Подписанты | Кворум |
|---|---|---|
| `GENESIS` | все учредители `ft` | co-signature: все, независимо от `th` |
| `INVITE`, `REVOKE_INVITE`, `EVICT`, `ACT`, `REVERSE_ACT`, `AMEND` | ACTIVE члены на seq | по конституции §4 (freeze D28) |
| `ENROLL` | новичок (1 подпись) | сам-событие: ровно подпись вступающего |
| `EXIT` | выходящий (D18a) | сам-событие: ровно подпись выходящего (ACTIVE) |
| `ROTATE_KEY` | старый (ACTIVE) + новый (`np`) | ровно 2: {старый p, np} (D39) |
| `DISSOLVE` | ACTIVE члены | default `{ m: 'any' }` |

Кворум по весам: при `cn.w = true` требование и массы — суммы `w`; иначе — количества. Подписи различны по `p`; `sig` ≤ 16.

### 7.6. Различность и дубликаты

`sig[].p` различны (дубликат ⇒ `MALFORMED`); два события на один `sq` ⇒ `FORK_DETECTED`; повторное ENROLL по уже использованному `ref` (приглашение одноразовое, D14) ⇒ `MALFORMED`.

### 7.7. Порядок проверки (нормативный)

1. **Цепочка:** `sq` от 0 без пропусков; `ph[0] == ZERO32`; `ph[i] == evHash(prev)`; один `pid`; нарушение ⇒ `FORK_DETECTED`.
2. **Envelope:** strict parse (§7.3), лимиты (§7.4), известный `ty`, skew ±30 с (`SKEW`), различность `sig[].p`, b64url-валидность, `cx`/`doc`-хеши (§4.11), Ed25519 по TBS (`SIGNATURE_INVALID`).
3. **Кворум:** по конституции на seq события (§4, §7.5); самособытия — по правилам §7.5.
4. **Семантика:** ростер-replay (ENROLL/EXIT/EVICT/ROTATE/AMEND), B-6 веса, B-5 конституция, D19 реф-цели, D12 anchor/chain-length.

Ошибки — ТЗ §5 (E1), `PactError { code, context }`.

## 8. Ограничения и честный blast radius

- **MITM-окно финализации `ch`:** транспорт обязан быть аутентифицированным (X3DH в reference-адаптере); слепое сравнение PactRoot — амплификатор (BL-12), вне v0.1 (P9).
- **B-8:** равенство `evHash` не доказывает побайтовое равенство реплик (наборы подписей могут различаться) — сверка реплик включает `sig[]`; export/import сохраняет наборы (D47).
- **D27:** история до точки расщепления валидна; CAS-append ⇒ `FORK_DETECTED`, оптимистичная конкурентность (C2).
- **D10:** двойная личная подпись вне цепочки — вне v0.1; **D24** FROST/BLS — отложено; **D30** nested pacts — отложено; **D37** zombie N-party expiry — отложено (P-4: не импровизировать в деплойменте); **D29** роли — отложено; **D40** binary transport — отложено.

## 9. Решения (D1–D47)

| ID | Решение |
|---|---|
| D1 | Anchor=Identity: pact key из root-ключа (`crypto.deriveRootKey(seed)`); вся сила Identity в пакте |
| D2 | Anchor=Handle: pact key из handle-ключа; изоляция от root (компрометация пакта не поднимается к root) |
| D3 | Pact Key = HKDF-SHA256(anchorSecretKey, salt="", info=`me2em/pact/v1/{pid}/{ch}/g{gen}`, L=32); `gen=0` при вступлении, `+1` на ROTATE_KEY |
| D4 | `ch` в info-строке ⇒ любое расхождение текста контекста = другой ключ = fail-closed; AMEND ключей не касается (B-4) |
| D5 | `pactPub` — производная `getPublicKey(pactKey)`; отдельной деривации нет (Р1) |
| D6 | Dial выключен: отсутствие `vc` — предупреждение `NO_VOUCHER`, не ошибка; наличие `vc` — проверяемое обещание |
| D7 | Journal — единственный источник истины; replay детерминирован |
| D8 | OFFER/ACCEPT — wire-типы, не journal-события |
| D9 | Подпись событий — capability `pact:sign` (гранты core); никакого ambient-доступа |
| D10 | Двойная личная подпись (вне журнала) — вне v0.1 |
| D11 | `sq`/`ph`-цепочка: `ph[0] = ZERO32`, строгая монотонность; два события на `sq` ⇒ `FORK_DETECTED` |
| D12 | Anchor/длина voucher-цепочки: identity↔1, handle↔2, subhandle↔3; противоречие ⇒ `ANCHOR_MISMATCH` (fail-closed) |
| D13 | `im: 'pinned'` — приглашение привязано к конкретному участнику; `'bearer'` — предъявитель (конституция задаёт режим) |
| D14 | REVOKE_INVITE действует только на неиспользованное приглашение (по `ref`) |
| D15 | Roster отсортирован по `p`; порядок нормативный (детерминизм) |
| D16 | `RosterEntry.e` = evHash события членства; сохраняется при ROTATE_KEY |
| D17 | Три тира верификации: 1 подписи, 2 replay, 3 датированные отзывы; распределение — Р9 (sync/async) |
| D18 | Членство закрывается EXIT/EVICT/DISSOLVE; повторное вступление — новая цепочка членства |
| D18a | EXIT подписывается текущим ключом выходящего |
| D19 | Акты не удаляются и не редактируются — только REVERSE_ACT `supersede` \| `reversal` (B-12) |
| D20 | `compromisedAt` в ROTATE_KEY: акты после — `REVOKED @ ROTATE_KEY`, до — `PRE_COMPROMISE_ACT` |
| D21 | AMEND меняет только конституцию; ключи не трогает (B-4) |
| D22 | Конституция валидируется на GENESIS и в каждой AMEND (B-5) |
| D23 | Кворум AMEND — конституция ДО события |
| D24 | FROST/BLS мультиподписи — отложено; v1 — индивидуальные Ed25519 |
| D25 | Подписи собраны в `sig[]` одного события; ≤ 16; различность `p` |
| D26 | EVICT требует кворум > EXIT-уровня (честная защита от выталкивания) |
| D26′ | 2-party: EVICT недостижим ≡ DISSOLVE; тип сохранён для N-party |
| D27 | История до форка валидна; ветвление = `FORK_DETECTED` на CAS-append |
| D28 | Freeze per-type: порог события фиксируется конституцией на seq события |
| D29 | Роли — отложено; v1 — только веса |
| D30 | Nested pacts — отложено |
| D31 | `iat` — unix seconds, инъектированный Clock (C3), skew ±30 с |
| D32 | Envelope + evHash: TBS без `sig`; `typ`/`pid` в TBS (сепарация/анти-replay) |
| D33 | Неизвестное поле envelope/payload ⇒ reject (fail-closed версии: `typ: me2em/pact-event/v1`) |
| D34 | Hash-commit: журнал хранит хеши (`rh`, `ch`, `dh`); тяжёлое — out-of-band; inline — check-верифицируется |
| D35 | Лимиты §7.4 ⇒ `PAYLOAD_TOO_LARGE` |
| D36 | Ошибки — `CODE @ CONTEXT` (E1), `PactError extends Error` |
| D37 | Zombie N-party expiry — отложено (P-4) |
| D38 | Info-строка ключа — UTF-8, salt пустой, L=32 (D3); формат `me2em/pact/v1/{pid}/{ch}/g{gen}` |
| D39 | ROTATE_KEY: подпись родителя (старого ключа) обязательна + подпись нового ключа |
| D40 | Binary transport — отложено (F5) |
| D41 | `JournalStore` — CAS-append `append(expectedHead, event)`; несовпадение ⇒ `FORK_DETECTED` (C1) |
| D42 | `MemoryStore` — reference-реализация; реализации без `isRevokedAt` деградируют до Tier 2 |
| D43 | Export/import — NL-канонический JCS с `sig[]`, побайтово точны (D47) |
| D44 | Транспорт — инъекция `Channel`; аутентифицированный; reference — X3DH через `@me2em/crypto` (C4) |
| D45 | `Clock` — инъекция (Р4); сборка не защищает от skew — контролирует verify |
| D46 | Кошелёк/эскроу пакта — отдельное ТЗ поверх (ротационно-стабильные деривации, эскроу `(pid, evHash(ACT))`) |
| D47 | Sneakernet — первоклассный режим: exportJournal/importJournal побайтово точны (B-14/P10) |
