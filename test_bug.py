import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        # log all console messages
        page.on("console", lambda msg: print(f"Browser console: {msg.type}: {msg.text}"))
        page.on("pageerror", lambda err: print(f"Browser page error: {err}"))
        
        print("Navigating to compare...")
        await page.goto("http://127.0.0.1:5000/compare")
        
        print("Clicking compare button...")
        submit_btn = page.locator("button#submit")
        await submit_btn.click()
        await page.wait_for_timeout(3000)
        
        print("Done.")
        await browser.close()

asyncio.run(run())
