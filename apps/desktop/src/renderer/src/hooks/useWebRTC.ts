import { useEffect, useRef, useState } from "react";
import type {
  ControlMessage,
  HostSource,
  PeerJoinedPayload,
  PeerRole,
  ViewerApprovalRequestPayload
} from "@remote-control/shared";

import {
  RemoteControlClient,
  type CaptureMode,
  type ConnectionStats,
  type FrameRate
} from "../webrtc/RemoteControlClient";

type ConnectOptions = {
  captureMode?: CaptureMode;
  captureSourceId?: string;
  displayName: string;
  frameRate?: FrameRate;
  onControlReady?: () => void;
  onPasswordRequired: (message: string) => Promise<string | undefined>;
  onStatus: (status: string) => void;
  onViewerApprovalRequest: (request: ViewerApprovalRequestPayload) => Promise<boolean>;
  role: PeerRole;
  serverUrl: string;
  sessionId: string;
};

export function useWebRTC() {
  const clientRef = useRef<RemoteControlClient | undefined>(undefined);
  const [peer, setPeer] = useState<PeerJoinedPayload | undefined>();
  const [localStream, setLocalStream] = useState<MediaStream | undefined>();
  const [remoteStream, setRemoteStream] = useState<MediaStream | undefined>();
  const [isConnected, setIsConnected] = useState(false);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [transferProgress, setTransferProgress] = useState<number | undefined>();
  const [transferLabel, setTransferLabel] = useState<string | undefined>();
  const [connectionStats, setConnectionStats] = useState<ConnectionStats | undefined>();
  const [receivedFileNotice, setReceivedFileNotice] = useState<{ name: string; path?: string } | undefined>();
  const [hostSources, setHostSources] = useState<HostSource[]>([]);
  const [activeRemoteSourceId, setActiveRemoteSourceId] = useState<string | undefined>();

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
    };
  }, []);

  async function connect(options: ConnectOptions): Promise<void> {
    clientRef.current?.disconnect();

    const client = new RemoteControlClient({
      role: options.role,
      sessionId: options.sessionId,
      serverUrl: options.serverUrl,
      displayName: options.displayName,
      captureSourceId: options.captureSourceId,
      captureMode: options.captureMode,
      frameRate: options.frameRate,
      onStatus: options.onStatus,
      onPeer: setPeer,
      onHostSources: (nextSources, activeSourceId) => {
        setHostSources(nextSources);
        setActiveRemoteSourceId(activeSourceId);
      },
      onControlReady: options.onControlReady,
      onPasswordRequired: options.onPasswordRequired,
      onViewerApprovalRequest: options.onViewerApprovalRequest,
      onStats: setConnectionStats,
      onFileReceived: setReceivedFileNotice,
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream
    });

    clientRef.current = client;
    setIsConnected(true);

    try {
      await client.connect();
    } catch (error) {
      setIsConnected(false);
      throw error;
    }
  }

  function disconnect(): void {
    clientRef.current?.disconnect();
    clientRef.current = undefined;
    setIsConnected(false);
    setControlEnabled(false);
    setTransferProgress(undefined);
    setTransferLabel(undefined);
    setConnectionStats(undefined);
    setHostSources([]);
    setActiveRemoteSourceId(undefined);
    setPeer(undefined);
    setReceivedFileNotice(undefined);
  }

  function announceHostShutdown(reason: string): void {
    clientRef.current?.announceHostShutdown(reason);
  }

  function sendControlMessage(message: ControlMessage): void {
    clientRef.current?.sendControlMessage(message);
  }

  function switchRemoteSource(sourceId: string): void {
    setActiveRemoteSourceId(sourceId);
    clientRef.current?.sendHostCommand(sourceId);
  }

  function sendHostStreamSettings(settings: { audioEnabled: boolean; frameRate: FrameRate }): void {
    clientRef.current?.sendHostStreamSettings(settings);
  }

  async function sendFile(file: File, onStatus: (status: string) => void): Promise<void> {
    if (!isConnected || !clientRef.current || !peer) {
      return;
    }

    setTransferLabel(file.name);
    setTransferProgress(0);
    onStatus(`Sending file: ${file.name}`);

    try {
      await clientRef.current.sendFile(file, setTransferProgress);
      setTransferProgress(100);
      onStatus(`File sent: ${file.name}`);
    } catch (error) {
      setTransferProgress(undefined);
      onStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    activeRemoteSourceId,
    announceHostShutdown,
    clearReceivedFileNotice: () => setReceivedFileNotice(undefined),
    connect,
    connectionStats,
    controlEnabled,
    disconnect,
    hostSources,
    isConnected,
    localStream,
    peer,
    receivedFileNotice,
    remoteStream,
    sendControlMessage,
    sendFile,
    sendHostStreamSettings,
    setControlEnabled,
    switchRemoteSource,
    transferLabel,
    transferProgress
  };
}
