// The interrupt flow, end to end, against the real built console over test/ui-mock-server.mjs
// (which mirrors the controller: a queued send, the stop seam, exit 253, the gap before the
// resume, the delivery loop after a plain Stop).
//
//   node .shots/interrupt-flow.mjs [--dark] [--port=8799]
//
// Two flows, shot at every state:
//   A  message queued mid-turn → "Send now" in the composer's queue tray → stopping → seam + delivering → settled
//   B  a second message queued → header "Stop & send" → same states, from the other button
//   D  three messages queued → the tray as a list → one edited in place → one removed → the rest removed
//   C  plain Stop with nothing queued
// Every shot is a clip of the conversation column's lower half (the part that changes) and the
// header strip, so the state pill and the Stop button are in the frame too. Prints a per-step
// timeline of what the thread shows (bubble label, state pill, any run-end pill).
import { spawn } from "node:child_process";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const dark = args.includes("--dark");
const port = Number(args.find((a) => a.startsWith("--port="))?.slice(7) ?? 8799);
const suffix = dark ? "dark" : "light";
const out = (name) => `.shots/interrupt-${name}-${suffix}.png`;
const BOX = "pool-1788256499900-jnq6ys";

const server = spawn(process.execPath, ["test/ui-mock-server.mjs", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => server.stdout.once("data", r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 2 });
await ctx.addInitScript((d) => {
  localStorage.setItem("asb-token", "devtoken123");
  localStorage.setItem("asb-dark", d ? "1" : "0");
}, dark);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`http://localhost:${port}/dashboard/box/${BOX}`, { waitUntil: "load" });
await page.waitForSelector("#send-input", { timeout: 20000 });
await sleep(1200);

const read = () =>
  page.evaluate(() => {
    const t = (el) => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const tray = document.querySelector("[data-queue-tray]");
    const pending = tray
      ? [...tray.querySelectorAll("li")].map((li) => (li.querySelector("textarea") ? "[editing] " + li.querySelector("textarea").value.slice(0, 24) : t(li.querySelector("p")).slice(0, 24)) + " | " + [...li.querySelectorAll("button,[role=status]")].map((b) => t(b) || b.getAttribute("aria-label")).join(", "))
      : [];
    const trayHead = t(tray?.firstElementChild);
    const bubbles = [...document.querySelectorAll(".you-bubble")].map((b) => t(b).slice(0, 40));
    const stop = t([...document.querySelectorAll("button")].find((b) => /^(Stop|Stopping…|Stop & send)$/.test(t(b))));
    const pill = t(document.querySelector("[data-run-pill]"));
    const seams = [...document.querySelectorAll("span.label")].map(t).filter((s) => /^stopped by you/i.test(s));
    const state = t(document.querySelector(".pop-in.rounded-full"));
    const sendBtn = document.querySelector("[data-composer-send]");
    const composer = sendBtn ? sendBtn.getAttribute("aria-label") + (sendBtn.disabled ? " (off)" : "") : "";
    return { tray: trayHead, pending, bubbles: bubbles.slice(-3), stop, composer, pill, seams, state };
  });

async function shot(name) {
  const r = await read();
  console.log(`[${name}]`, JSON.stringify(r));
  await page.screenshot({ path: out(name), clip: { x: 0, y: 0, width: 1280, height: 860 } });
}

const send = async (text) => {
  await page.fill("#send-input", text);
  await page.keyboard.press("Enter");
  await sleep(250); // the composer clears and the queue answers before the next one is typed
};
const clickLabel = async (label) => {
  await page.evaluate((l) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === l);
    if (!b) throw new Error(`no button "${l}"`);
    b.click();
  }, label);
};

// A — the bubble's own "send now".
await shot("0-running");
await send("Skip that check — the runner is gone. Comment on the PR and merge.");
await sleep(500);
await shot("1-queued");
await clickLabel("Send now");
await sleep(150);
await shot("2-armed");
await clickLabel("Stop the turn & send");
await sleep(400);
await shot("3-stopping");
await sleep(1400); // STOP_MS passed: the seam is in the log, the box reads done
await shot("4-stopped-delivering");
await sleep(2400); // RESUME_MS passed: the ⟦you⟧ line landed, the turn is running again
await shot("5-settled");

// B — the header's Stop & send.
await send("Also bump the changelog before you merge.");
await sleep(600);
await shot("6-queued-again");
await clickLabel("Stop & send");
await sleep(400);
await shot("7-header-stopping");
await sleep(3800);
await shot("8-header-settled");

// D — a list: three messages queued, one taken back, then the rest.
await send("Then open a follow-up issue for the flaky runner.");
await send("Tag it infra and assign it to me.");
await send("And post the issue link in the PR thread when you are done.");
await sleep(700);
await shot("9-queue-list");
// Edit the second row in place: pencil → editor → new words → Enter.
await page.evaluate(() => [...document.querySelectorAll("[data-queue-tray] button[aria-label='Edit']")][1].click());
await sleep(300);
await shot("10-queue-editing");
await page.fill("[data-queue-tray] textarea", "Tag it infra, assign it to me, and link the failing run.");
await page.keyboard.press("Enter");
await sleep(600);
await shot("11-queue-edited");
// A long message (a pasted checklist, many lines) waits clipped to two lines and edits in a field
// that stops at a third of the viewport and scrolls inside, opened at its end.
const long = ["Before you open the issue, go through this checklist and paste the answers into it:", ""]
  .concat(Array.from({ length: 60 }, (_, i) => `${i + 1}. Check that job ${i + 1} of the runner matrix is green on main and note the run id.`))
  .concat(["", "Then link every red run under a single heading."])
  .join("\n");
await page.fill("#send-input", long);
await page.keyboard.press("Enter");
await sleep(700);
await page.evaluate(() => [...document.querySelectorAll("[data-queue-tray] button[aria-label='Edit']")][3].click());
await sleep(300);
await shot("12-queue-editing-long");
await page.keyboard.press("Escape");
await sleep(300);
await page.evaluate(() => [...document.querySelectorAll("[data-queue-tray] button[aria-label='Remove from the queue']")][3].click());
await sleep(500);
await page.evaluate(() => [...document.querySelectorAll("[data-queue-tray] button[aria-label='Remove from the queue']")][1].click());
await sleep(600);
await shot("13-queue-list-one-removed");
for (let i = 0; i < 2; i++) {
  await page.evaluate(() => document.querySelector("[data-queue-tray] button[aria-label='Remove from the queue']").click());
  await sleep(400);
}
await sleep(500);
await shot("14-queue-empty");

// E — the composer's own stop: with the agent working and nothing typed, the send button is a
// filled square; the first character typed turns it back into the queue arrow.
await shot("15-composer-stop");
await page.fill("#send-input", "Also");
await sleep(300);
await shot("16-composer-typing");
await page.fill("#send-input", "");
await sleep(300);

// C — plain Stop with nothing queued, from the composer's square: the seam, no red pill.
await page.click("[data-composer-send][aria-label='Stop the agent']");
await sleep(2200);
await shot("17-plain-stop");

const st = await fetch(`http://localhost:${port}/__state`).then((r) => r.json());
console.log("server queue after:", st.queue.length, "| log tail:", JSON.stringify(st.log.split("\n").slice(-6).join(" ⏎ ")));
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
await browser.close();
server.kill();
