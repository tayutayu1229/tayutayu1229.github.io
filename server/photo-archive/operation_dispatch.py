"""運転情報打電・状況報告 API。

既存の写真APIコンテナへ登録し、認証は同じFirebase IDトークン検証を利用する。
打電本文は上書きせず、続報・状態変更・確認記録を時系列で保存する。
"""

from __future__ import annotations

import csv
import io
import json
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import Response

JST = timezone(timedelta(hours=9))
CATEGORIES = {
    "operation", "suspension", "delay", "turnback", "rolling_stock",
    "passenger", "special_boarding", "facility", "weather", "notice", "other",
}
CATEGORY_NUMBER_BASES = {
    "operation": 500, "suspension": 500, "delay": 500,
    "turnback": 500, "rolling_stock": 500,
    "passenger": 700, "special_boarding": 700,
    "facility": 700, "weather": 700,
    "notice": 900, "other": 900,
}
STATUSES = {"active", "monitoring", "resolved", "cancelled"}
UPDATE_KINDS = {"followup", "status", "correction", "handover", "memo"}
TRAIN_ACTIONS = {
    "運転休止", "運休", "遅延", "運転再開", "折返し変更", "行先変更", "時刻変更",
    "編成変更", "車種変更", "臨時運転", "便宜乗車", "指定輸送", "抑止", "その他",
}


def now_iso() -> str:
    return datetime.now(JST).isoformat(timespec="seconds")


def text(value: Any, limit: int = 5000) -> str:
    return str(value or "").strip()[:limit]


def boolean(value: Any) -> int:
    return 1 if value in (True, 1, "1", "true", "on", "yes") else 0


def json_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def json_object(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise HTTPException(400, "JSONオブジェクトを送信してください")
    return value


class OperationDispatchStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=20000")
        return db

    def initialize(self) -> None:
        with self.connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS dispatch_sequences(
              service_date TEXT PRIMARY KEY, last_number INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS dispatches(
              id TEXT PRIMARY KEY, dispatch_number TEXT NOT NULL,
              service_date TEXT NOT NULL, event_at TEXT, received_at TEXT NOT NULL,
              category TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL,
              title TEXT NOT NULL, line_name TEXT, location TEXT, reason TEXT, body TEXT,
              recipients TEXT, sender_uid TEXT NOT NULL, sender_email TEXT NOT NULL,
              sender_name TEXT, requires_ack INTEGER NOT NULL DEFAULT 0,
              handover INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
              effective_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              resolved_at TEXT, dispatched_at TEXT
            );
            CREATE TABLE IF NOT EXISTS dispatch_trains(
              id TEXT PRIMARY KEY, dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
              position INTEGER NOT NULL, train_number TEXT, action TEXT, section_from TEXT,
              section_to TEXT, delay_minutes INTEGER, planned TEXT, changed TEXT, notes TEXT
            );
            CREATE TABLE IF NOT EXISTS dispatch_updates(
              id TEXT PRIMARY KEY, dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
              kind TEXT NOT NULL, body TEXT NOT NULL, author_uid TEXT NOT NULL,
              author_email TEXT NOT NULL, author_name TEXT, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS dispatch_acknowledgements(
              dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
              uid TEXT NOT NULL, email TEXT NOT NULL, display_name TEXT, created_at TEXT NOT NULL,
              PRIMARY KEY(dispatch_id, uid)
            );
            CREATE TABLE IF NOT EXISTS dispatch_favorites(
              dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
              uid TEXT NOT NULL, created_at TEXT NOT NULL,
              PRIMARY KEY(dispatch_id, uid)
            );
            CREATE TABLE IF NOT EXISTS dispatch_audit(
              id TEXT PRIMARY KEY, dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
              action TEXT NOT NULL, actor_uid TEXT NOT NULL, actor_email TEXT NOT NULL,
              detail TEXT, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_dispatch_status_updated ON dispatches(status, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_dispatch_line_event ON dispatches(line_name, event_at DESC);
            CREATE INDEX IF NOT EXISTS idx_dispatch_service_date ON dispatches(service_date DESC);
            CREATE INDEX IF NOT EXISTS idx_dispatch_handover ON dispatches(handover, status, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_dispatch_trains_number ON dispatch_trains(train_number);
            CREATE INDEX IF NOT EXISTS idx_dispatch_updates_parent ON dispatch_updates(dispatch_id, created_at);
            """)
            columns = {row[1] for row in db.execute("PRAGMA table_info(dispatches)")}
            if "dispatched_at" not in columns:
                db.execute("ALTER TABLE dispatches ADD COLUMN dispatched_at TEXT")
                db.commit()
            table_sql = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='dispatches'").fetchone()[0]
            if re.search(r"dispatch_number\s+TEXT\s+NOT\s+NULL\s+UNIQUE", table_sql, re.IGNORECASE):
                db.commit()
                db.execute("PRAGMA foreign_keys=OFF")
                db.executescript("""
                CREATE TABLE dispatches_new(
                  id TEXT PRIMARY KEY, dispatch_number TEXT NOT NULL,
                  service_date TEXT NOT NULL, event_at TEXT, received_at TEXT NOT NULL,
                  category TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL,
                  title TEXT NOT NULL, line_name TEXT, location TEXT, reason TEXT, body TEXT,
                  recipients TEXT, sender_uid TEXT NOT NULL, sender_email TEXT NOT NULL,
                  sender_name TEXT, requires_ack INTEGER NOT NULL DEFAULT 0,
                  handover INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
                  effective_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                  resolved_at TEXT, dispatched_at TEXT
                );
                INSERT INTO dispatches_new SELECT * FROM dispatches;
                DROP TABLE dispatches;
                ALTER TABLE dispatches_new RENAME TO dispatches;
                CREATE INDEX idx_dispatch_status_updated ON dispatches(status, updated_at DESC);
                CREATE INDEX idx_dispatch_line_event ON dispatches(line_name, event_at DESC);
                CREATE INDEX idx_dispatch_service_date ON dispatches(service_date DESC);
                CREATE INDEX idx_dispatch_handover ON dispatches(handover, status, updated_at DESC);
                """)
                db.execute("PRAGMA foreign_keys=ON")
            db.execute("UPDATE dispatches SET dispatched_at=COALESCE(dispatched_at, created_at, received_at) WHERE dispatched_at IS NULL OR dispatched_at='' ")
            numbering_version = db.execute("SELECT 1 FROM dispatch_sequences WHERE service_date='__numbering_v2__'").fetchone()
            if not numbering_version:
                db.execute("DELETE FROM dispatch_sequences")
                counters: dict[str, int] = {}
                rows = db.execute("SELECT id,category,received_at,created_at FROM dispatches ORDER BY received_at,created_at,id").fetchall()
                for row in rows:
                    received_day = (row["received_at"] or row["created_at"] or now_iso())[:10]
                    base = CATEGORY_NUMBER_BASES.get(row["category"], 900)
                    sequence_key = f"{received_day}:{base}"
                    counters[sequence_key] = counters.get(sequence_key, base) + 1
                    db.execute("UPDATE dispatches SET dispatch_number=? WHERE id=?", (f"TKG-{counters[sequence_key]}号", row["id"]))
                db.executemany("INSERT INTO dispatch_sequences(service_date,last_number) VALUES(?,?)", counters.items())
                db.execute("INSERT INTO dispatch_sequences(service_date,last_number) VALUES('__numbering_v2__',2)")
            db.execute("PRAGMA optimize")

    def next_number(self, db: sqlite3.Connection, received_day: str, category: str) -> str:
        base = CATEGORY_NUMBER_BASES.get(category, 900)
        sequence_key = f"{received_day}:{base}"
        row = db.execute("SELECT last_number FROM dispatch_sequences WHERE service_date=?", (sequence_key,)).fetchone()
        number = max(base, row[0] if row else base) + 1
        db.execute("INSERT INTO dispatch_sequences VALUES(?,?) ON CONFLICT(service_date) DO UPDATE SET last_number=excluded.last_number", (sequence_key, number))
        return f"TKG-{number}号"


def train_input(raw: Any, position: int) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    train_number = text(raw.get("trainNumber"), 50)
    action = text(raw.get("action"), 30)
    section_from = text(raw.get("sectionFrom"), 100)
    section_to = text(raw.get("sectionTo"), 100)
    if not any((train_number, action, section_from, section_to)):
        return None
    try:
        delay = int(raw.get("delayMinutes")) if raw.get("delayMinutes") not in (None, "") else None
    except (TypeError, ValueError):
        delay = None
    return {
        "id": uuid.uuid4().hex, "position": position, "trainNumber": train_number,
        "action": action if action in TRAIN_ACTIONS else (action or "その他"),
        "sectionFrom": section_from, "sectionTo": section_to,
        "delayMinutes": max(-999, min(9999, delay)) if delay is not None else None,
        "planned": text(raw.get("planned"), 1000), "changed": text(raw.get("changed"), 1000),
        "notes": text(raw.get("notes"), 2000),
    }


def train_output(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "trainNumber": row["train_number"], "action": row["action"],
        "sectionFrom": row["section_from"], "sectionTo": row["section_to"],
        "delayMinutes": row["delay_minutes"], "planned": row["planned"],
        "changed": row["changed"], "notes": row["notes"],
    }


def dispatch_output(db: sqlite3.Connection, row: sqlite3.Row, uid: str, detail: bool = False) -> dict[str, Any]:
    dispatch_id = row["id"]
    trains = [train_output(train) for train in db.execute("SELECT * FROM dispatch_trains WHERE dispatch_id=? ORDER BY position", (dispatch_id,))]
    ack_count = db.execute("SELECT COUNT(*) FROM dispatch_acknowledgements WHERE dispatch_id=?", (dispatch_id,)).fetchone()[0]
    acknowledged = bool(db.execute("SELECT 1 FROM dispatch_acknowledgements WHERE dispatch_id=? AND uid=?", (dispatch_id, uid)).fetchone())
    favorite = bool(db.execute("SELECT 1 FROM dispatch_favorites WHERE dispatch_id=? AND uid=?", (dispatch_id, uid)).fetchone())
    result = {
        "id": dispatch_id, "dispatchNumber": row["dispatch_number"],
        "serviceDate": row["service_date"],
        "eventAt": row["event_at"], "receivedAt": row["received_at"], "category": row["category"],
        "status": row["status"], "title": row["title"],
        "lineName": row["line_name"], "location": row["location"], "reason": row["reason"],
        "body": row["body"], "recipients": row["recipients"], "senderUid": row["sender_uid"],
        "senderEmail": row["sender_email"], "senderName": row["sender_name"],
        "requiresAcknowledgement": bool(row["requires_ack"]), "handover": bool(row["handover"]),
        "pinned": bool(row["pinned"]), "effectiveUntil": row["effective_until"],
        "createdAt": row["created_at"], "dispatchedAt": row["dispatched_at"] or row["created_at"],
        "updatedAt": row["updated_at"], "resolvedAt": row["resolved_at"],
        "trains": trains, "acknowledgementCount": ack_count, "acknowledged": acknowledged, "favorite": favorite,
    }
    if detail:
        result["updates"] = [{
            "id": update["id"], "kind": update["kind"], "body": update["body"],
            "authorUid": update["author_uid"], "authorEmail": update["author_email"],
            "authorName": update["author_name"], "createdAt": update["created_at"],
        } for update in db.execute("SELECT * FROM dispatch_updates WHERE dispatch_id=? ORDER BY created_at", (dispatch_id,))]
        result["acknowledgements"] = [{
            "uid": ack["uid"], "email": ack["email"], "displayName": ack["display_name"], "createdAt": ack["created_at"],
        } for ack in db.execute("SELECT * FROM dispatch_acknowledgements WHERE dispatch_id=? ORDER BY created_at", (dispatch_id,))]
        result["audit"] = [{
            "action": audit["action"], "actorEmail": audit["actor_email"], "detail": audit["detail"], "createdAt": audit["created_at"],
        } for audit in db.execute("SELECT * FROM dispatch_audit WHERE dispatch_id=? ORDER BY created_at", (dispatch_id,))]
    return result


def add_audit(db: sqlite3.Connection, dispatch_id: str, action: str, user: dict[str, Any], detail: str = "") -> None:
    db.execute("INSERT INTO dispatch_audit VALUES(?,?,?,?,?,?,?)", (
        uuid.uuid4().hex, dispatch_id, action, user["uid"], user.get("email", ""), text(detail, 2000), now_iso(),
    ))


def register_operation_dispatch(app: FastAPI, verify_user: Callable[..., Any], database_path: Path) -> OperationDispatchStore:
    store = OperationDispatchStore(database_path)
    prefix = "/v1/operation-dispatch"

    @app.get(f"{prefix}/health")
    def operation_health(user: dict[str, Any] = Depends(verify_user)) -> dict[str, Any]:
        with store.connect() as db:
            total = db.execute("SELECT COUNT(*) FROM dispatches").fetchone()[0]
            active = db.execute("SELECT COUNT(*) FROM dispatches WHERE status IN('active','monitoring')").fetchone()[0]
        return {"ok": True, "version": "2026.08.11.4", "records": total, "active": active}

    @app.get(f"{prefix}/summary")
    def summary(user: dict[str, Any] = Depends(verify_user)) -> dict[str, Any]:
        today = datetime.now(JST).date().isoformat()
        with store.connect() as db:
            counts = {
                "active": db.execute("SELECT COUNT(*) FROM dispatches WHERE status='active'").fetchone()[0],
                "monitoring": db.execute("SELECT COUNT(*) FROM dispatches WHERE status='monitoring'").fetchone()[0],
                "handover": db.execute("SELECT COUNT(*) FROM dispatches WHERE handover=1 AND status IN('active','monitoring')").fetchone()[0],
                "today": db.execute("SELECT COUNT(*) FROM dispatches WHERE service_date=?", (today,)).fetchone()[0],
                "unacknowledged": db.execute("""SELECT COUNT(*) FROM dispatches d WHERE d.requires_ack=1 AND d.status!='cancelled'
                  AND NOT EXISTS(SELECT 1 FROM dispatch_acknowledgements a WHERE a.dispatch_id=d.id AND a.uid=?)""", (user["uid"],)).fetchone()[0],
            }
        return counts

    @app.get(prefix)
    def list_dispatches(
        q: str = Query("", max_length=200), status: str = Query(""), category: str = Query(""),
        line: str = Query("", max_length=100), date_from: str = Query(""),
        date_to: str = Query(""), handover: bool = Query(False), favorite: bool = Query(False),
        unacknowledged: bool = Query(False),
        limit: int = Query(100, ge=1, le=300), user: dict[str, Any] = Depends(verify_user),
    ) -> dict[str, Any]:
        clauses, parameters = ["1=1"], []
        if status in STATUSES: clauses.append("d.status=?"); parameters.append(status)
        elif status == "open": clauses.append("d.status IN('active','monitoring')")
        if category in CATEGORIES: clauses.append("d.category=?"); parameters.append(category)
        if line: clauses.append("d.line_name LIKE ?"); parameters.append(f"%{line}%")
        if date_from: clauses.append("d.service_date>=?"); parameters.append(date_from[:10])
        if date_to: clauses.append("d.service_date<=?"); parameters.append(date_to[:10])
        if handover: clauses.append("d.handover=1")
        if favorite: clauses.append("EXISTS(SELECT 1 FROM dispatch_favorites f WHERE f.dispatch_id=d.id AND f.uid=?)"); parameters.append(user["uid"])
        if unacknowledged:
            clauses.append("d.requires_ack=1 AND d.status!='cancelled' AND NOT EXISTS(SELECT 1 FROM dispatch_acknowledgements a WHERE a.dispatch_id=d.id AND a.uid=?)")
            parameters.append(user["uid"])
        if q:
            needle = f"%{q}%"
            clauses.append("""(d.title LIKE ? OR d.line_name LIKE ? OR d.location LIKE ? OR d.reason LIKE ? OR d.body LIKE ?
              OR d.dispatch_number LIKE ? OR EXISTS(SELECT 1 FROM dispatch_trains t WHERE t.dispatch_id=d.id AND (t.train_number LIKE ? OR t.section_from LIKE ? OR t.section_to LIKE ?)))""")
            parameters.extend([needle] * 9)
        sql = f"SELECT d.* FROM dispatches d WHERE {' AND '.join(clauses)} ORDER BY d.pinned DESC, CASE d.status WHEN 'active' THEN 0 WHEN 'monitoring' THEN 1 ELSE 2 END, d.updated_at DESC LIMIT ?"
        parameters.append(limit)
        with store.connect() as db:
            rows = db.execute(sql, parameters).fetchall()
            return {"items": [dispatch_output(db, row, user["uid"]) for row in rows], "count": len(rows)}

    @app.get(f"{prefix}/export.csv")
    def export_csv(user: dict[str, Any] = Depends(verify_user)) -> Response:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["電報番号", "運転日", "発生日時", "打電日時", "受付日時", "線区", "件名", "種別", "状態", "事由", "本文", "発信者", "更新日時"])
        with store.connect() as db:
            for row in db.execute("SELECT * FROM dispatches ORDER BY service_date DESC, updated_at DESC"):
                writer.writerow([row["dispatch_number"], row["service_date"], row["event_at"], row["dispatched_at"], row["received_at"], row["line_name"], row["title"], row["category"], row["status"], row["reason"], row["body"], row["sender_email"], row["updated_at"]])
        return Response("\ufeff" + output.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=operation-dispatch.csv"})

    @app.post(prefix)
    async def create_dispatch(request: Request, user: dict[str, Any] = Depends(verify_user)) -> dict[str, Any]:
        data = json_object(await request.json())
        title = text(data.get("title"), 300)
        if not title: raise HTTPException(400, "件名を入力してください")
        service_date = text(data.get("serviceDate"), 10) or datetime.now(JST).date().isoformat()
        category = data.get("category") if data.get("category") in CATEGORIES else "operation"
        status = data.get("status") if data.get("status") in STATUSES else "active"
        trains = [item for index, raw in enumerate(json_list(data.get("trains"))) if (item := train_input(raw, index))]
        timestamp, dispatch_id = now_iso(), uuid.uuid4().hex
        dispatched_at = text(data.get("dispatchedAt"), 40) or timestamp
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            number = store.next_number(db, timestamp[:10], category)
            db.execute("""INSERT INTO dispatches(
                id,dispatch_number,service_date,event_at,received_at,category,priority,status,title,line_name,location,
                reason,body,recipients,sender_uid,sender_email,sender_name,requires_ack,handover,pinned,effective_until,
                created_at,updated_at,resolved_at,dispatched_at
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                dispatch_id, number, service_date, text(data.get("eventAt"), 40), timestamp, category, "", status,
                title, text(data.get("lineName"), 150), text(data.get("location"), 300), text(data.get("reason"), 1000),
                text(data.get("body"), 10000), text(data.get("recipients"), 3000), user["uid"], user.get("email", ""),
                text(user.get("displayName") or user.get("email", ""), 200), boolean(data.get("requiresAcknowledgement")),
                boolean(data.get("handover")), boolean(data.get("pinned")), text(data.get("effectiveUntil"), 40),
                timestamp, timestamp, timestamp if status == "resolved" else None, dispatched_at,
            ))
            for train in trains:
                db.execute("INSERT INTO dispatch_trains VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
                    train["id"], dispatch_id, train["position"], train["trainNumber"], train["action"], train["sectionFrom"],
                    train["sectionTo"], train["delayMinutes"], train["planned"], train["changed"], train["notes"],
                ))
            add_audit(db, dispatch_id, "created", user, f"{category} {title}")
            row = db.execute("SELECT * FROM dispatches WHERE id=?", (dispatch_id,)).fetchone()
            return dispatch_output(db, row, user["uid"], True)

    def require_dispatch(db: sqlite3.Connection, dispatch_id: str) -> sqlite3.Row:
        row = db.execute("SELECT * FROM dispatches WHERE id=?", (dispatch_id,)).fetchone()
        if not row: raise HTTPException(404, "打電が見つかりません")
        return row

    @app.get(f"{prefix}/{{dispatch_id}}")
    def get_dispatch(dispatch_id: str, user: dict[str, Any] = Depends(verify_user)) -> dict[str, Any]:
        with store.connect() as db:
            return dispatch_output(db, require_dispatch(db, dispatch_id), user["uid"], True)

    @app.post(f"{prefix}/{{dispatch_id}}/updates")
    async def add_update(dispatch_id: str, request: Request, user: dict[str, Any] = Depends(verify_user)) -> dict[str, Any]:
        data = json_object(await request.json()); body = text(data.get("body"), 10000)
        if not body: raise HTTPException(400, "続報内容を入力してください")
        kind = data.get("kind") if data.get("kind") in UPDATE_KINDS else "followup"
        timestamp = now_iso()
        with store.connect() as db:
            require_dispatch(db, dispatch_id)
            db.execute("INSERT INTO dispatch_updates VALUES(?,?,?,?,?,?,?,?)", (uuid.uuid4().hex, dispatch_id, kind, body, user["uid"], user.get("email", ""), text(user.get("displayName") or user.get("email", ""), 200), timestamp))
            db.execute("UPDATE dispatches SET updated_at=? WHERE id=?", (timestamp, dispatch_id))
            add_audit(db, dispatch_id, f"update:{kind}", user, body[:200])
            return dispatch_output(db, require_dispatch(db, dispatch_id), user["uid"], True)

    @app.post(f"{prefix}/{{dispatch_id}}/status")
    async def set_status(dispatch_id: str, request: Request, user: dict[str, Any] = Depends(verify_user)) -> dict[str, Any]:
        data = json_object(await request.json()); status = data.get("status")
        if status not in STATUSES: raise HTTPException(400, "状態が不正です")
        timestamp = now_iso(); note = text(data.get("note"), 3000)
        with store.connect() as db:
            current = require_dispatch(db, dispatch_id)
            handover = boolean(data.get("handover")) if "handover" in data else current["handover"]
            db.execute("UPDATE dispatches SET status=?,handover=?,updated_at=?,resolved_at=? WHERE id=?", (
                status, handover, timestamp, timestamp if status == "resolved" else None, dispatch_id,
            ))
            if note:
                db.execute("INSERT INTO dispatch_updates VALUES(?,?,?,?,?,?,?,?)", (uuid.uuid4().hex, dispatch_id, "status", note, user["uid"], user.get("email", ""), text(user.get("displayName") or user.get("email", ""), 200), timestamp))
            add_audit(db, dispatch_id, f"status:{status}", user, note)
            return dispatch_output(db, require_dispatch(db, dispatch_id), user["uid"], True)

    @app.post(f"{prefix}/{{dispatch_id}}/acknowledge")
    def acknowledge(dispatch_id: str, user: dict[str, Any] = Depends(verify_user)) -> dict[str, Any]:
        with store.connect() as db:
            require_dispatch(db, dispatch_id)
            db.execute("INSERT OR IGNORE INTO dispatch_acknowledgements VALUES(?,?,?,?,?)", (dispatch_id, user["uid"], user.get("email", ""), text(user.get("displayName") or user.get("email", ""), 200), now_iso()))
            add_audit(db, dispatch_id, "acknowledged", user)
            return dispatch_output(db, require_dispatch(db, dispatch_id), user["uid"], True)

    @app.post(f"{prefix}/{{dispatch_id}}/favorite")
    async def favorite(dispatch_id: str, request: Request, user: dict[str, Any] = Depends(verify_user)) -> dict[str, Any]:
        data = json_object(await request.json()); enabled = bool(data.get("enabled"))
        with store.connect() as db:
            require_dispatch(db, dispatch_id)
            if enabled: db.execute("INSERT OR IGNORE INTO dispatch_favorites VALUES(?,?,?)", (dispatch_id, user["uid"], now_iso()))
            else: db.execute("DELETE FROM dispatch_favorites WHERE dispatch_id=? AND uid=?", (dispatch_id, user["uid"]))
            return {"ok": True, "favorite": enabled}

    return store
