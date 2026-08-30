// ==== 設定 ====
const SHEET_ID = "1wDGrV4EcFwtUGWGaQQzOKqUPf_jd7SJ1M8RmRk_-ais";
const MAIN_TAB_NAME = "サマリー・備考";
const PROMO_CONTINUE_TAB_NAME = "【継続】プロモーション";
const PROMO_NEW_TAB_NAME = "【新規】プロモーション";
const GOKI_TAB_NAME = "5期スケジュール";
const PREMIUM_SHEET_ID = "1OMHSOrxjNJWAM7wuBSFv1t2n7p67Rj5sgRUPmDGLXN0";
const BASIC_SHEET_ID = "1oGQaFvoUqVpGqznyLo8O2_xao9hQ_ZQNR33WCtZ28BQ";
const NON_CONTINUER_SHEET_ID = "1hJJuKTRZo364NahVGgLgYxKvgYyPNtARH-_yd3-cPhw";
const WITHDRAWAL_SHEET_ID = "1Ta-g1ZnzF41mPmlyBlcsaapTUoXfRACUqEEtumwzgNg";
const SHINKI_PREMIUM_SHEET_ID = "1UBRxHPM_Ak5ED3C75xYExJCBZUUS4mv610Z4VzHUF3A";
const SHINKI_BASIC_SHEET_ID = "1o-E6D-q1fWvpHAKs2gX5VC8UjilEBzHIroAPFYbJpow";
const SHINKI_SURVEY_SHEET_ID = "1HmTGpQcNdfwOyBvb2_bh_cN420rqh60As0EM2rHgAeI";
const PREMIUM_PRICE = 180000;
const BASIC_PRICE = 90000;
const SHINKI_PREMIUM_PRICE = 360000;
const SHINKI_BASIC_PRICE = 180000;
const TOTAL_4KI_COUNT = 108; // 4期全体110名からインターン生2名を除いた実質対象数
const NEW_MEMBER_COUNT = 2; // 工藤恵(プレミアム)・佐藤麻子(ベーシック)
const NEW_REVENUE = 0;
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

  const refreshBtn = document.getElementById("refreshBtn");
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "更新中...";
    try {
      await loadData();
    } finally {
      refreshBtn.textContent = "今すぐ更新";
      refreshBtn.disabled = false;
    }
  });
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

// forceSingleHeader: gvizの見出し行自動判定が、新しく追加された行を誤って2つ目の
// 見出し行と判定し、データが消えてしまう不具合が実際に発生したため、マイスピー連携シート
// (ユーザーID/本登録完了日時/姓/名/メールアドレス)ではheaders=1で明示的に固定する。
// (このオプションは列Aが常に空欄のシートでは逆に見出し検出を壊すため、全シート共通にはしていない)
async function fetchGvizTable(sheetId, sheetName, forceSingleHeader) {
  const sheetParam = sheetName ? `&sheet=${encodeURIComponent(sheetName)}` : "";
  const headersParam = forceSingleHeader ? "&headers=1" : "";
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json${headersParam}${sheetParam}&t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sheet fetch not ok: ${res.status}`);
  const text = await res.text();
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) throw new Error("unexpected sheet response format");
  const json = JSON.parse(match[1]);
  if (json.status === "error") throw new Error(`gviz error: ${JSON.stringify(json.errors)}`);
  return json.table || { cols: [], rows: [] };
}

async function fetchGvizRows(sheetId, sheetName, forceSingleHeader) {
  return (await fetchGvizTable(sheetId, sheetName, forceSingleHeader)).rows || [];
}

// 1行目の見出しをそのままキーにしたオブジェクトへ変換する。
// 列を追加/変更/削除しても、見出し名がそのまま反映されるようにするため、固定の列番号には依存しない。
function toDynamicRows(table) {
  const headers = (table.cols || []).map((c) => (c.label || "").trim());
  return (table.rows || []).map((r) => {
    const obj = {};
    (r.c || []).forEach((cell, i) => {
      const key = headers[i];
      if (!key) return;
      obj[key] = key === "更新日" ? normalizedDate(cell) || cellValue(cell) : cellValue(cell);
    });
    return obj;
  });
}

// サマリー・備考タブ用(旧スキーマ): 更新日,カテゴリ,項目,現状,今後の施策,スケジュール,担当,メモ
function toPlanRows(rawRows) {
  return rawRows.map((r) => {
    const c = r.c || [];
    return {
      updated: normalizedDate(c[0]) || cellValue(c[0]),
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
      appendLinkifiedText(noteDiv, `${key}: ${r[key]}`);
      li.appendChild(noteDiv);
    });

    container.appendChild(li);
  });
}

// テキスト中のURL(http/https)を自動でハイパーリンク化して要素に追加する
const URL_REGEX = /(https?:\/\/[^\s]+)/g;
function appendLinkifiedText(container, text) {
  let lastIndex = 0;
  URL_REGEX.lastIndex = 0;
  let match;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const a = document.createElement("a");
    a.href = match[0];
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = match[0];
    container.appendChild(a);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

// 見出しは常にタブ名の設定(定数)と同じ文字列にする。表示名とフェッチ先のズレを防ぐため。
async function loadData() {
  document.getElementById("premiumSheetLink").href = sheetLinkUrl(PREMIUM_SHEET_ID);
  document.getElementById("basicSheetLink").href = sheetLinkUrl(BASIC_SHEET_ID);
  document.getElementById("nonContinuerSheetLink").href = sheetLinkUrl(NON_CONTINUER_SHEET_ID);

  loadStepMailStatus().catch((err) => console.error("stepmail load failed", err));
  await renderSeminarCards();

  // アンケートを先に読み込んでからメンバー名簿を描画する（突合のため）
  await loadEnquete().catch((err) => console.error("enquete load failed", err));

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

  loadNonContinuers().catch((err) => console.error("non-continuer sheet load failed", err));
  loadWithdrawals().catch((err) => console.error("withdrawal sheet load failed", err));
  loadShinkiMembers().catch((err) => console.error("shinki sheet load failed", err));
}

// 未継続者リスト: 列番号ではなく見出し名で読み取るため、列の追加/並び替えに強い。
async function loadNonContinuers() {
  const table = await fetchGvizTable(NON_CONTINUER_SHEET_ID);
  const people = toDynamicRows(table)
    .filter((r) => r["姓名"])
    .map((r) => ({
      name: r["姓名"] || "",
      course: r["コース"] || "",
      graduation: r["卒業制作提出/発表"] || "",
      seminar: r["説明会参加"] || "",
      applied: r["5期継続申込"] || "",
      reason: r["入会経緯（一言）"] || "",
      status: r["状況"] || "",
    }));

  document.getElementById("summary-nonkeizoku").textContent = `合計 ${people.length}名`;

  const tbody = document.getElementById("tbody-nonkeizoku-list");
  tbody.innerHTML = "";
  if (people.length === 0) {
    tbody.appendChild(emptyRow(7));
    return;
  }
  people.forEach((p) => {
    const applied = p.applied === "TRUE";
    const tr = document.createElement("tr");
    if (applied) tr.classList.add("continued-row");

    [p.name, p.course, p.graduation, p.seminar].forEach((val) => {
      const td = document.createElement("td");
      td.textContent = val || "-";
      tr.appendChild(td);
    });

    const appliedTd = document.createElement("td");
    if (applied) {
      const badge = document.createElement("span");
      badge.className = "applied-badge";
      badge.textContent = "申し込み済み";
      appliedTd.appendChild(badge);
    } else {
      appliedTd.textContent = "-";
    }
    tr.appendChild(appliedTd);

    const reasonTd = document.createElement("td");
    reasonTd.textContent = p.reason || "-";
    tr.appendChild(reasonTd);

    const statusTd = document.createElement("td");
    statusTd.className = "status-cell";
    appendLinkifiedText(statusTd, p.status || "-");
    tr.appendChild(statusTd);
    tbody.appendChild(tr);
  });
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
  // 継続者数は未入金の申込者も含めた人数(=申込総数)。分母は4期対象者108名(110名からインターン2名を除く)
  const totalCount = premiumStats.total + basicStats.total;
  const retentionRate = ((totalCount / TOTAL_4KI_COUNT) * 100).toFixed(1);
  renderKpiValue(
    "kpi-count",
    `${totalCount}名 / ${TOTAL_4KI_COUNT}名中`,
    `継続率 ${retentionRate}%（プレミアム${premiumStats.total}名、ベーシック${basicStats.total}名）`
  );

  // kpi-new-count は loadShinkiMembers() が更新する

  const premiumRevenue = premiumStats.paid * PREMIUM_PRICE;
  const basicRevenue = basicStats.paid * BASIC_PRICE;
  const continueRevenue = premiumRevenue + basicRevenue;
  const premiumPending = premiumStats.unpaid * PREMIUM_PRICE;
  const basicPending = basicStats.unpaid * BASIC_PRICE;
  const totalPending = premiumPending + basicPending;
  renderKpiValue(
    "kpi-revenue-by-course",
    yen(continueRevenue),
    `（プレミアム${yen(premiumRevenue)}、ベーシック${yen(basicRevenue)}）未入金${yen(totalPending)}`
  );

  // kpi-new-revenue・kpi-revenue-total は loadShinkiMembers() が更新する
  // continueRevenue をグローバルに保持して合計計算に使う
  window._continueRevenue = continueRevenue;
  updateTotalRevenue();
}

function updateTotalRevenue() {
  const continueRevenue = window._continueRevenue || 0;
  const newRevenue = window._newRevenue || 0;
  renderKpiValue("kpi-new-revenue", yen(newRevenue),
    `プレミアム${yen(window._shinkiPremRevenue || 0)}、ベーシック${yen(window._shinkiBasicRevenue || 0)}`);
  renderKpiValue(
    "kpi-revenue-total",
    yen(continueRevenue + newRevenue),
    `（継続${yen(continueRevenue)}、新規${yen(newRevenue)}）`
  );
}

// マイスピー転記シート: ユーザーID, 本登録完了日時, 姓, 名, メールアドレス, 状況・メモ(F列, 手入力)
// 入金完了時にマイスピーが同じユーザーIDで新しい行を末尾に追加する仕様のため、
// ユーザーIDで重複排除し、入金済みの行を優先する。
async function loadMemberSheet(sheetId, courseLabel, summaryElId, tbodyId) {
  const rawRows = await fetchGvizRows(sheetId, undefined, true);
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
      const result = memberRow(m);
      if (Array.isArray(result)) {
        result.forEach((row) => tbody.appendChild(row));
      } else {
        tbody.appendChild(result);
      }
    });
  }

  return { paid: paidCount, unpaid: unpaidCount, total: members.length, members, courseLabel };
}

function memberRow(m) {
  const fullName = `${m.lastName} ${m.firstName}`.trim() || "-";

  // アンケート突合：姓名スペースなし・あり両方で検索
  const nameNoSpace = `${m.lastName}${m.firstName}`.trim();
  const enq = enqueteMap[fullName] || enqueteMap[nameNoSpace]
    || Object.values(enqueteMap).find((e) => e.name.replace(/\s/g, "") === nameNoSpace);

  const tr = document.createElement("tr");
  const tdName = document.createElement("td");
  tdName.className = "name";
  tdName.textContent = fullName;
  if (!m.completedAt) {
    const tag = document.createElement("span");
    tag.className = "unpaid-tag";
    tag.textContent = "（未入金）";
    tdName.appendChild(document.createTextNode(" "));
    tdName.appendChild(tag);
  }

  // アンケートボタン
  if (enq) {
    const btn = document.createElement("button");
    btn.className = "enq-inline-btn";
    btn.textContent = "アンケート";
    btn.title = "事前アンケート回答を表示";
    tdName.appendChild(document.createTextNode(" "));
    tdName.appendChild(btn);

    const trEnq = document.createElement("tr");
    trEnq.className = "enq-inline-row";
    const tdEnq = document.createElement("td");
    tdEnq.colSpan = 2;
    tdEnq.className = "enq-inline-cell";
    const body = buildEnqueteBody(enq);
    body.hidden = true;
    tdEnq.appendChild(body);
    trEnq.appendChild(tdEnq);
    trEnq.hidden = true;

    btn.addEventListener("click", () => {
      const open = trEnq.hidden;
      trEnq.hidden = !open;
      body.hidden = !open;
      btn.classList.toggle("open", open);
      btn.textContent = open ? "閉じる" : "アンケート";
    });

    const tdNotes = document.createElement("td");
    tdNotes.className = "notes";
    tdNotes.textContent = m.notes || "-";
    tr.appendChild(tdName);
    tr.appendChild(tdNotes);
    return [tr, trEnq];
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

// 更新日セルをYYYY-MM-DDに正規化する。表示形式(f)は列によって「yyyy/MM/dd」
// 「m月d日」(年なし)などバラバラで、そのまま文字列比較すると誤った大小関係になる
// ことがある(実際に発生した不具合)ため、実際の日付(v)をパースして統一する。
function normalizedDate(cell) {
  if (!cell || typeof cell.v !== "string") return "";
  const m = cell.v.match(/^Date\((\d+),(\d+),(\d+)/);
  if (!m) return "";
  const year = m[1];
  const month = String(Number(m[2]) + 1).padStart(2, "0");
  const day = m[3].padStart(2, "0");
  return `${year}-${month}-${day}`;
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

// 退会者リスト: 1行目は注記、2行目がヘッダー(NO./氏名/メールアドレス/コース/退会日/退会理由/備考)
async function loadWithdrawals() {
  const table = await fetchGvizTable(WITHDRAWAL_SHEET_ID, undefined, false);
  const rows = (table.rows || []).map((r) => {
    const c = r.c || [];
    return {
      no: cellValue(c[0]),
      name: cellValue(c[1]),
      // c[2] はメールアドレス（表示しない）
      course: cellValue(c[3]),
      date: cellValue(c[4]),
      reason: cellValue(c[5]),
      memo: cellValue(c[6]),
    };
  }).filter((r) => r.name && r.name !== "氏名" && r.no !== "NＯ．" && r.no !== "NO.");

  const summaryEl = document.getElementById("summary-withdrawal");
  if (summaryEl) summaryEl.textContent = `合計 ${rows.length}名`;

  const tbody = document.getElementById("tbody-withdrawal-list");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (rows.length === 0) {
    tbody.appendChild(emptyRow(5));
    return;
  }
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    const cells = [
      { val: r.name, cls: "" },
      { val: r.course, cls: "" },
      { val: r.date, cls: "" },
      { val: r.reason, cls: "withdrawal-reason" },
      { val: r.memo, cls: "" },
    ];
    cells.forEach(({ val, cls }) => {
      const td = document.createElement("td");
      if (cls) td.className = cls;
      td.textContent = val || "-";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

// ==== 7/31まーりん合同セミナー参加者メール（流入元タグ用）====
const MARLIN_EMAILS = new Set([
  "miyumiyumi1225@gmail.com","wiwikeiko@yahoo.co.jp","yayo.y.yayo@gmail.com",
  "g1001432@gmail.com","nokymd999@gmail.com","atelier.mami.2014@gmail.com",
  "narikosuke@gmail.com","kominencorea@gmail.com","tresor3090hm@gmail.com",
  "rikazo99422000@gmail.com","windandsun37@gmail.com","flowermoon2525@gmail.com",
  "hnl2kaori@docomo.ne.jp","mkawaguchi344@gmail.com","menkai.koai@gmail.com",
  "s.h.081303@gmail.com","ayakomatsura1201@gmail.com","memeko.sugi.nagasaka@gmail.com",
  "ikuratara2005@yahoo.co.jp","ayakemu2000@gmail.com","reiko.e@gmail.com",
  "lightsteelprefabbuilder@gmail.com","kouki2619@gmail.com","q9411q@gmail.com",
  "chica.pant2@gmail.com","natti518@icloud.com","tomoko555world@icloud.com",
  "oriondaisuki28@gmail.com","ayanoren2912@gmail.com","ticorin-sakura@docomo.ne.jp",
  "cct.jasmine100@gmail.com","chaochoco925@gmail.com","yuri.iyoda@gmail.com",
  "fortunate418tiara@gmail.com","joelle.730721@gmail.com",
  "happylife.coaching.988@gmail.com","ksksk1009@yahoo.co.jp","fukkoe23@jcom.zaq.ne.jp",
  "kawashk342@gmail.com","uta1219@gmail.com","fusayonsama@gmail.com",
  "kanahapuna@gmail.com","youuuluck@gmail.com","minakachiba9@gmail.com",
  "yukitty0114@gmail.com","kenji7112@tiara.ocn.ne.jp","m-miyake.green@mineo.jp",
  "keiko.imamura@couplan.com","gynn723@gmail.com","yeyang25@yahoo.co.jp",
  "kenboumama7@gmail.com","310sayuriapple@gmail.com","tanmi.miya@gmail.com",
  "juke33joint66@gmail.com","willvii@icloud.com","hananokailease@gmail.com",
  "sano.hmm@gmail.com","kurupure@gmail.com","nagasato0729@gmail.com",
  "1433.shizuko@gmail.com","yyshinshin0317@gmail.com",
]);

// ==== ステップメール配信状況 ====
// シート構成（両タブ共通）:
// c[0]=対象, c[1]=日付, c[2]=曜日, c[3]=時刻, c[4]=配信者名, c[5]=件名, c[6]=原稿(本文)
// c[7]=MYASP/配信先1, c[8]=配信数1, c[9]=開封率1, c[10]=配信数2, c[11]=開封率2, c[12]=合計配信数, c[13]=合計開封率

function buildStepMailTable(rows, tbody, colDefs) {
  // 今日の日付を「8月26日」形式で照合
  const now = new Date();
  const todayLabel = `${now.getMonth() + 1}月${now.getDate()}日`;

  tbody.innerHTML = "";
  // サブヘッダー行（c[0]="対象"）と日付空の行を除外
  const dataRows = rows.filter((r) => r[1] && r[0] !== "対象");
  if (dataRows.length === 0) {
    tbody.appendChild(emptyRow(colDefs.length + 2)); // 日付+時刻+件名+cols
    return;
  }

  dataRows.forEach((r) => {
    const dateLabel = r[1] || "";
    const time = r[3] || "";
    const sender = r[4] || "";
    const subject = r[5] || "";
    const isToday = dateLabel === todayLabel;

    // メイン行
    const tr = document.createElement("tr");
    if (isToday) tr.classList.add("stepmail-today");

    // 配信日時セル
    const tdDate = document.createElement("td");
    tdDate.className = "stepmail-date-cell";
    const dateSpan = document.createElement("span");
    dateSpan.textContent = dateLabel;
    const timeSpan = document.createElement("span");
    timeSpan.className = "stepmail-time";
    timeSpan.textContent = time;
    tdDate.appendChild(dateSpan);
    tdDate.appendChild(timeSpan);
    if (isToday) {
      const badge = document.createElement("span");
      badge.className = "stepmail-today-badge";
      badge.textContent = "本日";
      tdDate.appendChild(badge);
    }

    // 配信者セル
    const tdSender = document.createElement("td");
    tdSender.textContent = sender;
    tdSender.className = sender.includes("織田") ? "sender-oda" : "sender-mineyama";

    // 件名セル
    const tdSubject = document.createElement("td");
    tdSubject.textContent = subject || "-";

    tr.appendChild(tdDate);
    tr.appendChild(tdSender);
    tr.appendChild(tdSubject);

    // 動的列（配信数・開封率）
    colDefs.forEach(({ idx, isRate }) => {
      const val = r[idx] || "";
      const td = document.createElement("td");
      if (!val || val === "0") {
        td.textContent = "-";
        td.className = "stepmail-pending";
      } else if (isRate) {
        td.textContent = val;
        const rate = parseFloat(val);
        td.className = rate >= 45 ? "openrate-high" : rate >= 35 ? "openrate-mid" : "openrate-low";
      } else {
        td.textContent = `${Number(val).toLocaleString()}通`;
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

async function loadStepMailStatus() {
  const [stepTable, odaTable] = await Promise.all([
    fetchGvizTable(STEPMAIL_SHEET_ID, "ステップメール", true).catch(() => ({ rows: [] })),
    fetchGvizTable(STEPMAIL_SHEET_ID, "織田クラブメール", true).catch(() => ({ rows: [] })),
  ]);

  const toRaw = (table) =>
    (table.rows || []).map((r) => (r.c || []).map((c) => cellValue(c) || ""));

  // ステップメール: 合計配信数(c[12]) + 合計開封率(c[13])
  const stepTbody = document.getElementById("tbody-stepmail");
  if (stepTbody) {
    buildStepMailTable(toRaw(stepTable), stepTbody, [
      { idx: 8, isRate: false, label: "配信数①" },
      { idx: 9, isRate: true, label: "開封率①" },
      { idx: 10, isRate: false, label: "配信数②" },
      { idx: 11, isRate: true, label: "開封率②" },
      { idx: 12, isRate: false, label: "合計配信数" },
      { idx: 13, isRate: true, label: "合計開封率" },
    ]);
  }

  // 織田クラブメール: NAHクラブ生(c[8])・開封率(c[9]) + サバイバル(c[10])・開封率(c[11]) + 合計開封率(c[12])
  const odaTbody = document.getElementById("tbody-oda-mail");
  if (odaTbody) {
    buildStepMailTable(toRaw(odaTable), odaTbody, [
      { idx: 8, isRate: false, label: "NAHクラブ生" },
      { idx: 9, isRate: true, label: "開封率" },
      { idx: 10, isRate: false, label: "サバイバル" },
      { idx: 11, isRate: true, label: "開封率" },
      { idx: 12, isRate: true, label: "合計開封率" },
    ]);
  }
}

// ==== 事前アンケート ====
const ENQUETE_SHEET_ID = "16iJ3SESmXqzxqxq9g1ufuAXhX00F_COv_HAEgHox90Q";

// 名前→アンケート回答のグローバルマップ（継続者名簿との突合に使用）
let enqueteMap = {};

// アンケート回答からカード本体のDOMを生成する共通関数
function buildEnqueteBody(row) {
  const body = document.createElement("div");
  body.className = "enquete-card-body";
  body.hidden = true;
  const questions = [
    { label: "4期でやったこと・一番の収穫", text: row.q1 },
    { label: "4期でやりきれなかったこと", text: row.q2 },
    { label: "5期でやりたいこと", text: row.q3 },
    { label: "質問・その他", text: row.q4 },
  ];
  questions.forEach(({ label, text }) => {
    if (!text) return;
    const dl = document.createElement("dl");
    dl.className = "enquete-qa";
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = text;
    dl.appendChild(dt);
    dl.appendChild(dd);
    body.appendChild(dl);
  });
  return body;
}

async function loadEnquete() {
  const container = document.getElementById("enquete-list");
  const summaryEl = document.getElementById("summary-enquete");
  if (!container) return;

  const table = await fetchGvizTable(ENQUETE_SHEET_ID, undefined, true).catch(() => null);
  if (!table) {
    container.innerHTML = `<p class="roster-summary">読み込みに失敗しました</p>`;
    return;
  }

  const rows = (table.rows || [])
    .map((r) => {
      const c = r.c || [];
      return {
        timestamp: cellValue(c[0]),
        name: cellValue(c[2]),
        q1: cellValue(c[3]),
        q2: cellValue(c[4]),
        q3: cellValue(c[5]),
        q4: cellValue(c[6]),
      };
    })
    .filter((r) => r.name);

  if (summaryEl) summaryEl.textContent = `${rows.length}名が回答`;

  // グローバルマップに保存（継続者名簿との突合用）
  enqueteMap = {};
  rows.forEach((r) => { enqueteMap[r.name] = r; });

  let allItems = [];

  function render(filtered) {
    container.innerHTML = "";
    if (filtered.length === 0) {
      container.innerHTML = `<p class="roster-summary">該当なし</p>`;
      return;
    }
    filtered.forEach((row) => {
      const card = document.createElement("div");
      card.className = "enquete-card";

      const header = document.createElement("button");
      header.className = "enquete-card-btn";
      header.textContent = row.name;
      header.setAttribute("aria-expanded", "false");

      const body = buildEnqueteBody(row);

      header.addEventListener("click", () => {
        const open = !body.hidden;
        body.hidden = open;
        header.classList.toggle("open", !open);
        header.setAttribute("aria-expanded", String(!open));
      });

      card.appendChild(header);
      card.appendChild(body);
      container.appendChild(card);
    });
  }

  allItems = rows;
  render(allItems);

  const searchEl = document.getElementById("enquete-search");
  if (searchEl) {
    searchEl.addEventListener("input", () => {
      const q = searchEl.value.trim();
      if (!q) { render(allItems); return; }
      render(allItems.filter((r) => r.name.includes(q)));
    });
  }
}

// ==== プロモーション：実施セミナー実績カード ====
const SETSUMEIKAI_SHEET_ID = "1ezLaC6ckT9VPgQqpeAl5sxzBED1oABOctS7Bb3SYNM0";
const STEPMAIL_SHEET_ID = "1DFuxfID3nIkS1qxKTycr3-Y5auJ2RXHoYTA3zJ02SrQ";
const CLAUDECODE_EVENT_SHEET_ID = "1D-NTEIdm_aHnXgrYhL0OO6_KcPvZx1M7469g9XSt_MI";

async function renderSeminarCards() {
  const container = document.getElementById("promo-seminar-list");
  if (!container) return;

  container.innerHTML = `<p class="roster-summary">読み込み中...</p>`;

  // 説明会シートを一括取得して日付別に分類（fetchGvizTableでJSON取得）
  let byDate = {};
  try {
    const table = await fetchGvizTable(SETSUMEIKAI_SHEET_ID, undefined, true);
    (table.rows || []).forEach((r) => {
      const c = r.c || [];
      // gviz日付セルはv="Date(year,month,day,...)"形式のため normalizedDate で確実にYYYY-MM-DDへ変換
      const dateStr = normalizedDate(c[1]) || (() => {
        const s = cellValue(c[1]).trim().substring(0, 10).replace(/\//g, "-");
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
      })();
      if (!dateStr) return;
      if (!byDate[dateStr]) byDate[dateStr] = [];
      const sei = cellValue(c[3]) || "";
      const mei = cellValue(c[4]) || "";
      const name = (sei + " " + mei).trim();
      const referrer = (cellValue(c[5]) || "").trim();
      if (name) byDate[dateStr].push({ name, referrer });
    });
  } catch (e) {
    console.error("setsumeikai sheet load failed", e);
  }

  // Claude Code体験会シートを別途読み込み
  let claudeCodeNames = [];
  try {
    const table2 = await fetchGvizTable(CLAUDECODE_EVENT_SHEET_ID, undefined, true);
    (table2.rows || []).forEach((r) => {
      const c = r.c || [];
      const sei = cellValue(c[2]) || "";
      const mei = cellValue(c[3]) || "";
      const name = (sei + " " + mei).trim();
      if (name) claudeCodeNames.push({ name });
    });
  } catch (e) {
    console.error("claudecode event sheet load failed", e);
  }

  const today = new Date();

  // 固定カード（過去分・キャンセル等、手動管理）
  const fixedDates = new Set(["2026-09-07","2026-09-06","2026-09-01","2026-08-30","2026-08-28","2026-07-31","2026-08-16","2026-08-15","2026-08-14"]);
  const fixedSeminars = [
    { date: "2026-09-07", label: "9/7 説明会", hasSheet: true, hideReferrer: true },
    { date: "2026-09-06", label: "9/6 説明会", hasSheet: true, hideReferrer: true },
    { date: "2026-09-01", label: "9/1 説明会", cancelled: true, cancelNote: "中止", done: true },
    { date: "2026-08-30", label: "8/30 説明会", cancelled: true, cancelNote: "中止", done: true },
    { date: "2026-08-28", label: "8/28 説明会", cancelled: true, cancelNote: "中止", done: true },
    { date: "2026-07-31", label: "7/31 峯山×まーりん合同セミナー",
      staticStats: { apply: 62, realtime: 44, archive: 18 },
      staticNames: [
        ...["今枝 仁礼子","大城戸 佳子","宮本 弥生","小野 光一","山田 直樹","ユキエ マユミ(まみるん)","中口 成子","小峰 直保子","木村 恵美","り か","藤本 洋","石垣 志乃","澤村 香凛","川口 摩弓","菊永 恵妃","岩見 聖子","鳳 鈴華","杉浦 尚子","秦 小百合","小松 文美","狩野 狩野","島村 拓史","増田 和人","渡邊 智子","ほり ちか","内藤 正徳","清水 智子","森本 真理子","大久保 綾乃","三田村 知里","鈴木 茉莉花","山田 順子","伊與田 ユリ","峰尾 安梨沙","原田 加奈","中村 智子","關 妃","大橋 二佐江","河島 佳代子","宇田川 洋子","上田 房代","大塚 香奈子","岡部 貴之"].filter(n=>n).map(n=>({name:n,type:"realtime"})),
        ...["千葉 未来香","今野 祐喜子","新井 乾司","三宅 めぐ美","イマムラ ケイコ","茂木 菜摘","加茂 野央","小林 京子","佐藤 小百合","三谷 英明","たなか ようこ","白石 みほ","OGASHIWA CHIKAE","佐野 博美","中川 毅文","永里 真由美","小林 靖江","よ しん"].map(n=>({name:n,type:"archive"})),
      ] },
    { date: "2026-08-16", label: "8/16 説明会", hasSheet: true },
    { date: "2026-08-15", label: "8/15 説明会", hasSheet: true },
    { date: "2026-08-14", label: "8/14 説明会", hasSheet: true },
  ];

  // シートに存在する日付を自動でカードに追加（固定分除く）
  const sheetDates = Object.keys(byDate)
    .filter((d) => !fixedDates.has(d))
    .sort((a, b) => b.localeCompare(a));

  const autoSeminars = sheetDates.map((d) => {
    const [y, m, day] = d.split("-");
    return { date: d, label: `${parseInt(m)}/${parseInt(day)} 説明会`, hasSheet: true, hideReferrer: true };
  });

  const seminars = [
    { date: "2026-09-03", label: "9/3 Claude Code体験会", claudeCodeEvent: true },
    ...autoSeminars,
    ...fixedSeminars,
  ];

  let accId = 0;
  container.innerHTML = "";

  seminars.forEach((s) => {
    const isPast = new Date(s.date) < today;
    const card = document.createElement("div");
    card.className = "seminar-card" + (isPast || s.done ? " done" : "");

    // ヘッダー行
    const head = document.createElement("div");
    head.className = "seminar-card-head";
    head.innerHTML = `<span class="seminar-date">${s.label}</span>` +
      (s.cancelled ? `<span class="seminar-badge cancelled">${s.cancelNote || "中止"}</span>` : "");

    // シートリンクボタン
    const headLinks = document.createElement("div");
    headLinks.style.cssText = "display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;";
    if (s.claudeCodeEvent) {
      const a = document.createElement("a");
      a.href = `https://docs.google.com/spreadsheets/d/${CLAUDECODE_EVENT_SHEET_ID}/edit`;
      a.target = "_blank"; a.rel = "noopener";
      a.className = "sheet-link small-link";
      a.textContent = "無料イベントシートを開く →";
      headLinks.appendChild(a);
    } else if (s.hasSheet) {
      const a = document.createElement("a");
      a.href = `https://docs.google.com/spreadsheets/d/${SETSUMEIKAI_SHEET_ID}/edit`;
      a.target = "_blank"; a.rel = "noopener";
      a.className = "sheet-link small-link";
      a.textContent = "説明会シートを開く →";
      headLinks.appendChild(a);
    }
    if (headLinks.children.length > 0) head.appendChild(headLinks);

    card.appendChild(head);

    if (s.claudeCodeEvent) {
      const stats = document.createElement("div");
      stats.className = "seminar-stats";
      stats.innerHTML = `<div class="seminar-stat"><div class="seminar-stat-label">申込者数</div><div class="seminar-stat-value">${claudeCodeNames.length}名</div></div>`;
      card.appendChild(stats);
      if (claudeCodeNames.length > 0) {
        const id = `seminar-acc-${accId++}`;
        const btn = document.createElement("button");
        btn.className = "accordion-btn";
        btn.style.marginTop = "12px";
        btn.textContent = "▼ 申込者一覧";
        btn.addEventListener("click", () => {
          const pane = document.getElementById(id);
          if (!pane) return;
          const open = !pane.hidden;
          pane.hidden = open;
          btn.textContent = open ? "▼ 申込者一覧" : "▲ 閉じる";
        });
        const pane = document.createElement("div");
        pane.id = id;
        pane.hidden = true;
        pane.className = "seminar-names-pane";
        pane.innerHTML = claudeCodeNames.map((n) =>
          `<span class="seminar-name-tag">${n.name}</span>`
        ).join("");
        card.appendChild(btn);
        card.appendChild(pane);
      }
      container.appendChild(card);
      return;
    }

    if (!s.cancelled) {
      const stats = document.createElement("div");
      stats.className = "seminar-stats";

      if (s.staticStats) {
        stats.innerHTML = `
          <div class="seminar-stat"><div class="seminar-stat-label">申込者数</div><div class="seminar-stat-value">${s.staticStats.apply}名</div></div>
          <div class="seminar-stat"><div class="seminar-stat-label">事前申込者</div><div class="seminar-stat-value">${s.staticStats.realtime}名</div></div>
          <div class="seminar-stat"><div class="seminar-stat-label">アーカイブ申込</div><div class="seminar-stat-value">${s.staticStats.archive}名</div></div>
        `;
        card.appendChild(stats);
        if (s.staticNames && s.staticNames.length > 0) {
          const id = `seminar-acc-${accId++}`;
          const btn = document.createElement("button");
          btn.className = "accordion-btn";
          btn.style.marginTop = "12px";
          btn.textContent = "▼ 申込者一覧";
          btn.addEventListener("click", () => {
            const pane = document.getElementById(id);
            if (!pane) return;
            const open = !pane.hidden;
            pane.hidden = open;
            btn.textContent = open ? "▼ 申込者一覧" : "▲ 閉じる";
          });
          const pane = document.createElement("div");
          pane.id = id;
          pane.hidden = true;
          pane.className = "seminar-names-pane";
          pane.innerHTML = s.staticNames.map((e) =>
            `<span class="seminar-name-tag">${e.name}<span class="seminar-referrer">${e.type === "realtime" ? "事前申込者" : "アーカイブ申込"}</span></span>`
          ).join("");
          card.appendChild(btn);
          card.appendChild(pane);
        }
        container.appendChild(card);
        return;
      } else if (s.hasSheet) {
        const entries = byDate[s.date] || [];
        const withRef = entries.filter((e) => e.referrer).length;
        stats.innerHTML = `<div class="seminar-stat"><div class="seminar-stat-label">申込者数</div><div class="seminar-stat-value">${entries.length}名</div></div>` +
          (!s.hideReferrer && withRef ? `<div class="seminar-stat"><div class="seminar-stat-label">紹介あり</div><div class="seminar-stat-value">${withRef}名</div></div>` : "");
        const names = entries;

        // 申込者一覧アコーディオン
        if (names.length > 0 && !s.hideReferrer) {
          const id = `seminar-acc-${accId++}`;
          const btn = document.createElement("button");
          btn.className = "accordion-btn";
          btn.style.marginTop = "12px";
          btn.textContent = "▼ 申込者一覧";
          btn.addEventListener("click", () => {
            const pane = document.getElementById(id);
            if (!pane) return;
            const open = !pane.hidden;
            pane.hidden = open;
            btn.textContent = open ? "▼ 申込者一覧" : "▲ 閉じる";
          });

          const pane = document.createElement("div");
          pane.id = id;
          pane.hidden = true;
          pane.className = "seminar-names-pane";
          pane.innerHTML = names.map((n) =>
            `<span class="seminar-name-tag">${n.name}${n.referrer ? `<span class="seminar-referrer">紹介：${n.referrer}</span>` : ""}</span>`
          ).join("");

          card.appendChild(stats);
          card.appendChild(btn);
          card.appendChild(pane);
          container.appendChild(card);
          return;
        }
      }
      card.appendChild(stats);
    }

    container.appendChild(card);
  });
}

// ==== 新規加入者 ====
const SURVEY_QUESTIONS = [
  { key: "q1", label: "生年月日", idx: 3 },
  { key: "q2", label: "生まれた時間", idx: 4 },
  { key: "q3", label: "生まれた場所", idx: 5 },
  { key: "q4", label: "現在の活動内容", idx: 6 },
  { key: "q5", label: "月間収益（平均）", idx: 7 },
  { key: "q6", label: "PC・ITスキル", idx: 8 },
  { key: "q7", label: "AI活用状況", idx: 9 },
  { key: "q8", label: "もどかしい・不安なこと", idx: 10 },
  { key: "q9", label: "達成したい成果・目標", idx: 11 },
  { key: "q10", label: "期限・ライフイベント", idx: 12 },
  { key: "q11", label: "共感ライティングを選んだ理由", idx: 13 },
  { key: "q12", label: "これまで学んだスキル・講座", idx: 14 },
  { key: "q13", label: "初回面談で聞きたいこと", idx: 15 },
];

async function loadShinkiMembers() {
  // fetchGvizTableでJSON取得（CORSに対応）
  function tableToRows(table) {
    return (table.rows || []).map((r) => (r.c || []).map((c) => cellValue(c) || ""));
  }

  const [premTable, basicTable, surveyPremTable, surveyBasicTable] = await Promise.all([
    fetchGvizTable(SHINKI_PREMIUM_SHEET_ID, undefined, true).catch(() => ({rows:[]})),
    fetchGvizTable(SHINKI_BASIC_SHEET_ID, undefined, true).catch(() => ({rows:[]})),
    fetchGvizTable(SHINKI_SURVEY_SHEET_ID, "プレミアム", true).catch(() => ({rows:[]})),
    fetchGvizTable(SHINKI_SURVEY_SHEET_ID, "ベーシック", true).catch(() => ({rows:[]})),
  ]);

  const premRows = tableToRows(premTable);
  const basicRows = tableToRows(basicTable);
  const surveyPremRows = tableToRows(surveyPremTable);
  const surveyBasicRows = tableToRows(surveyBasicTable);

  // アンケートをメールで索引（最新回答を採用）
  const surveyMap = new Map();
  [...surveyPremRows, ...surveyBasicRows].forEach((r) => {
    const email = (r[1] || "").trim().toLowerCase();
    if (!email) return;
    const data = {};
    SURVEY_QUESTIONS.forEach((q) => { data[q.key] = (r[q.idx] || "").trim(); });
    surveyMap.set(email, data);
  });

  // メールで名寄せ、入金済み優先
  const premMap = new Map();
  const basicMap = new Map();

  function mergeInto(map, rows) {
    rows.forEach((r) => {
      const email = (r[2] || "").trim().toLowerCase();
      const name = ((r[3] || "") + " " + (r[4] || "")).trim();
      const paid = !!(r[1] && r[1].trim());
      if (!email || name === "") return;
      const ex = map.get(email);
      if (!ex || (!ex.paid && paid)) {
        map.set(email, { name, email, paid, survey: surveyMap.get(email) || null });
      }
    });
  }

  mergeInto(premMap, premRows);
  mergeInto(basicMap, basicRows);

  // プレミアム入金済みの人をベーシックから除外
  basicMap.forEach((v, email) => {
    const prem = premMap.get(email);
    if (prem && prem.paid) basicMap.delete(email);
  });

  let accordionCounter = 0;

  function renderCourse(members, summaryId, tbodyId) {
    const unpaid = members.filter((m) => !m.paid);
    const paid = members.filter((m) => m.paid);
    const sorted = [...unpaid, ...paid];

    const summaryEl = document.getElementById(summaryId);
    if (summaryEl) summaryEl.textContent = `合計 ${members.length}名（入金済み ${paid.length}名・未受領 ${unpaid.length}名）`;

    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = "";

    sorted.forEach((m) => {
      const id = `survey-acc-${accordionCounter++}`;

      // メイン行
      const tr = document.createElement("tr");
      const tdName = document.createElement("td");
      tdName.className = "name";
      tdName.textContent = m.name;
      const tdStatus = document.createElement("td");
      if (!m.paid) {
        const badge = document.createElement("span");
        badge.className = "unpaid-tag";
        badge.textContent = "未受領";
        tdStatus.appendChild(badge);
      }
      const tdSource = document.createElement("td");
      if (MARLIN_EMAILS.has(m.email)) {
        const tag = document.createElement("span");
        tag.className = "applied-badge";
        tag.textContent = "7/31まーりん合同";
        tdSource.appendChild(tag);
      }
      // アンケートボタン
      const tdBtn = document.createElement("td");
      if (m.survey) {
        const btn = document.createElement("button");
        btn.className = "accordion-btn";
        btn.setAttribute("aria-expanded", "false");
        btn.textContent = "▼ アンケート";
        btn.addEventListener("click", () => {
          const pane = document.getElementById(id);
          if (!pane) return;
          const open = !pane.hidden;
          pane.hidden = open;
          btn.textContent = open ? "▼ アンケート" : "▲ 閉じる";
        });
        tdBtn.appendChild(btn);
      }
      tr.appendChild(tdName);
      tr.appendChild(tdStatus);
      tr.appendChild(tdSource);
      tr.appendChild(tdBtn);
      tbody.appendChild(tr);

      // アコーディオン行
      if (m.survey) {
        const trAcc = document.createElement("tr");
        trAcc.id = id;
        trAcc.hidden = true;
        const tdAcc = document.createElement("td");
        tdAcc.colSpan = 4;
        tdAcc.className = "survey-pane";

        const inner = document.createElement("div");
        inner.className = "survey-inner";
        SURVEY_QUESTIONS.forEach((q) => {
          const val = m.survey[q.key];
          if (!val) return;
          const row = document.createElement("div");
          row.className = "survey-row";
          row.innerHTML = `<span class="survey-label">${q.label}</span><span class="survey-val">${val.replace(/\n/g, "<br>")}</span>`;
          inner.appendChild(row);
        });
        tdAcc.appendChild(inner);
        trAcc.appendChild(tdAcc);
        tbody.appendChild(trAcc);
      }
    });
  }

  const premMembers = Array.from(premMap.values());
  const basicMembers = Array.from(basicMap.values());
  const total = premMembers.length + basicMembers.length;
  const paidPrem = premMembers.filter((m) => m.paid).length;
  const paidBasic = basicMembers.filter((m) => m.paid).length;
  const paidTotal = paidPrem + paidBasic;

  renderCourse(premMembers, "summary-shinki-premium", "tbody-shinki-premium");
  renderCourse(basicMembers, "summary-shinki-basic", "tbody-shinki-basic");

  renderKpiValue("kpi-new-count", `${total}名`, `入金済み ${paidTotal}名`);

  // 新規売上をKPIに反映
  window._shinkiPremRevenue = paidPrem * SHINKI_PREMIUM_PRICE;
  window._shinkiBasicRevenue = paidBasic * SHINKI_BASIC_PRICE;
  window._newRevenue = window._shinkiPremRevenue + window._shinkiBasicRevenue;
  updateTotalRevenue();
}

// gvizからCSV形式で行配列を取得するヘルパー
async function fetchGvizCsv(sheetId, sheetName = "") {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv` +
    (sheetName ? `&sheet=${encodeURIComponent(sheetName)}` : "");
  const res = await fetch(url);
  const text = await res.text();
  // 簡易CSV parse（ダブルクォート対応）
  const lines = text.trim().split("\n");
  const parse = (line) => {
    const result = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { result.push(cur); cur = ""; }
      else { cur += ch; }
    }
    result.push(cur);
    return result;
  };
  // 1行目ヘッダーをスキップ
  return lines.slice(1).map(parse);
}

// ==== タブ切り替え ====
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// ==== セクションアコーディオン（4期→5期タブ内）====
document.querySelectorAll(".section-accordion-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const pane = document.getElementById(btn.dataset.target);
    if (!pane) return;
    const isOpen = !pane.hidden;
    pane.hidden = isOpen;
    btn.classList.toggle("active", !isOpen);
  });
});

function emptyRow(colspan) {
  const tr = document.createElement("tr");
  tr.className = "empty-row";
  const td = document.createElement("td");
  td.colSpan = colspan;
  td.textContent = "データなし";
  tr.appendChild(td);
  return tr;
}
