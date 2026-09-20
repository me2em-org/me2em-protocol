# NOTES.md — CI1 Iteration: DevSecOps Pipeline

## Решения

### Audit — informational (non-blocking)
`pnpm audit --prod --audit-level high` выполняется с `continue-on-error: true`.
На PR — информационный, не блокирует мёрж. Причина: в monorepo с alpha-пакетами
зависимости часто имеют known vulnerabilities, которые ещё не исправлены в
релизах. Блокировка audit приведёт к false-positive blocking. Решение пересмотреть
при появлении policy document от архитектора.

### CodeQL — без install/build
CodeQL инициализируется напрямую (`javascript-typescript`) без стадии
install/build. Причина: JavaScript/TypeScript проекты не требуют автопостроения
для статического анализа; CodeQL сам парсит AST из исходников. Это сокращает
время пайплайна на ~2-3 минуты.

### Node 22
Все job'ы используют Node 22 (через matrix). pnpm/action-setup@v4 не указывает
явную version — берётся из `packageManager: "pnpm@10.11.1"` корня.

### .gitleaks.toml — адаптация формата
ТЗ указывает формат с `[[rules.allowlist]]` (массив). gitleaks v8 (используется
в `gitleaks/gitleaks-action@v2`) требует `allowlist` как single map, привязанный
к rule с regex/path. Конфиг адаптирован: одно правило с regex, покрывающим все
тест-паттерны, и allowlist для фильтрации false positives.

### .gitleaksignore
Создан пустым с комментарием-заглушкой. Наполняется ТОЛЬКО после пробного прогона,
если gitleaks найдёт false positives, которые нельзя выразить в .gitleaks.toml.

### README CI-бейдж
Обновлён с `ci.yml` → `ci-security.yml`. Старый `ci.yml` пустой (0 байт,
33+ Failures из-за отсутствия event triggers).

## SPEC-MISMATCH

1. **T1 — ci.yml → ci-security.yml**: ТЗ требует «заменить пустой ci.yml», но
   файл переименован в `ci-security.yml` (сохраняем старый пустой ci.yml как
   есть — не трогаем его, создаём новый). Бейдж в README обновлён на новый файл.

2. **T2 — .gitleaks.toml формат**: ТЗ указывает `[[rules.allowlist]]` как массив
   TOML-таблиц. gitleaks v8 требует `allowlist` как single map внутри rule.
   Конфиг переписан в совместимом формате (одно правило с regex + allowlist map).

3. **T4 — README badge**: ТЗ говорит «раскомментировать; если не комментировался —
   оставить». Бейдж уже был активен (не закомментирован). Обновлён filename на
   `ci-security.yml`.

## Локальный gitleaks-отчёт

- **До allowlist** (default config): 0 findings
- **После allowlist** (.gitleaks.toml с адаптацией): 0 findings
- **Находки**: 0 (все тест-фикстуры не триггерят default правила gitleaks)
- **Тест-фикстуры проверены**: BIP39 mnemonics (`abandon...`), `Uint8Array.fill(0x..)` —
  не попадают в default rules gitleaks, allowlist добавлен превентивно.

## Файлы, изменённые в рабочей директории

| Файл | Действие |
|------|----------|
| `.github/workflows/ci-security.yml` | Создан — полный DevSecOps пайплайн |
| `.gitleaks.toml` | Создан — превентивный allowlist |
| `.gitleaksignore` | Создан — пустой, placeholder |
| `README.md` | Обновлён — CI бейдж → ci-security.yml |
| `NOTES.md` | Создан — этот файл |

## Коммиты

НЕ ДЕЛАТЬ. Работать в рабочем дереве.
