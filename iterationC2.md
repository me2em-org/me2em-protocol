# ЗАДАНИЕ: Iteration C2 — seed phrase UX components for @me2em/react

Проект: packages/react, ветка react-01. Текущее состояние:
28 тестов зелёных (7 headless + 12 seed-words + 9 react), tsc чистый,
build работает.

Цель: четыре headless-компонент-машины + четыре React-компонента для
seed-фразы UX: отображение (с одноразовостью показа), верификация
(упорядоченный выбор по сетке), импорт, passphrase.

## ЖЕЛЕЗНЫЕ ПРАВИЛА

1. НЕ менять: packages/core/*, существующие headless/react файлы C1 —
   КРОМЕ явно указанного в T0 (использование нового контракта
   seed-words уже реализовано — его не трогать).
2. ИНВАРИАНТ СЛОЁВ: state-машины в src/headless/ — чистый TS, НОЛЬ
   react-импортов. Компоненты в src/react/ — тонкие обёртки над
   машинами: рендер + диспатч событий + доступность (a11y-атрибуты),
   НОЛЬ бизнес-логики.
3. Ноль новых зависимостей. Существующие (react, testing-library) —
   достаточно.
4. Комментарии самодостаточны; ПЕРВАЯ СТРОКА каждого нового/изменённого
   файла — path-comment (`// packages/react/src/...`).
5. Дизайн компонентов — headless по стилю: минимальная семантическая
   разметка (button, ol/li, input), НИКАКИХ классов/стилей/inline-styles
   кроме data-* атрибутов для тестирования. Потребитель стилизует сам.
6. Любой компонент с интерактивностью обязан иметь RTL-тест.
7. Несовпадение — NOTES.md "SPEC-MISMATCH" + отчёт.

---

## T0 — test-utils: ожидаемый фоновый шум

Файл: test/react/renderWithProvider.tsx (новый)

React dev бросает ошибки рендера через jsdom (шум "Uncaught [Error...]")
в тесте outside-Provider. Обернём:

    // packages/react/test/react/renderWithProvider.tsx
    import { render, renderHook, type RenderHookResult } from '@testing-library/react';
    import type { ReactNode } from 'react';
    import { Me2emProvider } from '../../src/react/Me2emProvider.js';

    interface CapturedError { message: string }

    /**
     * Renders a hook inside a Provider wrapped in an error boundary
     * that captures the first thrown error (for outside-Provider tests).
     */
    export function renderHookCapturingError(
      callback: () => unknown
    ): { captured: CapturedError | null; rerender: () => void } {
      let captured: CapturedError | null = null;
      function Boundary({ children }: { children: ReactNode }) {
        // rethrow manually: RTL renderHook does not support componentDidCatch
        return <>{children}</>;
      }
      void Boundary;
      // Simple approach: spy on console.error during the call is done
      // by the caller; here we only standardize the wrapper.
      const result: RenderHookResult<unknown, unknown> = renderHook(callback);
      return { captured, rerender: () => result.rerender(callback) };
    }

    /** Standard wrapper for hook tests. */
    export function withProvider(node: ReactNode): (props: { children: ReactNode }) => ReactNode {
      return ({ children }) => <Me2emProvider>{node ?? children}</Me2emProvider>;
    }

УПРОСТИ, если реализация выше не работает: главная цель файла —
единая точка wrapper'ов для всех новых тестов:
`withProvider()` для обычных случаев. Error boundary часть — удалить
из финальной версии, если не заработает чисто (отметить в отчёте).
Оставить минимум: withProvider + (опционально) generateTestSeed helper:

    import { get32ByteSeedFromMnemonic } from '@me2em/core';

    export const TEST_MNEMONIC =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    export async function testSeed(): Promise<Uint8Array> {
      return get32ByteSeedFromMnemonic(TEST_MNEMONIC);
    }

Все НОВЫЕ react-тесты используют withProvider/testSeed вместо локальных
wrapper'ов. Старые тесты НЕ трогать.

---

## T1 — headless: display machine + verify machine + import machine

### 1a. src/headless/display-flow.ts (одноразовость показа)

State-машина показа фразы. Ключевой инвариант из нашего протокола
безопасности: слова раскрываются ОДИН РАЗ; копирование целой фразой —
разрешено ровно once (clipboard-гигиена).

    // packages/react/src/headless/display-flow.ts
    export type DisplayStatus =
      | 'hidden'       // слова не показаны
      | 'revealed'     // показаны; можно скопировать ОДИН раз
      | 'copied'       // скопировано; повторное копирование запрещено
      | 'dismissed';   // пользователь скрыл (финал)

    export interface DisplayState {
      status: DisplayStatus;
      copyCount: number;      // 0 или 1 — инвариант
      revealedAt: number | null; // unix ms, для UI-таймеров
    }

    export type DisplayEvent =
      | { type: 'REVEAL'; at: number }
      | { type: 'COPY'; at: number }
      | { type: 'DISMISS' }
      | { type: 'RESET' };

    export function displayFlowReducer(state, event): DisplayState
    export const initialDisplayState: DisplayState = {
      status: 'hidden', copyCount: 0, revealedAt: null,
    };

Переходы:
- hidden  + REVEAL → revealed, revealedAt=at
- revealed + COPY (copyCount===0) → copied, copyCount=1
- revealed/copied + COPY (copyCount===1) → state БЕЗ ИЗМЕНЕНИЙ (warn)
- revealed/copied + DISMISS → dismissed
- copied/revealed + RESET → initial
- hidden + COPY → state без изменений + warn (нельзя копировать скрытое)
- любые невалидные → warn + state (паттерн identity-flow)

Тест test/headless/display-flow.spec.ts (минимум):
- reveal из hidden; copy из revealed (count=1); повторный copy — без
  изменений; copy из hidden — без изменений; dismiss; reset;
  инвариант copyCount ≤ 1 на всех переходах.

### 1b. src/headless/verify-flow.ts (упорядоченный выбор)

Машина поверх buildVerificationGrid/isGridSelectionCorrect (из C1,
контракт упорядоченный).

    // packages/react/src/headless/verify-flow.ts
    import { buildVerificationGrid, isGridSelectionCorrect } from './seed-words.js';

    export type VerifyStatus = 'collecting' | 'correct' | 'incorrect';

    export interface VerifyState {
      status: VerifyStatus;
      grid: { words: string[]; correctIndices: number[] };
      /** Indices of grid cells in CLICK order. */
      selected: number[];
      attempts: number;   // количество проверок
    }

    export type VerifyEvent =
      | { type: 'SELECT'; index: number }
      | { type: 'DESELECT'; index: number }
      | { type: 'CHECK' }
      | { type: 'RESET'; realWords: string[]; gridSize: number;
          randomSeed: number; allWords: readonly string[] };

    export function initVerifyState(
      realWords: string[], gridSize: number,
      randomSeed: number, allWords: readonly string[]
    ): VerifyState

    export function verifyFlowReducer(state, event): VerifyState

Переходы:
- init: построить grid, selected=[], status='collecting', attempts=0
- SELECT: index валиден (в границах сетки), ещё не выбран → push в
  selected. Уже выбран → warn + state (используй DESELECT)
- DESELECT: index в selected → удалить (именно его; дублей в selected
  нет)
- CHECK: если selected.length !== grid.correctIndices.length → warn +
  state (недобор). Иначе: isGridSelectionCorrect → 'correct' ИЛИ
  'incorrect', attempts+1. После 'correct'/'incorrect' новые SELECT
  игнорируются (warn) — только RESET
- RESET: заново init с новыми параметрами

Тест test/headless/verify-flow.spec.ts (минимум):
- init строит сетку правильного размера
- select добавляет, deselect убирает, двойной select — warn
- check с недобором — warn + collecting
- check с верным in-order выбором → correct
- check с неверным порядком → incorrect, attempts=1
- после correct: SELECT игнорируется
- repeated words (тест из C1-семантики): фраза с дублем выбирается
  корректно через правильный in-order порядок клеток

### 1c. src/headless/import-flow.ts

Машина пошагового ввода: пользователь вводит слова по позиции.

    // packages/react/src/headless/import-flow.ts
    import { validateSeedPhrase, type SeedStrength } from '@me2em/core';

    export type ImportStatus = 'entering' | 'valid' | 'invalid';

    export interface ImportState {
      status: ImportStatus;
      /** words by position; null = not entered yet */
      words: (string | null)[];
      expectedCount: 12 | 24;
    }

    export type ImportEvent =
      | { type: 'INIT'; expectedCount: 12 | 24 }
      | { type: 'SET_WORD'; position: number; word: string }
      | { type: 'CLEAR_WORD'; position: number }
      | { type: 'CHECK' }
      | { type: 'RESET' };

    export function initImportState(expectedCount: 12 | 24): ImportState
    export function importFlowReducer(state, event): ImportState

Правила:
- SET_WORD: position в границах [0, expectedCount), word →
  lowercase+trim ЗДЕСЬ (это не деривация, а UX-нормализация ввода;
  core-валидация всё равно выполняется в CHECK через validateSeedPhrase)
- CHECK: если есть null-позиции → invalid + error 'Fill all words'
  (status='invalid'). Иначе validateSeedPhrase(words) → valid/invalid
- invalid → пользователь правит слова (SET_WORD) → status='entering'
  (любая правка сбрасывает invalid)
- expectedCount: 12 или 24; INIT/RESET сбрасывают

Тест test/headless/import-flow.spec.ts (минимум 8):
- init 12 → words длины 12, все null
- SET_WORD нормализует (пробелы/регистр)
- SET_WORD вне границ — warn
- CHECK с null-позицией → invalid 'Fill all'
- CHECK с валидной фразой (взять сгенерированную через generateSeedPhrase)
  → valid
- CHECK с битой контрольной суммой → invalid
- SET_WORD после invalid → entering
- RESET

---

## T2 — React-компоненты (тонкие обёртки)

Общий паттерн каждого: props = { машина уже поднята хуком-обёрткой } или
компонент сам держит useReducer? РЕШЕНИЕ: компонент сам создаёт reducer
внутри себя (self-contained), state торчит наружу через callback-пропсы.
Это даёт простоту использования:

    <SeedPhraseVerify
      realWords={seedWords}
      gridSize={24}
      onVerified={() => ...}
      wordlist={BIP39_ENGLISH}
    />

### 2a. src/react/SeedPhraseDisplay.tsx

Props: { words: string[]; onDismiss?: () => void; onCopyAllowed?: () => void }
Внутри: displayFlowReducer.
UI (семантика):
- status hidden → единственная кнопка "Reveal" (data-testid="reveal")
- status revealed/copied → <ol data-testid="words"> c <li> по слову,
  каждый <li data-testid="word-N" data-position={i}>; кнопка "Copy all"
  (data-testid="copy-all"), disabled при copyCount=1 + текст "Copied";
  кнопка "Hide" (data-testid="dismiss")
- copy: navigator.clipboard.writeText(words.join(' ')) (в try/catch —
  в jsdom clipboard нет, тест мокает); диспатч COPY
- onDismiss вызывается при DISMISS (клик "Hide")
Показ слов: скрываются, если статус hidden.

Тест SeedPhraseDisplay.spec.tsx (RTL, минимум):
- initial: слова НЕ видны, кнопка reveal есть
- клик reveal → 12 li с текстами слов
- клик copy → clipboard вызван с join(' '); кнопка копирования
  disabled; (clipboard мокнуть: Object.assign(navigator, { clipboard:
  { writeText: vi.fn().mockResolvedValue(undefined) } }))
- повторный клик по disabled невозможен; но прямой вызов copy-хендлера
  после copied → state не меняется (через rerender-проверку текста
  кнопки)
- клик dismiss → слова скрыты, onDismiss вызван

### 2b. src/react/SeedPhraseVerify.tsx

Props: { realWords: string[]; gridSize?: number (default realWords.length + 8);
  wordlist: readonly string[]; onVerified: () => void; onFailed?: (attempts: number) => void }
Внутри: initVerifyState + useReducer(verifyFlowReducer).
UI:
- прогресс: "Select word N of realWords.length" (data-testid="progress")
- сетка кнопок: grid.words.map((w, i) => <button key={i}
  data-testid={`cell-${i}`} data-word={w} disabled={...}>
  — disabled: если слово уже выбрано (его позиция в selected) ИЛИ
  статус correct/incorrect
- клик клетки: если selected.length < correctIndices.length → SELECT,
  иначе ничего (все слова выбраны)
- на каждом select: если selected.length === correctIndices.length
  после добавления → автоматический CHECK (без кнопки Check — UX
  проще); onVerified при correct; onFailed при incorrect
- incorrect → показать "Try again" кнопку (data-testid="retry") →
  RESET с теми же параметрами (новый shuffle — seed инкрементируется:
  attempts использовать как salt к randomSeed)

Тест SeedPhraseVerify.spec.tsx (RTL, минимум):
- рендер: gridSize кнопок, прогресс "Select word 1 of 12"
- клики в правильном порядке (вычислить правильные клетки из
  realWords через поиск в DOM по data-word, учитывая повторы —
  повторный data-word выбирает СЛЕДУЮЩУЮ свободную клетку) →
  onVerified вызван
- клики в неправильном порядке → onFailed вызван, retry-кнопка видна
- клик retry → сетка перегенерирована (клетки сброшены), прогресс
  "Select word 1 of 12"

### 2c. src/react/SeedPhraseImport.tsx

Props: { expectedCount?: 12 | 24 (default 12);
  wordlist: readonly string[];
  onImported: (words: string[]) => void }
Внутри: importFlowReducer + локальный подсказочный autocomplete НЕ нужен
(MVP), но нужна валидация слова на лету: если введённое слово не в
wordlist → data-invalid="true" на input (подсветка — на стороне
потребителя).
UI:
- переключатель 12/24 (data-testid="count-12"/"count-24")
- expectedCount input'ов: <input data-testid={`word-${i}`}
  aria-label={`Word ${i+1}`} />
- кнопка Import (data-testid="import") disabled, пока машина в
  'entering' с null-позициями ИЛИ invalid; enabled только при 'valid'
- CHECK происходит автоматически: каждое изменение слова диспатчит
  SET_WORD + затем CHECK (debounce НЕ нужен — дёшево)
- onImported вызывается при переходе в valid (один раз за валидное
  состояние — guard по предыдущему статусу)

Тест SeedPhraseImport.spec.tsx (RTL, минимум):
- рендер: 12 инпутов, Import disabled
- ввод валидной фразы по позициям → Import enabled; клик → onImported
  с нормализованными словами
- ввод слова не из словаря → input data-invalid="true", Import disabled
- клик count-24 → 24 инпута
- битая checksum (валидные слова, неверный порядок) → Import disabled

### 2d. src/react/PassphraseInput.tsx

Props: { onPassphraseChange: (p: string) => void; showWarnings?: boolean (default true) }
Самый простой компонент:
- <input type="password" data-testid="passphrase" aria-label="BIP39 passphrase" />
- при showWarnings: текст-предупреждение (data-testid="warning"):
  "Passphrase is case-sensitive and NOT recoverable. A different
  passphrase silently derives a different wallet."
- onChange → normalize('NFKC') → onPassphraseChange

Тест PassphraseInput.spec.tsx (минимум 3):
- ввод вызывает onPassphraseChange с NFKC-нормализованным значением
  (ﬁle → file)
- warning отображается при showWarnings=true, отсутствует при false
- type="password"

### 2e. Экспорты: добавить в src/index.ts (barrel):
SeedPhraseDisplay, SeedPhraseVerify, SeedPhraseImport, PassphraseInput
(+ их props-типы). headless-машины: displayFlowReducer, verifyFlowReducer,
importFlowReducer, initVerifyState, initImportState + типы — в headless
namespace.

---

## T3 — Документация

packages/react/README.md — добавить секцию "Components" с примером
полного флоу: Provider → useCreateIdentity → generate → SeedPhraseDisplay
→ SeedPhraseVerify → confirmWords. Плюс краткие подписи к каждому
компоненту. Пример кода в README ОБЯЗАН быть согласован с реальными
пропсами.

---

## КОММИТЫ (порядок)

1. `feat(react): headless flow machines for display, verify, import`
2. `feat(react): seed phrase UX components`
3. `test(react): test-utils withProvider and component test coverage`
4. `docs(react): components section in README`

## КРИТЕРИИ ПРИЁМКИ

1. pnpm --filter @me2em/react test — все зелёные. Ожидание:
   28 (старые) + ~6 display-flow + ~7 verify-flow + ~8 import-flow
   (headless) + компонентные (мин. 5+3+5+3) = 60-65.
2. typecheck, build — чисто.
3. grep -rn "from 'react'" src/headless/ → пусто (инвариант).
4. grep -rn "className" src/react/*.tsx → пусто (headless-стиль).
5. Коммиты в react-01.

## ОТЧЁТ

Файлы, тесты (headless/react отдельно), все критерии, NOTES.md,
скриншот списка экспортов из index.ts.