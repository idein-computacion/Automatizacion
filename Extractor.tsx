import React, { useState, useMemo, useEffect } from 'react';
import Listado, { formatOperationNumber, formatToDdMmYyyy, getCurrentFormattedDate } from './Listado';
import { getFirebaseDb, ref, get, set } from './firebase';
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
  X
} from 'lucide-react';

// API Key de Gemini: El entorno de ejecución la provee de ser necesario.
const apiKey = "";

// Iniciamos completamente vacío para control absoluto del usuario
const INITIAL_RECORDS = [];


export default function App() {
  const [records, setRecords] = useState<any[]>(INITIAL_RECORDS);
  const [activeDiploma, setActiveDiploma] = useState<string>(() => localStorage.getItem('ACTIVE_DIPLOMA') || 'DUELO');
  const [diplomasList, setDiplomasList] = useState<string[]>(['DUELO', 'DANZA']);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('sheet'); // 'sheet' | 'ocr' | 'dashboard' | 'ai_audit' | 'code'

  // Filtros
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [bankFilter, setBankFilter] = useState<string>('ALL'); // 'ALL' | 'MP' | 'MACRO'
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

  const [customApiKey, setCustomApiKey] = useState<string>(() => localStorage.getItem('GEMINI_CUSTOM_KEY') || '');
  const [claudeApiKey, setClaudeApiKey] = useState<string>(() => localStorage.getItem('CLAUDE_CUSTOM_KEY') || '');
  const [aiProvider, setAiProvider] = useState<string>(() => localStorage.getItem('AI_PROVIDER') || 'gemini');
  const [firebaseConfigStr, setFirebaseConfigStr] = useState<string>(() => localStorage.getItem('FIREBASE_CUSTOM_CONFIG') || '');

  // Estados para el sistema de gestión de carpetas (Local y Servidor)
  const [fileMode, setFileMode] = useState<string>('manual'); // 'manual' | 'browser_dir' | 'server_dir'
  const [directoryHandle, setDirectoryHandle] = useState<any>(null);
  const [directoryFiles, setDirectoryFiles] = useState<any[]>([]);
  const [currentFileHandle, setCurrentFileHandle] = useState<any>(null);
  const [serverFiles, setServerFiles] = useState<any[]>([]);
  const [selectedServerFile, setSelectedServerFile] = useState<any>(null);
  const [isSyncingGmail, setIsSyncingGmail] = useState<boolean>(false);



  // Modales personalizados de control de UI (en reemplazo de alert/confirm)
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });

  // Guardar clave API en local storage si se ingresa manualmente
  useEffect(() => {
    localStorage.setItem('GEMINI_CUSTOM_KEY', customApiKey);
  }, [customApiKey]);

  useEffect(() => {
    localStorage.setItem('FIREBASE_CUSTOM_CONFIG', firebaseConfigStr);
  }, [firebaseConfigStr]);

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
  const [consolidatedRecords, setConsolidatedRecords] = useState<any[]>([]);

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
        const rawDaily = dailySnap.exists() ? dailySnap.val() || [] : [];

        const consolidatedSnap = await get(consolidatedRef);
        const rawConsolidated = consolidatedSnap.exists() ? consolidatedSnap.val() || [] : [];

        // 1. Renumerar y sanitizar el consolidado secuencialmente desde 1 hasta N (consolidatedId consecutivo)
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

        // 2. Renumerar y sanitizar la planilla diaria secuencialmente desde 1 hasta N (id consecutivo 1..N) y sincronizar
        let dailyChanged = false;

        // Indexar el consolidado para búsquedas rápidas O(1)
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

          // Helper local para composite key
          const studentKey = (rec.dni && String(rec.dni).trim()) || (rec.apellidoNombre && String(rec.apellidoNombre).trim().toUpperCase()) || '';
          const recComp = studentKey ? `${studentKey}-${cleanFecha}-${rec.monto}` : '';

          const histMatch = (recOp && consolidatedByOp.get(recOp)) || (recComp && consolidatedByCompKey.get(recComp)) || null;

          const newConsolidatedId = histMatch ? histMatch.consolidatedId : (rec.consolidatedId || targetDailyId);
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

  // Cargar automáticamente los archivos de la carpeta del servidor local al activar este modo
  useEffect(() => {
    if (fileMode === 'server_dir') {
      refreshServerDirectory();
    }
  }, [fileMode]);

  const showNotification = (message, type = 'success') => {
    setNotification({ show: true, message, type });
    setTimeout(() => {
      setNotification({ show: false, message: '', type: 'success' });
    }, 3000);
  };

  // Función de llamada robusta a la API de Gemini con Backoff Exponencial (hasta 5 intentos)
  const callGeminiAPI = async (payload) => {
    const activeKeyString = customApiKey || apiKey || "";
    if (!activeKeyString) {
      throw new Error("API_KEY_EMPTY");
    }

    // Separar por comas, espacios o punto y coma
    const keys = activeKeyString
      .split(/[,;\s]+/)
      .map(k => k.trim())
      .filter(k => k.startsWith("AIzaSy"));

    if (keys.length === 0) {
      throw new Error("API_KEY_INVALID_FORMAT");
    }

    let lastError = null;
    // Rotar claves de API en caso de toparnos con límites de cuota (429)
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      const currentKey = keys[keyIndex];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${currentKey}`;

      let delay = 1000;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (response.ok) {
            return await response.json();
          }

          if (response.status === 429) {
            console.warn(`Límite 429 alcanzado en clave índice ${keyIndex}. Rotando a la siguiente clave...`);
            lastError = new Error("Límite de cuota excedido (429) en todas las claves provistas.");
            break; // Salta al siguiente elemento del bucle principal (rotación de clave)
          }

          if (response.status >= 500) {
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
          } else {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody?.error?.message || `Error de API: ${response.status}`);
          }
        } catch (err) {
          lastError = err;
          if (attempt === 1) break;
        }
      }
    }
    throw lastError || new Error("No se pudo conectar con Gemini API.");
  };

  const callClaudeAPI = async (messages, systemPrompt = "") => {
    if (!claudeApiKey) {
      throw new Error("CLAUDE_API_KEY_EMPTY");
    }

    const url = '/api/anthropic/v1/messages';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 2048,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: messages
      })
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `Error de Claude API: ${response.status}`);
    }

    const data = await response.json();
    return data.content[0].text;
  };

  // Modificar registro
  const handleCellEditStart = (id, field, value) => {
    setEditingCell({ id, field });
    setEditValue(value || '');
  };

  const handleCellEditSave = (id, field) => {
    setRecords(prev => prev.map(rec => {
      if (rec.id === id) {
        let value: any = editValue;
        if (field === 'monto') {
          let num = parseFloat(editValue.replace(/[^0-9.-]/g, '').replace(',', '.')) || 0;
          if (num > 0 && num < 1000) {
            num = num * 1000;
          }
          value = num;
        }
        if (field === 'dni') {
          value = editValue.replace(/\./g, "");
        }
        if (field === 'fecha') {
          value = formatToDdMmYyyy(editValue);
        }
        if (field === 'operacion') {
          value = formatOperationNumber(editValue);
        }

        const updatedRec = { ...rec, [field]: value };

        // Si cambia el nombre y hay un archivo, actualizar el nombre del archivo
        if (field === 'apellidoNombre' && rec.archivoRenombrado) {
          let apellido = "ORDENANTE";
          if (value) {
            const parts = value.split(',');
            apellido = parts[0].trim().split(/\s+/)[0];
          }
          const cleanApellido = apellido
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9]/g, "")
            .toUpperCase();
          const extension = rec.archivoRenombrado.split('.').pop() || "png";
          updatedRec.archivoRenombrado = `${rec.id}-${cleanApellido}.${extension}`;
        }

        return updatedRec;
      }
      return rec;
    }));
    setEditingCell({ id: null, field: null });
    showNotification('Celda actualizada correctamente');
  };

  const handleCellEditCancel = () => {
    setEditingCell({ id: null, field: null });
  };

  // Agregar fila manual
  const handleAddNewRow = () => {
    const nextId = records.length > 0 ? Math.max(...records.map(r => r.id)) + 1 : 1;
    const newRow = {
      id: nextId,
      apellidoNombre: "",
      dni: "",
      banco: "MP",
      operacion: "",
      fecha: getCurrentFormattedDate(),
      monto: 0,
      titular: ""
    };
    setRecords([...records, newRow]);
    showNotification('Nueva fila vacía insertada');
  };

  // Eliminar fila
  const handleDeleteRow = (id) => {
    setRecords(prev => prev.filter(rec => rec.id !== id));
    showNotification('Fila eliminada correctamente', 'error');
  };

  // Procesamiento Real OCR con Gemini o Claude
  const handleOcrWithGemini = async (file) => {
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
            const prompt = `Analiza de manera experta este comprobante de pago bancario y extrae con máxima precisión los datos estructurados para conciliación de caja.
            
            Reglas de extracción críticas:
            1. Identifica el banco emisor: Debe ser 'MP' si es de Mercado Pago, 'MACRO' si es de Banco Macro, 'BNA' si es de Banco Nación, 'PERSONAL_PAY' si es de Personal Pay, 'MODO' si es de MODO, 'ASTRO_PAY' si es de Astro Pay, o 'OTROS' si es otro medio.
            2. Identifica el Apellido y Nombre del ordenante si figura. Formatea siempre como: APELLIDO, NOMBRE (en mayúsculas).
            3. Si figura un CUIT, CUIL o CUIT/CUIL del remitente (ejemplo: '27-30826835-2' o '20427619053'), extrae exclusivamente la sección de 8 dígitos intermedios correspondiente al DNI del ordenante. Si el banco es MACRO y no figura el DNI, CUIT o CUIL del remitente/ordenante, NO extraigas el CUIT/DNI del destinatario; en ese caso deja el campo "dni" totalmente vacío ("").
            4. Obtén el número de operación, transacción, comprobante o ID de transferencia de manera exacta. IMPORTANTE para Banco Macro: El número de operación se encuentra en la cabecera superior al lado de la fecha y hora (ejemplo: '30/05/2026 13:38 1325295412' -> el nro de operación es '1325295412').
            5. Obtén la fecha de la operación y conviértela estrictamente al formato simple: AAAA-MM-DD.
            6. Obtén el importe o importe neto transferido como número flotante o entero.
            7. Obtén el titular de la cuenta origen si se menciona de forma explícita.
            
            Devuelve un objeto JSON que coincida exactamente con este esquema:
            {
              "apellidoNombre": "APELLIDO, NOMBRE",
              "dni": "DNI de 8 dígitos",
              "banco": "MP, MACRO, BNA, PERSONAL_PAY, MODO, ASTRO_PAY o OTROS",
              "operacion": "Nro operación",
              "fecha": "DD-MM-AAAA",
              "monto": importe_numérico,
              "titular": "Nombre titular origen"
            }`;

            const payload = {
              contents: [{
                role: "user",
                parts: [
                  { text: prompt },
                  { inlineData: { mimeType: mimeType, data: base64Data } }
                ]
              }],
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: "OBJECT",
                  properties: {
                    apellidoNombre: { type: "STRING" },
                    dni: { type: "STRING" },
                    banco: { type: "STRING", enum: ["MP", "MACRO", "BNA", "PERSONAL_PAY", "MODO", "ASTRO_PAY", "OTROS"] },
                    operacion: { type: "STRING" },
                    fecha: { type: "STRING" },
                    monto: { type: "NUMBER" },
                    titular: { type: "STRING" }
                  },
                  required: ["banco", "operacion", "fecha", "monto"]
                }
              }
            };

            setOcrProgress(60);
            setOcrStepText("✨ Procesando firma digital e importes...");

            const result = await callGeminiAPI(payload);
            const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;

            if (textResponse) {
              ocrData = JSON.parse(textResponse);
            }
          } else {
            // Claude OCR
            const claudeMessages = [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: mimeType.startsWith("image/") ? mimeType : "image/jpeg",
                      data: base64Data
                    }
                  },
                  {
                    type: "text",
                    text: `Analiza este comprobante bancario y extrae de manera experta los datos en formato JSON.
                    Reglas críticas:
                    1. Identifica el banco emisor: Debe ser 'MP' si es de Mercado Pago, 'MACRO' si es de Banco Macro, 'BNA' si es de Banco Nación, 'PERSONAL_PAY' si es de Personal Pay, 'MODO' si es de MODO, 'ASTRO_PAY' si es de Astro Pay, o 'OTROS' si es otro medio.
                    2. Identifica el Apellido y Nombre del ordenante si figura. Formatea siempre como: APELLIDO, NOMBRE (en mayúsculas).
                    3. Extrae la sección de 8 dígitos correspondientes al DNI del ordenante. Si el banco es MACRO y no figura el DNI, CUIT o CUIL del remitente/ordenante, NO extraigas el CUIT/DNI del destinatario; en ese caso deja el campo "dni" totalmente vacío ("").
                    4. Obtén el número de operación exacta. IMPORTANTE para Banco Macro: El número de operación se encuentra arriba al lado de la fecha y hora (ej: '30/05/2026 13:38 1325295412' -> el nro es '1325295412').
                    5. Obtén la fecha en formato AAAA-MM-DD.
                    6. Obtén el importe como número.
                    7. Obtén el titular de la cuenta origen si figura.

                    Devuelve EXCLUSIVAMENTE el objeto JSON que coincida exactamente con este esquema, sin ningún formato Markdown (no rodees con triple comilla backticks ni texto previo/posterior) y sin explicaciones adicionales:
                    {
                      "apellidoNombre": "APELLIDO, NOMBRE",
                      "dni": "DNI",
                      "banco": "MP, MACRO, BNA, PERSONAL_PAY, MODO, ASTRO_PAY o OTROS",
                      "operacion": "Nro operación",
                      "fecha": "AAAA-MM-DD",
                      "monto": importe_numérico,
                      "titular": "Nombre titular"
                    }`
                  }
                ]
              }
            ];

            setOcrProgress(60);
            setOcrStepText("✨ Procesando imagen con Claude 3.5 Sonnet...");

            const responseText = await callClaudeAPI(claudeMessages, "Eres un asistente experto en contabilidad y OCR de facturas. Tu única tarea es extraer datos y formatearlos en JSON puro.");
            const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            ocrData = JSON.parse(cleanedText);
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
        } catch (innerErr) {
          console.error("Error en llamada real OCR: ", innerErr);
          const errMsg = innerErr.message === "API_KEY_EMPTY"
            ? "La clave API de Gemini está vacía."
            : innerErr.message === "CLAUDE_API_KEY_EMPTY"
              ? "La clave API de Anthropic está vacía."
              : innerErr.message === "API_KEY_INVALID_FORMAT"
                ? "Formato inválido. Las claves deben comenzar con 'AIzaSy'."
                : `Error de ${aiProvider === 'gemini' ? 'Gemini' : 'Claude'}: ${innerErr.message}`;
          setOcrStepText(errMsg);
          showNotification(errMsg, "error");
          setOcrExtractedData(null);
        } finally {
          setIsOcrScanning(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (e) {
      setIsOcrScanning(false);
      setOcrStepText("Clave de API ausente. Configúrala abajo para procesar.");
      showNotification("Clave API requerida para procesar archivos reales", "error");
    }
  };

  const refreshBrowserDirectory = async (dirHandle) => {
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

  const handleSelectFileFromBrowserDir = async (fileHandle) => {
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
    // 1. Verificar si llegamos al límite de 15 registros diarios
    if (currentRecordsCount >= 15) {
      showNotification("Límite de lote alcanzado (15/15). Por favor exporta y vacía la planilla.", "info");
      setOcrExtractedData(null);
      setSelectedOcrFile(null);
      setCurrentFileHandle(null);
      setSelectedServerFile(null);
      setActiveTab('sheet');
      return;
    }

    // 2. Buscar el siguiente archivo en el modo correspondiente
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
    setIsSyncingGmail(true);
    showNotification(`Iniciando sincronización de Gmail para ${activeDiploma}...`, 'info');
    try {
      const res = await fetch(`/api/sync-gmail?diploma=${activeDiploma}`, {
        method: 'POST'
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Error en el servidor de sincronización");
      }
      const data = await res.json();
      if (data.success) {
        const stdout = data.stdout || '';
        const match = stdout.match(/Se encontraron (\d+) correos no leídos/);
        const count = match ? match[1] : '0';
        showNotification(`Sincronización exitosa. Se procesaron ${count} correos.`, 'success');
        await refreshServerDirectory();
      } else {
        throw new Error(data.error || "Sincronización fallida");
      }
    } catch (err: any) {
      console.error(err);
      showNotification(`Error: ${err.message}`, 'error');
    } finally {
      setIsSyncingGmail(false);
    }
  };

  const handleSelectFileFromServerDir = async (fileName) => {
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
    } catch (err) {
      console.error(err);
      showNotification(`Error al cargar el archivo del servidor: ${err.message}`, "error");
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFileMode('manual');
      setSelectedOcrFile({
        name: file.name,
        size: `${(file.size / 1024).toFixed(1)} KB`
      });
      handleOcrWithGemini(file);
    }
  };

  const triggerDownload = (dataUrl, fileName) => {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };



  // Sets memoizados para búsquedas rápidas O(1) de operaciones en el ciclo de renderizado del formulario OCR
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

  // Comprobación de duplicados para el comprobante recién escaneado por OCR
  // Comprobación de duplicados para el comprobante recién escaneado por OCR (estricto por número de operación)
  const checkOcrDuplicate = () => {
    if (!ocrExtractedData) return null;

    const op = ocrExtractedData.operacion ? ocrExtractedData.operacion.trim() : '';
    if (!op) return null; // Si no hay número de operación, no se considera duplicado

    // A. Buscar coincidencia en la planilla diaria actual
    if (dailyOperationsSet.has(op)) {
      return {
        type: 'daily',
        reason: `código de operación "${op}" ya ingresado en este lote`
      };
    }

    // B. Buscar coincidencia en el historial consolidado
    if (historicalOperationsSet.has(op)) {
      return {
        type: 'historical',
        reason: `código de operación "${op}" ya registrado anteriormente en el historial maestro`
      };
    }

    return null;
  };

  // Guardar datos extraídos por OCR en la tabla principal
  const saveOcrToSheet = async () => {
    if (!ocrExtractedData) return;

    // Mostrar estado de "Buscando duplicados..." en la UI
    setIsOcrScanning(true);
    setOcrProgress(50);
    setOcrStepText("Buscando duplicados...");

    // Esperar una pequeña fracción de segundo para que el loader sea visible
    await new Promise(resolve => setTimeout(resolve, 800));

    // Verificar duplicación antes de guardar
    const duplicate = checkOcrDuplicate();
    if (duplicate) {
      // Ocultar el loader temporalmente para que el confirm sea visible sobre el formulario
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

    // Extraer apellido
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

    // Método A: Guardado y renombrado nativo en la carpeta abierta del navegador
    if (fileMode === 'browser_dir' && directoryHandle && currentFileHandle) {
      try {
        const file = await currentFileHandle.getFile();

        // Escribir el nuevo archivo renombrado en la carpeta
        const newFileHandle = await directoryHandle.getFileHandle(newFileName, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(file);
        await writable.close();

        // Eliminar el archivo original
        await directoryHandle.removeEntry(currentFileHandle.name);

        fileHandledLocally = true;
        showNotification(`Archivo renombrado como ${newFileName} y original eliminado del disco.`);
        await refreshBrowserDirectory(directoryHandle);
      } catch (err) {
        console.error("Error en renombrado/eliminación nativo:", err);
        showNotification("Error al guardar archivo en carpeta local del navegador. Se forzará descarga.", "error");
      }
    }

    // Método B: Enviar solicitud de renombrado y borrado al servidor de Vite
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

    // Método C: Guardar en el servidor local si estamos en modo manual y tenemos el archivo
    if (fileMode === 'manual' && ocrExtractedData.fileDataUrl) {
      try {
        const response = await fetch(`/api/local-files/rename?diploma=${activeDiploma}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalName: newFileName, // Al pasar el mismo nombre, el servidor lo crea sin borrar ningún original
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

    const newRecord = {
      id: nextId,
      apellidoNombre: ocrExtractedData.apellidoNombre || "",
      dni: (ocrExtractedData.dni || "").replace(/\./g, ""),
      banco: ocrExtractedData.banco || "MP",
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

    // Persistir el listado de comprobantes registrados en Firebase Realtime Database
    try {
      const db = getFirebaseDb();

      // 1. Obtener registros consolidados actuales desde Firebase
      const consolidatedRef = ref(db, `diplomaturas/${activeDiploma}/consolidated_records`);
      const consolidatedSnap = await get(consolidatedRef);
      const currentConsolidated = consolidatedSnap.exists() ? consolidatedSnap.val() || [] : [];

      // 2. Mapear y renumerar registros diarios consecutivamente de 1 a N
      const mapped = updatedRecords.map((rec, idx) => ({
        ...rec,
        id: idx + 1,
        consolidatedId: rec.consolidatedId || rec.id || (Date.now() + idx)
      }));

      // 3. Consolidar el nuevo registro en la lista histórica
      const consolidated = [...currentConsolidated];

      // Indexar el consolidado para búsquedas rápidas O(1)
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

        // A. Comparación por operación bancaria
        if (recOp && consolidatedByOp.has(recOp)) {
          existingIndex = consolidatedByOp.get(recOp)!;
        }

        // B. Comparación por clave compuesta si no hay operación
        if (existingIndex === -1 && recComp && consolidatedByCompKey.has(recComp)) {
          existingIndex = consolidatedByCompKey.get(recComp)!;
        }

        if (existingIndex !== -1) {
          consolidated[existingIndex] = { ...consolidated[existingIndex], ...rec };
          rec.consolidatedId = consolidated[existingIndex].consolidatedId;
        } else {
          // Asignar ID consolidado incremental consecutivo
          const nextConsolidatedId = consolidated.length + 1;
          rec.consolidatedId = nextConsolidatedId;
          const newRecord = { ...rec, consolidatedId: nextConsolidatedId };

          const newIndex = consolidated.length;
          consolidated.push(newRecord);

          // Actualizar mapas
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

      // 4. Guardar ambas colecciones en Firebase
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

    // Descarga automática en navegador si no se pudo manejar localmente
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



  // Vaciar planilla completamente previo paso por modal
  const handleClearAllRecords = () => {
    setRecords([]);
    setShowDeleteModal(false);
    showNotification('Se han eliminado todos los datos de la planilla', 'info');
  };

  // Filtrado de datos
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

  // Totales y estadísticas para Dashboard
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

  // Función robusta para parsear y normalizar fechas de los registros (soporta DD/MM/YYYY y YYYY-MM-DD)
  const parseRecordDate = (dateStr: string) => {
    if (!dateStr) return null;
    const clean = dateStr.trim();
    let parts: string[] = [];
    let isYMD = false;

    if (clean.includes('-')) {
      parts = clean.split('-');
      if (parts[0] && parts[0].length === 4) isYMD = true;
    } else if (clean.includes('/')) {
      parts = clean.split('/');
      if (parts[0] && parts[0].length === 4) isYMD = true;
    } else {
      return null;
    }

    if (parts.length < 3) return null;

    let y = '', m = '', d = '';
    if (isYMD) {
      y = parts[0];
      m = parts[1];
      d = parts[2];
    } else {
      d = parts[0];
      m = parts[1];
      y = parts[2];
    }

    const cleanY = y.trim();
    const cleanM = m.trim().padStart(2, '0');
    const cleanD = d.trim().padStart(2, '0');

    if (cleanY.length !== 4 || isNaN(Number(cleanY)) || isNaN(Number(cleanM))) return null;

    return {
      year: cleanY,
      month: cleanM,
      day: cleanD,
      fechaNormalizada: `${cleanY}-${cleanM}-${cleanD}`,
      keyMes: `${cleanY}-${cleanM}`
    };
  };

  // Agrupamiento por fecha para gráficos (diario)
  const dailyData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredRecords.forEach(r => {
      const parsed = parseRecordDate(r.fecha);
      if (!parsed) return;
      map[parsed.fechaNormalizada] = (map[parsed.fechaNormalizada] || 0) + r.monto;
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredRecords]);

  // Agrupamiento por MES para el Dashboard
  const monthlyData = useMemo(() => {
    const map: Record<string, { total: number; mp: number; macro: number; count: number }> = {};
    filteredRecords.forEach(r => {
      const parsed = parseRecordDate(r.fecha);
      if (!parsed) return;
      const key = parsed.keyMes;
      if (!map[key]) map[key] = { total: 0, mp: 0, macro: 0, count: 0 };
      map[key].total += r.monto;
      map[key].count += 1;
      if (r.banco === 'MP') map[key].mp += r.monto;
      if (r.banco === 'MACRO') map[key].macro += r.monto;
    });
    return Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, val]) => {
        const [year, month] = key.split('-');
        const label = new Date(Number(year), Number(month) - 1, 1)
          .toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })
          .replace('.', '')
          .toUpperCase();
        return { key, label, ...val };
      });
  }, [filteredRecords]);

  // Exportar a CSV de forma simulada/segura
  const exportToCSV = () => {
    let csvContent = "APELLIDO Y NOMBRE,DNI,BANCO,OPERACION N,FECHA DE LA OPERACION,MONTO,TITULAR DE LA CUENTA\n";
    filteredRecords.forEach(rec => {
      csvContent += `"${rec.apellidoNombre}","${rec.dni}","${rec.banco}","${rec.operacion}","${rec.fecha}",${rec.monto},"${rec.titular}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `comprobantes_control_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification('CSV Descargado con éxito');
  };

  // Copiar datos en formato TSV (para Excel/Sheets directo)
  const copyExcelFormat = () => {
    let tsv = "APELLIDO Y NOMBRE\tDNI\tBANCO\tOPERACIÓN N°\tFECHA\tMONTO\tTITULAR DE LA CUENTA\n";
    filteredRecords.forEach(rec => {
      tsv += `${rec.apellidoNombre}\t${rec.dni}\t${rec.banco}\t${rec.operacion}\t${rec.fecha}\t${rec.monto}\t${rec.titular}\n`;
    });

    const textarea = document.createElement('textarea');
    textarea.value = tsv;
    textarea.style.position = 'fixed';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showNotification('Copiado al portapapeles en formato Excel');
    } catch (err) {
      showNotification('Error al copiar', 'error');
    }
    document.body.removeChild(textarea);
  };

  // Generador de Apps Script con datos reales actuales
  const appsScriptCode = useMemo(() => {
    const dataString = JSON.stringify(filteredRecords.map(r => [
      r.apellidoNombre,
      r.dni,
      r.banco,
      r.operacion,
      r.fecha,
      r.monto,
      r.titular
    ]), null, 2);

    return `/**
 * SCRIPT PARA GOOGLE SHEETS
 * Diseñado para el control contable general de cobros.
 * Agrega los registros filtrados directamente al final de la hoja activa.
 */
function registrarComprobantesActuales() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  // Datos sincronizados en tiempo real desde la Hoja Interactiva
  var nuevosRegistros = ${dataString};
  
  if (nuevosRegistros.length === 0) {
    SpreadsheetApp.getUi().alert("Control de Caja", "No hay registros cargados para importar.", SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  
  // Fila de inicio para la inserción
  var ultimaFila = sheet.getLastRow();
  var rangoDestino = sheet.getRange(ultimaFila + 1, 1, nuevosRegistros.length, nuevosRegistros[0].length);
  
  // Insertar valores
  rangoDestino.setValues(nuevosRegistros);
  
  // Formatear la columna de monto (Columna 6) como moneda
  sheet.getRange(ultimaFila + 1, 6, nuevosRegistros.length, 1).setNumberFormat("$ #,##0.00");
  
  SpreadsheetApp.getUi().alert(
    "Operación Exitosa", 
    "Se insertaron correctamente " + nuevosRegistros.length + " comprobantes al final de la hoja.", 
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}`;
  }, [filteredRecords]);

  // Generador de script de Python para base de datos SQLite / Pandas
  const pythonScriptCode = useMemo(() => {
    const dataString = JSON.stringify(filteredRecords, null, 2);
    return `# SCRIPT DE PYTHON PARA CONTROL CONTABLE DE COBROS
# Mapea e inserta los comprobantes filtrados a una base de datos SQLite o procesa con Pandas

import pandas as pd
import sqlite3
from datetime import datetime

# Datos exportados de la Hoja de Control de Comprobantes
comprobantes_data = ${dataString}

# Convertir a un DataFrame de Pandas
df = pd.DataFrame(comprobantes_data)

# Formatear y limpiar
df['monto'] = df['monto'].astype(float)
df['fecha'] = pd.to_datetime(df['fecha'])

print("--- Resumen de Comprobantes a Cargar ---")
print(f"Total de Transacciones: {len(df)}")
print(f"Monto Total Recaudado: $ {df['monto'].sum():,.2f}")
print(df[['apellidoNombre', 'dni', 'banco', 'monto']])

def guardar_en_bd():
    # Crear o conectar base de datos local
    conn = sqlite3.connect('control_comprobantes.db')
    cursor = conn.cursor()
    
    # Crear tabla si no existe
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cobros (
            id INTEGER PRIMARY KEY,
            apellido_nombre TEXT,
            dni TEXT,
            banco TEXT,
            operacion_n TEXT UNIQUE,
            fecha TEXT,
            monto REAL,
            titular_cuenta TEXT
        )
    ''')
    
    # Insertar filas de manera segura evitando duplicados de Operación
    nuevos = 0
    for idx, row in df.iterrows():
        try:
            cursor.execute('''
                INSERT INTO cobros (id, apellido_nombre, dni, banco, operacion_n, fecha, monto, titular_cuenta)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (row['id'], row['apellidoNombre'], row['dni'], row['banco'], row['operacion'], row['fecha'].strftime('%Y-%m-%d'), row['monto'], row['titular']))
            nuevos += 1
        except sqlite3.IntegrityError:
            # Si el N° de Operación ya existe, no se vuelve a insertar (protección de duplicados)
            continue
            
    conn.commit()
    conn.close()
    print(f"\\nSe han insertado {nuevos} nuevas transacciones únicas a la base de datos sqlite.")

if __name__ == '__main__':
    guardar_en_bd()
`;
  }, [filteredRecords]);

  // Copiar código
  const copyCodeToClipboard = (code, type) => {
    const textarea = document.createElement('textarea');
    textarea.value = code;
    textarea.style.position = 'fixed';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showNotification(`Código de ${type} copiado al portapapeles`);
    } catch (err) {
      showNotification('Error al copiar código', 'error');
    }
    document.body.removeChild(textarea);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased flex flex-col">

      {/* ── Floating Toast Notification ── */}
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

      {/* ── HEADER UNIFICADO (reemplaza sidebar + header móvil) ── */}
      <header className="bg-[#070b12] text-white sticky top-0 z-30 select-none border-b border-slate-800/50 shadow-lg shadow-black/20">

        {/* Barra principal */}
        <div className="flex items-center justify-between px-4 py-3 lg:px-6">

          {/* Logo */}
          <div className="flex items-center gap-3 shrink-0 select-none">
            <img
              src="/logo.jpg"
              alt="Logo IDeIn"
              className="h-10 w-auto rounded-lg object-contain bg-white p-0.5 shadow shadow-white/10 border border-slate-800/80"
            />
            <div className="hidden sm:block">
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

          {/* Derecha: título del sistema */}
          <div className="flex items-center shrink-0">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1.5 rounded-xl shadow-sm">
              Sistema Integrado de control de cobros
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6 lg:p-8 xl:p-10 animate-fadeIn bg-slate-50/50">

        {/* Menú de Navegación en forma de Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8 select-none">
          {[
            { tab: 'sheet', icon: <FileSpreadsheet className="h-6 w-6" />, label: 'Hoja de Cálculo', description: 'Planilla de pagos y cobros' },
            { tab: 'ocr', icon: <Upload className="h-6 w-6" />, label: 'Lector OCR ✨', description: 'Escáner automático de comprobantes' },
            { tab: 'dashboard', icon: <BarChart2 className="h-6 w-6" />, label: 'Estadísticas', description: 'Reportes y gráficos de caja' },
            { tab: 'code', icon: <Code className="h-6 w-6" />, label: 'Automatizar', description: 'Scripts de automatización y Gmail' },
          ].map(({ tab, icon, label, description }) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`fintech-card-interactive flex flex-col justify-between p-5 text-left transition-all duration-300 relative group cursor-pointer border rounded-2xl ${activeTab === tab
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


        {/* Tab OCR: Subida e Extracción automatizada */}
        {activeTab === 'ocr' && (
          <div className="fintech-card p-6 overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5 mb-6">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Scan className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-800">Carga Digital Inteligente (Lector OCR ✨)</h2>
                  <p className="text-xs text-slate-500">Arrastra comprobantes bancarios para parsear de forma real con Visión Artificial.</p>
                </div>
              </div>

              {/* Selector de Proveedor de IA */}
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
                <button
                  onClick={() => setAiProvider('claude')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center ${aiProvider === 'claude'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                  🚀 Anthropic Claude 3.5
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Zona de Arrastre / Selección de Archivo */}
              <div className="flex flex-col space-y-6">
                {/* Selector de Modo de Archivo */}
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
                      className="absolute inset-0 cursor-pointer"
                    />
                    <div className="p-4 bg-white shadow-sm rounded-full mb-4 text-slate-400 pointer-events-none">
                      <FileUp className="h-8 w-8 text-indigo-500 animate-bounce" />
                    </div>
                    <p className="text-sm font-bold text-slate-700 pointer-events-none">Arrastra tu comprobante aquí</p>
                    <p className="text-xs text-slate-400 mt-1 pointer-events-none">O haz clic para explorar tu PC</p>
                    <span className="inline-block mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded pointer-events-none">Soporta PDF, PNG y JPEG</span>
                  </div>
                )}

                {fileMode === 'browser_dir' && (
                  <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 flex flex-col space-y-4 min-h-[250px] animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-600">Carpeta local conectada:</span>
                      {directoryHandle && (
                        <button
                          onClick={handleSelectBrowserDirectory}
                          className="px-2 py-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-100 transition-all flex items-center gap-1"
                        >
                          <RefreshCw className="h-3 w-3" /> Cambiar
                        </button>
                      )}
                    </div>

                    {!directoryHandle ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-300 rounded-xl bg-white">
                        <FolderOpen className="h-10 w-10 text-indigo-400 mb-2" />
                        <p className="text-sm font-bold text-slate-700">No hay ninguna carpeta abierta</p>
                        <p className="text-xs text-slate-400 mt-1 mb-4">Abre una carpeta local para procesar archivos y eliminarlos automáticamente al renombrarlos.</p>
                        <button
                          onClick={handleSelectBrowserDirectory}
                          className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm hover:shadow transition-all"
                        >
                          Seleccionar Carpeta Local
                        </button>
                      </div>
                    ) : (
                      <div className="flex-1 overflow-y-auto max-h-[300px] space-y-1.5 pr-1">
                        {directoryFiles.length === 0 ? (
                          <div className="text-center text-slate-400 py-10 bg-white border border-slate-200 rounded-xl">
                            <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 mb-2 animate-pulse" />
                            <p className="text-xs font-bold">¡Sin comprobantes pendientes!</p>
                            <p className="text-[10px] mt-0.5 text-slate-400">Coloca archivos PNG/JPG/PDF en esta carpeta para verlos aquí.</p>
                          </div>
                        ) : (
                          directoryFiles.map((entry: any) => (
                            <button
                              key={entry.name}
                              onClick={() => handleSelectFileFromBrowserDir(entry)}
                              className={`w-full text-left p-2.5 rounded-lg border text-xs flex items-center justify-between transition-all ${currentFileHandle?.name === entry.name
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-900 font-bold'
                                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                                }`}
                            >
                              <div className="flex items-center space-x-2 truncate">
                                <FileText className="h-4 w-4 text-indigo-500 flex-shrink-0" />
                                <span className="truncate">{entry.name}</span>
                              </div>
                              <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 font-mono">Listo</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                {fileMode === 'server_dir' && (
                  <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 flex flex-col space-y-4 min-h-[250px] animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-slate-600 block">Carpeta de Servidor Local</span>
                        <span className="text-[10px] font-mono text-indigo-600 block">/comprobantes/{activeDiploma}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleSyncGmail}
                          disabled={isSyncingGmail}
                          className="px-2.5 py-1 text-[10px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 rounded-lg border border-indigo-500 shadow-sm transition-all flex items-center gap-1"
                        >
                          {isSyncingGmail ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>Sincronizando...</span>
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-3 w-3" />
                              <span>Sincronizar Gmail ✉️</span>
                            </>
                          )}
                        </button>
                        <button
                          onClick={refreshServerDirectory}
                          className="px-2.5 py-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-100 transition-all flex items-center gap-1"
                        >
                          <RefreshCw className="h-3 w-3" /> Refrescar
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto max-h-[300px] space-y-1.5 pr-1">
                      {serverFiles.length === 0 ? (
                        <div className="text-center text-slate-400 py-10 bg-white border border-dashed border-slate-300 rounded-xl">
                          <Database className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                          <p className="text-xs font-bold text-slate-500">¡Sin archivos en /comprobantes!</p>
                          <p className="text-[10px] mt-0.5 text-slate-400 max-w-[200px] mx-auto">Mueve archivos PNG/JPG/PDF a la carpeta `comprobantes/` en la raíz de tu proyecto para verlos y procesarlos aquí.</p>
                        </div>
                      ) : (
                        serverFiles.map((file: any) => (
                          <button
                            key={file.name}
                            onClick={() => handleSelectFileFromServerDir(file.name)}
                            className={`w-full text-left p-2.5 rounded-lg border text-xs flex items-center justify-between transition-all ${selectedServerFile === file.name
                              ? 'bg-indigo-50 border-indigo-200 text-indigo-900 font-bold'
                              : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                              }`}
                          >
                            <div className="flex items-center space-x-2 truncate">
                              <FileText className="h-4 w-4 text-indigo-500 flex-shrink-0" />
                              <span className="truncate">{file.name}</span>
                            </div>
                            <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/50">{file.size}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Acceso Rápido a Configuración de API Key desde el propio Tab */}
                {!(customApiKey || apiKey) && (
                  <div className="bg-amber-50 border border-amber-200/70 rounded-xl p-4 flex flex-col space-y-3">
                    <div className="flex items-start space-x-2 text-amber-800">
                      <KeyRound className="h-5 w-5 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide">Clave de API Requerida para Escaneo Real</p>
                        <p className="text-xs text-amber-700 mt-0.5">Introduce tu API Key de Gemini a continuación para activar la lectura por Inteligencia Artificial de tus comprobantes.</p>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <input
                        type="password"
                        placeholder="Introduce tu API Key (AIzaSy...)"
                        value={customApiKey}
                        onChange={(e) => setCustomApiKey(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-xs bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Panel de Estado / Extracción */}
              <div className="bg-slate-50 rounded-xl border border-slate-200/70 p-6 flex flex-col justify-center min-h-[300px]">
                {/* 1. Estado inicial vacío */}
                {!selectedOcrFile && !isOcrScanning && !ocrExtractedData && (
                  <div className="text-center text-slate-400 py-12">
                    <HelpCircle className="h-12 w-12 mx-auto text-slate-300 mb-3" />
                    <p className="text-sm font-bold text-slate-500">Esperando comprobante...</p>
                    <p className="text-xs mt-1">Sube un archivo en el panel izquierdo para iniciar el proceso de lectura automatizada.</p>
                  </div>
                )}

                {/* 2. Procesando lectura OCR */}
                {isOcrScanning && (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="relative w-full max-w-sm bg-slate-200 rounded-full h-3.5 overflow-hidden mb-4 border border-slate-300 shadow-inner">
                      <div
                        style={{ width: `${ocrProgress}%` }}
                        className="progress-bar-animated h-full rounded-full transition-all duration-700 ease-out"
                      ></div>
                    </div>
                    <div className="flex items-center space-x-2 text-indigo-600 font-bold text-sm animate-pulse">
                      <Loader2 className="h-4.5 w-4.5 animate-spin" />
                      <span>{ocrStepText}</span>
                    </div>
                    <span className="text-xs text-slate-400 mt-2">Lectura de matriz de píxeles: {ocrProgress}%</span>
                  </div>
                )}

                {/* 3. Datos Extraídos listos para Confirmación */}
                {ocrExtractedData && (
                  <div className="space-y-5 animate-fadeIn">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                      <div>
                        <span className="text-[10px] font-black uppercase text-indigo-600 tracking-wider bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">Vista previa de Extracción</span>
                        <h4 className="text-sm font-black text-slate-700 mt-1 truncate">Archivo: {selectedOcrFile?.name}</h4>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-400">Canal Detectado</span>
                        <p className="font-extrabold text-sm text-slate-700">{ocrExtractedData.banco}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Campo Apellido y Nombre */}
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase text-slate-400 mb-1">Apellido y Nombre (Ordenante)</label>
                        <input
                          type="text"
                          value={ocrExtractedData.apellidoNombre}
                          onChange={(e) => setOcrExtractedData({ ...ocrExtractedData, apellidoNombre: e.target.value })}
                          className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 font-medium"
                          placeholder="Ingresar si el OCR no lo detectó"
                        />
                      </div>

                      {/* Campo DNI */}
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase text-slate-400 mb-1">DNI (Cálculo Automático)</label>
                        <input
                          type="text"
                          value={ocrExtractedData.dni}
                          onChange={(e) => setOcrExtractedData({ ...ocrExtractedData, dni: e.target.value.replace(/\./g, "") })}
                          className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 font-mono font-bold"
                          placeholder="Sin puntos ni guiones"
                        />
                      </div>

                      {/* Campo Banco */}
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase text-slate-400 mb-1">Entidad de Cobro</label>
                        <select
                          value={ocrExtractedData.banco}
                          onChange={(e) => setOcrExtractedData({ ...ocrExtractedData, banco: e.target.value })}
                          className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 font-bold"
                        >
                          <option value="MP">MP (Mercado Pago)</option>
                          <option value="MACRO">MACRO (Banco Macro)</option>
                          <option value="BNA">BNA (Banco Nación)</option>
                          <option value="PERSONAL_PAY">PERSONAL PAY</option>
                          <option value="MODO">MODO</option>
                          <option value="ASTRO_PAY">ASTRO PAY</option>
                          <option value="OTROS">OTROS</option>
                        </select>
                      </div>

                      {/* N° de Operación */}
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase text-slate-400 mb-1">N° Operación</label>
                        <input
                          type="text"
                          value={ocrExtractedData.operacion}
                          onChange={(e) => setOcrExtractedData({ ...ocrExtractedData, operacion: e.target.value })}
                          className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 font-mono font-bold"
                        />
                      </div>

                      {/* Fecha */}
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase text-slate-400 mb-1">Fecha de Pago</label>
                        <input
                          type="date"
                          value={ocrExtractedData.fecha}
                          onChange={(e) => setOcrExtractedData({ ...ocrExtractedData, fecha: e.target.value })}
                          className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 font-bold"
                        />
                      </div>

                      {/* Monto cobrado */}
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase text-slate-400 mb-1">Monto cobrado ($)</label>
                        <input
                          type="number"
                          value={ocrExtractedData.monto}
                          onChange={(e) => setOcrExtractedData({ ...ocrExtractedData, monto: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 font-bold text-slate-800"
                        />
                      </div>

                      {/* Titular de la Cuenta */}
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-extrabold uppercase text-slate-400 mb-1">Titular de Cuenta Origen</label>
                        <input
                          type="text"
                          value={ocrExtractedData.titular}
                          onChange={(e) => setOcrExtractedData({ ...ocrExtractedData, titular: e.target.value })}
                          className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 font-medium"
                          placeholder="No figura (Cajero/Terminal)"
                        />
                      </div>
                    </div>



                    <div className="flex space-x-3 pt-4 border-t border-slate-200">
                      <button
                        onClick={saveOcrToSheet}
                        className="flex-1 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow flex items-center justify-center space-x-1 transition-all"
                      >
                        <Check className="h-4.5 w-4.5" />
                        <span>Confirmar e Importar a Planilla</span>
                      </button>
                      <button
                        onClick={() => {
                          setOcrExtractedData(null);
                          setSelectedOcrFile(null);
                        }}
                        className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-all"
                      >
                        Descartar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 1: Hoja de Cálculo Interactiva */}
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

        {/* Tab 2: Estadísticas y Dashboards */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-fadeIn">

            {/* ── KPI TOP ROW ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: 'Total Recaudado', value: `$ ${stats.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, sub: 'Ingresos consolidados', color: 'indigo', icon: '💰' },
                { label: 'Comprobantes Cargados', value: stats.count.toString(), sub: 'Transacciones procesadas', color: 'sky', icon: '📎' },
                { label: 'Meses con Cobros', value: monthlyData.length.toString(), sub: monthlyData.length > 0 ? `Última actividad: ${monthlyData[monthlyData.length - 1].label}` : 'Sin registros de fecha', color: 'emerald', icon: '📅' },
              ].map(({ label, value, sub, color, icon }) => (
                <div key={label} className={`fintech-card flex flex-col gap-1.5 kpi-glow-${color === 'emerald' ? 'emerald' : color === 'sky' ? 'sky' : 'indigo'}`}>
                  <span className="text-lg">{icon}</span>
                  <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">{label}</span>
                  <span className={`text-xl font-black tabular-nums ${color === 'sky' ? 'text-sky-700' : color === 'emerald' ? 'text-emerald-700' : 'text-indigo-700'
                    }`}>{value}</span>
                  <span className="text-[10px] font-semibold text-slate-400">{sub}</span>
                </div>
              ))}
            </div>

            {/* ── GRÁFICO MENSUAL DE RECAUDACIÓN ── */}
            <div className="fintech-card w-full flex flex-col">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h3 className="font-black text-slate-800 text-base flex items-center gap-2">
                    <span className="h-7 w-7 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center text-sm">📊</span>
                    Recaudación Mensual
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">Evolución de cobros consolidados por mes de operación</p>
                </div>
                {monthlyData.length > 0 && (
                  <div className="text-right">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">Mes de mayor ingreso</span>
                    <span className="text-sm font-black text-indigo-700">
                      {monthlyData.reduce((best, m) => m.total > best.total ? m : best, monthlyData[0]).label}
                    </span>
                  </div>
                )}
              </div>

              {monthlyData.length > 0 ? (
                <div className="flex-1">
                  {/* Barras horizontales por mes */}
                  <div className="space-y-3">
                    {monthlyData.map((m) => {
                      const maxTotal = Math.max(...monthlyData.map(x => x.total)) || 1;
                      const pct = (m.total / maxTotal) * 100;
                      return (
                        <div key={m.key} className="flex items-center gap-4 group">
                          {/* Label mes */}
                          <span className="text-[11px] font-black text-slate-500 w-14 shrink-0 text-right">{m.label}</span>
                          {/* Barra */}
                          <div className="flex-1 h-7 bg-slate-100 rounded-lg overflow-hidden relative">
                            <div
                              style={{ width: `${pct}%` }}
                              className="absolute left-0 top-0 h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-600 transition-all duration-700 ease-out rounded-lg shadow-sm"
                            />
                            {/* Tooltip interno */}
                            <span className="absolute inset-0 flex items-center px-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="text-[10px] font-black text-white drop-shadow">
                                $ {m.total.toLocaleString('es-AR', { minimumFractionDigits: 0 })} &nbsp;·&nbsp; {m.count} transacciones
                              </span>
                            </span>
                          </div>
                          {/* Monto */}
                          <span className="text-[11px] font-black text-slate-700 tabular-nums w-24 shrink-0">
                            $ {m.total.toLocaleString('es-AR', { minimumFractionDigits: 0 })}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100 select-none text-[10px] text-slate-400">
                    <span>Gradiente del volumen mensual</span>
                    <span>Pasa el cursor por las barras para ver la cantidad de transacciones</span>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-12 border-2 border-dashed border-slate-200 rounded-xl">
                  <span className="text-4xl mb-3">📊</span>
                  <p className="text-sm font-bold">Sin datos mensuales aún</p>
                  <p className="text-xs mt-1">Importá comprobantes con fecha para ver este gráfico</p>
                </div>
              )}
            </div>

            {/* ── TABLA MENSUAL DETALLADA ── */}
            {monthlyData.length > 0 && (
              <div className="fintech-card">
                <h3 className="font-black text-slate-800 text-base flex items-center gap-2 mb-4">
                  <span className="h-7 w-7 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center text-sm">📋</span>
                  Detalle por Mes
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200">
                        {['Mes', 'Cobros', 'Total Recaudado', '% del Período Total'].map(h => (
                          <th key={h} className="py-2.5 px-3 text-left text-[10px] font-black uppercase text-slate-400 tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {monthlyData.map((m) => (
                        <tr key={m.key} className="hover:bg-indigo-50/30 transition-colors">
                          <td className="py-2.5 px-3 font-black text-slate-800">{m.label}</td>
                          <td className="py-2.5 px-3 font-bold text-slate-600 tabular-nums">{m.count}</td>
                          <td className="py-2.5 px-3 font-black text-slate-800 tabular-nums">$ {m.total.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-20 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-indigo-500 rounded-full"
                                  style={{ width: `${stats.total > 0 ? (m.total / stats.total) * 100 : 0}%` }}
                                />
                              </div>
                              <span className="font-bold text-slate-600 tabular-nums">
                                {stats.total > 0 ? ((m.total / stats.total) * 100).toFixed(1) : 0}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50">
                        <td className="py-3 px-3 font-black text-slate-800 text-[11px] uppercase tracking-wider">TOTAL</td>
                        <td className="py-3 px-3 font-black text-slate-800 tabular-nums">{stats.count}</td>
                        <td className="py-3 px-3 font-black text-indigo-700 tabular-nums">$ {stats.total.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</td>
                        <td className="py-3 px-3 font-black text-slate-800">100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

          </div>
        )}


        {/* Tab 4: Automatización y Scripts */}
        {activeTab === 'code' && (
          <div className="space-y-6">
            {/* Panel de Configuración de Claves de IA */}
            <div className="fintech-card">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 border-b border-slate-100 pb-4">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                    <KeyRound className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-base">Motores de Inteligencia Artificial (OCR y Auditoría)</h3>
                    <p className="text-xs text-slate-400">Configura tus claves personales de Google Gemini o Anthropic Claude para procesamiento real.</p>
                  </div>
                </div>

                {/* Switcher Rápido en automatización */}
                <div className="bg-slate-100 p-1 rounded-xl border border-slate-200 flex items-center space-x-0.5 select-none">
                  <button
                    onClick={() => setAiProvider('gemini')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${aiProvider === 'gemini'
                      ? 'bg-white text-indigo-950 shadow'
                      : 'text-slate-500 hover:text-slate-800'
                      }`}
                  >
                    ✨ Google Gemini
                  </button>
                  <button
                    onClick={() => setAiProvider('claude')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${aiProvider === 'claude'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-slate-500 hover:text-slate-800'
                      }`}
                  >
                    🚀 Anthropic Claude
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Bloque Google Gemini */}
                <div className={`p-4 rounded-xl border transition-all ${aiProvider === 'gemini' ? 'bg-indigo-50/10 border-indigo-200' : 'bg-slate-50/30 border-slate-200/60'
                  }`}>
                  <h4 className="text-xs font-extrabold uppercase text-slate-500 tracking-wider mb-2 flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block"></span>
                    Configuración de Google Gemini
                  </h4>
                  <p className="text-xs text-slate-400 mb-3">Modelo activo: <strong>gemini-2.5-flash</strong> (Soporta múltiples claves para rotación automática si se satura).</p>

                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="Introduce tus API Keys de Gemini (ej: CLAVE1, CLAVE2)"
                      value={customApiKey}
                      onChange={(e) => setCustomApiKey(e.target.value)}
                      className="flex-1 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono"
                    />
                    <button
                      onClick={() => {
                        setCustomApiKey('');
                        showNotification('Clave API de Gemini restablecida', 'info');
                      }}
                      className="px-2.5 py-2 text-[10px] font-bold text-slate-500 hover:text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-all"
                      title="Limpiar clave"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Bloque Anthropic Claude */}
                <div className={`p-4 rounded-xl border transition-all ${aiProvider === 'claude' ? 'bg-indigo-50/10 border-indigo-200' : 'bg-slate-50/30 border-slate-200/60'
                  }`}>
                  <h4 className="text-xs font-extrabold uppercase text-slate-500 tracking-wider mb-2 flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-indigo-500 inline-block"></span>
                    Configuración de Anthropic Claude
                  </h4>
                  <p className="text-xs text-slate-400 mb-3">Modelo activo: <strong>claude-3-5-sonnet-latest</strong> (OCR premium con velocidad ultrarrápida).</p>

                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="Introduce tu API Key de Anthropic (ej: sk-ant-...)"
                      value={claudeApiKey}
                      onChange={(e) => setClaudeApiKey(e.target.value)}
                      className="flex-1 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono"
                    />
                    <button
                      onClick={() => {
                        setClaudeApiKey('');
                        showNotification('Clave API de Claude restablecida', 'info');
                      }}
                      className="px-2.5 py-2 text-[10px] font-bold text-slate-500 hover:text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-all"
                      title="Limpiar clave"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 mt-4 flex items-center">
                <ShieldAlert className="h-3.5 w-3.5 mr-1.5 text-indigo-500 flex-shrink-0" />
                El extractor cambiará automáticamente de motor basándose en el "Proveedor Activo" seleccionado en las pestañas de Lector OCR y Auditoría.
              </p>
            </div>

          </div>
        )}

      </main>
      {/* Footer del Establecimiento */}
      <footer className="bg-white border-t border-slate-200 py-8 select-none mt-12">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6 text-xs text-slate-400 font-medium tracking-wide">
          <div className="text-center md:text-left">
            <p className="font-extrabold text-slate-700 text-sm tracking-tight">IDeIn Computación</p>
            <p className="mt-1 text-[11px] text-slate-500 font-bold">Leandro N. Alem - Misiones.</p>
          </div>
          <div className="text-center">
            <p className="font-bold text-slate-500">© 2026 Sistema Integrado de Control de Cobros</p>
            <p className="mt-1">Desarrollador: <span className="font-extrabold text-slate-700">Pedro Turcheñuk</span></p>
          </div>
          <div className="text-center md:text-right flex flex-col items-center md:items-end gap-1">
            <p className="font-bold text-slate-500">Contacto Técnico</p>
            <p className="text-[11px]"><span className="text-slate-400">Email:</span> <a href="mailto:ideincom@gmail.com" className="text-indigo-600 font-bold hover:underline">ideincom@gmail.com</a></p>
            <p className="text-[11px]"><span className="text-slate-400">Tel:</span> <a href="tel:+543754406435" className="text-indigo-600 font-bold hover:underline">+54 3754406435</a></p>
          </div>
        </div>
      </footer>

    </div>
  );
}