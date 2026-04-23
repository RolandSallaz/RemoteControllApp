import assert from "node:assert/strict";
import React from "react";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AppOverlays } from "./AppOverlays";

const noop = (): void => undefined;

test("AppOverlays renders file and approval surfaces", () => {
  const markup = renderToStaticMarkup(
    <AppOverlays
      isHostFileDropVisible
      passwordPrompt={{ message: "Password required", password: "secret" }}
      receivedFileNotice={{ name: "report.txt", path: "C:/Downloads/report.txt" }}
      viewerApprovalPrompt={{
        requestId: "request-1",
        sessionId: "LAN",
        clientId: "viewer-1",
        displayName: "DESKTOP-01",
        requestedAt: 1,
        expiresAt: 2
      }}
      onCloseReceivedFile={noop}
      onOpenReceivedFolder={noop}
      onPasswordChange={noop}
      onResolvePassword={noop}
      onResolveViewerApproval={noop}
    />
  );

  assert.match(markup, /Drop file to transfer/);
  assert.match(markup, /report\.txt/);
  assert.match(markup, /Password required/);
  assert.match(markup, /DESKTOP-01/);
  assert.match(markup, /Allow Viewer/);
});
