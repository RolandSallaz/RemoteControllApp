import React, { type ReactElement } from "react";
import type { ViewerApprovalRequestPayload } from "@remote-control/shared";

export type PasswordPromptState = {
  message: string;
  password: string;
};

export type ReceivedFileNotice = {
  name: string;
  path?: string;
};

export function AppOverlays({
  isHostFileDropVisible,
  passwordPrompt,
  receivedFileNotice,
  viewerApprovalPrompt,
  onCloseReceivedFile,
  onOpenReceivedFolder,
  onPasswordChange,
  onResolvePassword,
  onResolveViewerApproval
}: {
  isHostFileDropVisible: boolean;
  passwordPrompt?: PasswordPromptState;
  receivedFileNotice?: ReceivedFileNotice;
  viewerApprovalPrompt?: ViewerApprovalRequestPayload;
  onCloseReceivedFile: () => void;
  onOpenReceivedFolder: (path?: string) => void;
  onPasswordChange: (password: string) => void;
  onResolvePassword: (password?: string) => void;
  onResolveViewerApproval: (approved: boolean) => void;
}): ReactElement {
  return (
    <>
      {isHostFileDropVisible && (
        <div className="global-file-drop-overlay" aria-hidden="true">
          <div className="global-file-drop-card">
            <div className="video-drop-title">Drop file to transfer</div>
            <div className="video-drop-sub">Release to send it to the connected viewer</div>
          </div>
        </div>
      )}

      {receivedFileNotice && (
        <div className="file-toast" role="status" aria-live="polite">
          <div className="file-toast-body">
            <div className="file-toast-title">File received</div>
            <div className="file-toast-text" title={receivedFileNotice.path ?? receivedFileNotice.name}>
              {receivedFileNotice.name}
            </div>
            {receivedFileNotice.path && (
              <div className="file-toast-path" title={receivedFileNotice.path}>
                {receivedFileNotice.path}
              </div>
            )}
          </div>
          <div className="file-toast-actions">
            <button type="button" onClick={() => onOpenReceivedFolder(receivedFileNotice.path)}>
              Open Folder
            </button>
            <button type="button" onClick={onCloseReceivedFile}>
              Close
            </button>
          </div>
        </div>
      )}

      {passwordPrompt && (
        <div className="password-prompt-overlay">
          <form
            className="password-prompt-modal"
            onSubmit={(event) => {
              event.preventDefault();
              onResolvePassword(passwordPrompt.password);
            }}
          >
            <div className="password-prompt-header">
              <div>
                <div className="section-label">Password</div>
                <h2>Server Password</h2>
              </div>
            </div>
            <div className="password-prompt-body">
              <div className="field">
                <label>{passwordPrompt.message}</label>
                <input
                  autoFocus
                  type="password"
                  value={passwordPrompt.password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  placeholder="Enter server password"
                />
              </div>
              <div className="password-prompt-actions">
                <button type="button" className="secondary-action" onClick={() => onResolvePassword(undefined)}>
                  Cancel
                </button>
                <button type="submit" className="connect-btn btn-primary" disabled={!passwordPrompt.password}>
                  Connect
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {viewerApprovalPrompt && (
        <div className="password-prompt-overlay">
          <div className="password-prompt-modal" role="dialog" aria-label="Viewer approval request">
            <div className="password-prompt-header">
              <div>
                <div className="section-label">Connection Request</div>
                <h2>Allow Viewer?</h2>
              </div>
            </div>
            <div className="password-prompt-body">
              <div className="approval-request-card">
                <div className="approval-request-name">
                  {viewerApprovalPrompt.displayName ?? "Viewer"}
                </div>
                <div className="approval-request-meta">
                  Session {viewerApprovalPrompt.sessionId}
                </div>
              </div>
              <div className="drop-hint">
                A client is asking to view and control this host. Approve only if you recognize this request.
              </div>
              <div className="password-prompt-actions">
                <button type="button" className="secondary-action" onClick={() => onResolveViewerApproval(false)}>
                  Deny
                </button>
                <button type="button" className="connect-btn btn-primary" onClick={() => onResolveViewerApproval(true)}>
                  Allow
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
