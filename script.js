// ==== 設定 ====
const SHEET_ID = "1wDGrV4EcFwtUGWGaQQzOKqUPf_jd7SJ1M8RmRk_-ais";
const MAIN_TAB_NAME = "サマリー・備考";
const PROMO_TAB_NAME = "プロモーション計画";
const GOKI_TAB_NAME = "5期継続者に向けて";
const PREMIUM_SHEET_ID = "1OMHSOrxjNJWAM7wuBSFv1t2n7p67Rj5sgRUPmDGLXN0";
const BASIC_SHEET_ID = "1oGQaFvoUqVpGqznyLo8O2_xao9hQ_ZQNR33WCtZ28BQ";
const PREMIUM_PRICE = 180000;
const BASIC_PRICE = 90000;
const PASSWORD = "kyokan5ki";
const REFRESH_INTERVAL_MS = 60 * 1000;
const DASHBOARD_TITLE = "共感ライティング5期プロモーションダッシュボード";

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
  document.title = DASHBOARD_TITLE;
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
function sheetLinkUrl(sheetId) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}

async function fetchGvizRows(sheetId, sheetName) {
  const sheetParam = sheetName ? `&sheet=${encodeURIComponent(sheetName)}` : "";
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json${sheetParam}&t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sheet fetch not ok: ${res.status}`);
  const text = await res.text();
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) throw new Error("unexpected sheet response format");
  const json = JSON.parse(match[1]);
  if (json.status === "error") throw new Error(`gviz error: ${JSON.stringify(json.errors)}`);
  return json.table.rows || [];
}

function toPlanRows(rawRows) {
  return rawRows.map((r) => {
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
      progress: cellValue(c[8]), // 進捗ステータス: 未実施/着手/完了
      result: cellValue(c[9]), // 結果
    };
  });
}

// 表示順: 着手 → 未実施(空欄含む) → 完了
const PROGRESS_ORDER = { 着手: 0, 未実施: 1, 完了: 2 };

function buildPromoListItems(container, rows) {
  container.innerHTML = "";
  const usable = rows.filter((r) => r.plan || r.schedule);
  if (usable.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-item";
    li.textContent = "スプレッドシートに施策を追加してください";
    container.appendChild(li);
    return;
  }
  const sorted = [...usable].sort(
    (a, b) => (PROGRESS_ORDER[a.progress] ?? 1) - (PROGRESS_ORDER[b.progress] ?? 1)
  );
  sorted.forEach((r) => {
    const li = document.createElement("li");
    if (r.progress === "完了") li.classList.add("promo-done");

    const textSpan = document.createElement("span");
    textSpan.className = "promo-text";
    const parts = [r.plan];
    if (r.schedule) parts.push(`（${r.schedule}）`);
    if (r.owner) parts.push(` 担当:${r.owner}`);
    textSpan.textContent = parts.join("");
    li.appendChild(textSpan);

    if (r.progress) {
      const statusSpan = document.createElement("span");
      statusSpan.className = `promo-status status-${r.progress}`;
      statusSpan.textContent = ` [${r.progress}]`;
      li.appendChild(statusSpan);
    }

    if (r.result) {
      const resultSpan = document.createElement("span");
      resultSpan.className = "promo-result";
      resultSpan.textContent = `結果: ${r.result}`;
      li.appendChild(document.createElement("br"));
      li.appendChild(resultSpan);
    }

    if (r.memo) {
      const memoSpan = document.createElement("span");
      memoSpan.className = "promo-memo";
      memoSpan.textContent = ` ${r.memo}`;
      li.appendChild(memoSpan);
    }
    container.appendChild(li);
  });
}

async function loadData() {
  document.getElementById("sheetLink").href = sheetLinkUrl(SHEET_ID);
  document.getElementById("premiumSheetLink").href = sheetLinkUrl(PREMIUM_SHEET_ID);
  document.getElementById("basicSheetLink").href = sheetLinkUrl(BASIC_SHEET_ID);

  try {
    // 1枚目のタブ(サマリー・備考)と「プロモーション計画」タブの両方を読み込んで統合する
    const [mainRaw, promoRaw] = await Promise.all([
      fetchGvizRows(SHEET_ID, MAIN_TAB_NAME),
      fetchGvizRows(SHEET_ID, PROMO_TAB_NAME).catch((err) => {
        console.error("promo tab load failed (未作成の可能性があります)", err);
        return [];
      }),
    ]);
    render([...toPlanRows(mainRaw), ...toPlanRows(promoRaw)]);
  } catch (err) {
    console.error("main sheet load failed", err);
  }

  try {
    const gokiRaw = await fetchGvizRows(SHEET_ID, GOKI_TAB_NAME);
    const gokiList = document.getElementById("goki-list");
    if (gokiList) buildPromoListItems(gokiList, toPlanRows(gokiRaw));
  } catch (err) {
    console.error("5期継続者に向けて tab load failed (未作成の可能性があります)", err);
  }

  const [premium, basic] = await Promise.all([
    loadMemberSheet(PREMIUM_SHEET_ID, "プレミアム", "summary-premium", "tbody-premium-list").catch((err) => {
      console.error("premium sheet load failed", err);
      return null;
    }),
    loadMemberSheet(BASIC_SHEET_ID, "ベーシック", "summary-basic", "tbody-basic-list").catch((err) => {
      console.error("basic sheet load failed", err);
      return null;
    }),
  ]);

  if (premium && basic) {
    renderTopSummary(premium, basic);
  }
}

function yen(n) {
  return `${n.toLocaleString("ja-JP")}円`;
}

function renderTopSummary(premiumStats, basicStats) {
  // 継続者数は未入金の申込者も含めた人数(=申込総数)
  const totalCount = premiumStats.total + basicStats.total;
  document.getElementById("kpi-count").textContent =
    `${totalCount}名（プレミアム${premiumStats.total}名、ベーシック${basicStats.total}名）`;

  const premiumRevenue = premiumStats.paid * PREMIUM_PRICE;
  const basicRevenue = basicStats.paid * BASIC_PRICE;
  const totalRevenue = premiumRevenue + basicRevenue;
  document.getElementById("kpi-revenue-by-course").textContent =
    `${yen(totalRevenue)}（プレミアム${yen(premiumRevenue)}、ベーシック${yen(basicRevenue)}）`;

  const premiumPending = premiumStats.unpaid * PREMIUM_PRICE;
  const basicPending = basicStats.unpaid * BASIC_PRICE;
  const totalPending = premiumPending + basicPending;
  document.getElementById("kpi-revenue-total").textContent =
    `${yen(totalRevenue)}（未入金${yen(totalPending)}）`;
}

// マイスピー転記シート: ユーザーID, 本登録完了日時, 姓, 名, メールアドレス, 状況・メモ(F列, 手入力)
// 入金完了時にマイスピーが同じユーザーIDで新しい行を末尾に追加する仕様のため、
// ユーザーIDで重複排除し、入金済みの行を優先する。
async function loadMemberSheet(sheetId, courseLabel, summaryElId, tbodyId) {
  const rawRows = await fetchGvizRows(sheetId);
  const byUserId = new Map();
  rawRows.forEach((r) => {
    const c = r.c || [];
    const userId = cellValue(c[0]);
    const entry = {
      completedAt: cellValue(c[1]),
      lastName: cellValue(c[2]),
      firstName: cellValue(c[3]),
      notes: cellValue(c[5]),
    };
    const key = userId || `${entry.lastName}_${entry.firstName}`;
    const existing = byUserId.get(key);
    if (!existing || (!existing.completedAt && entry.completedAt)) {
      // 既存が未入金 or 未登録で、今回の行が入金済みなら上書き(または新規登録)
      byUserId.set(key, {
        ...entry,
        notes: entry.notes || (existing && existing.notes) || "",
      });
    } else if (existing && !entry.notes && existing.notes) {
      // 何もしない(既存のメモを維持)
    }
  });
  const members = [...byUserId.values()];

  const paidCount = members.filter((m) => m.completedAt).length;
  const unpaidCount = members.length - paidCount;

  document.getElementById(summaryElId).textContent =
    `合計 ${members.length}名 / 未入金 ${unpaidCount}名`;

  // 未入金の方をフォローアップしやすいよう先に表示
  const sorted = [...members].sort((a, b) => (a.completedAt ? 1 : 0) - (b.completedAt ? 1 : 0));

  const tbody = document.getElementById(tbodyId);
  tbody.innerHTML = "";
  if (sorted.length === 0) {
    tbody.appendChild(emptyRow(2));
  } else {
    sorted.forEach((m) => {
      tbody.appendChild(memberRow(m));
    });
  }

  return { paid: paidCount, unpaid: unpaidCount, total: members.length, members, courseLabel };
}

function memberRow(m) {
  const tr = document.createElement("tr");
  const tdName = document.createElement("td");
  tdName.className = "name";
  const fullName = `${m.lastName} ${m.firstName}`.trim() || "-";
  tdName.textContent = fullName;
  if (!m.completedAt) {
    const tag = document.createElement("span");
    tag.className = "unpaid-tag";
    tag.textContent = "（未入金）";
    tdName.appendChild(document.createTextNode(" "));
    tdName.appendChild(tag);
  }
  const tdNotes = document.createElement("td");
  tdNotes.className = "notes";
  tdNotes.textContent = m.notes || "-";
  tr.appendChild(tdName);
  tr.appendChild(tdNotes);
  return tr;
}

function cellValue(cell) {
  if (!cell) return "";
  // 日付セルは f (書式済み文字列) を優先。v は Date(y,m,d,...) という生の形式になるため。
  if (cell.f !== undefined && cell.f !== null && cell.f !== "") return String(cell.f).trim();
  if (cell.v === null || cell.v === undefined) return "";
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

    const promoList = document.getElementById(`promo-${cat}-list`);
    if (promoList) buildPromoListItems(promoList, planRows);
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
