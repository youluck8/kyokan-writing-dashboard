// ==== 設定 ====
const SHEET_ID = "1wDGrV4EcFwtUGWGaQQzOKqUPf_jd7SJ1M8RmRk_-ais";
const MAIN_TAB_NAME = "サマリー・備考";
const PROMO_CONTINUE_TAB_NAME = "【継続】プロモ";
const PROMO_NEW_TAB_NAME = "【新規】プロモ";
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

// プロモーション計画継続/新規タブ用(タブ自体でカテゴリを分けるためカテゴリ列は無し):
// 更新日,重要度,進捗ステータス,今後の施策,スケジュール,担当,メモ
function toPromoRows(rawRows) {
  return rawRows.map((r) => {
    const c = r.c || [];
    return {
      updated: cellValue(c[0]),
      importance: cellValue(c[1]), // 高/中/低
      progress: cellValue(c[2]), // 未着手/着手/完了
      plan: cellValue(c[3]),
      schedule: cellValue(c[4]),
      owner: cellValue(c[5]),
      memo: cellValue(c[6]),
    };
  });
}

// 5期スケジュールタブ用(重要度・カテゴリ列なし): 更新日,進捗ステータス,今後の施策,スケジュール,担当,メモ
function toGokiRows(rawRows) {
  return rawRows.map((r) => {
    const c = r.c || [];
    return {
      updated: cellValue(c[0]),
      importance: "",
      progress: cellValue(c[1]), // 未着手/着手/完了
      plan: cellValue(c[2]),
      schedule: cellValue(c[3]),
      owner: cellValue(c[4]),
      memo: cellValue(c[5]),
    };
  });
}

const IMPORTANCE_ORDER = { 高: 0, 中: 1, 低: 2 };

// 未着手/着手(実施中)を上、完了を下。各グループ内は重要度(高→中→低)で並び替え
function sortPromoRows(rows) {
  return [...rows].sort((a, b) => {
    const doneA = a.progress === "完了" ? 1 : 0;
    const doneB = b.progress === "完了" ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    return (IMPORTANCE_ORDER[a.importance] ?? 1) - (IMPORTANCE_ORDER[b.importance] ?? 1);
  });
}

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
  sortPromoRows(usable).forEach((r) => {
    const li = document.createElement("li");
    // 重要度で枠・背景色を変える(完了の場合はグレーアウトを優先)
    if (r.importance) li.classList.add(`importance-${r.importance}`);
    if (r.progress === "完了") li.classList.add("promo-done");

    if (r.importance) {
      const impSpan = document.createElement("span");
      impSpan.className = `promo-importance importance-badge-${r.importance}`;
      impSpan.textContent = r.importance;
      li.appendChild(impSpan);
    }

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
      statusSpan.textContent = r.progress;
      li.appendChild(statusSpan);
    }

    // 結果・メモはラベルなしでそのまま表示(グレーの補足欄)
    const noteText = r.memo;
    if (noteText) {
      const noteDiv = document.createElement("div");
      noteDiv.className = "promo-note";
      noteDiv.textContent = noteText;
      li.appendChild(noteDiv);
    }
    container.appendChild(li);
  });
}

async function loadData() {
  document.getElementById("sheetLink").href = sheetLinkUrl(SHEET_ID);
  document.getElementById("premiumSheetLink").href = sheetLinkUrl(PREMIUM_SHEET_ID);
  document.getElementById("basicSheetLink").href = sheetLinkUrl(BASIC_SHEET_ID);

  try {
    const mainRaw = await fetchGvizRows(SHEET_ID, MAIN_TAB_NAME);
    render(toPlanRows(mainRaw));
  } catch (err) {
    console.error("main sheet load failed", err);
  }

  const [continueRaw, newRaw] = await Promise.all([
    fetchGvizRows(SHEET_ID, PROMO_CONTINUE_TAB_NAME).catch((err) => {
      console.error("プロモーション計画継続 tab load failed (未作成の可能性があります)", err);
      return [];
    }),
    fetchGvizRows(SHEET_ID, PROMO_NEW_TAB_NAME).catch((err) => {
      console.error("プロモーション計画新規 tab load failed (未作成の可能性があります)", err);
      return [];
    }),
  ]);
  const continueRows = toPromoRows(continueRaw);
  const newRows = toPromoRows(newRaw);
  const continueList = document.getElementById("promo-継続-list");
  const newList = document.getElementById("promo-新規-list");
  if (continueList) buildPromoListItems(continueList, continueRows);
  if (newList) buildPromoListItems(newList, newRows);
  updateLastUpdated([...continueRows, ...newRows].map((r) => r.updated));

  try {
    const gokiRaw = await fetchGvizRows(SHEET_ID, GOKI_TAB_NAME);
    const gokiList = document.getElementById("goki-list");
    if (gokiList) buildPromoListItems(gokiList, toGokiRows(gokiRaw));
  } catch (err) {
    console.error("5期スケジュール tab load failed (未作成の可能性があります)", err);
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
