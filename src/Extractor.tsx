import React, { useState, useMemo, useEffect } from 'react';
import Listado, { formatOperationNumber, formatToDdMmYyyy, getCurrentFormattedDate } from './Listado';
import { getFirebaseDb, ref, get, set } from './firebase';
import { processComprobanteWithGemini, getGeminiConfigStatus } from './services/geminiService';
import { getGmailAccountStatus, syncGmailForDiploma, subscribeToExtractionStream } from './services/gmailService';
import type { SyncEmailStartEvent, SyncEmailSkipEvent, SyncRowExtractedEvent, SyncProgressEvent, SyncStartEvent, SyncDoneEvent } from './services/gmailService';
import type { GmailStatus, RegistroComprobante, BancoType } from './types/comprobante';

import {
  FileSpreadsheet,
  Search,
  Plus,
  Trash2,
  Download,
  Copy,
  Check,
  BarChart2,
  Code,
  RefreshCw,
  SlidersHorizontal,
  AlertCircle,
  CheckCircle2,
  UserPlus,
  Coins,
  Sparkles,
  HelpCircle,
  FileCode2,
  Database,
  Upload,
  Scan,
  FileText,
  FileUp,
  Loader2,
  ArrowRight,
  BrainCircuit,
  KeyRound,
  ShieldAlert,
  ClipboardCheck,
  RotateCcw,
  FolderOpen,
  Menu,
  X,
  Mail,
  Zap,
  CheckCircle,
  XCircle
} from 'lucide-react';

// API Key por defecto obtenida de las variables de entorno de Vite
const DEFAULT_GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
const DEFAULT_GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

const INITIAL_RECORDS: RegistroComprobante[] = [];

export default function App() {
  const [records, setRecords] = useState<RegistroComprobante[]>(INITIAL_RECORDS);
  const [activeDiploma, setActiveDiploma] = useState<string>(() => localStorage.getItem('ACTIVE_DIPLOMA') || 'DUELO');
  const [diplomasList, setDiplomasList] = useState<string[]>(['DUELO', 'DANZA']);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('sheet'); // 'sheet' | 'ocr' | 'dashboard' | 'code'

  // Filtros
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [bankFilter, setBankFilter] = useState<string>('ALL');
  const [montoFilter, setMontoFilter] = useState<string>('');
  const [onlyMissingData, setOnlyMissingData] = useState<boolean>(false);

  // Estado de edición de celda
  const [editingCell, setEditingCell] = useState<{ id: any; field: any }>({ id: null, field: null });
  const [editValue, setEditValue] = useState<string>('');

  // Estados de IA & OCR
  const [selectedOcrFile, setSelectedOcrFile] = useState<any>(null);
  const [isOcrScanning, setIsOcrScanning] = useState<boolean>(false);
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [ocrStepText, setOcrStepText] = useState<string>('');
  const [ocrExtractedData, setOcrExtractedData] = useState<any>(null);

  // Credenciales y variables de entorno
  const [customApiKey, setCustomApiKey] = useState<string>(
    () => localStorage.getItem('GEMINI_CUSTOM_KEY') || DEFAULT_GEMINI_KEY
  );
  const [claudeApiKey, setClaudeApiKey] = useState<string>(() => localStorage.getItem('CLAUDE_CUSTOM_KEY') || '');
  const [aiProvider, setAiProvider] = useState<string>(() => localStorage.getItem('AI_PROVIDER') || 'gemini');
  const [firebaseConfigStr, setFirebaseConfigStr] = useState<string>(() => localStorage.getItem('FIREBASE_CUSTOM_CONFIG') || '');

  // Indicadores de estado de conexión API
  const [gmailAccountStatus, setGmailAccountStatus] = useState<GmailStatus>({ status: 'loading' });

  // Estados para el sistema de gestión de carpetas (Local y Servidor)
  const [fileMode, setFileMode] = useState<string>('manual'); // 'manual' | 'browser_dir' | 'server_dir'
  const [directoryHandle, setDirectoryHandle] = useState<any>(null);
  const [directoryFiles, setDirectoryFiles] = useState<any[]>([]);
  const [currentFileHandle, setCurrentFileHandle] = useState<any>(null);
  const [serverFiles, setServerFiles] = useState<any[]>([]);
  const [selectedServerFile, setSelectedServerFile] = useState<any>(null);
  const [isSyncingGmail, setIsSyncingGmail] = useState<boolean>(false);

  // Estado en tiempo real de la sincronización de Gmail (SSE)
  type SyncLogEntry =
    | { kind: 'start'; subject: string; index: number }
    | { kind: 'ok'; subject: string; nombre: string; monto: string; filename: string | null; folderName: string; index: number }
    | { kind: 'skip'; subject: string; reason: string; index: number };

  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; folderName: string } | null>(null);
  const [syncDone, setSyncDone] = useState<SyncDoneEvent | null>(null);
  const [isSyncStreamActive, setIsSyncStreamActive] = useState<boolean>(false);

  // Modales personalizados de control de UI
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });

  // Guardar clave API en local storage si se ingresa manualmente
  useEffect(() => {
    localStorage.setItem('GEMINI_CUSTOM_KEY', customApiKey);
  }, [customApiKey]);

  useEffect(() => {
    localStorage.setItem('FIREBASE_CUSTOM_CONFIG', firebaseConfigStr);
  }, [firebaseConfigStr]);

  // Verificar la conexión con la API de Gmail al cargar el componente
  const checkGmailConnection = async () => {
    setGmailAccountStatus({ status: 'loading' });
    const res = await getGmailAccountStatus();
    setGmailAccountStatus(res);
  };

  useEffect(() => {
    checkGmailConnection();
  }, []);

  // Prevenir que el navegador intente abrir/descargar el archivo si se suelta fuera del dropzone
  useEffect(() => {
    const preventDefault = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  // Cargar registros locales al iniciar la aplicación
  const [consolidatedRecords, setConsolidatedRecords] = useState<RegistroComprobante[]>([]);

  const loadDiplomas = async () => {
    try {
      const res = await fetch('/api/diplomas');
      if (res.ok) {
        const list = await res.json();
        const mergedList = Array.from(new Set(['DUELO', 'DANZA', ...list]));
        setDiplomasList(mergedList);
      }
    } catch (e) {
      console.error("Error al cargar gestiones:", e);
    }
  };

  useEffect(() => {
    loadDiplomas();
  }, []);

  const handleDiplomaChange = async (diploma: string) => {
    setActiveDiploma(diploma);
    localStorage.setItem('ACTIVE_DIPLOMA', diploma);
    showNotification(`Cambiando a Gestión: ${diploma}`, 'info');
  };

  useEffect(() => {
    const fetchInitialRecords = async () => {
      try {
        const db = getFirebaseDb();
        const dailyRef = ref(db, `diplomaturas/${activeDiploma}/daily_records`);
        const consolidatedRef = ref(db, `diplomaturas/${activeDiploma}/consolidated_records`);

        const dailySnap = await get(dailyRef);
        const rawDaily = dailySnap.exists() ? (dailySnap.val() as RegistroComprobante[]) || [] : [];

        const consolidatedSnap = await get(consolidatedRef);
        const rawConsolidated = consolidatedSnap.exists() ? (consolidatedSnap.val() as RegistroComprobante[]) || [] : [];

        let consolidatedChanged = false;
        const updatedConsolidated = rawConsolidated.map((rec: any, idx: number) => {
          const targetConsolidatedId = idx + 1;
          const cleanOp = formatOperationNumber(rec.operacion);
          const cleanFecha = formatToDdMmYyyy(rec.fecha);

          const needsUpdate = rec.consolidatedId !== targetConsolidatedId ||
            rec.operacion !== cleanOp ||
            rec.fecha !== cleanFecha;
          if (needsUpdate) {
            consolidatedChanged = true;
          }
          return {
            ...rec,
            consolidatedId: targetConsolidatedId,
            operacion: cleanOp,
            fecha: cleanFecha
          };
        });

        let dailyChanged = false;
        const consolidatedByOp = new Map<string, any>();
        const consolidatedByCompKey = new Map<string, any>();
        updatedConsolidated.forEach((c: any) => {
          if (c.operacion) {
            consolidatedByOp.set(c.operacion.trim(), c);
          }
          const cStudentKey = (c.dni && String(c.dni).trim()) || (c.apellidoNombre && String(c.apellidoNombre).trim().toUpperCase()) || '';
          const cComp = cStudentKey ? `${cStudentKey}-${c.fecha}-${c.monto}` : '';
          if (cComp) {
            consolidatedByCompKey.set(cComp, c);
          }
        });

        const updatedDaily = rawDaily.map((rec: any, idx: number) => {
          const targetDailyId = idx + 1;
          const cleanOp = formatOperationNumber(rec.operacion);
          const cleanFecha = formatToDdMmYyyy(rec.fecha);

          if (
            rec.id !== targetDailyId ||
            rec.operacion !== cleanOp ||
            rec.fecha !== cleanFecha
          ) {
            dailyChanged = true;
          }

          const recOp = cleanOp ? cleanOp.trim() : '';

          const studentKey = (rec.dni && String(rec.dni).trim()) || (rec.apellidoNombre && String(rec.apellidoNombre).trim().toUpperCase()) || '';
          const recComp = studentKey ? `${studentKey}-${cleanFecha}-${rec.monto}` : '';

          let histMatch = null;
          if (recOp && consolidatedByOp.has(recOp)) {
            histMatch = consolidatedByOp.get(recOp);
          } else if (recComp && consolidatedByCompKey.has(recComp)) {
            const match = consolidatedByCompKey.get(recComp);
            if (!recOp || !match.operacion || String(match.operacion).trim() === recOp) {
              histMatch = match;
            }
          }

          if (!histMatch) {
            const newConsolidatedId = updatedConsolidated.length > 0 
                ? Math.max(...updatedConsolidated.map(c => c.consolidatedId || 0)) + 1 
                : 1;
            const newConsolidated = {
              ...rec,
              id: newConsolidatedId,
              consolidatedId: newConsolidatedId,
              operacion: cleanOp,
              fecha: cleanFecha
            };
            updatedConsolidated.push(newConsolidated);
            consolidatedChanged = true;
            if (recOp) consolidatedByOp.set(recOp, newConsolidated);
            if (recComp) consolidatedByCompKey.set(recComp, newConsolidated);
            histMatch = newConsolidated;
          }

          const newConsolidatedId = histMatch.consolidatedId;
          if (rec.consolidatedId !== newConsolidatedId) {
            dailyChanged = true;
          }

          return {
            ...rec,
            id: targetDailyId,
            consolidatedId: newConsolidatedId,
            operacion: cleanOp,
            fecha: cleanFecha
          };
        });

        if (consolidatedChanged) {
          await set(consolidatedRef, updatedConsolidated);
        }
        if (dailyChanged) {
          await set(dailyRef, updatedDaily);
        }

        setRecords(updatedDaily);
        setConsolidatedRecords(updatedConsolidated);
      } catch (err) {
        console.error("Error al cargar registros de Firebase al iniciar:", err);
      }
    };
    fetchInitialRecords();
  }, [activeDiploma]);

  useEffect(() => {
    localStorage.setItem('CLAUDE_CUSTOM_KEY', claudeApiKey);
  }, [claudeApiKey]);

  useEffect(() => {
    localStorage.setItem('AI_PROVIDER', aiProvider);
  }, [aiProvider]);

  useEffect(() => {
    if (fileMode === 'server_dir') {
      refreshServerDirectory();
    }
  }, [fileMode]);

  const showNotification = (message: string, type = 'success') => {
    setNotification({ show: true, message, type });
    setTimeout(() => {
      setNotification({ show: false, message: '', type: 'success' });
    }, 3000);
  };

  // Procesamiento Real OCR con Gemini o Claude
  const handleOcrWithGemini = async (file: File) => {
    setIsOcrScanning(true);
    setOcrProgress(10);
    setOcrStepText("Abriendo archivo y cargando en memoria contable...");

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1];
          const mimeType = file.type;

          setOcrProgress(30);
          setOcrStepText(`✨ Analizando estructura visual con ${aiProvider === 'gemini' ? 'Gemini 2.5 Flash' : 'Claude 3.5 Sonnet'}...`);

          let ocrData = null;

          if (aiProvider === 'gemini') {
            setOcrProgress(60);
            setOcrStepText("✨ Procesando firma digital e importes...");

            const extracted = await processComprobanteWithGemini(base64Data, mimeType, {
              apiKeyOverride: customApiKey
            });
            ocrData = extracted;
          } else {
            throw new Error("El proveedor Claude requiere proxy backend activo.");
          }

          if (ocrData) {
            const op = ocrData.operacion ? formatOperationNumber(ocrData.operacion) : '';
            const isDuplicate = op && (dailyOperationsSet.has(op) || historicalOperationsSet.has(op));

            if (isDuplicate) {
              const fileName = file.name;
              await deletePhysicalFile(fileName);
              showNotification(`Comprobante duplicado (${op}) detectado. El archivo "${fileName}" fue eliminado para evitar duplicados.`, 'error');

              await advanceToNextFile(fileName, records.length);
              setIsOcrScanning(false);
            } else {
              setOcrExtractedData({
                ...ocrData,
                originalName: file.name,
                originalExtension: file.name.split('.').pop(),
                fileDataUrl: reader.result
              });
              setOcrProgress(100);
              setOcrStepText("¡Extracción realizada de forma exitosa!");
              showNotification(`Datos extraídos con éxito por ${aiProvider === 'gemini' ? 'Gemini' : 'Claude'} IA`);
            }
          } else {
            throw new Error("Respuesta de IA vacía.");
          }
        } catch (innerErr: any) {
          console.error("Error en llamada real OCR: ", innerErr);
          const errMsg = innerErr.message?.includes("API_KEY_EMPTY")
            ? "La clave API de Gemini está vacía. Configúrala en VITE_GEMINI_API_KEY o en la interfaz."
            : `Error de ${aiProvider === 'gemini' ? 'Gemini' : 'Claude'}: ${innerErr.message}`;
          setOcrStepText(errMsg);
          showNotification(errMsg, "error");
          setOcrExtractedData(null);
        } finally {
          setIsOcrScanning(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (e: any) {
      setIsOcrScanning(false);
      setOcrStepText("Clave de API ausente. Configúrala abajo para procesar.");
      showNotification("Clave API requerida para procesar archivos reales", "error");
    }
  };

  const refreshBrowserDirectory = async (dirHandle: any) => {
    try {
      const files = [];
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const nameLower = entry.name.toLowerCase();
          if (nameLower.endsWith('.png') || nameLower.endsWith('.jpg') || nameLower.endsWith('.jpeg') || nameLower.endsWith('.pdf')) {
            files.push(entry);
          }
        }
      }
      setDirectoryFiles(files);
    } catch (err) {
      console.error("Error al refrescar archivos de la carpeta del navegador:", err);
      showNotification("Error al refrescar carpeta", "error");
    }
  };

  const handleSelectBrowserDirectory = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({
        mode: 'readwrite'
      });
      setDirectoryHandle(handle);
      await refreshBrowserDirectory(handle);
      setFileMode('browser_dir');
      showNotification("Carpeta local abierta correctamente con permisos de lectura/escritura");
    } catch (err) {
      console.error(err);
      showNotification("Acceso denegado o cancelado", "error");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setFileMode('manual');
      setSelectedOcrFile({
        name: file.name,
        size: `${(file.size / 1024).toFixed(1)} KB`
      });
      handleOcrWithGemini(file);
    }
  };

  const handleSelectFileFromBrowserDir = async (fileHandle: any) => {
    try {
      setCurrentFileHandle(fileHandle);
      const file = await fileHandle.getFile();
      setSelectedOcrFile({
        name: file.name,
        size: `${(file.size / 1024).toFixed(1)} KB`
      });
      handleOcrWithGemini(file);
    } catch (err) {
      console.error("Error al leer archivo de la carpeta:", err);
      showNotification("No se pudo leer el archivo de la carpeta", "error");
    }
  };

  const refreshServerDirectory = async () => {
    try {
      const res = await fetch(`/api/local-files?diploma=${activeDiploma}`);
      if (!res.ok) throw new Error("Error al obtener la lista de archivos");
      const files = await res.json();
      setServerFiles(files);
    } catch (err) {
      console.error(err);
      showNotification("No se pudo obtener la lista de archivos del servidor local", "error");
    }
  };

  const deletePhysicalFile = async (fileName: string) => {
    if (fileMode === 'browser_dir' && directoryHandle) {
      try {
        await directoryHandle.removeEntry(fileName);
        showNotification(`Archivo duplicado ${fileName} eliminado de la carpeta local.`, 'error');
        await refreshBrowserDirectory(directoryHandle);
      } catch (err) {
        console.error("Error al eliminar localmente:", err);
      }
    } else if (fileMode === 'server_dir') {
      try {
        const res = await fetch(`/api/local-files/delete?diploma=${activeDiploma}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName })
        });
        if (res.ok) {
          showNotification(`Archivo duplicado ${fileName} eliminado del servidor.`, 'error');
          await refreshServerDirectory();
        }
      } catch (err) {
        console.error("Error al eliminar del servidor:", err);
      }
    }
  };

  const advanceToNextFile = async (currentName: string, currentRecordsCount: number) => {
    if (currentRecordsCount >= 15) {
      showNotification("Límite de lote alcanzado (15/15). Por favor exporta y vacía la planilla.", "info");
      setOcrExtractedData(null);
      setSelectedOcrFile(null);
      setCurrentFileHandle(null);
      setSelectedServerFile(null);
      setActiveTab('sheet');
      return;
    }

    if (fileMode === 'browser_dir' && directoryHandle) {
      const currentIndex = directoryFiles.findIndex(f => f.name === currentName);
      if (currentIndex !== -1 && currentIndex + 1 < directoryFiles.length) {
        const nextHandle = directoryFiles[currentIndex + 1];
        await handleSelectFileFromBrowserDir(nextHandle);
      } else {
        setOcrExtractedData(null);
        setSelectedOcrFile(null);
        setCurrentFileHandle(null);
        setSelectedServerFile(null);
        setActiveTab('sheet');
        showNotification("Se procesaron todos los comprobantes de la carpeta.", "success");
      }
    } else if (fileMode === 'server_dir') {
      const currentIndex = serverFiles.findIndex(f => f.name === currentName);
      if (currentIndex !== -1 && currentIndex + 1 < serverFiles.length) {
        const nextFileName = serverFiles[currentIndex + 1].name;
        await handleSelectFileFromServerDir(nextFileName);
      } else {
        setOcrExtractedData(null);
        setSelectedOcrFile(null);
        setCurrentFileHandle(null);
        setSelectedServerFile(null);
        setActiveTab('sheet');
        showNotification("Se procesaron todos los comprobantes de la carpeta.", "success");
      }
    } else {
      setOcrExtractedData(null);
      setSelectedOcrFile(null);
      setCurrentFileHandle(null);
      setSelectedServerFile(null);
      setActiveTab('sheet');
    }
  };

  const handleSyncGmail = async () => {
    // Reiniciar estado de progreso
    setSyncLog([]);
    setSyncProgress(null);
    setSyncDone(null);
    setIsSyncingGmail(true);
    setIsSyncStreamActive(true);

    // Navegar al tab OCR para mostrar el panel de progreso
    setActiveTab('ocr');

    // Conectar SSE ANTES de disparar el sync para no perder eventos
    const unsubscribe = subscribeToExtractionStream({
      onSyncStart: (_data: SyncStartEvent) => {
        showNotification(`Sincronizando Gmail → carpeta ${_data.folderName}...`, 'info');
      },
      onEmailStart: (data: SyncEmailStartEvent) => {
        setSyncLog(prev => [
          ...prev,
          { kind: 'start', subject: data.subject, index: data.index }
        ]);
      },
      onEmailSkip: (data: SyncEmailSkipEvent) => {
        setSyncLog(prev => [
          // reemplazar el último 'start' de este índice con un 'skip'
          ...prev.filter(e => !(e.kind === 'start' && e.index === data.index)),
          { kind: 'skip', subject: data.subject, reason: data.reason, index: data.index }
        ]);
      },
      onRowExtracted: (data: SyncRowExtractedEvent) => {
        setSyncLog(prev => [
          // reemplazar el último 'start' de este índice con un 'ok'
          ...prev.filter(e => !(e.kind === 'start' && e.index === data.index)),
          {
            kind: 'ok',
            subject: data.subject,
            nombre: data.nombre,
            monto: data.monto,
            filename: data.savedFilename,
            folderName: data.folderName,
            index: data.index
          }
        ]);
      },
      onSyncProgress: (data: SyncProgressEvent) => {
        setSyncProgress(data);
      },
      onSyncDone: (data: SyncDoneEvent) => {
        setSyncDone(data);
        setIsSyncingGmail(false);
        setIsSyncStreamActive(false);
        unsubscribe();
        // Refrescar lista de archivos disponibles
        refreshServerDirectory();
        const msg = data.error
          ? `Error en sync: ${data.error}`
          : `Sync completado: ${data.validCount} comprobante${data.validCount !== 1 ? 's' : ''} importado${data.validCount !== 1 ? 's' : ''} de ${data.totalScanned} correo${data.totalScanned !== 1 ? 's' : ''} escaneado${data.totalScanned !== 1 ? 's' : ''}.`;
        showNotification(msg, data.error ? 'error' : 'success');
      },
      onBatchCompleted: () => {
        showNotification('Lote de 15 comprobantes completado. Exportá la planilla.', 'info');
      }
    });

    try {
      const result = await syncGmailForDiploma(activeDiploma);
      if (!result.success) {
        throw new Error(result.message);
      }
    } catch (err: any) {
      console.error(err);
      showNotification(`Error al iniciar sync: ${err.message}`, 'error');
      setIsSyncingGmail(false);
      setIsSyncStreamActive(false);
      unsubscribe();
    }
  };

  const handleSelectFileFromServerDir = async (fileName: string) => {
    try {
      setSelectedServerFile(fileName);
      const res = await fetch(`/api/local-files/download?name=${encodeURIComponent(fileName)}&diploma=${activeDiploma}`);
      if (!res.ok) throw new Error("Error al descargar el archivo");
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: blob.type });
      setSelectedOcrFile({
        name: file.name,
        size: `${(file.size / 1024).toFixed(1)} KB`
      });
      handleOcrWithGemini(file);
    } catch (err: any) {
      console.error(err);
      showNotification(`Error al cargar el archivo del servidor: ${err.message}`, "error");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileMode('manual');
      setSelectedOcrFile({
        name: file.name,
        size: `${(file.size / 1024).toFixed(1)} KB`
      });
      handleOcrWithGemini(file);
    }
  };

  const triggerDownload = (dataUrl: string, fileName: string) => {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const dailyOperationsSet = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r: any) => {
      if (r.operacion) set.add(r.operacion.trim());
    });
    return set;
  }, [records]);

  const historicalOperationsSet = useMemo(() => {
    const set = new Set<string>();
    consolidatedRecords.forEach((c: any) => {
      if (c.operacion) set.add(c.operacion.trim());
    });
    return set;
  }, [consolidatedRecords]);

  const checkOcrDuplicate = () => {
    if (!ocrExtractedData) return null;

    const op = ocrExtractedData.operacion ? ocrExtractedData.operacion.trim() : '';
    if (!op) return null;

    if (dailyOperationsSet.has(op)) {
      return {
        type: 'daily',
        reason: `código de operación "${op}" ya ingresado en este lote`
      };
    }

    if (historicalOperationsSet.has(op)) {
      return {
        type: 'historical',
        reason: `código de operación "${op}" ya registrado anteriormente en el historial maestro`
      };
    }

    return null;
  };

  const saveOcrToSheet = async () => {
    if (!ocrExtractedData) return;

    setIsOcrScanning(true);
    setOcrProgress(50);
    setOcrStepText("Buscando duplicados...");

    await new Promise(resolve => setTimeout(resolve, 800));

    const duplicate = checkOcrDuplicate();
    if (duplicate) {
      setIsOcrScanning(false);
      const confirmSave = window.confirm(
        `⚠️ ADVERTENCIA DE COBRO DUPLICADO\n\nEl sistema detecta que este comprobante ya está registrado: ${duplicate.reason}.\n\n¿Estás seguro de que deseas ingresarlo a la planilla diaria de todas formas?`
      );
      if (!confirmSave) {
        const fileName = selectedServerFile || (currentFileHandle ? currentFileHandle.name : null);
        if (fileName) {
          await deletePhysicalFile(fileName);
          await advanceToNextFile(fileName, records.length);
        } else {
          setOcrExtractedData(null);
          setSelectedOcrFile(null);
          setCurrentFileHandle(null);
          setSelectedServerFile(null);
        }
        return;
      }
      setIsOcrScanning(true);
      setOcrStepText("Guardando y consolidando...");
    } else {
      setOcrStepText("Guardando y consolidando...");
    }

    const nextId = records.length > 0 ? Math.max(...records.map(r => r.id)) + 1 : 1;

    let apellido = "ORDENANTE";
    if (ocrExtractedData.apellidoNombre) {
      const parts = ocrExtractedData.apellidoNombre.split(',');
      apellido = parts[0].trim().split(/\s+/)[0];
    }
    const cleanApellido = apellido
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase();

    const extension = ocrExtractedData.originalExtension || "png";
    const newFileName = `${nextId}-${cleanApellido}.${extension}`;

    let fileHandledLocally = false;

    if (fileMode === 'browser_dir' && directoryHandle && currentFileHandle) {
      try {
        const file = await currentFileHandle.getFile();
        const newFileHandle = await directoryHandle.getFileHandle(newFileName, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(file);
        await writable.close();

        await directoryHandle.removeEntry(currentFileHandle.name);

        fileHandledLocally = true;
        showNotification(`Archivo renombrado como ${newFileName} y original eliminado del disco.`);
        await refreshBrowserDirectory(directoryHandle);
      } catch (err) {
        console.error("Error en renombrado/eliminación nativo:", err);
        showNotification("Error al guardar archivo en carpeta local del navegador. Se forzará descarga.", "error");
      }
    }

    if (fileMode === 'server_dir' && selectedServerFile) {
      try {
        const response = await fetch(`/api/local-files/rename?diploma=${activeDiploma}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalName: selectedServerFile,
            newFileName: newFileName,
            fileDataUrl: ocrExtractedData.fileDataUrl
          })
        });

        const contentType = response.headers.get('content-type');
        if (response.ok && contentType && contentType.includes('application/json')) {
          const data = await response.json();
          if (data && data.success) {
            fileHandledLocally = true;
            showNotification(`Archivo renombrado en el servidor local como ${newFileName} y original eliminado.`);
            await refreshServerDirectory();
          } else {
            throw new Error(data.error || "Error desconocido");
          }
        } else {
          throw new Error("Respuesta inválida del servidor (no es JSON)");
        }
      } catch (err: any) {
        console.error("Error en renombrado en servidor:", err);
        showNotification(`Error al renombrar en el servidor: ${err.message}. Se forzará descarga.`, "error");
      }
    }

    if (fileMode === 'manual' && ocrExtractedData.fileDataUrl) {
      try {
        const response = await fetch(`/api/local-files/rename?diploma=${activeDiploma}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalName: newFileName,
            newFileName: newFileName,
            fileDataUrl: ocrExtractedData.fileDataUrl
          })
        });

        const contentType = response.headers.get('content-type');
        if (response.ok && contentType && contentType.includes('application/json')) {
          const data = await response.json();
          if (data && data.success) {
            fileHandledLocally = true;
            showNotification(`Archivo guardado en el servidor local en la carpeta de ${activeDiploma} como ${newFileName}.`);
          }
        }
      } catch (err) {
        console.error("Error al guardar archivo en el servidor desde modo manual:", err);
      }
    }

    const newRecord: RegistroComprobante = {
      id: nextId,
      apellidoNombre: ocrExtractedData.apellidoNombre || "",
      dni: (ocrExtractedData.dni || "").replace(/\./g, ""),
      banco: (ocrExtractedData.banco as BancoType) || "MP",
      operacion: formatOperationNumber(ocrExtractedData.operacion || ""),
      fecha: formatToDdMmYyyy(ocrExtractedData.fecha || ""),
      monto: (() => {
        let cleanMonto = ocrExtractedData.monto || 0;
        if (cleanMonto > 0 && cleanMonto < 1000) {
          cleanMonto = cleanMonto * 1000;
        }
        return cleanMonto;
      })(),
      titular: ocrExtractedData.titular || "",
      archivoRenombrado: newFileName,
      fileDataUrl: ""
    };

    const updatedRecords = [...records, newRecord];
    setRecords(updatedRecords);

    try {
      const db = getFirebaseDb();

      const consolidatedRef = ref(db, `diplomaturas/${activeDiploma}/consolidated_records`);
      const consolidatedSnap = await get(consolidatedRef);
      const currentConsolidated = consolidatedSnap.exists() ? (consolidatedSnap.val() as RegistroComprobante[]) || [] : [];

      const mapped = updatedRecords.map((rec, idx) => ({
        ...rec,
        id: idx + 1,
        consolidatedId: rec.consolidatedId || rec.id || (Date.now() + idx)
      }));

      const consolidated = [...currentConsolidated];

      const consolidatedByOp = new Map<string, number>();
      const consolidatedByCompKey = new Map<string, number>();
      consolidated.forEach((c: any, index: number) => {
        if (c.operacion) {
          consolidatedByOp.set(String(c.operacion).trim(), index);
        }
        const studentKey = (c.dni && String(c.dni).trim()) || (c.apellidoNombre && String(c.apellidoNombre).trim().toUpperCase()) || '';
        const cComp = studentKey ? `${studentKey}-${c.fecha}-${c.monto}` : '';
        if (cComp) {
          consolidatedByCompKey.set(cComp, index);
        }
      });

      mapped.forEach((rec: any) => {
        if (!rec.apellidoNombre && !rec.dni && !rec.operacion) return;

        let existingIndex = -1;
        const recOp = rec.operacion ? String(rec.operacion).trim() : '';
        const studentKey = (rec.dni && String(rec.dni).trim()) || (rec.apellidoNombre && String(rec.apellidoNombre).trim().toUpperCase()) || '';
        const recComp = studentKey ? `${studentKey}-${rec.fecha}-${rec.monto}` : '';

        if (recOp && consolidatedByOp.has(recOp)) {
          existingIndex = consolidatedByOp.get(recOp)!;
        } else if (existingIndex === -1 && recComp && consolidatedByCompKey.has(recComp)) {
          const idx = consolidatedByCompKey.get(recComp)!;
          const match = consolidated[idx];
          if (!recOp || !match.operacion || String(match.operacion).trim() === recOp) {
            existingIndex = idx;
          }
        }

        if (existingIndex !== -1) {
          consolidated[existingIndex] = { ...consolidated[existingIndex], ...rec };
          rec.consolidatedId = consolidated[existingIndex].consolidatedId;
        } else {
          const nextConsolidatedId = consolidated.length + 1;
          rec.consolidatedId = nextConsolidatedId;
          const newRecord = { ...rec, consolidatedId: nextConsolidatedId };

          const newIndex = consolidated.length;
          consolidated.push(newRecord);

          if (newRecord.operacion) {
            consolidatedByOp.set(String(newRecord.operacion).trim(), newIndex);
          }
          const newStudentKey = (newRecord.dni && String(newRecord.dni).trim()) || (newRecord.apellidoNombre && String(newRecord.apellidoNombre).trim().toUpperCase()) || '';
          const newCompKey = newStudentKey ? `${newStudentKey}-${newRecord.fecha}-${newRecord.monto}` : '';
          if (newCompKey) {
            consolidatedByCompKey.set(newCompKey, newIndex);
          }
        }
      });

      const dailyRef = ref(db, `diplomaturas/${activeDiploma}/daily_records`);
      await set(dailyRef, mapped);
      await set(consolidatedRef, consolidated);

      setRecords(mapped);
      setConsolidatedRecords(consolidated);
    } catch (err) {
      console.error("Error al persistir registros en Firebase desde el OCR:", err);
    } finally {
      setIsOcrScanning(false);
    }

    if (!fileHandledLocally) {
      if (ocrExtractedData.fileDataUrl) {
        triggerDownload(ocrExtractedData.fileDataUrl, newFileName);
        showNotification(`Comprobante importado y renombrado como ${newFileName}`);
      } else {
        showNotification('Comprobante cargado a la planilla con éxito!');
      }
    }

    const currentName = selectedServerFile || (currentFileHandle ? currentFileHandle.name : null);
    if (currentName) {
      await advanceToNextFile(currentName, updatedRecords.length);
    } else {
      setOcrExtractedData(null);
      setSelectedOcrFile(null);
      setCurrentFileHandle(null);
      setSelectedServerFile(null);
      setActiveTab('sheet');
    }
  };

  const filteredRecords = useMemo(() => {
    return consolidatedRecords.filter(rec => {
      const query = searchQuery.trim().toLowerCase();
      const matchSearch = !query ? true : (
        (rec.apellidoNombre && rec.apellidoNombre.toLowerCase().includes(query)) ||
        (rec.dni && rec.dni.includes(query)) ||
        (rec.operacion && rec.operacion.includes(query)) ||
        (rec.titular && rec.titular.toLowerCase().includes(query))
      );

      const matchBank = bankFilter === 'ALL' ? true : rec.banco === bankFilter;
      const matchMonto = montoFilter === '' ? true : rec.monto >= parseFloat(montoFilter);
      const matchMissing = onlyMissingData ? (rec.apellidoNombre === '' || rec.dni === '') : true;

      return matchSearch && matchBank && matchMonto && matchMissing;
    });
  }, [consolidatedRecords, searchQuery, bankFilter, montoFilter, onlyMissingData]);

  const stats = useMemo(() => {
    const total = filteredRecords.reduce((sum, r) => sum + r.monto, 0);
    const count = filteredRecords.length;
    const countMP = filteredRecords.filter(r => r.banco === 'MP').length;
    const totalMP = filteredRecords.filter(r => r.banco === 'MP').reduce((sum, r) => sum + r.monto, 0);
    const countMacro = filteredRecords.filter(r => r.banco === 'MACRO').length;
    const totalMacro = filteredRecords.filter(r => r.banco === 'MACRO').reduce((sum, r) => sum + r.monto, 0);
    const missingCount = filteredRecords.filter(r => r.apellidoNombre === '' || r.dni === '').length;

    return { total, count, countMP, totalMP, countMacro, totalMacro, missingCount };
  }, [filteredRecords]);

  const geminiStatus = useMemo(() => getGeminiConfigStatus(customApiKey), [customApiKey]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased flex flex-col">

      {/* Floating Notification */}
      {notification.show && (
        <div className={`notification-enter fixed top-5 right-5 z-[100] flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl text-sm font-bold max-w-sm pointer-events-none ${notification.type === 'success'
          ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white border border-emerald-400/30'
          : notification.type === 'error'
            ? 'bg-gradient-to-r from-rose-600 to-rose-500 text-white border border-rose-400/30'
            : 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white border border-indigo-400/30'
          }`}>
          <span className="text-base">
            {notification.type === 'success' ? '✅' : notification.type === 'error' ? '❌' : 'ℹ️'}
          </span>
          <span className="leading-snug">{notification.message}</span>
        </div>
      )}

      {/* HEADER UNIFICADO */}
      <header className="bg-[#070b12] text-white sticky top-0 z-30 select-none border-b border-slate-800/50 shadow-lg shadow-black/20">
        <div className="flex items-center justify-between px-4 py-3 lg:px-6">

          {/* Logo */}
          <div className="flex items-center gap-3 shrink-0 select-none">
            <img
              src="/logo.jpg"
              alt="Logo IDeIn"
              className="h-10 w-auto rounded-lg object-contain bg-white p-0.5 shadow shadow-white/10 border border-slate-800/80"
              onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
            />
            <div>
              <h2 className="text-sm font-black tracking-tight text-white leading-tight">ControlCobros</h2>
              <p className="text-[10px] font-bold text-indigo-400/80 tracking-wider uppercase">IDeIn Computación</p>
            </div>
          </div>

          {/* Selector de Curso/Gestión */}
          <div className="flex items-center gap-1.5 bg-slate-800/60 hover:bg-slate-800/85 px-3 py-1.5 rounded-xl border border-slate-700/60 shadow-inner transition-all duration-150">
            <span className="text-[10px] font-extrabold uppercase text-indigo-400 tracking-wider">Gestión:</span>
            <select
              value={activeDiploma}
              onChange={(e) => {
                if (e.target.value === 'NEW') {
                  const newName = window.prompt("Ingresa el nombre de la nueva Gestión (ej. TEATRO, CIENCIAS):");
                  if (newName) {
                    const cleanName = newName.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
                    if (cleanName) {
                      if (!diplomasList.includes(cleanName)) {
                        setDiplomasList([...diplomasList, cleanName]);
                      }
                      handleDiplomaChange(cleanName);
                    }
                  }
                } else {
                  handleDiplomaChange(e.target.value);
                }
              }}
              className="bg-transparent text-white font-extrabold text-[11px] focus:outline-none cursor-pointer pr-1"
            >
              {diplomasList.map(d => (
                <option key={d} value={d} className="bg-[#0b1120] text-white font-bold text-xs">{d}</option>
              ))}
              <option value="NEW" className="bg-[#0b1120] text-indigo-300 font-bold text-xs">✨ + Nueva Gestión...</option>
            </select>
          </div>

          {/* Indicadores Visuales de Conexión de API (Gmail y Gemini) */}
          <div className="hidden md:flex items-center gap-2">
            {/* Status Gemini */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                geminiStatus.isConfigured
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
              }`}
              title={geminiStatus.isConfigured ? `Gemini API Lista (${geminiStatus.keyHint})` : 'Gemini API Sin Configurar'}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>{geminiStatus.isConfigured ? 'Gemini AI' : 'Gemini Off'}</span>
            </div>

            {/* Status Gmail API / Backend */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                gmailAccountStatus.status === 'connected'
                  ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
                  : gmailAccountStatus.status === 'loading'
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
              title={gmailAccountStatus.email ? `Gmail: ${gmailAccountStatus.email}` : gmailAccountStatus.error || 'Gmail desconectado'}
            >
              <Mail className="h-3.5 w-3.5" />
              <span>
                {gmailAccountStatus.status === 'connected'
                  ? 'Gmail API'
                  : gmailAccountStatus.status === 'loading'
                  ? 'Verificando...'
                  : 'Gmail Backend'}
              </span>
            </div>
          </div>

        </div>
      </header>

      <main className="flex-1 p-4 md:p-6 lg:p-8 xl:p-10 animate-fadeIn bg-slate-50/50">

        {/* Menú de Navegación */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8 select-none">
          {[
            { tab: 'sheet', icon: <FileSpreadsheet className="h-6 w-6" />, label: 'Hoja de Cálculo', description: 'Planilla de pagos y cobros' },
            { tab: 'ocr', icon: <Upload className="h-6 w-6" />, label: 'Lector OCR ✨', description: 'Escáner automático de comprobantes' },
            { tab: 'dashboard', icon: <BarChart2 className="h-6 w-6" />, label: 'Estadísticas', description: 'Reportes y gráficos de caja' },
            { tab: 'code', icon: <Code className="h-6 w-6" />, label: 'Automatizar', description: 'Configuración y APIs' },
          ].map(({ tab, icon, label, description }) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex flex-col justify-between p-5 text-left transition-all duration-300 relative group cursor-pointer border rounded-2xl ${activeTab === tab
                ? 'bg-gradient-to-br from-indigo-900 to-indigo-950 border-indigo-700 text-white shadow-xl shadow-indigo-950/20'
                : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-400 hover:shadow-md'
                }`}
            >
              <div className="flex justify-between items-start w-full">
                <div className={`p-3 rounded-xl transition-all duration-300 ${activeTab === tab ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-100 text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-600'
                  }`}>
                  {icon}
                </div>
                {activeTab === tab && (
                  <span className="h-2 w-2 rounded-full bg-indigo-400 animate-ping shadow-sm"></span>
                )}
              </div>
              <div className="mt-4">
                <h4 className={`text-xs font-black uppercase tracking-wider ${activeTab === tab ? 'text-indigo-200' : 'text-slate-500'}`}>
                  {label}
                </h4>
                <p className={`text-[11px] mt-1 line-clamp-2 ${activeTab === tab ? 'text-slate-300' : 'text-slate-400'}`}>
                  {description}
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* Tab OCR */}
        {activeTab === 'ocr' && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 overflow-hidden shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5 mb-6">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Scan className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-800">Carga Digital Inteligente (Lector OCR ✨)</h2>
                  <p className="text-xs text-slate-500">Arrastra comprobantes bancarios para parsear con Visión Artificial.</p>
                </div>
              </div>

              {/* Selector Proveedor */}
              <div className="bg-slate-100 p-1.5 rounded-xl border border-slate-200 flex items-center space-x-1 select-none">
                <button
                  onClick={() => setAiProvider('gemini')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${aiProvider === 'gemini'
                    ? 'bg-white text-indigo-950 shadow'
                    : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                  ✨ Google Gemini 2.5
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Zona de Selección */}
              <div className="flex flex-col space-y-6">
                <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200 gap-1 select-none">
                  <button
                    onClick={() => setFileMode('manual')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${fileMode === 'manual'
                      ? 'bg-white text-indigo-950 shadow border border-slate-200/50'
                      : 'text-slate-500 hover:text-slate-800'
                      }`}
                  >
                    📂 Subir Archivo
                  </button>
                  <button
                    onClick={handleSelectBrowserDirectory}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${fileMode === 'browser_dir'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-slate-500 hover:text-slate-800'
                      }`}
                  >
                    💻 Carpeta Web
                  </button>
                  <button
                    onClick={() => setFileMode('server_dir')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${fileMode === 'server_dir'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-slate-500 hover:text-slate-800'
                      }`}
                  >
                    🖥️ Carpeta Servidor
                  </button>
                </div>

                {fileMode === 'manual' && (
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    className="relative border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center text-center transition-all cursor-pointer h-full min-h-[250px] border-slate-300 hover:border-indigo-500 bg-slate-50/50 hover:bg-indigo-50/10"
                  >
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleFileUpload}
                      className="absolute inset-0 cursor-pointer opacity-0"
                    />
                    <div className="p-4 bg-white shadow-sm rounded-full mb-4 text-slate-400 pointer-events-none">
                      <FileUp className="h-8 w-8 text-indigo-500" />
                    </div>
                    <p className="text-sm font-bold text-slate-700 pointer-events-none">Arrastra tu comprobante aquí</p>
                    <p className="text-xs text-slate-400 mt-1 pointer-events-none">O haz clic para explorar tu PC</p>
                  </div>
                )}
              </div>

              {/* Panel de Extracción / Progreso Gmail */}
              <div className="bg-slate-50 rounded-xl border border-slate-200/70 p-6 flex flex-col justify-center min-h-[300px]">

                {/* ─── Panel Progreso Sync Gmail en tiempo real ─── */}
                {(isSyncStreamActive || syncDone) && (
                  <div className="flex flex-col gap-3 h-full">
                    {/* Encabezado */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isSyncStreamActive
                          ? <Loader2 className="h-4 w-4 text-indigo-600 animate-spin" />
                          : syncDone?.error
                            ? <XCircle className="h-4 w-4 text-rose-500" />
                            : <CheckCircle className="h-4 w-4 text-emerald-500" />}
                        <span className="text-xs font-black text-slate-700">
                          {isSyncStreamActive ? 'Descargando correos...' : syncDone?.error ? 'Error en sincronización' : 'Sincronización completada'}
                        </span>
                      </div>
                      {syncProgress && (
                        <span className="text-[10px] font-extrabold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                          {syncProgress.current}/{syncProgress.total} válidos
                        </span>
                      )}
                    </div>

                    {/* Barra de progreso */}
                    {syncProgress && (
                      <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, (syncProgress.current / syncProgress.total) * 100)}%` }}
                        />
                      </div>
                    )}

                    {/* Resumen de carpeta */}
                    {syncProgress && (
                      <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                        <FolderOpen className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                        <span className="text-[10px] font-bold text-indigo-700 truncate">{syncProgress.folderName}</span>
                      </div>
                    )}

                    {/* Log scrolleable */}
                    <div className="flex-1 overflow-y-auto space-y-1.5 max-h-[320px] pr-1">
                      {syncLog.length === 0 && isSyncStreamActive && (
                        <div className="text-center py-6 text-slate-400">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-300" />
                          <p className="text-xs">Conectando con Gmail...</p>
                        </div>
                      )}
                      {[...syncLog].reverse().map((entry, i) => (
                        <div
                          key={`${entry.index}-${i}`}
                          className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${
                            entry.kind === 'ok'
                              ? 'bg-emerald-50 border-emerald-200'
                              : entry.kind === 'skip'
                              ? 'bg-amber-50 border-amber-200'
                              : 'bg-slate-100 border-slate-200 animate-pulse'
                          }`}
                        >
                          <span className="text-base leading-none mt-0.5 shrink-0">
                            {entry.kind === 'ok' ? '✅' : entry.kind === 'skip' ? '⏭' : '🔄'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold truncate text-slate-700">{entry.subject}</p>
                            {entry.kind === 'ok' && (
                              <p className="text-emerald-700 mt-0.5">
                                <span className="font-bold">{entry.nombre}</span>
                                {entry.monto ? ` · $${Number(entry.monto).toLocaleString('es-AR')}` : ''}
                                {entry.filename ? (
                                  <span className="block text-[10px] text-emerald-600 font-mono mt-0.5">📁 {entry.filename}</span>
                                ) : null}
                              </p>
                            )}
                            {entry.kind === 'skip' && (
                              <p className="text-amber-700 mt-0.5 text-[10px]">{entry.reason}</p>
                            )}
                            {entry.kind === 'start' && (
                              <p className="text-slate-400 mt-0.5 text-[10px]">Analizando adjunto...</p>
                            )}
                          </div>
                          <span className="text-[9px] text-slate-400 shrink-0">#{entry.index}</span>
                        </div>
                      ))}
                    </div>

                    {/* Resumen final */}
                    {syncDone && !isSyncStreamActive && (
                      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-xs font-bold ${
                        syncDone.error
                          ? 'bg-rose-50 border-rose-200 text-rose-700'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      }`}>
                        {syncDone.error
                          ? <XCircle className="h-4 w-4 shrink-0" />
                          : <CheckCircle className="h-4 w-4 shrink-0" />}
                        <span>
                          {syncDone.error
                            ? `Error: ${syncDone.error}`
                            : `${syncDone.validCount} guardado${syncDone.validCount !== 1 ? 's' : ''} de ${syncDone.totalScanned} escaneado${syncDone.totalScanned !== 1 ? 's' : ''}`
                          }
                        </span>
                        <button
                          onClick={() => { setSyncLog([]); setSyncDone(null); setSyncProgress(null); }}
                          className="ml-auto text-[10px] px-2 py-1 bg-white border rounded-lg hover:bg-slate-50"
                        >
                          Limpiar
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ─── Estado inicial: esperando comprobante ─── */}
                {!selectedOcrFile && !isOcrScanning && !ocrExtractedData && !isSyncStreamActive && !syncDone && (
                  <div className="text-center text-slate-400 py-12">
                    <HelpCircle className="h-12 w-12 mx-auto text-slate-300 mb-3" />
                    <p className="text-sm font-bold text-slate-500">Esperando comprobante...</p>
                  </div>
                )}

                {isOcrScanning && !isSyncStreamActive && (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 text-indigo-600 animate-spin mb-3" />
                    <span className="text-xs font-bold text-indigo-600">{ocrStepText}</span>
                  </div>
                )}

                {ocrExtractedData && (
                  <div className="space-y-4">
                    <h4 className="text-sm font-black text-slate-700">Resultado de Extracción</h4>

                    {/* Card: Carpeta destino + Nro. de planilla */}
                    <div className="flex items-stretch gap-3">
                      <div className="flex-1 flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
                        <div className="p-2 bg-indigo-100 rounded-lg shrink-0">
                          <FolderOpen className="h-5 w-5 text-indigo-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-extrabold text-indigo-400 uppercase tracking-wider">Licenciatura</p>
                          <p className="text-sm font-black text-indigo-800 truncate">{activeDiploma}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                        <div className="p-2 bg-emerald-100 rounded-lg shrink-0">
                          <FileText className="h-5 w-5 text-emerald-600" />
                        </div>
                        <div>
                          <p className="text-[10px] font-extrabold text-emerald-500 uppercase tracking-wider">Nro. Planilla</p>
                          <p className="text-sm font-black text-emerald-800">#{records.length + 1}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Ordenante</label>
                        <input
                          type="text"
                          value={ocrExtractedData.apellidoNombre}
                          onChange={(e) => setOcrExtractedData({ ...ocrExtractedData, apellidoNombre: e.target.value })}
                          className="w-full p-2 bg-white border rounded font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">DNI</label>
                        <input
                          type="text"
                          value={ocrExtractedData.dni}
                          onChange={(e) => setOcrExtractedData({ ...ocrExtractedData, dni: e.target.value })}
                          className="w-full p-2 bg-white border rounded font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Operación</label>
                        <input
                          type="text"
                          value={ocrExtractedData.operacion}
                          onChange={(e) => setOcrExtractedData({ ...ocrExtractedData, operacion: e.target.value })}
                          className="w-full p-2 bg-white border rounded font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Monto</label>
                        <input
                          type="number"
                          value={ocrExtractedData.monto}
                          onChange={(e) => setOcrExtractedData({ ...ocrExtractedData, monto: parseFloat(e.target.value) || 0 })}
                          className="w-full p-2 bg-white border rounded font-bold"
                        />
                      </div>
                    </div>
                    <button
                      onClick={saveOcrToSheet}
                      className="w-full py-2.5 bg-indigo-600 text-white font-bold text-xs rounded-lg shadow hover:bg-indigo-700"
                    >
                      Confirmar e Importar a Planilla
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 1: Hoja de Cálculo */}
        {activeTab === 'sheet' && (
          <Listado
            records={records}
            setRecords={setRecords}
            showNotification={showNotification}
            activeDiploma={activeDiploma}
            onlyMissingData={onlyMissingData}
            setOnlyMissingData={setOnlyMissingData}
          />
        )}

        {/* Tab Dashboard */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Total Recaudado</span>
                <p className="text-xl font-black text-indigo-600 mt-1">${stats.total.toLocaleString('es-AR')}</p>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Comprobantes</span>
                <p className="text-xl font-black text-slate-700 mt-1">{stats.count}</p>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Faltan Datos</span>
                <p className="text-xl font-black text-rose-500 mt-1">{stats.missingCount}</p>
              </div>
            </div>
          </div>
        )}

        {/* Tab Config / Code */}
        {activeTab === 'code' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center space-x-3 border-b pb-4">
                <KeyRound className="h-6 w-6 text-indigo-600" />
                <div>
                  <h3 className="font-extrabold text-slate-800 text-sm">Estado de Integraciones & Conexiones API</h3>
                  <p className="text-xs text-slate-400">Verifica la configuración de las credenciales del sistema.</p>
                </div>
              </div>

              {/* Indicadores Visuales Detallados */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Gemini Status Card */}
                <div className={`p-4 rounded-xl border ${geminiStatus.isConfigured ? 'bg-emerald-50/50 border-emerald-200' : 'bg-rose-50/50 border-rose-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-xs flex items-center gap-2">
                      <Zap className={`h-4 w-4 ${geminiStatus.isConfigured ? 'text-emerald-600' : 'text-rose-600'}`} />
                      Google Gemini AI (OCR)
                    </span>
                    <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded-full ${geminiStatus.isConfigured ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                      {geminiStatus.isConfigured ? 'CONFIGURADO' : 'PENDIENTE'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    {geminiStatus.isConfigured
                      ? `Clave activa (${geminiStatus.keyHint}) cargada desde ${geminiStatus.source === 'env' ? 'variables de entorno (.env.local)' : 'interfaz manual'}.`
                      : 'No se detectó API Key en .env.local ni en la interfaz.'}
                  </p>
                  <div className="mt-3">
                    <input
                      type="password"
                      placeholder="Override Clave Gemini (AIzaSy...)"
                      value={customApiKey}
                      onChange={(e) => setCustomApiKey(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border rounded font-mono"
                    />
                  </div>
                </div>

                {/* Gmail API Status Card */}
                <div className={`p-4 rounded-xl border ${gmailAccountStatus.status === 'connected' ? 'bg-indigo-50/50 border-indigo-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-xs flex items-center gap-2">
                      <Mail className="h-4 w-4 text-indigo-600" />
                      Gmail API (Backend Express)
                    </span>
                    <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded-full ${gmailAccountStatus.status === 'connected' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-200 text-slate-600'}`}>
                      {gmailAccountStatus.status === 'connected' ? 'CONECTADO' : 'DESCONECTADO'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    {gmailAccountStatus.status === 'connected'
                      ? `Cuenta asociada: ${gmailAccountStatus.email}`
                      : gmailAccountStatus.error || 'El backend Express en puerto 3000 administra la sesión OAuth de Gmail.'}
                  </p>
                  <button
                    onClick={checkGmailConnection}
                    className="mt-3 px-3 py-1 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded border border-indigo-200 flex items-center gap-1"
                  >
                    <RefreshCw className="h-3 w-3" /> Recomprobar Estado
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      <footer className="bg-white border-t border-slate-200 py-6 select-none mt-12 text-center text-xs text-slate-400">
        <p className="font-bold text-slate-600">IDeIn Computación — Sistema Integrado de Control de Cobros</p>
      </footer>

    </div>
  );
}
