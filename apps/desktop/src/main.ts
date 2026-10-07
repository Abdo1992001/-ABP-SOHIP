import { app, BrowserWindow, session, shell } from "electron";

const webUrl =
  process.env.ABP_DESKTOP_WEB_URL ?? "https://PENDING-DEP-002.invalid";
const allowedOrigin = new URL(webUrl).origin;

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: process.env.NODE_ENV !== "production",
    },
  });
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => {
      callback(false);
    },
  );
  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url);
    if (target.protocol === "https:" && target.origin !== allowedOrigin)
      void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== allowedOrigin) event.preventDefault();
  });
  await window.loadURL(webUrl);
  window.once("ready-to-show", () => {
    window.show();
  });
}

app
  .whenReady()
  .then(createWindow)
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "DESKTOP_BOOT_FAILED"}\n`,
    );
    app.exit(1);
  });
app.on("window-all-closed", () => {
  app.quit();
});
