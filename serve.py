"""Uma página local com o scanner já incluso. Uso no dia do TCC."""

from __future__ import annotations

import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent
API = WEB.parent / "API-PTCG Scanner"

if not (API / "app" / "main.py").is_file():
    raise SystemExit(f"Não achei o scanner em {API}")

sys.path.insert(0, str(API))

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.main import app


def _drop_site_root() -> None:
    kept = []
    for route in app.router.routes:
        methods = getattr(route, "methods", None) or set()
        if getattr(route, "path", None) == "/" and "GET" in methods:
            continue
        kept.append(route)
    app.router.routes = kept


def _page(name: str):
    path = WEB / name

    def handler():
        return FileResponse(path)

    return handler


_drop_site_root()
app.add_api_route("/", _page("index.html"), methods=["GET"], include_in_schema=False)
app.add_api_route("/index.html", _page("index.html"), methods=["GET"], include_in_schema=False)
app.add_api_route("/revisar.html", _page("revisar.html"), methods=["GET"], include_in_schema=False)
app.mount("/css", StaticFiles(directory=WEB / "css"), name="css")
app.mount("/js", StaticFiles(directory=WEB / "js"), name="js")
app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=5500, reload=False)


if __name__ == "__main__":
    main()
