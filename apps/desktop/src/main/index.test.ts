import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildAppProfilePaths,
  configureAppProfile,
  createHostTray,
  createMainWindow,
  createTrayIcon,
  createTrayIconSvg,
  createTrayMenuTemplate,
  defaultViewerSettings,
  delay,
  fetchBackend,
  getDefaultSaveDirectory,
  getHostSettingsFromBackend,
  getHostSettingsPath,
  getHostSettingsWithRetry,
  getTrayStatusText,
  getViewerSettings,
  hashAccessPassword,
  notifyHostShutdownAndQuit,
  openTrustedExternalUrl,
  readJsonSettings,
  registerDirectIpcHandlers,
  shouldDelayQuitForHostShutdown,
  showHostNotification,
  syncLaunchOnStartup,
  updateHostSettingsViaBackend,
  updateTray,
  writeJsonSettings
} from "./index.js";

class FakeWindow {
  readonly events = new Map<string, (...args: unknown[]) => void>();
  readonly sent: Array<{ channel: string; args: unknown[] }> = [];
  hidden = 0;
  focused = 0;
  shown = 0;
  titles: string[] = [];
  webContents = {
    events: new Map<string, (...args: unknown[]) => void>(),
    on: (event: string, listener: (...args: unknown[]) => void) => {
      this.webContents.events.set(event, listener);
    },
    send: (channel: string, ...args: unknown[]) => {
      this.sent.push({ channel, args });
    }
  };

  focus(): void {
    this.focused += 1;
  }

  hide(): void {
    this.hidden += 1;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.events.set(event, listener);
  }

  setTitle(title: string): void {
    this.titles.push(title);
  }

  show(): void {
    this.shown += 1;
  }
}

test("profile and window helpers configure Electron app state", async () => {
  const appCalls: string[] = [];
  const mkdirCalls: Array<{ path: string; recursive: boolean }> = [];
  const paths = buildAppProfilePaths("C:/Users/Me/AppData/Roaming", "RemoteControl", true);

  assert.deepEqual(
    Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, value.replace(/\\/g, "/")])),
    {
      profileName: "RemoteControl Dev",
      userDataPath: "C:/Users/Me/AppData/Roaming/RemoteControl Dev",
      sessionDataPath: "C:/Users/Me/AppData/Roaming/RemoteControl Dev/Session Data",
      cachePath: "C:/Users/Me/AppData/Roaming/RemoteControl Dev/Session Data/Cache"
    }
  );

  configureAppProfile({
    getPath: () => "C:/Users/Me/AppData/Roaming",
    setName: (name) => {
      appCalls.push(`name:${name}`);
    },
    setPath: (name, value) => {
      appCalls.push(`${name}:${value.replace(/\\/g, "/")}`);
    },
    commandLine: {
      appendSwitch: (name, value) => {
        appCalls.push(`switch:${name}=${value.replace(/\\/g, "/")}`);
      }
    }
  }, "RemoteControl", false, (path, options) => {
    mkdirCalls.push({ path: path.replace(/\\/g, "/"), recursive: Boolean(options?.recursive) });
  });

  assert.deepEqual(appCalls, [
    "name:RemoteControl",
    "userData:C:/Users/Me/AppData/Roaming/RemoteControl",
    "sessionData:C:/Users/Me/AppData/Roaming/RemoteControl/Session Data",
    "switch:disk-cache-dir=C:/Users/Me/AppData/Roaming/RemoteControl/Session Data/Cache"
  ]);
  assert.deepEqual(mkdirCalls, [{
    path: "C:/Users/Me/AppData/Roaming/RemoteControl/Session Data/Cache",
    recursive: true
  }]);

  const createdWindows: FakeWindow[] = [];
  const attachedUrls: string[] = [];
  const loadCalls: Array<{ currentDir: string; isDev: boolean; rendererUrl?: string }> = [];
  const originalConsoleError = console.error;
  const consoleErrors: string[] = [];
  console.error = (message?: unknown) => {
    consoleErrors.push(String(message));
  };

  try {
    const window = createMainWindow({
      BrowserWindow: class {
        constructor() {
          const fakeWindow = new FakeWindow();
          createdWindows.push(fakeWindow);
          return fakeWindow as unknown as object;
        }
      } as unknown as new (options: unknown) => FakeWindow,
      appMode: "host",
      attachTrustedExternalOpenHandler: (_window, handler) => {
        handler("https://docs.example");
        attachedUrls.push("attached");
      },
      buildMainWindowOptions: () => ({}) as never,
      currentDir: "C:/app/main",
      getIsQuitting: () => false,
      isDev: true,
      loadWindowContent: async (_window, currentDir, isDev, rendererUrl) => {
        loadCalls.push({ currentDir: currentDir.replace(/\\/g, "/"), isDev, rendererUrl });
      },
      openTrustedExternalUrl: (url) => {
        attachedUrls.push(url);
      },
      rendererUrl: "http://localhost:5173",
      windowTitle: "RemoteControl v0.2.6"
    });

    const closeEvent = { preventDefaultCalled: false, preventDefault() { this.preventDefaultCalled = true; } };
    createdWindows[0].events.get("close")?.(closeEvent);
    createdWindows[0].events.get("page-title-updated")?.({ preventDefault() {} });
    createdWindows[0].webContents.events.get("render-process-gone")?.({}, { reason: "crashed", exitCode: 8 });
    await Promise.resolve();

    assert.equal(window, createdWindows[0]);
    assert.deepEqual(attachedUrls, ["https://docs.example", "attached"]);
    assert.equal(createdWindows[0].hidden, 1);
    assert.equal(closeEvent.preventDefaultCalled, true);
    assert.deepEqual(loadCalls, [{
      currentDir: "C:/app/main",
      isDev: true,
      rendererUrl: "http://localhost:5173"
    }]);
    assert.deepEqual(createdWindows[0].titles, ["RemoteControl v0.2.6", "RemoteControl v0.2.6"]);
    assert.deepEqual(consoleErrors, ["Renderer process gone: crashed (8)"]);
  } finally {
    console.error = originalConsoleError;
  }
});

test("settings and backend helpers merge defaults persist JSON and wrap backend requests", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "remote-control-main-"));

  try {
    assert.deepEqual(defaultViewerSettings, {
      captureLocalInput: false,
      connectInFullscreen: true,
      disconnectShortcut: "Ctrl+Alt+Shift+D",
      frameRate: 30,
      receiveAudio: true,
      switchMonitorShortcut: "Ctrl+Alt+Shift+M"
    });
    assert.equal(getDefaultSaveDirectory("C:/Downloads").replace(/\\/g, "/"), "C:/Downloads/RemoteControl");
    assert.deepEqual(getViewerSettings({
      viewer: { receiveAudio: false, frameRate: 60 } as never
    }, (payload) => payload as Partial<typeof defaultViewerSettings>), {
      ...defaultViewerSettings,
      receiveAudio: false,
      frameRate: 60
    });

    const settingsPath = join(tempDir, "settings.json");
    await writeJsonSettings(settingsPath, { recentServers: ["http://server"] });
    assert.deepEqual(await readJsonSettings<{ recentServers?: string[] }>(settingsPath), {
      recentServers: ["http://server"]
    });
    assert.deepEqual(await readJsonSettings<{ recentServers?: string[] }>(
      join(tempDir, "missing.json")
    ), {});
    assert.deepEqual(await readJsonSettings<{ recentServers?: string[] }>(
      join(tempDir, "broken.json"),
      (path) => path.endsWith("broken.json"),
      async () => "{"
    ), {});
    assert.equal((await readFile(settingsPath, "utf8")).includes("\"http://server\""), true);
    assert.equal(getHostSettingsPath(tempDir).replace(/\\/g, "/"), `${tempDir.replace(/\\/g, "/")}/host-settings.json`);

    const retries: number[] = [];
    let attempt = 0;
    const settings = await getHostSettingsWithRetry(async () => {
      attempt += 1;
      if (attempt < 3) {
        throw new Error("not ready");
      }

      return { launchOnStartup: true };
    }, async (ms) => {
      retries.push(ms);
    }, 5, 25);
    assert.deepEqual(settings, { launchOnStartup: true });
    assert.deepEqual(retries, [25, 25]);
    await assert.rejects(
      () => getHostSettingsWithRetry(async () => {
        throw new Error("still down");
      }, async () => undefined, 2, 10),
      /still down/
    );

    const backendCalls: Array<{ url: string; token?: string; method?: string; body?: string }> = [];
    const backendResponse = new Response(JSON.stringify({ launchOnStartup: true }), { status: 200 });
    const fetched = await fetchBackend({
      backendStatus: { url: "http://localhost:47315" },
      settingsToken: "secret",
      path: "/settings/host",
      fetchFn: async (url, init) => {
        backendCalls.push({
          url: String(url),
          token: new Headers(init?.headers).get("x-remote-control-settings-token") ?? undefined,
          method: init?.method,
          body: typeof init?.body === "string" ? init.body : undefined
        });
        return backendResponse;
      }
    });
    assert.equal(fetched, backendResponse);
    assert.deepEqual(backendCalls, [{
      url: "http://localhost:47315/settings/host",
      token: "secret",
      method: undefined,
      body: undefined
    }]);
    await assert.rejects(
      () => fetchBackend({ backendStatus: {}, path: "/settings/host" }),
      /Embedded backend is not available/
    );
    await assert.rejects(
      () => fetchBackend({
        backendStatus: { url: "http://localhost:47315" },
        path: "/settings/host",
        fetchFn: async () => new Response("nope", { status: 503 })
      }),
      /503/
    );

    assert.deepEqual(
      await getHostSettingsFromBackend("viewer", async () => new Response("{}")),
      {}
    );
    assert.deepEqual(
      await getHostSettingsFromBackend("host", async () => new Response(JSON.stringify({ launchOnStartup: false }))),
      { launchOnStartup: false }
    );

    const patchCalls: Array<{ method?: string; body?: string }> = [];
    assert.deepEqual(
      await updateHostSettingsViaBackend("host", { launchOnStartup: true }, async (_path, init) => {
        patchCalls.push({
          method: init?.method,
          body: typeof init?.body === "string" ? init.body : undefined
        });
        return new Response(JSON.stringify({ launchOnStartup: true }));
      }),
      { launchOnStartup: true }
    );
    assert.deepEqual(patchCalls, [{
      method: "PATCH",
      body: JSON.stringify({ launchOnStartup: true })
    }]);

    let openAtLogin: boolean | undefined;
    await syncLaunchOnStartup({
      getHostSettingsWithRetry: async () => ({ launchOnStartup: false }),
      setLoginItemOpenAtLogin: (enabled) => {
        openAtLogin = enabled;
      }
    });
    assert.equal(openAtLogin, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("misc main-process helpers handle hashing tray notifications quit flow and IPC wiring", async () => {
  const hashed = await hashAccessPassword("secret", {
    passwordHashPrefix: "scrypt:test",
    randomBytes: () => Buffer.from("salt"),
    scrypt: async (_password, salt, keylen) => Buffer.concat([salt, Buffer.alloc(keylen - salt.length, 1)]),
    keyBytes: 8
  });
  assert.equal(hashed, "scrypt:test$c2FsdA==$c2FsdAEBAQE=");

  const scheduled: number[] = [];
  await delay(15, (_callback, timeoutMs) => {
    scheduled.push(timeoutMs);
    queueMicrotask(_callback);
  });
  assert.deepEqual(scheduled, [15]);

  assert.equal(getTrayStatusText(false), "Waiting for viewer");
  assert.equal(getTrayStatusText(true, "Alice"), "Connected: Alice");
  assert.deepEqual(createTrayMenuTemplate({
    connected: true,
    viewerName: "Alice",
    onOpen: () => undefined,
    onQuit: () => undefined
  }).map((item) => item.label), [
    "Connected to Alice",
    "Open",
    "Quit"
  ]);

  const trayOps: string[] = [];
  updateTray({
    Menu: {
      buildFromTemplate: (template) => {
        trayOps.push(`menu:${template.map((item) => item.label).join("|")}`);
        return template;
      }
    },
    connected: true,
    onOpen: () => trayOps.push("open"),
    onQuit: () => trayOps.push("quit"),
    productName: "RemoteControl",
    tray: {
      setContextMenu: () => trayOps.push("context"),
      setToolTip: (tooltip) => trayOps.push(`tooltip:${tooltip}`)
    },
    viewerName: "Alice"
  });
  assert.deepEqual(trayOps.slice(0, 3), [
    "tooltip:RemoteControl: Connected: Alice",
    "menu:Connected to Alice|Open|Quit",
    "context"
  ]);

  const trayEvents = new Map<string, () => void>();
  const hostTray = createHostTray({
    Tray: class {
      constructor(public _icon: unknown) {}
      on(event: string, listener: () => void): void {
        trayEvents.set(event, listener);
      }
      setContextMenu(_menu: unknown): void {
        trayOps.push("tray-context");
      }
      setToolTip(tooltip: string): void {
        trayOps.push(`tray-tooltip:${tooltip}`);
      }
    },
    Menu: {
      buildFromTemplate: () => ({})
    },
    icon: "icon",
    productName: "RemoteControl",
    onDoubleClick: () => trayOps.push("double-click"),
    onOpen: () => trayOps.push("host-open"),
    onQuit: () => trayOps.push("host-quit")
  });
  trayEvents.get("double-click")?.();
  assert.equal(Boolean(hostTray), true);
  assert.equal(trayOps.includes("double-click"), true);

  const nativeImageCalls: string[] = [];
  createTrayIcon({
    createFromDataURL: (dataUrl) => {
      nativeImageCalls.push(dataUrl);
      return {
        resize: ({ width, height }) => `resized:${width}x${height}`
      };
    }
  });
  assert.equal(createTrayIconSvg().includes("<svg"), true);
  assert.equal(nativeImageCalls[0].startsWith("data:image/svg+xml;base64,"), true);

  const openedUrls: string[] = [];
  assert.equal(await openTrustedExternalUrl("https://example.com", () => true, async (url) => {
    openedUrls.push(url);
  }), true);
  assert.equal(await openTrustedExternalUrl("javascript:alert(1)", () => false, async () => undefined), false);
  assert.deepEqual(openedUrls, ["https://example.com"]);

  const shownNotifications: Array<{ title: string; body: string }> = [];
  assert.equal(showHostNotification({
    appMode: "viewer",
    title: "Viewer connected",
    body: "Alice connected",
    notification: {
      isSupported: () => true,
      create: (options) => ({
        show: () => {
          shownNotifications.push({ title: options.title, body: options.body });
        }
      })
    }
  }), false);
  assert.equal(showHostNotification({
    appMode: "host",
    title: "Viewer connected",
    body: "Alice connected",
    notification: {
      isSupported: () => true,
      create: (options) => ({
        show: () => {
          shownNotifications.push({ title: options.title, body: options.body });
        }
      })
    }
  }), true);
  assert.deepEqual(shownNotifications, [{
    title: "Viewer connected",
    body: "Alice connected"
  }]);

  const mainWindow = new FakeWindow();
  assert.equal(shouldDelayQuitForHostShutdown({
    appMode: "host",
    hostShutdownNotificationSent: false,
    mainWindow: {
      ...mainWindow,
      isDestroyed: () => false,
      webContents: {
        ...mainWindow.webContents,
        isDestroyed: () => false
      }
    }
  }), true);
  const timerOps: string[] = [];
  const timer = notifyHostShutdownAndQuit({
    appQuit: () => {
      timerOps.push("quit");
    },
    mainWindow,
    scheduleTimeout: (callback, timeoutMs) => {
      timerOps.push(`timeout:${timeoutMs}`);
      callback();
      return {
        unref: () => {
          timerOps.push("unref");
        }
      };
    },
    stopEmbeddedBackend: () => {
      timerOps.push("stop");
    }
  });
  assert.equal(Boolean(timer), true);
  assert.deepEqual(mainWindow.sent, [{
    channel: "app:host-shutdown-requested",
    args: []
  }]);
  assert.deepEqual(timerOps, ["timeout:350", "stop", "quit", "unref"]);

  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  let appliedControl: unknown;
  registerDirectIpcHandlers({
    applyHostControl: async (message) => {
      appliedControl = message;
    },
    desktopCapturer: {
      getSources: async () => [{
        id: "screen:1",
        name: "Primary",
        thumbnail: {
          toDataURL: () => "data:image/png;base64,AAAA"
        }
      }]
    },
    discoverServers: async () => [{ id: "srv-1", name: "Server", address: "192.0.2.10", port: 47315, url: "http://192.0.2.10:47315", lastSeen: 1 }],
    getEmbeddedBackendStatus: () => ({ status: "running", url: "http://localhost:47315" }),
    ipcMain: {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      }
    },
    sanitizeControlMessage: (message) => message as never
  });

  assert.deepEqual(await handlers.get("desktop:get-sources")?.(), [{
    id: "screen:1",
    name: "Primary",
    thumbnail: "data:image/png;base64,AAAA"
  }]);
  assert.deepEqual(await handlers.get("control:message")?.({}, { kind: "pointer" }), { ok: true });
  assert.deepEqual(appliedControl, { kind: "pointer" });
  assert.deepEqual(await handlers.get("backend:status")?.(), { status: "running", url: "http://localhost:47315" });
  assert.deepEqual(await handlers.get("discovery:scan")?.(), [{
    id: "srv-1",
    name: "Server",
    address: "192.0.2.10",
    port: 47315,
    url: "http://192.0.2.10:47315",
    lastSeen: 1
  }]);
});
