import { useState, useRef, useCallback, useEffect } from 'react';
import { listSTLFiles } from '../utils/api';
import type { STLFileInfo, WSStatus, WSFEAState, FEAParams } from '../types';

const WS_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001/api')
  .replace('http://', 'ws://')
  .replace('https://', 'wss://')
  .replace('/api', '');

const DEFAULT_PARAMS: FEAParams = {
  volume_to_remove: 'variable',
  patient_age: 45,
  procedure_type: 'tumor resection',
  reason: 'low-grade glioma',
};

export function useWebSocketFEA(caseId: string | null) {
  // STL loading state
  const [stlFiles, setStlFiles] = useState<STLFileInfo[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [selectedStructure, setSelectedStructure] = useState<STLFileInfo | null>(null);
  const [feaParams, setFeaParams] = useState<FEAParams>(DEFAULT_PARAMS);

  // WebSocket FEA state
  const [wsState, setWsState] = useState<WSFEAState>({
    status: 'idle',
    displacementField: null,
    maxStressKpa: null,
    bounds: null,
    clinicalSections: {},
    fullAnalysis: null,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCount = useRef(0);

  // ── Poll for STL files ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!caseId) return;

    setStlFiles([]);
    pollCount.current = 0;
    setIsPolling(true);

    // Fetch immediately, then retry every 2s if empty
    const fetchFiles = async () => {
      try {
        const res = await listSTLFiles(caseId);
        if (res.stl_files.length > 0) {
          setStlFiles(res.stl_files);
          setIsPolling(false);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // ignore transient errors
      }
    };

    fetchFiles(); // immediate first fetch
    pollRef.current = setInterval(fetchFiles, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [caseId]);

  // ── Run FEA via WebSocket ───────────────────────────────────────────────────
  const runWSFEA = useCallback(
    (
      structure: STLFileInfo,
      coords?: { x: number; y: number; z: number },
      params?: Partial<FEAParams>
    ) => {
      if (!caseId) return;

      // Close existing connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      const merged = { ...feaParams, ...params };

      setWsState({
        status: 'connecting',
        displacementField: null,
        maxStressKpa: null,
        bounds: null,
        clinicalSections: {},
        fullAnalysis: null,
        error: null,
      });

      const ws = new WebSocket(`${WS_BASE}/ws/fea/${caseId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            structure_name: structure.name,
            structure_label: structure.label,
            stl_filename: structure.filename,
            coordinates: coords ?? { x: 0, y: 0, z: 0 },
            patient_age: merged.patient_age,
            procedure_type: merged.procedure_type,
            volume_to_remove: merged.volume_to_remove,
            reason: merged.reason,
            removal_radius: 0.18,
          })
        );
      };

      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data as string);
        switch (msg.type) {
          case 'solver_start':
            setWsState((s) => ({ ...s, status: 'solver_running' }));
            break;
          case 'displacement_field':
            setWsState((s) => ({
              ...s,
              status: 'streaming',
              displacementField: msg.displacements,
              maxStressKpa: msg.max_stress_kpa,
              bounds: msg.bounds,
            }));
            break;
          case 'clinical_text':
            setWsState((s) => ({
              ...s,
              clinicalSections: { ...s.clinicalSections, [msg.section]: msg.content },
            }));
            break;
          case 'complete':
            setWsState((s) => ({ ...s, status: 'complete', fullAnalysis: msg.full_analysis }));
            break;
          case 'error':
            setWsState((s) => ({ ...s, status: 'error', error: msg.message }));
            break;
        }
      };

      ws.onerror = () => {
        setWsState((s) => ({ ...s, status: 'error', error: 'WebSocket connection failed' }));
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    },
    [caseId, feaParams]
  );

  // ── Select structure and auto-run FEA ───────────────────────────────────────
  const selectStructure = useCallback(
    (structure: STLFileInfo, coords?: { x: number; y: number; z: number }) => {
      setSelectedStructure(structure);
      runWSFEA(structure, coords);
    },
    [runWSFEA]
  );

  const updateFEAParams = useCallback((updates: Partial<FEAParams>) => {
    setFeaParams((p) => ({ ...p, ...updates }));
  }, []);

  const rerunFEA = useCallback(() => {
    if (selectedStructure) runWSFEA(selectedStructure, undefined);
  }, [selectedStructure, runWSFEA]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return {
    stlFiles,
    isPolling,
    selectedStructure,
    feaParams,
    updateFEAParams,
    selectStructure,
    rerunFEA,
    wsState,
  };
}
