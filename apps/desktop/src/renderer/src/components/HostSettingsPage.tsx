import { useEffect, useState, type ReactElement } from "react";

export function HostSettingsPage(): ReactElement {
  const [saveDirectory, setSaveDirectory] = useState("");
  const [launchOnStartup, setLaunchOnStartup] = useState(false);
  const [requireViewerApproval, setRequireViewerApproval] = useState(true);
  const [hostAccessPassword, setHostAccessPassword] = useState("");
  const [hostAccessPasswordSet, setHostAccessPasswordSet] = useState(false);
  const [hostAccessPasswordDirty, setHostAccessPasswordDirty] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void window.remoteControl.getFileSettings().then((settings) => setSaveDirectory(settings.saveDirectory));
    void window.remoteControl.getLaunchSettings().then((settings) => setLaunchOnStartup(settings.launchOnStartup));
    void window.remoteControl.getHostAccessSettings().then((settings) => {
      setHostAccessPassword(settings.accessPassword);
      setHostAccessPasswordSet(settings.accessPasswordSet);
      setRequireViewerApproval(settings.requireViewerApproval);
      setHostAccessPasswordDirty(false);
    });
  }, []);

  async function chooseSaveDirectory(): Promise<void> {
    const result = await window.remoteControl.chooseSaveDirectory();
    if (result.path) setSaveDirectory(result.path);
    if (result.error) setStatus(result.error);
  }

  async function changeLaunchOnStartup(enabled: boolean): Promise<void> {
    setLaunchOnStartup(enabled);
    const result = await window.remoteControl.setLaunchOnStartup(enabled);
    if (!result.ok) {
      setLaunchOnStartup(!enabled);
      if (result.error) setStatus(result.error);
    }
  }

  async function changeHostAccessPassword(password: string): Promise<void> {
    const result = await window.remoteControl.setHostAccessPassword(password);
    if (result.ok) {
      setHostAccessPassword(result.accessPassword ?? "");
      setHostAccessPasswordSet(Boolean(result.accessPasswordSet));
      setHostAccessPasswordDirty(false);
      setStatus(result.accessPasswordSet ? "Server password updated" : "Server password cleared");
    } else if (result.error) {
      setStatus(result.error);
    }
  }

  async function changeRequireViewerApproval(enabled: boolean): Promise<void> {
    setRequireViewerApproval(enabled);
    const result = await window.remoteControl.setRequireViewerApproval(enabled);
    if (result.ok) {
      setRequireViewerApproval(result.requireViewerApproval ?? enabled);
      setStatus(enabled ? "Viewer approval required" : "Viewer approval disabled");
      return;
    }

    setRequireViewerApproval(!enabled);
    if (result.error) {
      setStatus(result.error);
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div className="section-label">Host</div>
        <h2>Settings</h2>
      </div>

      {status && <div className="settings-page-status">{status}</div>}

      <div className="settings-page-body">
        <div className="field">
          <label>Incoming Files</label>
          <button type="button" onClick={() => void chooseSaveDirectory()}>
            Choose Folder
          </button>
          <div className="path-hint" title={saveDirectory}>{saveDirectory}</div>
        </div>

        <label className="toggle-field compact-toggle">
          <input
            type="checkbox"
            checked={launchOnStartup}
            onChange={(event) => void changeLaunchOnStartup(event.target.checked)}
          />
          <span>
            <strong>Launch at startup</strong>
            <small>Start host app when Windows starts</small>
          </span>
        </label>

        <label className="toggle-field compact-toggle">
          <input
            type="checkbox"
            checked={requireViewerApproval}
            onChange={(event) => void changeRequireViewerApproval(event.target.checked)}
          />
          <span>
            <strong>Require viewer approval</strong>
            <small>Ask on this host before allowing a client to connect</small>
          </span>
        </label>

        <div className="field">
          <label>Server Password</label>
          <input
            type="password"
            value={hostAccessPassword}
            onChange={(event) => {
              setHostAccessPassword(event.target.value);
              setHostAccessPasswordDirty(true);
            }}
            onBlur={() => {
              if (hostAccessPasswordDirty) {
                void changeHostAccessPassword(hostAccessPassword);
              }
            }}
            placeholder={hostAccessPasswordSet ? "Password is set" : "No password"}
          />
          {hostAccessPasswordSet && (
            <button type="button" className="secondary-action" onClick={() => void changeHostAccessPassword("")}>
              Clear Password
            </button>
          )}
          <div className="drop-hint">
            {hostAccessPasswordSet
              ? "A password is configured. Enter a new password to replace it."
              : "Viewers will be asked for this password before joining."}
          </div>
        </div>
      </div>
    </div>
  );
}
