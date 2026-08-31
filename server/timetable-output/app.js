"use strict";

const express = require("express");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 5000);
const PRIVATE_API_ORIGIN = process.env.TAYUNET_PRIVATE_API_ORIGIN || "http://127.0.0.1:5100";
const WORKBASE_URL = process.env.TAYUNET_WORKBASE_URL
  || "https://raw.githubusercontent.com/tayutayu1229/tayutayu1229.github.io/main/JREgyoumu/workdata/workbase.json";
const SPREADSHEET_ID = process.env.TAYUNET_TIMETABLE_SPREADSHEET_ID
  || "1ekLBxGUYNvydDsMid35WxqG5UEAyQ2Vn0IP70S-WTrY";
const CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(__dirname, "credentials.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const WORKBASE_CACHE_MILLISECONDS = 60 * 60 * 1000;
const IMPORT_WINDOW_MILLISECONDS = 10 * 60 * 1000;
const IMPORT_LIMIT = 10;

let workbaseCache = { expiresAt: 0, items: [] };
const importAttempts = new Map();

function loadGoogleAuth() {
  const creds = require(CREDENTIALS_PATH);
  return new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
}

let auth;
try {
  auth = loadGoogleAuth();
} catch (error) {
  console.error("[STARTUP] Google認証ファイルを読み込めません:", error.message);
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.set({
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' https://www.gstatic.com",
      "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "frame-src https://tokyo-pass.firebaseapp.com",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  next();
});
app.use(express.json({ limit: "256kb", strict: true }));
app.use(express.static(PUBLIC_DIR, { etag: true, maxAge: 0, index: "index.html" }));

function bearerToken(req) {
  const [scheme, token] = String(req.get("Authorization") || "").split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

async function privateApi(pathname, token) {
  const response = await fetch(new URL(pathname, PRIVATE_API_ORIGIN), {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  let payload = null;
  try { payload = await response.json(); } catch (_error) { /* handled below */ }
  if (!response.ok) {
    const error = new Error(payload?.error || "private_api_unavailable");
    error.status = response.status >= 400 && response.status < 600 ? response.status : 503;
    throw error;
  }
  return payload;
}

async function requireApprovedUser(req, res, next) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: "firebase_token_required" });
  try {
    await privateApi("/api/timetable-files", token);
    req.firebaseToken = token;
    return next();
  } catch (error) {
    const status = [401, 403, 503].includes(error.status) ? error.status : 503;
    return res.status(status).json({ error: error.message || "authorization_failed" });
  }
}

function requestAddress(req) {
  return String(req.get("CF-Connecting-IP") || req.ip || "unknown").slice(0, 100);
}

function limitImports(req, res, next) {
  const now = Date.now();
  const key = requestAddress(req);
  const recent = (importAttempts.get(key) || []).filter((time) => now - time < IMPORT_WINDOW_MILLISECONDS);
  if (recent.length >= IMPORT_LIMIT) {
    res.set("Retry-After", String(Math.ceil((IMPORT_WINDOW_MILLISECONDS - (now - recent[0])) / 1000)));
    return res.status(429).json({ error: "rate_limited", message: "発行回数が多すぎます。しばらく待ってから再度お試しください。" });
  }
  recent.push(now);
  importAttempts.set(key, recent);
  if (importAttempts.size > 1000) {
    for (const [address, times] of importAttempts) {
      if (!times.some((time) => now - time < IMPORT_WINDOW_MILLISECONDS)) importAttempts.delete(address);
    }
  }
  return next();
}

function validateString(value, maximum, required = true) {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFC").trim();
  if ((required && !text) || text.length > maximum || /[\0\r\n]/.test(text)) return null;
  return text;
}

function trainKeyFrom(body) {
  const input = body?.trainKey;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const trainNumber = validateString(input.trainNumber, 40);
  const startDate = validateString(input.startDate, 20);
  const line = validateString(input.line, 100);
  const origin = validateString(input.origin, 100, false) ?? "";
  const destination = validateString(input.destination, 100, false) ?? "";
  return trainNumber && startDate && line ? { trainNumber, startDate, line, origin, destination } : null;
}

function outputDateFrom(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month)
    || date.getUTCDate() !== Number(day)
  ) return null;
  return `${year}/${month}/${day}`;
}

function sameTrain(row, key) {
  return row && String(row.trainNumber || "") === key.trainNumber
    && String(row.startDate || "") === key.startDate
    && String(row.line || "") === key.line
    && String(row.origin || "") === key.origin
    && String(row.destination || "") === key.destination;
}

async function canonicalTrain(key, token) {
  const query = new URLSearchParams({ trainNumber: key.trainNumber, startDate: key.startDate });
  const payload = await privateApi(`/api/timetables?${query}`, token);
  const train = Array.isArray(payload?.items) ? payload.items.find((row) => sameTrain(row, key)) : null;
  if (!train) {
    const error = new Error("train_not_found");
    error.status = 404;
    throw error;
  }
  if (!Array.isArray(train.stops) || train.stops.length === 0 || train.stops.length > 90) {
    const error = new Error("invalid_train_data");
    error.status = 422;
    throw error;
  }
  return train;
}

async function workbaseItems() {
  if (workbaseCache.expiresAt > Date.now() && workbaseCache.items.length) return workbaseCache.items;
  const response = await fetch(WORKBASE_URL, {
    headers: { Accept: "application/json", "User-Agent": "tayunet-timetable-output/2" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`workbase HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("workbase is not an array");
  const items = [...new Set(payload.map((value) => validateString(value, 120)).filter(Boolean))];
  if (!items.length) throw new Error("workbase is empty");
  workbaseCache = { expiresAt: Date.now() + WORKBASE_CACHE_MILLISECONDS, items };
  return items;
}

function timestamp() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}`;
}

function plainText(value, maximum = 300) {
  return String(value ?? "").normalize("NFC").replace(/[\0\r\n]/g, " ").slice(0, maximum);
}

function writeText(cell, value, maximum) {
  const text = plainText(value, maximum);
  cell.value = text;
  // google-spreadsheetは「=」始まりの文字列を数式型にするため、
  // 更新対象の型だけをSheets APIの文字列型へ戻す。
  if (text.startsWith("=") && cell._draftData) cell._draftData.valueType = "stringValue";
}

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.get("/api/workbase", requireApprovedUser, async (_req, res) => {
  try {
    return res.json({ items: await workbaseItems() });
  } catch (error) {
    console.error("[WORKBASE]", error.message);
    return res.status(503).json({ error: "workbase_unavailable" });
  }
});

app.get("/api/timetables", requireApprovedUser, async (req, res) => {
  try {
    const payload = await privateApi("/api/timetables", req.firebaseToken);
    if (!Array.isArray(payload?.items)) return res.status(503).json({ error: "invalid_timetable_response" });
    return res.json({ count: payload.items.length, items: payload.items });
  } catch (error) {
    console.error("[TIMETABLE]", error.message);
    return res.status(error.status || 503).json({ error: error.message || "timetable_unavailable" });
  }
});

app.post("/import", requireApprovedUser, limitImports, async (req, res) => {
  let generatedSheet = null;
  try {
    if (!auth) return res.status(503).json({ status: "error", message: "PDF出力の認証設定を利用できません。" });
    const location = validateString(req.body?.location, 120);
    const key = trainKeyFrom(req.body);
    const requestedOutputDate = req.body?.outputDate;
    const outputDate = outputDateFrom(requestedOutputDate);
    if (!location || !key || (requestedOutputDate && !outputDate)) {
      return res.status(400).json({ status: "error", message: "発行条件が不正です。" });
    }

    const locations = await workbaseItems();
    if (!locations.includes(location)) {
      return res.status(400).json({ status: "error", message: "Workbaseに登録されていない出力先です。" });
    }
    const trainData = await canonicalTrain(key, req.firebaseToken);
    console.log(`[IMPORT] ${plainText(trainData.trainNumber, 40)} 発行開始`);

    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
    await doc.loadInfo();
    const templateSheet = doc.sheetsByIndex[0];
    if (!templateSheet) throw new Error("template_sheet_missing");
    const copied = await templateSheet.copyToSpreadsheet(SPREADSHEET_ID);
    await doc.loadInfo();
    generatedSheet = doc.sheetsById[copied.sheetId];
    if (!generatedSheet) throw new Error("copied_sheet_missing");

    const safeTrainNumber = plainText(trainData.trainNumber, 40).replace(/[\[\]*?:/\\]/g, "_");
    await generatedSheet.updateProperties({ title: `Export_${safeTrainNumber}_${Date.now()}`.slice(0, 95) });
    await generatedSheet.loadCells("A1:H100");

    writeText(generatedSheet.getCellByA1("D2"), `【　出 力 箇所　】${location}`, 180);
    writeText(generatedSheet.getCellByA1("A1"), `${trainData.trainNumber} 列車ダイヤ (${trainData.line})`, 180);
    writeText(generatedSheet.getCellByA1("B3"), trainData.trainNumber, 40);
    writeText(generatedSheet.getCellByA1("B4"), trainData.type, 100);
    writeText(generatedSheet.getCellByA1("B5"), `${trainData.origin || ""} ～ ${trainData.destination || ""}`, 220);
    writeText(generatedSheet.getCellByA1("B6"), outputDate || trainData.startDate, 20);
    writeText(generatedSheet.getCellByA1("B7"), trainData.line, 100);

    let lastRow = 8;
    trainData.stops.forEach((stop, index) => {
      const row = 9 + index;
      lastRow = row;
      const arrival = stop.arrival || (stop.departure ? "・・・" : "");
      const values = [stop.station, arrival, stop.trackN || "", stop.departure || "", stop.trackN || ""];
      for (let column = 0; column < 8; column += 1) {
        const cell = generatedSheet.getCell(row, column);
        writeText(cell, column < 5 ? values[column] : "", column === 0 ? 100 : 40);
        cell.borders = {
          top: { style: "SOLID" }, bottom: { style: "SOLID" },
          left: { style: "SOLID" }, right: { style: "SOLID" },
        };
      }
    });

    const footer = generatedSheet.getCell(lastRow + 1, 0);
    const nowJst = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    writeText(footer, `出力日時：${nowJst}`, 100);
    footer.textFormat = { fontSize: 9 };
    await generatedSheet.saveUpdatedCells();

    const pdfUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SPREADSHEET_ID)}/export?format=pdf&gid=${generatedSheet.sheetId}&size=A4&portrait=true&fitw=true&gridlines=false`;
    const pdfResponse = await auth.request({ url: pdfUrl, responseType: "arraybuffer" });
    return res.json({
      status: "success",
      pdf: Buffer.from(pdfResponse.data).toString("base64"),
      fileName: `${safeTrainNumber}_${timestamp()}.pdf`,
    });
  } catch (error) {
    console.error("[IMPORT ERROR]", error.message);
    const status = [400, 404, 422].includes(error.status) ? error.status : 500;
    const message = error.message === "train_not_found"
      ? "保護時刻表データに対象列車が見つかりません。"
      : error.message === "invalid_train_data"
        ? "対象列車の停車駅データを出力できません。"
        : "PDFの生成に失敗しました。時間をおいて再度お試しください。";
    return res.status(status).json({ status: "error", message });
  } finally {
    if (generatedSheet) {
      try { await generatedSheet.delete(); }
      catch (error) { console.error("[CLEANUP] 一時シートを削除できません:", error.message); }
    }
  }
});

app.use((error, _req, res, _next) => {
  console.error("[REQUEST ERROR]", error.message);
  if (error?.type === "entity.too.large") return res.status(413).json({ error: "payload_too_large" });
  return res.status(400).json({ error: "invalid_request" });
});

if (require.main === module) {
  app.listen(PORT, "127.0.0.1", () => console.log(`Timetable output listening on 127.0.0.1:${PORT}`));
}

module.exports = { app, outputDateFrom, trainKeyFrom, sameTrain, validateString, writeText };
