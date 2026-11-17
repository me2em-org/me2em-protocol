# LTS v1.0 — итоговый отчёт по программе

**Ветка:** `analysis/lts-v1-audit`, отрезана от **базлайна `0b73599`** (последний коммит до старта программы, merge PR #8 от 2026-10-30 16:39 +0300).
**Назначение:** аудит выполнения ТЗ «Полный план LTS v1.0» (PLAN-LTS-v1.md v3.1), сбор статистики, финальная фиксация всех решений. Ветка анализная: не пойдёт в main и удаляется после приёмки архитектором (вместе с remote-копией).
**Методика:** каждый факт ниже взят из git-истории, GitHub API или локальных прогонов, выполненных при подготовке отчёта (команды — §8). Worklog (31 задача) использован как вторичный источник с перекрёстной проверкой по диффам. Ничего не записано по памяти.

---

## 1. Вердикт

**ТЗ выполнено полностью.** Все 11 исполняемых PR карты (PR-1…PR-8, PR-10…PR-12; PR-9 выведен по A4 до реализации, номер не переиспользован) смержены архитектором (SeLub), `main` зелёный после каждого мержа, ни один golden-вектор не был регенерирован вне санкционированных +3 строк PR-8.

Финальное состояние программы:

| Измерение | Состояние на `896c9ed` (PR-12) |
|---|---|
| Версии пакетов | core / react / crypto = **1.0.0-rc.1** (прыжок с alpha, без публикации 0.8.0) |
| API freeze | **действует** — specs/v1.0.md §12 (замороженная поверхность + правила эволюции) |
| Code freeze | с PR-11 (закрыт Session-конструктор — последний публичный конструктор ключевых объектов) |
| Derivation freeze | с merge PR-2 (§4 плана); единственный путь ротации внутри 1.x — ревизии `rN` |
| Спека | specs/v1.0.md — нормативная для 1.0.0-rc.1, 12 разделов, 318 строк |
| Тесты | **602/602** (core 350, crypto 151, react 101), 50 spec-файлов |
| Coverage core | **94.36 / 94.13 / 94.73 / 94.69** (stmts/branch/funcs/lines), гейты 90/90/90/90 в CI |
| Golden-векторы | specs/test-vectors.json — 210 строк / 12 831 байт, байт-целостны |
| Документы LTS | THREAT_MODEL.md (14 классов угроз), SECURITY.md (SLA ≤7 дней, 24-месячное окно) |
| CI | на merge: Build & Test (Node 22 + coverage-гейт), CodeQL SAST, gitleaks, 3× Cloudflare Pages — success |

**Сроки:** первый мерж программы (PR-1) — 2026-10-30 17:43, последний (PR-12) — 2026-11-01 14:33 (+0300): **44 ч 50 мин** астрономического времени на все 12 PR при плане «8 недель» (§10 плана). Ограничителем даты v1.0.0 остаётся не код, а внешний аудит (D7).

---

## 2. Матрица выполнения ТЗ (карта §5 → факт)

| PR | GH# | Пункты ТЗ (v2.0) | Факт | Merge | Тесты после |
|---|---|---|---|---|---|
| PR-1 план | #9 | — (план программы) | PLAN-LTS-v1.md v3.0 → v3.1 (A1–A9); BACKLOG DR-6 + roadmap-версии (A8) | 5346947, 10-30 17:43 | 438 |
| PR-2 seed-64 | #10 | 0.0.1–0.0.6, A6, A8 | Seed = 64 байта (D1): `get64ByteSeedFromMnemonic`, `fromSeed` 64B/128hex, BIP39-векторы кросс-проверены 2 независимыми реализациями, HKDF-тест, react-миграция в том же PR (A6), JSDoc-fix (A8), Standards Compliance table (ride-along) | c486fd7, 10-30 21:43 | 455 |
| PR-3 векторы | #12 | 0.1.x, 0.2.x, 4.8, D9 | `scripts/generate-vectors.ts` (детерминизм 2 прогона байт-в-байт), golden `vectors.spec.ts` (17 тестов), specs/v1.0.md нормативный; DR-7: draft/archive удалены из дерева целиком; gitleaks allowlist для опубликованных векторов | 8f7ca78, 10-30 22:26 | 472 |
| PR-4 engines-bench | #13 | 0.3.1, 0.3.3–0.3.4, 0.4.1–0.4.2, A2, A7 | engines `>=22` workspace; vitest bench (10 бенчей) + `bench/baseline.json` до Stage 1; `expectAttestationError`, `createTestHandle()`, дедупликация; **coverage-гейты 90/90 в vitest config + CI-wiring архитектора** (A7) | 0e0f376, 10-31 01:23 | 478 |
| PR-5 encapsulation | #15 | 1.1, 1.3, 1.4, 1.8.1; 5.1–5.5 | `#private` (TS-private → ES#private) на Identity/Handle/SubHandle, копирование входов + defensive getters, `dispose()`/`DisposedError`, toJSON/inspect redaction; brand-check `Handle.prototype.sign.call(fakeThis)` → TypeError | 0fab815, 10-31 21:59 | 497 |
| PR-6 signer | #16 | 1.2, D2; 5.13 | `interface Signer` в публичном API, `Attestation.issue(signer, …)` (raw-ключ → TypeError), Identity.sign, byte-паритет attest* vs issue (пин передачи `this`); транзишнл-нота §8 удалена по собственной клаузе | da83b74, 10-31 23:05 | 509 |
| PR-7 hardening | #17 | 1.5–1.7, 1.8.2–1.8.7; 5.8/5.9/5.12/5.15/5.18 (+5.7) | Единая модель `AttestationError{code, level}` (все raw throws устранены; DisposedError — подкласс), `@scure/base` base64url (A3) + no-btoa scan, randomUUID fallback, jti ≤256, signature-length pre-check, `__proto__`-защита, deep copy `getSubMetadata`, детерминированный fuzz ~1050 раундов; CodeQL-находка в собственном тесте исправлена | 5ab68d2, 11-01 00:26 | 558 |
| PR-8 revisions | #18 | 2.1 (без 2.1.2 — A1), 2.2, 2.4; 5.6/5.16 | Options-object API (D3), ревизии `rN` (`/rN` в info — санкционированный путь поверх derivation freeze), `DERIVATION_PATHS.password/.channel(revision?)`, NFKC-канонизация контекстов, `byteLength` [1, 8160]; векторы +3 строки (единственная санкционированная регенерация); ревью-ответ архитектора закрепил «revision — целое» (+2 теста) | 72608ae, 11-01 01:12 | 584 |
| PR-9 | — | 2.3, 5.17 | **Выведен до реализации** (A4/D8: subjectWallet → отдельное ТЗ и пакет `@me2em/solano`); tombstone в §5, номер не переиспользован | — | — |
| PR-10 arch-cycle | #19 | 3.1, 3.2, 3.3.1, 3.3.4, D4/D5 | Разрыв цикла handle↔subhandle: ко-локация классов (см. §5.1 отчёта — задокументированное отклонение от буквы «static import»), `deriveRootKey/deriveHandleKey/deriveSubHandleKey` shared + parity, все @noble-импорты через crypto/ (мета-тест на детектор), auto-init как структурная гарантия; спека §11 + tree-shaking отчёт (ревью-ответ 050cd69) | 2165fee, 11-01 02:14 | 596 |
| PR-11 session-split | #20 | 3.4, 3.5, 3.6.1–3.6.3, D6 | `verifyAttested` (~210 строк) → оркестратор + 5 приватных стадий, порядок/коды/уровни байт-идентичны (28 аттестационных + error-table + fuzz suite'ы зелёные нетронутыми); конструктор `Session` private, `@internal fromVerified` (D6), тесты через test-utils (A6); одиночная нормализация имён в attest* | 8ff6618, 11-01 02:52 | 602 |
| PR-12 docs-lts-rc | #21 | 4.1–4.2, 4.4–4.6, 6.4, 6.5, A9 | THREAT_MODEL.md (14 угроз с привязкой к тестам), SECURITY.md (rc.1, SLA 7 дней, 24 мес), spec §12 API freeze, версии → 1.0.0-rc.1, CHANGELOGs (+ создан crypto CHANGELOG), README «Runtime & Limits», BACKLOG rc.1; docs-only: 0 изменений в src/ | 896c9ed, 11-01 14:33 | 602 |

### Сверка трейсабилити §11 (исключения — все плановые)

- `0.3.2` (CI-coverage wiring) → PR-4 (config) + архитектор (Workflows-scope) — исполнено, инцидент задокументирован (§5.2).
- `2.1.2` derivePasswordLegacy → **дропнут** (A1): функции никогда не существовало в дереве (проверено `git log -S` в PR-8).
- `2.3.*`, `5.17` → **исключены** (A4) → `@me2em/solano` track; PR-9 tombstone.
- `3.3.2/3.3.3` → **wrappers сохранены** (A5), унифицированы только внутренние импорты.
- `4.3` MIGRATION.md → **удалён из программы** (A9); каждая breaking-задокументирована в CHANGELOG в момент лендинга.
- `5.7` property-based → исполнен как детерминированный mulberry32-фаззинг (~1050 раундов) в PR-7.
- `6.1–6.6, 7.1–7.5` → архитекторский трек (§9 плана): Cloudflare watch paths (настроены и эмпирически подтверждены в PR #10/#11), publish-опы, аудит D7.

**Каждый breaking PR нес миграцию консьюмеров в том же PR (A6):** PR-2 — react-миграция (useImportSeed/useCreateIdentity + 4 spec); PR-4 — тест-хелперы; PR-8 — все core-коллеры (векторы/бенч/генератор); PR-11 — тест через test-utils. В PR-5/6/7 миграция не потребовалась (подтверждено grep по workspace, зафиксировано в worklog). `main` зелёный после всех 11 мержей.

---

## 3. Статистика программы

### 3.1 Программа целиком (базлайн `0b73599` → `main 896c9ed`)

| Метрика | Значение |
|---|---|
| Мержей (true merge, не squash) | **11** (GH #9, #10, #12, #13, #15, #16, #17, #18, #19, #20, #21; номера #11 и #14 пропущены — PR не создавался) |
| Коммитов | 31 всего = **20 content** + 11 merge |
| Дифф к базлайну | **74 файла, +6931 / −1033** (нетто) |
| Астрономическое время | PR-1 → PR-12: **44 ч 50 мин** (2026-10-30 17:43 → 2026-11-01 14:33 +0300) |
| Breaking PR | 6 из 11 (PR-2, PR-5, PR-6, PR-7, PR-8, PR-11) |
| Ревью | 11/11 merged_by=SeLub; ревью-ответы отдельными коммитами в PR-8 (+2 теста) и PR-10 (+139/−10, ноль src-изменений) |
| Worklog | 31 задача (Task 8–31 — программа) |
| Тесты | **438 → 602** (+164; весь прирост в core: 186 → 350) |
| Spec-файлы | 38 → **50** (core 8→20, crypto 16, react 14) |

### 3.2 По PR (дифф merge-коммита против его первого родителя)

| PR | Коммитов (content) | Файлов | +/− | Тесты после мержа |
|---|---|---|---|---|
| PR-1 план | 2 | 2 | +201/−2 | 438 |
| PR-2 seed-64 | 2 | 24 | +289/−94 | 455 |
| PR-3 векторы | 3 | 13 | +970/−94 | 472 |
| PR-4 engines | 2 | 22 | +697/−149 | 478 |
| PR-5 encapsulation | 1 | 10 | +567/−62 | 497 |
| PR-6 signer | 1 | 14 | +315/−50 | 509 |
| PR-7 hardening | 3 | 28 | +1438/−204 | 558 |
| PR-8 revisions | 2 | 16 | +790/−37 | 584 |
| PR-10 arch-cycle | 2 | 12 | +898/−395 | 596 |
| PR-11 session-split | 1 | 7 | +467/−109 | 602 |
| PR-12 docs-lts-rc | 1 | 12 | +502/−40 | 602 |

Суммы per-PR (7134/−1236) больше нетто-диффа программы (6931/−1033) — поздние PR переписывали строки, вставленные ранними; это ожидаемо.

### 3.3 Тесты и coverage (эволюция)

| Точка | Workspace | core | core coverage (stmts/branch) |
|---|---|---|---|
| Базлайн 0b73599 | 438 | 186 | порогов нет (появились в PR-4) |
| PR-2 | 455 | 203 | — |
| PR-3 | 472 | 220 | — |
| PR-4 (гейты введены) | 478 | 226 | 92.4 / 90.3 (после закрытия щелей; было 90.8/87.66) |
| PR-5 | 497 | 245 | 92.93 / 90.76 |
| PR-6 | 509 | 257 | 92.68 / 90.82 |
| PR-7 | 558 | 306 | 93.75 / 93.66 |
| PR-8 | 584 | 332 | 93.97 / 94.13 |
| PR-10 | 596 | 344 | 94.3 / 94.13 |
| PR-11 → PR-12 | 602 | 350 | **94.36 / 94.13** (funcs 94.73, lines 94.69) |

crypto: 151 теста во всех точках, coverage 96.66/91.17 (финал). react: 101 тест, храповик **82/71 (lines/branches)** — осознанное решение PR-4 (UI-слайс вне LTS-скипа; подъём до 90/90 — BL-34), храповик держится (83.39/72.36 на финале).

### 3.4 Инфраструктура качества

- **CI:** на базлайне gitleaks + Build&Test + CodeQL; с PR-4 шаг Test = `pnpm -r test:coverage` (гейты в CI); на PR-мержах фиксируется до 7 check-runs (включая 3× Cloudflare Pages). Все 11 мержей зелёные; startup-failure был один (PR-4, см. §5.2) и был устранён до мержа.
- **Bench:** vitest bench ×10 + `bench/baseline.json` зафиксирован **до** Stage 1 (как требовал §5), смоук-прогоны после каждого core-PR (финал: ~85.6k/90.8k ops/s на деривации).
- **Golden-векторы:** созданы PR-3 (210 строк, 12 831 байт, детерминизм двух прогонов байт-в-байт); единственная эволюция — +3 строки PR-8 (r2/NFKC), все прежние строки байт-идентичны; иначе не регенерировались ни разу.
- **Спека:** specs/v1.0.md — 318 строк, 12 разделов; §11 (модульный контракт, пин архитектуры) и §12 (API freeze) добавлены в ходе программы.

---

## 4. Финальная фиксация решений

### 4.1 Decision record D1–D9 — финальные статусы

| # | Решение | Статус | Где закреплено |
|---|---|---|---|
| D1 | Seed = 64 байта (BIP39), sha256-drop | ✅ исполнено (PR-2) | seed.ts/identity.ts; спека §1; векторы; BIP39-векторы кросс-проверены 2 реализациями |
| D2 | `Signer` для `Attestation.issue` | ✅ исполнено (PR-6) | types.ts; спека §8; byte-паритет тесты |
| D3 | Options-object деривации | ✅ исполнено (PR-8) | derivePassword/deriveChannelKey; спека §3 |
| D4 | Разрыв цикла handle↔subhandle | ✅ исполнено (PR-10) **с отклонением**: ко-локация вместо static cross-import | handle.ts header; спека §11; import-order пины; ESM-репро |
| D5 | Auto-init остаётся, документируется | ✅ исполнено (PR-10) | README «Auto-init» как структурная гарантия; ed-only-from-init.ts метапин; subpath невозможен (exports-map «.») |
| D6 | `Session.fromVerified` @internal | ✅ исполнено (PR-11) | session.ts; test-utils; `new Session(` только в фабриках файла |
| D7 | Внешний аудит / bug bounty обязателен | ⏳ **открыт** — архитекторский трек (BL-39) | Дедлайн снят архитектором («старт на усмотрение разработчика»); lead time 4–10 недель; аудит на code-freeze (достигнут); release-gate v1.0.0 |
| D8 | subjectWallet | ⏸ выведено из LTS (A4) → `@me2em/solano` | PLAN §5 tombstone PR-9 |
| D9 | Спека = specs/v1.0.md | ✅ исполнено (PR-3) + усилено DR-7: draft/archive удалены из дерева целиком | specs/ = v1.0.md + test-vectors.json; DR-7 в BACKLOG |

### 4.2 Поправки A1–A9 — финальные статусы

| # | Поправка | Статус |
|---|---|---|
| A1 | Дроп `derivePasswordLegacy` | ✅ (PR-8; функции не было в дереве — `git log -S`) |
| A2 | engines `>=22` | ✅ (PR-4, workspace-wide) |
| A3 | `@scure/base` для base64url | ✅ (PR-7; байт-идентично, no-btoa scan-пин) |
| A4 | Исключение solano-трека из LTS | ✅ (PR-9 tombstone; PLAN §5/§11) |
| A5 | crypto/ed25519 wrappers сохраняются | ✅ (PR-10; унифицированы только внутренние импорты) |
| A6 | Same-PR consumer rule | ✅ применена во всех breaking PR (§2); main зелёный после всех мержей |
| A7 | Coverage-гейты | ✅ (PR-4: vitest thresholds; CI-wiring архитектора; инцидент см. §5.2) |
| A8 | Docs-долг (JSDoc fromSeed, roadmap-версии) | ✅ (PR-2 и PR-1) |
| A9 | No-compat мандат | ✅ действовал всю программу: MIGRATION.md не существует, breaking только в CHANGELOG |

### 4.3 Программные правила — финальные статусы

| Правило | Статус |
|---|---|
| Derivation freeze (§4 плана) — после PR-2 ни одного деривационного изменения до v1.0.0 | ✅ активен с merge PR #10; единственное касание деривации — санкционированная ревизионная модель PR-8 (новые `/rN`-info, прежние строки байт-идентичны) |
| Один PR в ревью; ветка от актуального main; после мержа — ff + удаление веток | ✅ соблюдено во всех 11 циклах; на remote сейчас только main |
| Батчинг §6: косметика не мержится отдельно | ✅ (Standards-таблица — в PR-2; BL-39 — в PR-7; DR-6 — в PR-1) |
| DR-7: дерево = только живые артефакты | ✅ (specs/ без draft/archive; история в git) |
| Breaking-record §7 | ✅ все 6 breaking-строк в core CHANGELOG (1.0.0-rc.1); в §7 плана строка v0.8.0 отображена на rc.1 (0.8.0 не публиковался) |
| Golden-векторы не регенерируются | ✅ (кроме санкционированных +3 строк PR-8; проверено диффами на каждом PR) |

### 4.4 Freeze-состояние релиза (что фиксируется настоящим отчётом)

1. **Версия:** 1.0.0-rc.1 (core/react/crypto), публикация в npm — операция архитектора (dist-tag `lts`, pair-checks DR-4).
2. **API freeze:** specs/v1.0.md §12 — замороженная поверхность (классы, `Signer`, crypto-namespace, seed-утилиты, модель ошибок, wire-форматы и лимиты §4–§7); эволюция: additive → 1.x minor; breaking/деривационное → 2.0.0 + новая спека + ревизия векторов. Машино-проверяемая часть фриза — golden-файл векторов.
3. **Derivation freeze:** §4 плана; ротация внутри 1.x — только ревизии.
4. **Документы:** THREAT_MODEL.md (изменение — через §8 change discipline), SECURITY.md (SLA ≤7 дней критических, 24-месячное окно открывается на v1.0.0 GA).
5. **Гейты:** vitest thresholds (core 90/90/90/90, crypto 90/90, react храповик 82/71) в CI на main.

---

## 5. Отклонения, инциденты, уроки (все задокументированы в ходе программы)

### 5.1 Отклонение от буквы плана — D4/PR-10 (единственное техническое)
«Static SubHandle import in handle.ts» реализовано буквально и опровергнуто экспериментом: `SubHandle extends Handle` + статический обратный импорт = ESM-цикл с нелегальным порядком вычисления («Cannot access 'Handle' before initialization», изолированный 2-модульный репро). Решение — ко-локация классов в handle.ts, subhandle.ts = чистый re-export фасад; граф ацикличный, 100% статический. Нормативно закреплено в спеке §11 с аргументацией; публичные пути импорта не изменились; tree-shaking проверен отчётом (handle.js без identity.ts → −13 kb wordlist).

### 5.2 Инциденты (устранены до мержей, на main не попали)
- **PR-4/CI:** первый патч архитектора добавил второй `run:` под существующим → duplicate YAML key, workflow startup failure; пойман моей верификацией head-коммита, исправлен архитектором (замена, а не добавление строки). Зелёное состояние восстановлено до ревью.
- **PR-3/gitleaks:** опубликованные BIP39-векторы матчатся как «leak» (allowlist покрывал только test/); allowlist расширен на `specs/test-vectors.json` + латентный full-history finding в workflow README; full-history скан = 0 findings.
- **PR-7/CodeQL:** `js/incomplete-string-escaping` (high) в моём же тестовом коде; исправлен (splice вместо replace) отдельным коммитом в том же PR.
- **PR-10/коммит-сообщение:** bash command substitution съела два фрагмента из бэктиков; поправлено amend -F + force-push до ревью.

### 5.3 Уроки процесса
- `corepack pnpm` — единственный рабочий вызов pnpm в песочнице (10.11.1, store v10); фоновые процессы не живут между вызовами Tool — поллинг CI только foreground `python3 -u`.
- ESLint 10 без flat-config: `pnpm -r lint` сломан pre-existing (вне скоупа, в CI замаскирован continue-on-error) — не чинился сознательно.
- Два рецикла контекста (середина PR-11 и PR-12): потери нулевые — восстановление по артефактам (ветки, PR через API, диффы) зафиксировано в worklog Task 30/31; оба PR закрыты без повторной работы.

---

## 6. Открытые пункты (передаются архитекторскому треку §9)

| Пункт | Статус |
|---|---|
| **D7: внешний аудит / bug bounty** на code-freeze rc.1 | ⏳ BL-39, owner — архитектор; lead time 4–10 недель; release-gate v1.0.0. Реалистичный GA: Q1–Q2 2027 |
| Publish ops rc.1 → v1.0.0 | pair-checks по DR-4 (package + consumer на чистом install), npm dist-tag `lts` |
| BL-07 (zeroization-лимиты JS-рантайма) | механизм исполнен (PR-5 dispose()), честная TSDoc/THREAT_MODEL §5.2 — кандидат на закрытие при следующем свипе, решение за архитектором |
| BL-34: react coverage 82/71 → 90/90 | открыт (вне LTS-скипа) |
| BL-22: OpenAPI для verifier-интеграции | открыт (пишется с нуля после DR-7) |
| Cloudflare watch paths | настроены архитектором и подтверждены наблюдениями (PR #10: core+react собрались, crypto пропущен; README-only push — ноль сборок) |

---

## 7. Сопоставление с планом §1 (verified baseline → факт на финише)

| Пункт базлайна | Было (0b73599) | Стало (896c9ed) |
|---|---|---|
| Seed | 32 байта = sha256(seed64) | 64 байта BIP39 напрямую (D1) |
| Derivation API | позиционный `length = 16` | options-object + ревизии + NFKC (D3) |
| Ошибки | сырые Error | единый `AttestationError{code, level}` |
| Ключевой материал | TS-private | ES `#private` + копирование + dispose() + redaction |
| Подпись аттестаций | raw ключ в аргументах | `Signer` (D2) |
| Цикл handle↔subhandle | динамический `import()` | ацикличный статический граф (D4) |
| verifyAttested | монолит ~210 строк | оркестратор + 5 стадий, байт-идентичный порядок |
| Конструкторы | публичные (Identity/Handle/Session) | private + фабрики; `fromVerified` @internal |
| btoa/atob | util.ts, handle.ts | `@scure/base`, scan-пин |
| randomUUID | без fallback | fallback getRandomValues → v4 + пин |
| engines | root `>=18`, core нет | `>=22` workspace-wide |
| Векторы | плейсхолдер-заглушки | 210 строк золотых + golden-тест |
| Coverage-гейты | нет | vitest thresholds 90/90 (core, crypto) в CI |
| Спека | specs/draft/core.md (мёртвый) | нормативная v1.0.md (318 строк) + §11 + §12 |
| Версии | 0.7.0-alpha.2 / 0.1.0-alpha.2 / 0.1.0-alpha.1 | 1.0.0-rc.1 ×3 |

---

## 8. Как проверить отчёт

```bash
# Мержи и их состав
git -C me2em-protocol log --merges --first-parent --reverse --format='%h %ad %s' --date=iso 0b73599..main
git -C me2em-protocol diff --shortstat 0b73599 main

# Нетто-дифф и счётчики
git -C me2em-protocol rev-list --count 0b73599..main
git -C me2em-protocol rev-list --count --no-merges 0b73599..main

# Локальная воспроизводимость финального состояния
corepack pnpm -r test:coverage   # 602/602; core 94.36/94.13/94.73/94.69

# Целостность векторов
git -C me2em-protocol log --oneline -- specs/test-vectors.json   # PR-3 (создание), PR-8 (+3 строки)

# Замороженная поверхность
$PAGER specs/v1.0.md   # §11 Module structure, §12 Public API freeze
```

*Отчёт подготовлен на ветке `analysis/lts-v1-audit` (Task 32 worklog). Ветка локальная и не идёт в main: push в origin отклонён политикой GitHub — PAT без `workflow` scope не может пушить ref, чьё дерево отличается от main в `.github/workflows/ci-security.yml` (базлайн предшествует CI-патчу PR-4). Обход через git data API сознательно не применялся. Ветка удаляется после приёмки архитектором.*
