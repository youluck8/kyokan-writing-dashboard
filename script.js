// ==== 設定 ====
const SHEET_ID = "15DN8OKsj7vlnj1AL9RbIF2M-SchyMYdA_iSloX6GZq0";
const PASSWORD = "kyokan5ki";
const REFRESH_INTERVAL_MS = 60 * 1000;

const gateEl = document.getElementById("gate");
const dashboardEl = document.getElementById("dashboard");

// ==== 簡易パスワードゲート ====
// 見た目は404ページ。ページ全体を覆う透明な入力欄をタップ(クリック)すると
// スマホでもソフトウェアキーボードが開き、入力できる。
// これはクライアント側の目隠しであり、真のアクセス制御ではありません。

function toHalfWidth(str) {
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .trim()
    .toLowerCase();
}

function tryUnlock(value) {
  if (toHalfWidth(value).includes(PASSWORD)) {
    sessionStorage.setItem("kyokanUnlocked", "1");
    unlock();
  }
}

function unlock() {
  gateEl.style.display = "none";
  dashboardEl.hidden = false;
  document.title = "共感ライティング 入会状況ダッシュボード";
  loadData();
  setInterval(loadData, REFRESH_INTERVAL_MS);
}

if (sessionStorage.getItem("kyokanUnlocked") === "1") {
  unlock();
} else if (toHalfWidth(location.hash.slice(1)) === PASSWORD) {
  // 保険用リンク: https://.../#kyokan5ki を直接開くと確実に解除できる
  unlock();
} else {
  const pwInput = document.getElementById("pwInput");
  pwInput.addEventListener("input", () => tryUnlock(pwInput.value));
  pwInput.focus();
  gateEl.addEventListener("click", () => pwInput.focus());
}

// ==== データ取得・描画 ====
function sheetLinkUrl() {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
}

async function loadData() {
  document.getElementById("sheetLink").href = sheetLinkUrl();

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&t=${Date.now()}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error("fetch failed", err);
    return;
  }
  if (!res.ok) {
    console.error("sheet fetch not ok", res.status);
    return;
  }
  const text = await res.text();
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) {
    console.error("unexpected sheet response format");
    return;
  }
  const json = JSON.parse(match[1]);
  const rows = (json.table.rows || []).map((r) => {
    const c = r.c || [];
    return {
      updated: cellValue(c[0]),
      category: cellValue(c[1]),
      label: cellValue(c[2]),
      status: cellValue(c[3]),
      plan: cellValue(c[4]),
      schedule: cellValue(c[5]),
      owner: cellValue(c[6]),
      memo: cellValue(c[7]),
    };
  });

  render(rows);
}

function cellValue(cell) {
  if (!cell || cell.v === null || cell.v === undefined) return "";
  return String(cell.v).trim();
}

function render(rows) {
  const categories = ["継続", "新規", "共通"];
  let latestDate = "";

  categories.forEach((cat) => {
    const catRows = rows.filter((r) => r.category === cat && (r.label || r.status || r.plan));
    const statusRows = catRows.filter((r) => !r.plan && !r.schedule);
    const planRows = catRows.filter((r) => r.plan || r.schedule);

    catRows.forEach((r) => {
      if (r.updated && r.updated > latestDate) latestDate = r.updated;
    });

    const statusBody = document.getElementById(`tbody-${cat}-status`);
    if (statusBody) {
      statusBody.innerHTML = "";
      if (statusRows.length === 0) {
        statusBody.appendChild(emptyRow(2));
      } else {
        statusRows.forEach((r) => {
          const tr = document.createElement("tr");
          const tdLabel = document.createElement("td");
          tdLabel.className = "label";
          tdLabel.textContent = r.label || "-";
          const tdVal = document.createElement("td");
          tdVal.textContent = [r.status, r.memo].filter(Boolean).join(" / ") || "-";
          tr.appendChild(tdLabel);
          tr.appendChild(tdVal);
          statusBody.appendChild(tr);
        });
      }
    }

    const planBody = document.getElementById(`tbody-${cat}-plan`);
    if (planBody) {
      planBody.innerHTML = "";
      if (planRows.length === 0) {
        planBody.appendChild(emptyRow(4));
      } else {
        planRows.forEach((r) => {
          const tr = document.createElement("tr");
          [r.plan, r.schedule, r.owner, r.memo].forEach((val) => {
            const td = document.createElement("td");
            td.textContent = val || "-";
            tr.appendChild(td);
          });
          planBody.appendChild(tr);
        });
      }
    }
  });

  document.getElementById("lastUpdated").textContent = latestDate || "-";
}

function emptyRow(colspan) {
  const tr = document.createElement("tr");
  tr.className = "empty-row";
  const td = document.createElement("td");
  td.colSpan = colspan;
  td.textContent = "データなし";
  tr.appendChild(td);
  return tr;
}
