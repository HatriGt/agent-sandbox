// Does a blob: PDF opened with window.open render under the app CSP (object-src 'none')?
// Headed Chromium only: the headless shell has no PDF viewer. Prints "rendered" or "blank".
import http from "node:http";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const PDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 60 >> stream
BT /F1 36 Tf 30 100 Td (PROBE OK) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF`;

const CSP = "default-src 'self'; img-src 'self' data: blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const srv = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html", "content-security-policy": CSP });
  res.end(`<!doctype html><button id="go">open</button><script src="/app.js"></script>`.replace("<script src=\"/app.js\"></script>", "") + `<script src="/app.js"></script>`);
}).on("request", () => {});
const app = `document.getElementById('go').onclick = () => { const b = new Blob([${JSON.stringify(PDF)}], { type: 'application/pdf' }); const u = URL.createObjectURL(b); window.open(u, '_blank'); };`;
const srv2 = http.createServer((req, res) => {
  if (req.url === "/app.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(app);
    return;
  }
  res.writeHead(200, { "content-type": "text/html", "content-security-policy": CSP });
  res.end(`<!doctype html><button id="go">open</button><script src="/app.js"></script>`);
});
srv.close();
await new Promise((r) => srv2.listen(0, "127.0.0.1", r));
const port = srv2.address().port;
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${port}/`);
const [popup] = await Promise.all([ctx.waitForEvent("page"), page.click("#go")]);
await popup.waitForTimeout(2500);
const shot = process.argv[2] || ".shots/out/pdf-csp-probe.png";
await popup.screenshot({ path: shot });
const info = await popup.evaluate(() => ({ url: location.href, hasEmbed: !!document.querySelector("embed"), bodyText: document.body?.innerText?.slice(0, 80) ?? "" })).catch((e) => ({ err: String(e) }));
console.log(JSON.stringify(info));
await browser.close();
srv2.close();
