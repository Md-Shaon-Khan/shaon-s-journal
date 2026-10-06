import asyncio
import os
import re
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

import jwt
from bson import ObjectId
from bson.errors import InvalidId
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env", override=True, encoding="utf-8-sig")


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip().strip('"').strip("'")


MONGODB_URI = env("MONGODB_URI")
SECRET_KEY = env("SECRET_KEY", "change-me")
ADMIN_USERNAME = env("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = env("ADMIN_PASSWORD", "admin")
print(f"[info] .env path: {BASE_DIR / '.env'} (exists: {(BASE_DIR / '.env').exists()})")
print(f"[info] Admin username: {ADMIN_USERNAME!r}, password length: {len(ADMIN_PASSWORD)}")
ALGO = "HS256"
TOKEN_HOURS = 12
BLOCK_TYPES = {"heading", "subheading", "text", "code", "image", "callout", "github"}

client = AsyncIOMotorClient(MONGODB_URI, serverSelectionTimeoutMS=8000)
articles = client["nexus_kb"]["articles"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    async def ensure_index():
        try:
            await articles.create_index("slug", unique=True)
            print("[info] Connected to MongoDB Atlas")
        except Exception as exc:  # DB unreachable or IP not allowed yet
            print(f"[warning] Could not reach MongoDB: {exc}")

    task = asyncio.create_task(ensure_index())  # do not block server startup
    yield
    task.cancel()
    client.close()


class SafeStatic(StaticFiles):

    ALLOWED = {"style.css", "app.js", "shaon.png"}

    async def get_response(self, path, scope):
  
        ext = Path(path).suffix.lower()
        if path not in self.ALLOWED and ext not in {".png", ".jpg", ".jpeg", ".webp", ".svg"}:
            raise HTTPException(status_code=404)
        return await super().get_response(path, scope)

app = FastAPI(title="Nexus KB", lifespan=lifespan)
app.mount("/static", SafeStatic(directory="."), name="static")
templates = Jinja2Templates(directory=".")


class LoginIn(BaseModel):
    username: str
    password: str


class ArticleIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    category: str = Field(default="General", max_length=60)
    summary: str = Field(default="", max_length=500)
    status: Literal["draft", "published"] = "draft"
    blocks: list[dict[str, Any]] = []


# ---------- helpers ----------
def is_admin(request: Request) -> bool:
    token = request.cookies.get("token")
    if not token:
        return False
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGO])
    except jwt.PyJWTError:
        return False
    return payload.get("sub") == ADMIN_USERNAME and payload.get("role") == "admin"


def require_admin(request: Request):
    if not is_admin(request):
        raise HTTPException(status_code=401, detail="Admin login required")


def fmt(value: Optional[datetime]) -> Optional[str]:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ") if value else None


def ser(doc: dict, full: bool = True) -> dict:
    out = {
        "id": str(doc["_id"]),
        "title": doc.get("title", ""),
        "slug": doc.get("slug", ""),
        "category": doc.get("category", "General"),
        "summary": doc.get("summary", ""),
        "status": doc.get("status", "draft"),
        "created_at": fmt(doc.get("created_at")),
        "updated_at": fmt(doc.get("updated_at")),
        "published_at": fmt(doc.get("published_at")),
    }
    if full:
        out["blocks"] = doc.get("blocks", [])
    return out


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80] or "article"


def oid(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=404, detail="Article not found")


def clean_blocks(blocks: list[dict]) -> list[dict]:
    return [b for b in blocks if isinstance(b, dict) and b.get("type") in BLOCK_TYPES]


async def unique_slug(title: str) -> str:
    base = slugify(title)
    slug = base
    while await articles.find_one({"slug": slug}, {"_id": 1}):
        slug = f"{base}-{secrets.token_hex(2)}"
    return slug


# ---------- pages ----------
@app.get("/")
async def home(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/login")
async def login_page(request: Request):
    if is_admin(request):
        return RedirectResponse("/#/admin")
    return templates.TemplateResponse(request, "login.html")


# ---------- auth ----------
@app.post("/api/login")
async def login(data: LoginIn, response: Response):
    ok = secrets.compare_digest(data.username.strip().encode(), ADMIN_USERNAME.encode()) and \
        secrets.compare_digest(data.password.strip().encode(), ADMIN_PASSWORD.encode())
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    exp = datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS)
    token = jwt.encode({"sub": ADMIN_USERNAME, "role": "admin", "exp": exp}, SECRET_KEY, algorithm=ALGO)
    response.set_cookie("token", token, httponly=True, samesite="lax", max_age=TOKEN_HOURS * 3600, path="/")
    return {"ok": True}


@app.post("/api/logout")
async def logout(response: Response):
    response.delete_cookie("token", path="/")
    return {"ok": True}


@app.get("/api/me")
async def me(request: Request):
    return {"admin": is_admin(request)}


# ---------- public API ----------
@app.get("/api/categories")
async def categories():
    return sorted(await articles.distinct("category", {"status": "published"}))


@app.get("/api/articles")
async def list_published(category: Optional[str] = None):
    query: dict = {"status": "published"}
    if category:
        query["category"] = category
    cursor = articles.find(query, {"blocks": 0}).sort("published_at", -1)
    return [ser(d, False) async for d in cursor]


@app.get("/api/articles/{slug}")
async def get_article(slug: str, request: Request):
    doc = await articles.find_one({"slug": slug})
    if not doc or (doc.get("status") != "published" and not is_admin(request)):
        raise HTTPException(status_code=404, detail="Article not found")
    return ser(doc)


# ---------- admin API ----------
@app.get("/api/admin/articles", dependencies=[Depends(require_admin)])
async def admin_list():
    cursor = articles.find({}, {"blocks": 0}).sort("updated_at", -1)
    return [ser(d, False) async for d in cursor]


@app.get("/api/admin/articles/{article_id}", dependencies=[Depends(require_admin)])
async def admin_get(article_id: str):
    doc = await articles.find_one({"_id": oid(article_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Article not found")
    return ser(doc)


@app.post("/api/admin/articles", dependencies=[Depends(require_admin)])
async def admin_create(data: ArticleIn):
    now = datetime.now(timezone.utc)
    doc = {
        "title": data.title.strip(),
        "slug": await unique_slug(data.title),
        "category": data.category.strip() or "General",
        "summary": data.summary.strip(),
        "status": data.status,
        "blocks": clean_blocks(data.blocks),
        "created_at": now,
        "updated_at": now,
        "published_at": now if data.status == "published" else None,
    }
    result = await articles.insert_one(doc)
    doc["_id"] = result.inserted_id
    return ser(doc)


@app.put("/api/admin/articles/{article_id}", dependencies=[Depends(require_admin)])
async def admin_update(article_id: str, data: ArticleIn):
    existing = await articles.find_one({"_id": oid(article_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="Article not found")
    now = datetime.now(timezone.utc)
    published_at = existing.get("published_at")
    if data.status == "published" and not published_at:
        published_at = now
    update = {
        "title": data.title.strip(),
        "category": data.category.strip() or "General",
        "summary": data.summary.strip(),
        "status": data.status,
        "blocks": clean_blocks(data.blocks),
        "updated_at": now,
        "published_at": published_at,
    }
    await articles.update_one({"_id": existing["_id"]}, {"$set": update})
    existing.update(update)
    return ser(existing)


@app.delete("/api/admin/articles/{article_id}", dependencies=[Depends(require_admin)])
async def admin_delete(article_id: str):
    result = await articles.delete_one({"_id": oid(article_id)})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Article not found")
    return {"ok": True}