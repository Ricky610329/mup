# MUP — Model UI Protocol

版本：`mup/2026-03-17`（草案）

---

# 協議

## 1. MUP 是什麼

**MUP** 是嵌入在 LLM 聊天介面中的互動式 UI 元件。它把視覺介面和可呼叫的函式綁在一起 — 使用者透過 UI 操作它，LLM 透過 function call 操作它，雙方都能看到彼此的動作。

最簡單的 MUP 就是一個 `.html` 檔案。不需要建置工具、不需要框架、不需要安裝 SDK。

```
          使用者
         ↗    ↖
    (視覺介面)  (自然語言)
       ↙          ↘
   MUP UI  ←→  LLM
        ↘    ↙
       Host Runtime
```

**核心概念：**

- **共用函式。** manifest 中宣告的函式，LLM 可以當 tool 呼叫，使用者也可以透過 UI 觸發。不是每個函式都需要對應按鈕，也不是每個按鈕都需要對應函式 — 但重疊的部分共用同一份實作。
- **LLM 作為協調者。** MUP 之間不直接通訊。LLM 居中調度：MUP A 的輸出送給 LLM，LLM 決定是否呼叫 MUP B。
- **Host 無關。** 本規格定義 MUP 的格式和通訊協議。Host 怎麼渲染、隔離、管理 MUP 是 host 的事。

---

## 2. 快速開始

一個完整的、可運作的 MUP：

```html
<!DOCTYPE html>
<html>
<head>
  <script type="application/mup-manifest">
  {
    "name": "Counter",
    "description": "一個計數器。使用者點 +/-，LLM 可以設定或讀取數值。",
    "grid": { "minWidth": 1, "minHeight": 1 },
    "functions": [
      {
        "name": "setCount",
        "description": "Set the counter to a specific value",
        "inputSchema": {
          "type": "object",
          "properties": { "value": { "type": "number" } },
          "required": ["value"]
        }
      },
      {
        "name": "getCount",
        "description": "Get the current counter value",
        "inputSchema": { "type": "object", "properties": {} }
      }
    ]
  }
  </script>
</head>
<body>
  <div id="count" style="font-size:48px; text-align:center; padding:20px;">0</div>
  <div style="text-align:center;">
    <button id="dec">−</button>
    <button id="inc">+</button>
  </div>
  <script>
    let count = 0;
    const el = document.getElementById('count');

    document.getElementById('dec').addEventListener('click', () => adjust(-1));
    document.getElementById('inc').addEventListener('click', () => adjust(+1));

    function adjust(delta) {
      count += delta;
      el.textContent = count;
      mup.notifyInteraction(
        delta > 0 ? 'increment' : 'decrement',
        `Counter is now ${count}`,
        { count }
      );
    }

    mup.registerFunction('setCount', async (params) => {
      count = params.value;
      el.textContent = count;
      return { content: [{ type: 'text', text: `Counter set to ${count}` }], isError: false };
    });

    mup.registerFunction('getCount', async () => {
      return { content: [{ type: 'text', text: `Counter is at ${count}` }, { type: 'data', data: { count } }], isError: false };
    });

    mup.onReady(() => {
      mup.updateState(`Counter: ${count}`, { count });
    });
  </script>
</body>
</html>
```

把這個檔案拖進任何 MUP 相容的 host，就可以運作了。（`grid` 是選填的 — 省略則使用 host 預設大小。）

---

## 3. Manifest

每個 MUP 在 `<script type="application/mup-manifest">` 標籤內宣告一個 JSON manifest。這告訴 host 你的 MUP 是什麼、需要多少空間、提供哪些函式。

### 必要欄位

| 欄位 | 型別 | 說明 |
|------|------|------|
| `name` | string | 顯示名稱。會出現在 host UI 中。 |
| `description` | string | 這個 MUP 做什麼。**LLM 會讀這段文字**來決定何時使用你的 MUP。同時為人類和 LLM 撰寫。 |

### 選填欄位

| 欄位 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| `protocol` | string | 當前版本 | 協議版本（如 `"mup/2026-03-17"`）。 |
| `id` | string | Host 生成 | 唯一識別碼。建議用反向域名（如 `"com.example.my-chart"`）。穩定的 ID 有助於 LLM 在跨 session 時記住你的 MUP。 |
| `version` | string | `"1.0.0"` | MUP 的語意版本。 |
| `grid` | object | Host 預設 | 大小偏好。見 [Grid](#4-grid)。 |
| `functions` | Function[] | `[]` | 可呼叫的函式。省略或空陣列 = 純展示用 MUP。 |
| `permissions` | string[] | `[]` | 需要的瀏覽器權限（如 `["camera", "microphone"]`）。Host 會限制你的容器只能使用宣告的權限。 |
| `author` | string | — | 作者名稱。 |
| `icon` | string | — | 圖示的 URL 或 data URI。 |

---

## 4. Grid

`grid` 物件是一個**選填的提示**，告訴 host 你的 MUP 偏好多少空間（以抽象的 grid cell 為單位）。Host 決定最終佈局——可以用 grid、浮動視窗、tab、sidebar 或任何其他排列方式。沒有 `grid` 的 MUP 會得到 host 的預設大小。

```json
{
  "minWidth": 2,
  "minHeight": 2,
  "maxWidth": 4,
  "maxHeight": 3,
  "preferredWidth": 2,
  "preferredHeight": 2,
  "resizable": true
}
```

所有欄位皆為選填：

| 欄位 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| `minWidth` | integer | 1 | 建議最小欄數（≥ 0） |
| `minHeight` | integer | 1 | 建議最小列數（≥ 0） |
| `maxWidth` | integer | minWidth | 建議最大欄數 |
| `maxHeight` | integer | minHeight | 建議最大列數 |
| `preferredWidth` | integer | minWidth | 理想欄數 |
| `preferredHeight` | integer | minHeight | 理想列數 |
| `resizable` | boolean | false | 提示此 MUP 適合讓使用者調整大小 |

這些是**提示，不是保證**。Host 可能根據可用空間、螢幕大小或自身的佈局策略分配不同的大小。

**Headless MUP：** 設定 `minWidth: 0, minHeight: 0` 表示沒有 UI、只有函式的 MUP。Host 不會為它顯示視覺介面。

---

## 5. 函式

函式是 MUP 的核心。每個函式可被 LLM 呼叫（作為 tool），也可以由你自己的 UI 觸發。

### 在 Manifest 中宣告

```json
{
  "name": "renderChart",
  "description": "Render a chart from the given data",
  "inputSchema": {
    "type": "object",
    "properties": {
      "type": { "type": "string", "enum": ["bar", "line", "pie"] },
      "data": { "type": "array", "items": { "type": "number" } }
    },
    "required": ["type", "data"]
  }
}
```

| 欄位 | 型別 | 必要 | 說明 |
|------|------|------|------|
| `name` | string | 是 | 函式名稱。必須符合 `^[a-zA-Z][a-zA-Z0-9_]*$`。 |
| `description` | string | 是 | 這個函式做什麼。**LLM 會讀這段文字**來決定何時呼叫它。 |
| `inputSchema` | JSON Schema | 是 | 函式參數的 JSON Schema。 |

### Function Result 格式

每個函式必須回傳一個 `FunctionCallResult`：

```typescript
{
  content: ContentItem[];
  isError: boolean;
}
```

每個 `ContentItem` 是以下之一：

| 型別 | 欄位 | 用途 |
|------|------|------|
| `text` | `{ type: "text", text: "..." }` | 人類/LLM 可讀的結果描述 |
| `data` | `{ type: "data", data: {...} }` | 讓 LLM 處理的結構化 JSON 資料 |
| `image` | `{ type: "image", data: "base64...", mimeType: "image/jpeg" }` | 圖片（如相機快照） |

至少包含一個 `text` 項目 — LLM 需要它來理解結果。

---

## 6. 生命週期

MUP 依循固定的階段順序：

```
load → initialize → onReady → active → shutdown → destroyed
```

**規則：**

1. **`registerFunction` 必須在 script 求值時同步呼叫** — 在 host 發送 `initialize` 之前。Host 在初始化時讀取已註冊的函式名稱；遲到的註冊會被忽略。
2. **Host 必須發送 `initialize` 恰好一次**，作為 MUP 載入後的第一個 JSON-RPC 訊息。
3. **Host 在收到 `initialize` 回應之前，不得發送 `functions/call`。** 在此之前的任何函式呼叫都是無效的。
4. **`gracePeriodMs` 到期後，host 可以直接銷毀容器**，不需等待 `notifications/shutdown/complete`。MUP 應盡快完成清理。
5. **`onReady` 在 `initialize` 成功後觸發。** 這是進行初始狀態設定、DOM 渲染和第一次 `updateState` 呼叫的正確時機。

---

## 7. 錯誤處理

### 函式錯誤

如果函式 handler 拋出例外，SDK 會攔截並回傳：

```json
{ "content": [{ "type": "text", "text": "Error: <message>" }], "isError": true }
```

Host 將此轉發給 LLM，讓它可以做出相應反應。

### 無效的函式呼叫

| 情境 | Host 行為 |
|------|----------|
| LLM 呼叫了 manifest 中不存在的函式名稱 | Host 回傳 JSON-RPC 錯誤（`-32601 Method not found`）。呼叫**不會**轉發給 MUP。 |
| `registerFunction` 使用了 manifest 中未宣告的名稱 | Host 應記錄警告。該函式**不可**被呼叫。 |
| 函式呼叫逾時（handler 沒有回應） | Host 可以在實作定義的逾時後回傳 `{ isError: true }`。 |

### 未知方法

雙方都可能遇到不認識的方法 — 例如，MUP 使用了 host 不支援的擴展方法。

- **Host** 收到不認識的 MUP→Host request，必須回傳 JSON-RPC 錯誤碼 `-32601`（Method not found）。
- **MUP** 收到不認識的 Host→MUP request，必須回傳 JSON-RPC 錯誤碼 `-32601`（Method not found）。
- 不認識的 **notification**（無 `id`）雙方應靜默忽略。
- 呼叫方收到 `-32601` 後，應優雅降級（如退回替代行為），而非視為致命錯誤。

### JSON-RPC 錯誤碼

Host 和 MUP 皆應使用標準 JSON-RPC 2.0 錯誤碼：

| 代碼 | 意義 |
|------|------|
| `-32600` | 無效的請求 |
| `-32601` | 方法未找到 |
| `-32603` | 內部錯誤 |

---

# 指引

## 8. SDK 參考

Host 會在你的 MUP 中注入一個全域 `mup` 物件。不需要 import。

### `mup.registerFunction(name, handler)`

註冊 manifest 中宣告的函式。

```javascript
mup.registerFunction('myFunc', async (params, source) => {
  // params: 符合 inputSchema 的物件
  // source: "llm" | "user"
  return { content: [...], isError: false };
});
```

### `mup.onReady(callback)`

Host 完成初始化後呼叫一次。用來設定初始狀態。

```javascript
mup.onReady((params) => {
  // params.gridAllocation = { width, height } — 你被分配到的 grid 大小
  // params.savedState = { ... } — 選用，host 提供的前次狀態（見「狀態持久化」）
  if (params.savedState) {
    restoreFrom(params.savedState);
  }
  mup.updateState('Ready', { initialized: true });
});
```

### `mup.updateState(summary, data?)`

告訴 host 你目前的狀態。Host 會把 `summary` 轉發給 LLM，讓 LLM 隨時知道你的 MUP 在做什麼。

```javascript
mup.updateState('Timer running: 45s remaining', { status: 'running', remaining: 45 });
```

**節流** — host 可能靜默丟棄過於頻繁的呼叫。呼叫頻率應與所回報的資料合理匹配。

### `mup.notifyInteraction(action, summary, data?)`

告訴 host 使用者在你的 UI 中做了什麼。Host 會把 `summary` 轉發給 LLM。

```javascript
mup.notifyInteraction('paint', 'User painted 12 pixels in red', { color: '#ff0000', count: 12 });
```

- `action`：機器可讀的識別碼（如 `"click"`、`"drag"`、`"toggle"`）
- `summary`：LLM 可讀的使用者行為描述
- `data`：選填的結構化資料

---

## 9. 寫好 Description

Manifest 和函式中的 `description` 欄位是 **LLM 唯一看到的東西**。它看不到你的 UI、你的 CSS、你的 HTML。寫 description 時，想像你在向同事解釋這個 MUP 做什麼、每個函式什麼時候該用。

**Manifest description — 好的：**
> A 16×16 pixel art canvas. Users paint by clicking/dragging. LLM can set pixels, draw shapes, or clear the canvas. Both sides work on the same grid.

**Manifest description — 不好的：**
> Pixel art tool.

**Function description — 好的：**
> Take a photo from the camera and return it as a base64 JPEG image. Use this when the user asks you to look at something or analyze what's in front of them.

**Function description — 不好的：**
> Capture photo.

---

## 10. 最佳實踐

### updateState vs. notifyInteraction

| | `updateState` | `notifyInteraction` |
|--|---------------|---------------------|
| **何時** | 狀態改變（計時器跳動、資料載入完成） | 使用者做了什麼（點擊、打字、拖拉） |
| **目的** | 讓 LLM 知道目前狀態 | 告訴 LLM 使用者的動作 |
| **節流** | Host 可丟棄過頻呼叫 | 每個事件，但快速動作請批次處理 |

### 處理並發函式呼叫

Host 可能在上一個呼叫還在執行時再次呼叫你的函式。兩種策略：

1. **排隊** — 用簡單的 promise chain 依序處理。適合函式會修改共享狀態的情況。
2. **冪等** — 每次呼叫都是完整的狀態替換（如 `setPixels` 覆蓋所有像素）。不可能衝突。

避免依賴呼叫順序，或假設同一時間只有一個呼叫在執行。

### 狀態持久化（選用）

Host 可以在不同 session 之間保存 MUP 的狀態，並在重新載入時恢復。這是一個合作機制 — 需要 host 和 MUP 雙方配合。

**運作方式：**

1. **MUP 回報狀態** — 呼叫 `updateState(summary, data)`，其中 `data` 包含恢復所需的所有狀態。這和你平常用來通知 LLM 的呼叫是同一個。

2. **Host 保存 `data`** — host 將最近一次 `updateState` 的 `data` 作為 session 儲存的一部分持久化。

3. **Host 在重新載入時傳回 `savedState`** — 當 host 重新初始化 MUP 時，在 `initialize` 參數中包含 `savedState` 欄位：

```json
{
  "method": "initialize",
  "params": {
    "protocolVersion": "mup/2026-03-17",
    "hostInfo": { "name": "MUP Agent", "version": "0.1.0" },
    "gridAllocation": { "width": 2, "height": 2 },
    "savedState": { "count": 42 }
  }
}
```

4. **MUP 恢復** — 在 `onReady` 中檢查 `params.savedState` 並恢復：

```javascript
mup.onReady((params) => {
  if (params.savedState) {
    count = params.savedState.count;
    updateDisplay();
  }
  mup.updateState('Counter: ' + count, { count });
});
```

**規則：**

- `savedState` 在 `initialize` 參數中是**選用的**。MUP 不得假設它一定存在。
- 不支援持久化的 MUP 直接忽略 `savedState`。不需要修改任何程式碼。
- `updateState` 的 `data` 參數應該是**可 JSON 序列化的**，並包含恢復 MUP 視覺和邏輯狀態所需的一切。
- Host 不被要求實作狀態持久化。這是 host 的能力，不是協議要求。

### 保持 MUP 自包含

MUP 應該零外部依賴就能運作。內嵌你的 CSS、打包你的 JS、嵌入你的素材。Host 會原封不動載入你的 HTML — 不保證有模組解析或 CDN 存取。

### 權限

如果你需要瀏覽器 API（相機、麥克風、地理位置），在 `permissions` 中宣告。Host 只會授予你宣告的權限。不要要求你不需要的權限。

---

# 附錄

## 附錄 A：JSON-RPC 2.0（給 host 實作者）

所有 host↔MUP 通訊使用 JSON-RPC 2.0，經由 `MessageChannel`（或等效機制）。SDK 處理序列化 — MUP 作者不需要知道這些。Host 實作者請參考 [JSON-RPC 2.0 規格](https://www.jsonrpc.org/specification)。

### Host → MUP 訊息

| 方法 | 類型 | 說明 |
|------|------|------|
| `initialize` | Request | 載入後的第一個訊息。參數：`protocolVersion`、`hostInfo`、`gridAllocation`、`savedState?`（選用，用於狀態持久化）。MUP 回覆協議版本和資訊。觸發 `onReady`。 |
| `functions/call` | Request | 呼叫已註冊的函式。參數：`name`、`arguments`、`source`（`"llm"` 或 `"user"`）。 |
| `notifications/grid/resize` | Notification | Host 調整了 MUP 的分配空間。參數：`width`、`height`。 |
| `notifications/shutdown` | Notification | Host 即將銷毀容器。參數：`reason`、`gracePeriodMs`。 |

### MUP → Host 訊息

| 方法 | 類型 | 說明 |
|------|------|------|
| `notifications/state/update` | Notification | MUP 狀態變更。參數：`summary`、`data?`。 |
| `notifications/interaction` | Notification | 使用者與 MUP UI 互動。參數：`action`、`summary`、`data?`。 |
| `notifications/shutdown/complete` | Notification | MUP 確認收到關閉通知。無參數。 |

## 附錄 B：與 MCP 的比較

MUP 和 MCP 是互補的 — MCP 負責連接 LLM 與後端工具及資料；MUP 負責將互動式 UI 帶給使用者。Host 可以同時支援兩個協議。

| | MCP | MUP |
|--|-----|-----|
| **目的** | 連接 LLM 與資料/工具 | 將互動式 UI 嵌入 LLM 聊天 |
| **有 UI** | 否 | 是 |
| **使用者能互動** | 否 | 是 |
| **執行環境** | 伺服器（任何語言） | 瀏覽器 |
| **格式** | 伺服器程序 | HTML 檔案 |
| **傳輸** | JSON-RPC 2.0 (stdio/SSE/HTTP) | JSON-RPC 2.0 (MessageChannel) |
| **LLM 看到** | Tool 定義 | Tool 定義 |
| **使用者看到** | 無 | 互動式 UI |
| **瀏覽器 API** | 否 | 是（相機、檔案、音訊、GPU） |
