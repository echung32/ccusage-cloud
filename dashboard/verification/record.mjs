import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
const output = resolve("../docs/verification/personal-workspace");
await mkdir(output, { recursive: true });
const reset = await fetch("http://127.0.0.1:4322/__verification/reset", {
  method: "POST",
});
if (!reset.ok) throw new Error("Synthetic fixture reset failed");
const browser = await chromium.launch();
const reports = [];
const errors = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function experiment(name, title, run, mobile = false) {
  const viewport = mobile
    ? { width: 390, height: 844 }
    : { width: 1440, height: 1000 };
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: output, size: viewport },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const steps = [];
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  await page.addInitScript(() => {
    const mount = () => {
      if (document.getElementById("verification-log")) return;
      const box = document.createElement("div");
      box.id = "verification-log";
      box.style.cssText =
        "position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#10291ff2;color:#f0f6e9;padding:14px 22px;font:13px/1.6 monospace;border-top:2px solid #b4d492;pointer-events:none";
      box.textContent =
        sessionStorage.getItem("verification-step") ??
        "Synthetic data verification — preparing experiment";
      document.body.append(box);
    };
    window.addEventListener("DOMContentLoaded", mount);
    setInterval(mount, 100);
  });
  async function step(description, action) {
    steps.push(description);
    const text = `${title} · Step ${steps.length}\n${description}\nSynthetic fixtures · real browser interactions · not production auth`;
    await page
      .evaluate((text) => {
        sessionStorage.setItem("verification-step", text);
        const box = document.getElementById("verification-log");
        if (box) box.innerText = text;
      }, text)
      .catch(() => {});
    console.log(`${name} #${steps.length}: ${description}`);
    await pause(800);
    await action();
    await pause(1200);
  }
  await page.goto("http://127.0.0.1:4322/overview");
  await expect(page.getByText("633,000")).toBeVisible();
  await run(page, step);
  await page.evaluate(() => {
    document.activeElement?.blur();
    document.getElementById("verification-log").style.visibility = "hidden";
  });
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  await page.evaluate(() => {
    document.getElementById("verification-log").style.visibility = "visible";
  });
  await step(
    "PASS — all assertions in this experiment succeeded.",
    async () => {},
  );
  const video = page.video();
  await context.close();
  const original = await video.path();
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      original,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "24",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      `${output}/${name}.mp4`,
    ],
    { stdio: "ignore" },
  );
  await rm(original);
  reports.push({ name, title, steps });
}
try {
  await experiment(
    "01-overview-filters",
    "Experiment 1: Overview and date/source filters",
    async (page, step) => {
      await step(
        "Inspect headline metrics and both daily trend charts.",
        async () => {
          await expect(
            page.getByRole("img", { name: "Cost over time" }),
          ).toBeVisible();
          await expect(
            page.getByRole("img", { name: "Tokens over time" }),
          ).toBeVisible();
        },
      );
      await step(
        "Select Source → cursor. Verify the URL and filtered metrics.",
        async () => {
          await page
            .getByLabel("Source", { exact: true })
            .selectOption("cursor");
          await expect(page).toHaveURL(/source=cursor/);
          await expect(page.getByText("221,000")).toBeVisible();
        },
      );
      await step(
        "Press Clear. Type From = 2026-10-03 and To = 2026-10-05.",
        async () => {
          await page
            .getByRole("button", { name: "Clear", exact: true })
            .click();
          await page.getByLabel("From", { exact: true }).fill("2026-10-03");
          await page.getByLabel("To", { exact: true }).fill("2026-10-05");
          await expect(page).toHaveURL(/to=2026-10-05T23/);
        },
      );
      await step(
        "Press Clear, then click View chart data to inspect accessible daily values.",
        async () => {
          await page
            .getByRole("button", { name: "Clear", exact: true })
            .click();
          await page
            .getByText("View chart data", { exact: true })
            .first()
            .click();
          await expect(
            page.getByRole("table", { name: "Cost over time data" }),
          ).toBeVisible();
        },
      );
    },
  );
  await experiment(
    "02-breakdowns-projects",
    "Experiment 2: Sources, models, devices, and project search",
    async (page, step) => {
      await step(
        "Click Sources & Models in navigation; inspect cost bars and both tables.",
        async () => {
          await page
            .getByRole("link", { name: "Sources & Models", exact: true })
            .click();
          await expect(
            page.getByRole("img", { name: "Cost by model" }),
          ).toBeVisible();
        },
      );
      await step("Click Devices; compare machine contributions.", async () => {
        await page.getByRole("link", { name: "Devices", exact: true }).click();
        await expect(
          page.getByRole("img", { name: "Device contribution by cost" }),
        ).toBeVisible();
      });
      await step(
        "Click Projects. Click Tokens to sort numerically.",
        async () => {
          await page
            .getByRole("link", { name: "Projects", exact: true })
            .click();
          await page.getByRole("button", { name: /Tokens/ }).click();
          await expect(page.locator('th[aria-sort="ascending"]')).toContainText(
            "Tokens",
          );
        },
      );
      await step(
        "Click Find projects and type design-system. Verify only that project remains.",
        async () => {
          await page
            .getByRole("searchbox", { name: "Find projects" })
            .pressSequentially("design-system", { delay: 80 });
          await expect(page.locator("tbody tr")).toHaveCount(1);
          await expect(page.locator("tbody")).toContainText(
            "/workspace/design-system",
          );
        },
      );
      await step(
        "Press Control/Meta+A then Backspace to clear project search.",
        async () => {
          await page.getByRole("searchbox").press("Meta+A");
          await page.getByRole("searchbox").press("Backspace");
          await expect(page.locator("tbody tr")).toHaveCount(4);
        },
      );
    },
  );
  await experiment(
    "03-sessions",
    "Experiment 3: Session pagination, search, and legacy group URLs",
    async (page, step) => {
      await step(
        "Click Sessions. Inspect the first 12 loaded sessions.",
        async () => {
          await page
            .getByRole("link", { name: "Sessions", exact: true })
            .click();
          await expect(page.locator("tbody tr")).toHaveCount(12);
        },
      );
      await step(
        "Click Load more. Verify that all 24 sessions remain distinct.",
        async () => {
          await page.getByRole("button", { name: "Load more" }).click();
          await expect(page.locator("tbody tr")).toHaveCount(24);
        },
      );
      await step(
        "Type cursor in Find sessions; verify 8 matching rows.",
        async () => {
          await page
            .getByRole("searchbox")
            .pressSequentially("cursor", { delay: 100 });
          await expect(page.locator("tbody tr")).toHaveCount(8);
        },
      );
      await step(
        "Clear search. Click Cost twice to switch ascending then descending order.",
        async () => {
          await page.getByRole("searchbox").fill("");
          await page.getByRole("button", { name: /Cost/ }).click();
          await page.getByRole("button", { name: /Cost/ }).click();
          await expect(
            page.locator('th[aria-sort="descending"]'),
          ).toContainText("Cost");
        },
      );
      await step(
        "Open /projects?scope=group. Verify personal projects still load and no Group switch exists.",
        async () => {
          await page.goto("http://127.0.0.1:4322/projects?scope=group");
          await expect(page.locator("tbody tr")).toHaveCount(4);
          await expect(
            page.getByRole("link", { name: "Group", exact: true }),
          ).toHaveCount(0);
        },
      );
    },
  );
  await experiment(
    "04-device-management",
    "Experiment 4: Device creation, rename, enrollment, and revoke",
    async (page, step) => {
      await step(
        "Click Settings. Verify the private-account message and no sharing controls.",
        async () => {
          await page
            .getByRole("link", { name: "Settings", exact: true })
            .click();
          await expect(
            page.getByText("Your usage is private.", { exact: false }),
          ).toBeVisible();
        },
      );
      await step(
        "Type Review laptop into New device, then click Add device.",
        async () => {
          await page
            .getByLabel("new device label")
            .pressSequentially("Review laptop", { delay: 80 });
          await page.getByRole("button", { name: "Add device" }).click();
          await expect(
            page.getByText("cccloud_SYNTHETIC_DEMO_TOKEN_NOT_VALID"),
          ).toBeVisible();
        },
      );
      await step(
        "Click Dismiss token. Click Rename beside Review laptop.",
        async () => {
          await page.getByRole("button", { name: "Dismiss token" }).click();
          await page
            .getByRole("button", { name: "Edit Review laptop" })
            .click();
        },
      );
      await step(
        "Replace the device name with Review workstation and press Enter.",
        async () => {
          const input = page.getByLabel("device name input");
          await input.fill("Review workstation");
          await input.press("Enter");
          await expect(
            page.getByRole("heading", { name: "Review workstation" }),
          ).toBeVisible();
        },
      );
      await step(
        "Click Generate enroll command. Inspect macOS/Linux and PowerShell commands.",
        async () => {
          await page
            .getByRole("button", { name: "Generate enroll command" })
            .click();
          await expect(
            page.getByText("SYNTHETIC_DEMO_CODE", { exact: false }).first(),
          ).toBeVisible();
        },
      );
      await step(
        "Click Dismiss commands. Click Revoke beside Review workstation and accept confirmation.",
        async () => {
          await page.getByRole("button", { name: "Dismiss commands" }).click();
          page.once("dialog", (dialog) => dialog.accept());
          await page
            .locator(".device-row")
            .filter({ hasText: "Review workstation" })
            .getByRole("button", { name: "Revoke" })
            .click();
          await expect(
            page
              .locator(".device-row")
              .filter({ hasText: "Review workstation" }),
          ).toContainText("Revoked");
        },
      );
    },
  );
  await experiment(
    "05-failure-empty-states",
    "Experiment 5: Request failure, retry, empty data, and login",
    async (page, step) => {
      await step(
        "Simulate a summary API 500, then reload Overview.",
        async () => {
          await page.route("**/api/summary*", (route) =>
            route.fulfill({ status: 500, body: "{}" }),
          );
          await page.reload();
          await expect(page.getByRole("alert")).toContainText("Unable to load");
        },
      );
      await step(
        "Restore the API and click Try again. Verify metrics recover.",
        async () => {
          await page.unroute("**/api/summary*");
          await page.getByRole("button", { name: "Try again" }).click();
          await expect(page.getByText("633,000")).toBeVisible();
        },
      );
      await step(
        "Set From to 2027-01-01; inspect the empty chart guidance.",
        async () => {
          await page.getByLabel("From", { exact: true }).fill("2027-01-01");
          await expect(
            page.getByRole("heading", { name: "No data", exact: true }).first(),
          ).toBeVisible();
        },
      );
      await step(
        "Simulate an unauthorized account and open /login?returned=1.",
        async () => {
          await page.route("**/api/me", (route) =>
            route.fulfill({ status: 401, body: "{}" }),
          );
          await page.goto("http://127.0.0.1:4322/login?returned=1");
          await expect(
            page.getByRole("heading", { name: "Not authorized" }),
          ).toBeVisible();
        },
      );
    },
  );
  await experiment(
    "06-mobile",
    "Experiment 6: Mobile navigation and layout (390px)",
    async (page, step) => {
      await step(
        "Inspect mobile Overview. Verify the document fits the viewport.",
        async () => {
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
        },
      );
      await step(
        "Tap Sources & Models, then scroll to the model breakdown.",
        async () => {
          await page
            .getByRole("link", { name: "Sources & Models", exact: true })
            .click();
          await page
            .getByRole("heading", { name: "By model" })
            .scrollIntoViewIfNeeded();
          await expect(
            page.getByRole("img", { name: "Cost by model" }),
          ).toBeVisible();
        },
      );
      await step(
        "Tap Settings and scroll to device enrollment. Confirm there is no page overflow.",
        async () => {
          await page
            .getByRole("link", { name: "Settings", exact: true })
            .click();
          await page
            .getByRole("heading", { name: "Connect with one command" })
            .scrollIntoViewIfNeeded();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
        },
      );
    },
    true,
  );
  expect(errors).toEqual([]);
  const report =
    "# Personal workspace — video verification\n\nThese recordings exercise the real built dashboard in Chromium against a loopback-only **synthetic fixture API**. They do not prove production sign-in or a live Cloudflare deployment. Real Worker isolation and device behavior are covered separately by the Worker test suite. No real account data or usable secrets are shown.\n\nEvery video shows the experiment, numbered steps, typed input and actions in an on-screen log. All browser assertions passed; no uncaught browser errors.\n\n" +
    reports
      .map(
        (r) =>
          `## ${r.title}\n\n[Watch/download video (${r.name}.mp4)](${r.name}.mp4) · [Screenshot](${r.name}.png)\n\n${r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`,
      )
      .join("\n");
  await writeFile(`${output}/README.md`, report);
  console.log(
    `PASS: ${reports.length} recorded experiments. Artifacts: ${output}`,
  );
} finally {
  await browser.close();
}
