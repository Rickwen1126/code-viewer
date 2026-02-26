# Design Tokens

Code Viewer Mobile — 致敬 VSCode Dark+ 色調。

所有 token 名稱對應 `design.pen` 中的 variables，前端實作時用 CSS custom properties `--{token-name}`。

---

## Colors

### Backgrounds

| Token | Hex | VSCode 對應 | 用途 |
|-------|-----|------------|------|
| `bg-page` | `#1E1E1E` | Editor Background | 主背景 |
| `bg-card` | `#252526` | Editor Widget | 卡片、Action Sheet、Tab Bar pill |
| `bg-sidebar` | `#181818` | Activity Bar / Sidebar | 深色嵌入區域 |
| `bg-activitybar` | `#181818` | Activity Bar | Tab Bar section 背景 |
| `bg-inset` | `#1E1E1E` | Editor Background | 嵌套區塊（code snippet 背景） |

### Text

| Token | Hex | VSCode 對應 | 用途 |
|-------|-----|------------|------|
| `text-primary` | `#D4D4D4` | Editor Foreground | 主文字、標題 |
| `text-secondary` | `#9CDCFE` | Variable Blue | 次要文字、meta info |
| `text-tertiary` | `#808080` | Comment Gray | Section labels、placeholder |
| `text-muted` | `#5A5A5A` | Inactive | 行號、disabled 狀態 |
| `text-inverted` | `#FFFFFF` | — | Accent 按鈕上的白字 |

### Accent

| Token | Hex | VSCode 對應 | 用途 |
|-------|-----|------------|------|
| `accent` | `#007ACC` | VSCode Blue | 主 accent、active tab、CTA 按鈕 |
| `accent-dim` | `#264F78` | Selection Highlight | Icon 底色、badge 背景、hover |

### Border

| Token | Hex | VSCode 對應 | 用途 |
|-------|-----|------------|------|
| `border` | `#3C3C3C` | Panel Border | 分隔線、stroke |

### Semantic

| Token | Hex | VSCode 對應 | 用途 |
|-------|-----|------------|------|
| `success` | `#6A9955` | Green | Tour completed、file added |
| `warning` | `#DCDCAA` | Yellow | Git modified、folder icon |
| `error` | `#F44747` | Red | 錯誤、diagnostics |

### Diff

| Token | Hex | 用途 |
|-------|-----|------|
| `line-added` | `#2EA04333` | 新增行背景 |
| `line-removed` | `#F8514933` | 刪除行背景 |
| `highlight-line` | `#264F7833` | 當前行 highlight |

### Syntax Highlighting (VSCode Dark+ 1:1)

| Token | Hex | VSCode Scope | 範例 |
|-------|-----|-------------|------|
| `keyword` | `#C586C0` | keyword.control | `async`, `function`, `import`, `export` |
| `function` | `#DCDCAA` | entity.name.function | `activate()`, `registerProviders()` |
| `variable` | `#9CDCFE` | variable | `ws`, `ctx`, `defProvider` |
| `type` | `#4EC9B0` | entity.name.type | `ExtensionContext`, `void` |
| `string` | `#CE9178` | string | `"hello"`, `'world'` |
| `number` | `#B5CEA8` | constant.numeric | `42`, `3.14` |
| `comment` | `#6A9955` | comment | `// re-register after restart` |

---

## Typography

### Font Families

| 用途 | Font | Fallback |
|------|------|----------|
| Code、資料、行號、badge、tab label | `JetBrains Mono` | `monospace` |
| 標題、描述、按鈕、body text | `Inter` | `system-ui, sans-serif` |

### Type Scale

| Size | Weight | Font | 用途 |
|------|--------|------|------|
| 24px | 600 | Inter | Screen title（Open a Repo, Code Tours） |
| 20px | 600 | Inter | Nav title（code-viewer） |
| 18px | 600 | Inter | Sub-page title（Architecture Walkthrough） |
| 18px | 700 | JetBrains Mono | Symbol name（action sheet） |
| 16px | 600 | Inter | Card title（Extension Activation Flow） |
| 15px | 600 | Inter / JetBrains Mono | Repo name、file name |
| 14px | 500 | JetBrains Mono | File tree item |
| 13px | 400 | Inter | Body text、description |
| 12px | 400-600 | JetBrains Mono | Code lines、path、meta |
| 11px | 400-600 | JetBrains Mono / Inter | Section label、step info、breadcrumb |
| 10px | 500-600 | JetBrains Mono | Tab bar label |
| 9px | 600-700 | JetBrains Mono | Badge text（ACTIVE, DEF, IN PROGRESS） |

### Letter Spacing

| Value | 用途 |
|-------|------|
| `2px` | Section label uppercase（PROJECTS, RECENT, TOURS） |
| `1.5px` | Step counter（STEP 3 OF 12） |
| `0.5px` | Tab label、badge text |
| `0` | 所有其他文字 |

### Line Height

| Value | 用途 |
|-------|------|
| `1.5` | Body text、tour description |
| `1.4` | Q&A text、card description |
| default | 所有其他文字 |

---

## Spacing

### Gap（元素之間）

| Value | 用途 |
|-------|------|
| 32px | Major section gap |
| 24px | Content wrapper gap |
| 20px | Tour content gap |
| 16px | Card internal gap、form group |
| 14px | Repo card icon-to-info |
| 12px | Card list gap、section header to content |
| 10px | Compact row gap |
| 8px | Action button gap、icon-to-text |
| 6px | Symbol info internal、breadcrumb segments |
| 4px | Tab icon-to-label、progress dots |
| 2px | File tree item gap、title-to-meta |

### Padding

| Value | 用途 |
|-------|------|
| `[0, 24, 32, 24]` | Content wrapper（top, right, bottom, left） |
| `[0, 20, 24, 20]` | Tour content wrapper |
| `16px` | Card padding (all sides) |
| `[14, 16]` | Action button（vertical, horizontal） |
| `[12, 21, 21, 21]` | Tab bar section（含 safe area） |
| `[10, 12]` | File tree row |
| `[10, 14]` | Symbol banner |
| `[4, 4]` | Tab bar pill |
| `[4, 10]` | Branch badge |
| `[2, 8]` | Status badge（ACTIVE, IN PROGRESS） |
| `[1, 6]` | DEF badge |

---

## Corner Radius

| Value | 用途 |
|-------|------|
| 36px | Tab bar pill |
| 26px | Tab item (active) |
| 22px | Ask input、send button |
| 20px | Action sheet top corners |
| 12px | Card、tour card、tab bar pill content badge |
| 10px | Action button、Q&A card |
| 8px | Search bar、file tree row hover、branch badge、icon container |
| 6px | Segmented control |
| 4px | Badge（ACTIVE, DEF, IN PROGRESS） |
| 3px | Progress bar |
| 2px | Handle bar、progress dots |

---

## Shadows & Effects

目前設計為 flat（無 shadow）。深度透過 `bg-page` → `bg-card` → `bg-sidebar` 的色差表達。

---

## Iconography

- **Icon Set:** Lucide
- **Tab bar:** 18px
- **Inline actions:** 20px
- **File tree:** 18px
- **Status bar:** 16px
- **Small inline:** 14px

---

## Screen Dimensions

| Property | Value |
|----------|-------|
| Screen width | 402px (iPhone standard) |
| Screen height | 874px (minimum) |
| Status bar height | 62px |
| Tab bar section height | 95px（12 + 62 + 21） |
| Tab bar pill height | 62px |
| Content area | screen - status bar - tab bar |
| Touch target minimum | 44px |

---

## CSS Custom Properties 對照表

```css
:root {
  /* Backgrounds */
  --bg-page: #1E1E1E;
  --bg-card: #252526;
  --bg-sidebar: #181818;
  --bg-activitybar: #181818;
  --bg-inset: #1E1E1E;

  /* Text */
  --text-primary: #D4D4D4;
  --text-secondary: #9CDCFE;
  --text-tertiary: #808080;
  --text-muted: #5A5A5A;
  --text-inverted: #FFFFFF;

  /* Accent */
  --accent: #007ACC;
  --accent-dim: #264F78;

  /* Border */
  --border: #3C3C3C;

  /* Semantic */
  --success: #6A9955;
  --warning: #DCDCAA;
  --error: #F44747;

  /* Diff */
  --line-added: #2EA04333;
  --line-removed: #F8514933;
  --highlight-line: #264F7833;

  /* Syntax */
  --syntax-keyword: #C586C0;
  --syntax-function: #DCDCAA;
  --syntax-variable: #9CDCFE;
  --syntax-type: #4EC9B0;
  --syntax-string: #CE9178;
  --syntax-number: #B5CEA8;
  --syntax-comment: #6A9955;

  /* Typography */
  --font-mono: 'JetBrains Mono', monospace;
  --font-sans: 'Inter', system-ui, sans-serif;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 20px;
  --radius-pill: 36px;
}
```
