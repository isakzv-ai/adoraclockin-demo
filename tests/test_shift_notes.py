"""Run against the local demo: python tests/test_shift_notes.py [base URL].

Requires Playwright for Python and its Chromium browser. Uses only synthetic data.
"""
import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width in (390, 1440):
        page = browser.new_page(viewport={"width": width, "height": 900})
        page.goto(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173/")
        page.wait_for_selector("#recordsBody tr")
        page.evaluate("""() => {
          const employee = currentEmployee();
          employee.shifts = [{id:'test-shift',date:'2026-10-01',start:'08:00:00',
            end:'16:00:00',notes:'Original note',source:'live',dateMismatch:0}];
          appState.audit = []; save(); render();
        }""")
        page.locator('[data-edit="test-shift"]').click()
        page.locator('#editForm button[type="submit"]').click()
        assert page.evaluate('currentEmployee().shifts[0].notes') == 'Original note'
        assert page.evaluate('appState.audit.length') == 0

        page.locator('[data-edit="test-shift"]').click()
        page.locator('#editOut').fill('17:00:00')
        page.locator('#editForm button[type="submit"]').click()
        assert page.locator('#editDialog').evaluate('(dialog) => dialog.open')
        assert page.evaluate('currentEmployee().shifts[0].end') == '16:00:00'
        page.locator('#editNote').fill('Corrected finish time')
        page.locator('#editForm button[type="submit"]').click()
        expected = 'Original note · Corrected finish time'
        assert page.evaluate('currentEmployee().shifts[0].notes') == expected
        audit = page.evaluate('appState.audit[0]')
        assert audit['before']['notes'] == 'Original note'
        assert audit['after']['end'] == '17:00:00'
        assert audit['reason'] == 'Corrected finish time'

        page.locator('[data-edit="test-shift"]').click()
        page.locator('#editNote').fill('Manager confirmed')
        page.locator('#editForm button[type="submit"]').click()
        assert page.evaluate('appState.audit.length') == 2
        assert page.evaluate('appState.audit[1].reason') == 'Manager confirmed'
        page.reload()
        page.wait_for_selector('#recordsBody tr')
        assert page.evaluate('currentEmployee().shifts[0].notes') == expected + ' · Manager confirmed'
        assert page.evaluate('appState.audit.length') == 2
        page.close()
        print(f'PASS {width}px: unchanged save, required reason, corrected time, note-only audit, reload')
    browser.close()
