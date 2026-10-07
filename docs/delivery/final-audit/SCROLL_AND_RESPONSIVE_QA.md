# Scroll and Responsive QA

Status date: 2026-09-08. The Sales dashboard was measured through the browser at all required viewports.

| Viewport  | Document horizontal overflow | Result |
| --------- | ---------------------------: | ------ |
| 1920×1080 |                         0 px | PASS   |
| 1600×900  |                         0 px | PASS   |
| 1366×768  |                         0 px | PASS   |
| 1280×720  |                         0 px | PASS   |
| 1024×768  |                         0 px | PASS   |
| 768×1024  |                         0 px | PASS   |
| 390×844   |                         0 px | PASS   |

At 390×844, `.app-main` measured 375 px client width and 375 px scroll width, with 2,963 px scroll height inside an 844 px viewport. Vertical scrolling is available without page-wide horizontal overflow.

Mobile navigation closed state is no longer focusable off-screen. Open state includes a backdrop, Escape handling and inert main content. The quick-create drawer uses 95vw and its fields/buttons stay inside the viewport.

This is a route-level responsive pass for the exercised dashboard/admin/customer/quotation paths. Full every-role, every-screen, browser zoom and long-form acceptance remains pending.
