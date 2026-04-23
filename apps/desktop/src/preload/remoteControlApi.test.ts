import assert from "node:assert/strict";
import { test } from "node:test";

import { createRemoteControlApi, readClipboardData, writeClipboardData } from "./remoteControlApi.js";

test("clipboard helpers read and write structured clipboard payloads", () => {
  const clipboardWrites: Array<{ html?: string; image?: unknown; text?: string }> = [];
  const clipboard = {
    readHTML: () => "<b>Hi</b>",
    readImage: () => ({
      isEmpty: () => false,
      toDataURL: () => "data:image/png;base64,abc"
    }),
    readText: () => "Hello",
    write: (payload: { html?: string; image?: unknown; text?: string }) => {
      clipboardWrites.push(payload);
    },
    writeText: (_text: string) => undefined
  };

  assert.deepEqual(readClipboardData(clipboard), {
    html: "<b>Hi</b>",
    imageDataUrl: "data:image/png;base64,abc",
    text: "Hello"
  });

  writeClipboardData(clipboard, {
    createFromDataURL: (dataUrl: string) => ({ kind: "image", dataUrl })
  }, {
    html: "<i>Bye</i>",
    imageDataUrl: "data:image/png;base64,zzz",
    text: "Bye"
  });

  assert.deepEqual(clipboardWrites, [{
    html: "<i>Bye</i>",
    image: { kind: "image", dataUrl: "data:image/png;base64,zzz" },
    text: "Bye"
  }]);
});

test("createRemoteControlApi routes IPC calls and unsubscribe handlers correctly", async () => {
  const invocations: Array<{ channel: string; args: unknown[] }> = [];
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const writtenTexts: string[] = [];

  const api = createRemoteControlApi({
    appMode: "viewer",
    clipboard: {
      readHTML: () => "",
      readImage: () => ({
        isEmpty: () => true,
        toDataURL: () => ""
      }),
      readText: () => "copied",
      write: () => undefined,
      writeText: (text: string) => {
        writtenTexts.push(text);
      }
    },
    ipcRenderer: {
      invoke: async (channel: string, ...args: unknown[]) => {
        invocations.push({ channel, args });
        return { channel, args };
      },
      on: (channel: string, callback: (...args: unknown[]) => void) => {
        listeners.set(channel, [...(listeners.get(channel) ?? []), callback]);
      },
      off: (channel: string, callback: (...args: unknown[]) => void) => {
        listeners.set(channel, (listeners.get(channel) ?? []).filter((listener) => listener !== callback));
      }
    },
    nativeImage: {
      createFromDataURL: (dataUrl: string) => ({ dataUrl })
    }
  });

  assert.equal(api.productName, "RemoteControl Client");
  await api.getDeviceName();
  await api.setLaunchOnStartup(true);
  await api.appendIncomingFileTransfer("transfer-1", 2, new Uint8Array([1, 2]));

  let closedCount = 0;
  const unsubscribeClosed = api.onHostSettingsClosed(() => {
    closedCount += 1;
  });

  listeners.get("host-settings-closed")?.[0]?.();
  unsubscribeClosed();
  listeners.get("host-settings-closed")?.[0]?.();

  let shutdownCount = 0;
  const unsubscribeShutdown = api.onHostShutdownRequested(() => {
    shutdownCount += 1;
  });
  listeners.get("app:host-shutdown-requested")?.[0]?.("ignored");
  unsubscribeShutdown();

  api.writeClipboardText("new text");

  assert.deepEqual(invocations, [
    { channel: "app:get-device-name", args: [] },
    { channel: "app:set-launch-settings", args: [true] },
    {
      channel: "files:append-incoming-transfer",
      args: [{ transferId: "transfer-1", index: 2, bytes: new Uint8Array([1, 2]) }]
    }
  ]);
  assert.equal(closedCount, 1);
  assert.equal(shutdownCount, 1);
  assert.deepEqual(writtenTexts, ["new text"]);
});
