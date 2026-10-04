import sys
import json
from scrapling.fetchers import StealthyFetcher
from playwright.sync_api import sync_playwright

def main():
    if len(sys.argv) < 2:
        print("Missing JSON payload", file=sys.stderr)
        sys.exit(1)
        
    try:
        payload = json.loads(sys.argv[1])
    except Exception as e:
        print(f"Invalid JSON payload: {e}", file=sys.stderr)
        sys.exit(1)
        
    url = payload.get('url')
    method = payload.get('method', 'GET')
    headers = payload.get('headers', {})
    body = payload.get('body')
    
    if not url:
        print("Missing url", file=sys.stderr)
        sys.exit(1)

    StealthyFetcher.adaptive = True
    
    # Scrapling StealthyFetcher is primarily for GET.
    # For POST to an API, we can use Playwright's API request context 
    # but that defeats the purpose of Scrapling's turnstile bypass if we don't load a page.
    # However, if we only need the TLS bypass, playwright request context works.
    # But let's try to just use Scrapling StealthyFetcher if it supports method/body.
    # I'll use Playwright request context if method is POST, since API fetching with POST usually doesn't need Turnstile execution.
    if method.upper() == 'POST':
        with sync_playwright() as p:
            # We can use browser or request context
            request_context = p.request.new_context(
                extra_http_headers=headers
            )
            response = request_context.post(
                url,
                data=body
            )
            print(response.text())
    else:
        # standard GET with bypass
        page = StealthyFetcher.fetch(url, headless=True, network_idle=True)
        print(page.text)

if __name__ == "__main__":
    main()
