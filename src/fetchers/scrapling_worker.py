import sys
import json
import logging
from typing import Dict, Any
import warnings

# Ignore the deprecation warning
warnings.filterwarnings('ignore')

from scrapling import Fetcher

logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(message)s")

def process_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    # Validate contract
    if not isinstance(payload, dict):
        raise ValueError("Payload must be a JSON object")
    
    if payload.get("version") != 1:
        raise ValueError("Unsupported protocol version")
        
    url = payload.get("url")
    if not url or not isinstance(url, str) or not (url.startswith("http://") or url.startswith("https://")):
        raise ValueError("Invalid URL scheme")
        
    method = payload.get("method", "GET").upper()
    if method not in ("GET", "POST"):
        raise ValueError("Unsupported method")
        
    engine = payload.get("engine", "static")
    if engine not in ("static", "browser"):
        raise ValueError("Unsupported engine")
        
    headers = payload.get("headers") or {}
    body = payload.get("body")
    timeout = payload.get("timeout", 30)
    
    if engine == "static":
        fetcher = Fetcher()
        # Ensure we pass the headers exactly as requested
        if method == "GET":
            response = fetcher.get(url, headers=headers, timeout=timeout)
        else:
            if isinstance(body, dict):
                response = fetcher.post(url, headers=headers, json=body, timeout=timeout)
            elif isinstance(body, str):
                response = fetcher.post(url, headers=headers, data=body.encode('utf-8'), timeout=timeout)
            else:
                response = fetcher.post(url, headers=headers, data=body, timeout=timeout)

        # Build raw body string 
        raw_body = response.body
        try:
            text_body = raw_body.decode('utf-8')
            encoding = 'utf-8'
        except UnicodeDecodeError:
            text_body = raw_body.decode('latin-1', errors='replace')
            encoding = 'latin-1'
            
        return {
            "version": 1,
            "success": True,
            "status": response.status,
            "headers": dict(response.headers),
            "url": response.url,
            "body": text_body,
            "encoding": encoding,
            "engine": engine,
            "error": None
        }
    else:
        from scrapling import StealthyFetcher
        wait_selector = payload.get("wait_selector")
        solve_cloudflare = payload.get("solve_cloudflare", True)
        
        # The timeout is in milliseconds for StealthyFetcher
        timeout_ms = int(timeout * 1000)
        
        # Forward headers, use wait_selector for bounded site readiness
        fetch_kwargs = {
            "extra_headers": headers,
            "timeout": timeout_ms,
            "headless": True,
            "solve_cloudflare": solve_cloudflare,
            "google_search": False, # Do not override referer if provided
        }
        
        if wait_selector:
            fetch_kwargs["wait_selector"] = wait_selector
            
        # StealthyFetcher.fetch is a class method
        response = StealthyFetcher.fetch(url, **fetch_kwargs)
        
        raw_body = response.body
        try:
            text_body = raw_body.decode('utf-8')
            encoding = 'utf-8'
        except UnicodeDecodeError:
            text_body = raw_body.decode('latin-1', errors='replace')
            encoding = 'latin-1'
            
        return {
            "version": 1,
            "success": True,
            "status": response.status,
            "headers": dict(response.headers),
            "url": response.url,
            "body": text_body,
            "encoding": encoding,
            "engine": engine,
            "error": None
        }

def main():
    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            raise ValueError("Empty body")
            
        payload = json.loads(raw_input)
        
        response = process_request(payload)
        
    except json.JSONDecodeError as e:
        logging.error(f"JSON decode error: {e}")
        response = {
            "version": 1,
            "success": False,
            "error": {"category": "protocol", "message": "Malformed JSON input"}
        }
    except ValueError as e:
        logging.error(f"Validation error: {e}")
        response = {
            "version": 1,
            "success": False,
            "error": {"category": "validation", "message": str(e)}
        }
    except Exception as e:
        logging.error(f"Internal error: {e}")
        response = {
            "version": 1,
            "success": False,
            "error": {"category": "internal", "message": str(e)}
        }
        
    sys.stdout.write(json.dumps(response))
    sys.stdout.flush()

if __name__ == "__main__":
    main()
