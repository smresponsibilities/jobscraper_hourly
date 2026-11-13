"""Loopback-only Turnstile helper using the installed Quart and Patchright packages."""
import argparse
import asyncio
import hmac
import html
from urllib.parse import urlparse

from hypercorn.asyncio import serve
from hypercorn.config import Config
from patchright.async_api import async_playwright
from quart import Quart, jsonify, request

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=8088)
parser.add_argument("--secret", required=True)
args = parser.parse_args()
app = Quart(__name__)
semaphore = asyncio.Semaphore(1)
playwright = None
browser = None


@app.before_serving
async def start_browser():
    global playwright, browser
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(channel="chrome", headless=True)


@app.after_serving
async def close_browser():
    if browser:
        await browser.close()
    if playwright:
        await playwright.stop()


@app.get("/solve")
async def solve():
    if not hmac.compare_digest(request.headers.get("secret", ""), args.secret):
        return jsonify(error="forbidden"), 403
    data = await request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="invalid request"), 400
    url, site_key = data.get("site_url"), data.get("site_key")
    if not isinstance(url, str) or not isinstance(site_key, str) or len(url) > 4096 or not 1 <= len(site_key) <= 256:
        return jsonify(error="invalid request"), 400
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return jsonify(error="invalid URL"), 400
    attributes = f'data-sitekey="{html.escape(site_key, quote=True)}"'
    for name, key in (("action", "action"), ("cdata", "cdata")):
        value = data.get(key)
        if value is not None:
            if not isinstance(value, str) or len(value) > 1024:
                return jsonify(error="invalid widget data"), 400
            attributes += f' data-{name}="{html.escape(value, quote=True)}"'
    user_agent = data.get("user_agent")
    if user_agent is not None and (not isinstance(user_agent, str) or len(user_agent) > 1024):
        return jsonify(error="invalid user agent"), 400
    document = f'<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><div class="cf-turnstile" {attributes}></div>'
    async with semaphore:
        context = None
        try:
            context = await browser.new_context(**({"user_agent": user_agent} if user_agent else {}))
            page = await context.new_page()
            await page.route(url, lambda route: route.fulfill(status=200, content_type="text/html", body=document))
            await page.goto(url, wait_until="domcontentloaded", timeout=15000)
            await page.wait_for_function("() => (document.querySelector('[name=cf-turnstile-response]')?.value || '').length > 20", timeout=25000)
            token = await page.locator('[name="cf-turnstile-response"]').input_value()
            return jsonify(token=token)
        except Exception:
            return jsonify(error="challenge not solved"), 502
        finally:
            if context:
                await context.close()


if __name__ == "__main__":
    config = Config()
    config.bind = [f"127.0.0.1:{args.port}"]
    config.accesslog = None
    asyncio.run(serve(app, config))
