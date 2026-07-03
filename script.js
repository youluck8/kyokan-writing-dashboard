// ==== 設定 ====
const SHEET_ID = "1wDGrV4EcFwtUGWGaQQzOKqUPf_jd7SJ1M8RmRk_-ais";
const MAIN_TAB_NAME = "サマリー・備考";
const PROMO_CONTINUE_TAB_NAME = "【継続】プロモーション";
const PROMO_NEW_TAB_NAME = "【新規】プロモーション";
const GOKI_TAB_NAME = "5期スケジュール";
const PREMIUM_SHEET_ID = "1OMHSOrxjNJWAM7wuBSFv1t2n7p67Rj5sgRUPmDGLXN0";
const BASIC_SHEET_ID = "1oGQaFvoUqVpGqznyLo8O2_xao9hQ_ZQNR33WCtZ28BQ";
const PREMIUM_PRICE = 180000;
const BASIC_PRICE = 90000;
const PASSWORD = "kyokan5ki";
const REFRESH_INTERVAL_MS = 60 * 1000;
const DASHBOARD_TITLE = "共感5期ダッシュボード";

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

async function fetchGvizTable(sheetId, sheetName) {
  const sheetParam = sheetName ? `&sheet=${encodeURIComponent(sheetName)}` : "";
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json${sheetParam}&t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sheet fetch not ok: ${res.status}`);
  const text = await res.text();
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) throw new Error("unexpected sheet response format");
  const json = JSON.parse(match[1]);
  if (json.status === "error") throw new Error(`gviz error: ${JSON.stringify(json.errors)}`);
  return json.table || { cols: [], rows: [] };
}

async function fetchGvizRows(sheetId, sheetName) {
  return (await fetchGvizTable(sheetId, sheetName)).rows || [];
}

// 1行目の見出しをそのままキーにしたオブジェクトへ変換する。
// 列を追加/変更/削除しても、見出し名がそのまま反映されるようにするため、固定の列番号には依存しない。
function toDynamicRows(table) {
  const headers = (table.cols || []).map((c) => (c.label || "").trim());
  return (table.rows || []).map((r) => {
    const obj = {};
    (r.c || []).forEach((cell, i) => {
      const key = headers[i];
      if (key) obj[key] = cellValue(cell);
    });
    return obj;
  });
}

// サマリー・備考タブ用(旧スキーマ): 更新日,カテゴリ,項目,現状,今後の施策,スケジュール,担当,メモ
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
    };
  });
}

// 重要度・進捗ステータス・更新日・カテゴリは特別扱いする列名。それ以外は見出し名がそのまま表示される。
const SPECIAL_HEADERS = ["更新日", "カテゴリ", "重要度", "進捗ステータス"];
const IMPORTANCE_ORDER = { 高: 0, 中: 1, 低: 2 };

function hasContent(row) {
  return Object.keys(row).some((k) => !SPECIAL_HEADERS.includes(k) && row[k]);
}

// 未着手/着手(実施中)を上、完了を下。各グループ内は重要度(高→中→低)で並び替え
function sortPromoRows(rows) {
  return [...rows].sort((a, b) => {
    const doneA = a["進捗ステータス"] === "完了" ? 1 : 0;
    const doneB = b["進捗ステータス"] === "完了" ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    return (IMPORTANCE_ORDER[a["重要度"]] ?? 1) - (IMPORTANCE_ORDER[b["重要度"]] ?? 1);
  });
}

// 見出し(1行目)をそのままラベルとして使い、値がある列だけを列挙して表示する。
// 列を追加/変更しても、コードを直さずに自動で反映される。
function buildPromoListItems(container, rows) {
  container.innerHTML = "";
  const usable = rows.filter(hasContent);
  if (usable.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-item";
    li.textContent = "スプレッドシートに施策を追加してください";
    container.appendChild(li);
    return;
  }
  sortPromoRows(usable).forEach((r) => {
    const importance = r["重要度"];
    const progress = r["進捗ステータス"];
    const li = document.createElement("li");
    // 重要度で枠・背景色を変える(完了の場合はグレーアウトを優先)
    if (importance) li.classList.add(`importance-${importance}`);
    if (progress === "完了") li.classList.add("promo-done");

    if (importance) {
      const impSpan = document.createElement("span");
      impSpan.className = `promo-importance importance-badge-${importance}`;
      impSpan.textContent = importance;
      li.appendChild(impSpan);
    }

    // 特別扱い以外の列のうち、最初に値が入っている列をタイトル扱いにする。
    // 「担当」はタイトル行に直接添える(別行に並べない)。
    const otherKeys = Object.keys(r).filter((k) => !SPECIAL_HEADERS.includes(k) && k !== "担当" && r[k]);
    const titleKey = otherKeys[0];
    const restKeys = otherKeys.slice(1);

    const textSpan = document.createElement("span");
    textSpan.className = "promo-text";
    let titleText = titleKey ? r[titleKey] : "";
    if (r["担当"]) titleText += ` 担当:${r["担当"]}`;
    textSpan.textContent = titleText;
    li.appendChild(textSpan);

    if (progress) {
      const statusSpan = document.createElement("span");
      statusSpan.className = `promo-status status-${progress}`;
      statusSpan.textContent = progress;
      li.appendChild(statusSpan);
    }

    restKeys.forEach((key) => {
      const noteDiv = document.createElement("div");
      noteDiv.className = "promo-note";
      noteDiv.textContent = `${key}: ${r[key]}`;
      li.appendChild(noteDiv);
    });

    container.appendChild(li);
  });
}

// 見出しは常にタブ名の設定(定数)と同じ文字列にする。表示名とフェッチ先のズレを防ぐため。
function applyTabTitles() {
  document.getElementById("promo-継続-title").textContent = PROMO_CONTINUE_TAB_NAME;
  document.getElementById("promo-新規-title").textContent = PROMO_NEW_TAB_NAME;
  document.getElementById("goki-title").textContent = GOKI_TAB_NAME;
}

async function loadData() {
  applyTabTitles();
  document.getElementById("sheetLink").href = sheetLinkUrl(SHEET_ID);
  document.getElementById("premiumSheetLink").href = sheetLinkUrl(PREMIUM_SHEET_ID);
  document.getElementById("basicSheetLink").href = sheetLinkUrl(BASIC_SHEET_ID);

  try {
    const mainRaw = await fetchGvizRows(SHEET_ID, MAIN_TAB_NAME);
    render(toPlanRows(mainRaw));
  } catch (err) {
    console.error("main sheet load failed", err);
  }

  const emptyTable = { cols: [], rows: [] };
  const [continueTable, newTable, gokiTable] = await Promise.all([
    fetchGvizTable(SHEET_ID, PROMO_CONTINUE_TAB_NAME).catch((err) => {
      console.error("【継続】プロモ tab load failed (未作成の可能性があります)", err);
      return emptyTable;
    }),
    fetchGvizTable(SHEET_ID, PROMO_NEW_TAB_NAME).catch((err) => {
      console.error("【新規】プロモ tab load failed (未作成の可能性があります)", err);
      return emptyTable;
    }),
    fetchGvizTable(SHEET_ID, GOKI_TAB_NAME).catch((err) => {
      console.error("5期スケジュール tab load failed (未作成の可能性があります)", err);
      return emptyTable;
    }),
  ]);
  const continueRows = toDynamicRows(continueTable);
  const newRows = toDynamicRows(newTable);
  const gokiRows = toDynamicRows(gokiTable);

  const continueList = document.getElementById("promo-継続-list");
  const newList = document.getElementById("promo-新規-list");
  const gokiList = document.getElementById("goki-list");
  if (continueList) buildPromoListItems(continueList, continueRows);
  if (newList) buildPromoListItems(newList, newRows);
  if (gokiList) buildPromoListItems(gokiList, gokiRows);
  updateLastUpdated([...continueRows, ...newRows, ...gokiRows].map((r) => r["更新日"]));

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

// メインの数値の下に、括弧書きの内訳を改行して表示する
function renderKpiValue(elId, mainText, breakdownText) {
  const el = document.getElementById(elId);
  el.innerHTML = "";
  el.appendChild(document.createTextNode(mainText));
  const breakdown = document.createElement("span");
  breakdown.className = "kpi-breakdown";
  breakdown.textContent = breakdownText;
  el.appendChild(breakdown);
}

function renderTopSummary(premiumStats, basicStats) {
  // 継続者数は未入金の申込者も含めた人数(=申込総数)
  const totalCount = premiumStats.total + basicStats.total;
  renderKpiValue(
    "kpi-count",
    `${totalCount}名`,
    `（プレミアム${premiumStats.total}名、ベーシック${basicStats.total}名）`
  );

  const premiumRevenue = premiumStats.paid * PREMIUM_PRICE;
  const basicRevenue = basicStats.paid * BASIC_PRICE;
  const totalRevenue = premiumRevenue + basicRevenue;
  renderKpiValue(
    "kpi-revenue-by-course",
    yen(totalRevenue),
    `（プレミアム${yen(premiumRevenue)}、ベーシック${yen(basicRevenue)}）`
  );

  const premiumPending = premiumStats.unpaid * PREMIUM_PRICE;
  const basicPending = basicStats.unpaid * BASIC_PRICE;
  const totalPending = premiumPending + basicPending;
  renderKpiValue("kpi-revenue-total", yen(totalRevenue), `（未入金${yen(totalPending)}）`);
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
  const catRows = rows.filter((r) => r.category === "共通" && (r.label || r.status || r.plan));
  const statusRows = catRows.filter((r) => !r.plan && !r.schedule);

  const statusBody = document.getElementById("tbody-共通-status");
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

  updateLastUpdated(catRows.map((r) => r.updated));
}

// 各タブから取得した日付候補の中から最新のものだけを反映する(既存表示より古ければ無視)
function updateLastUpdated(dateStrings) {
  const el = document.getElementById("lastUpdated");
  const current = el.textContent === "-" ? "" : el.textContent;
  const latest = [current, ...dateStrings].filter(Boolean).sort().pop();
  if (latest) el.textContent = latest;
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
