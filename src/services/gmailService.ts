/**
 * gmailService.ts
 * Servicio para interactuar con el backend Express que maneja la Gmail API.
 *
 * Todas las llamadas se hacen al backend local (/api/*) que gestiona:
 * - Autenticación OAuth 2.0 con Google
 * - Lectura de correos con comprobantes
 * - Extracción y procesamiento de archivos adjuntos
 *
 * IDeIn Computación - Extractor de Comprobantes
 */

import type { GmailStatus } from '../types/comprobante';

// ─── Tipos internos ──────────────────────────────────────────────────────────

export interface ExtractionStatus {
  isRunning: boolean;
  processed: number;
  total: number;
  lastError?: string;
}

export interface SyncGmailResult {
  success: boolean;
  processedCount: number;
  message: string;
  email?: string;
}

/** Evento cuando empieza a procesarse un correo */
export interface SyncEmailStartEvent {
  emailId: string;
  subject: string;
  index: number;
  hasAttachments: boolean;
}

/** Evento cuando un correo es omitido (sin datos válidos, duplicado, sin adjunto, etc.) */
export interface SyncEmailSkipEvent {
  emailId: string;
  subject: string;
  reason: string;
  index: number;
  filename?: string;
}

/** Evento cuando se extrae correctamente un registro válido */
export interface SyncRowExtractedEvent {
  row: string[];
  recordNumber: number;
  savedFilename: string | null;
  folderName: string;
  subject: string;
  emailId: string;
  index: number;
  nombre: string;
  monto: string;
  banco: string;
  operacion: string;
  fecha: string;
}

/** Evento de progreso numérico */
export interface SyncProgressEvent {
  current: number;
  total: number;
  folderName: string;
}

/** Evento emitido al iniciar la sincronización */
export interface SyncStartEvent {
  folderName: string;
  targetDir: string;
  activeEmail: string;
  targetLimit: number;
}

/** Evento emitido al finalizar la sincronización */
export interface SyncDoneEvent {
  validCount: number;
  totalScanned: number;
  folderName: string;
  stopped?: boolean;
  error?: string;
}

export interface SyncStreamCallbacks {
  onEmailStart?: (data: SyncEmailStartEvent) => void;
  onEmailSkip?: (data: SyncEmailSkipEvent) => void;
  onRowExtracted?: (data: SyncRowExtractedEvent) => void;
  onSyncProgress?: (data: SyncProgressEvent) => void;
  onSyncStart?: (data: SyncStartEvent) => void;
  onSyncDone?: (data: SyncDoneEvent) => void;
  onBatchCompleted?: (data: unknown) => void;
}

// ─── Funciones de conexión ────────────────────────────────────────────────────

/**
 * Verifica el estado de la cuenta de Gmail conectada al backend.
 * Llama a GET /api/account en el servidor Express.
 */
export async function getGmailAccountStatus(): Promise<GmailStatus> {
  try {
    const response = await fetch('/api/account', {
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return { status: 'error', error: `Error del servidor: ${response.status}` };
    }

    const data = await response.json() as {
      connected: boolean;
      email?: string;
      messagesTotal?: number;
      authUrl?: string;
      error?: string;
    };

    if (data.connected) {
      return {
        status: 'connected',
        email: data.email,
        messagesTotal: data.messagesTotal,
      };
    } else {
      return {
        status: 'disconnected',
        authUrl: data.authUrl,
        error: data.error,
      };
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { status: 'error', error: 'El servidor backend no responde (timeout)' };
    }
    return {
      status: 'error',
      error: 'No se pudo conectar con el servidor backend. ¿Está corriendo en puerto 3000?',
    };
  }
}

/**
 * Obtiene la URL de autorización OAuth de Google para conectar una cuenta de Gmail.
 */
export async function getGmailAuthUrl(): Promise<string | null> {
  try {
    const response = await fetch('/api/auth-url');
    if (!response.ok) return null;
    const data = await response.json() as { authUrl?: string };
    return data.authUrl || null;
  } catch {
    return null;
  }
}

// ─── Control de extracción ────────────────────────────────────────────────────

/**
 * Inicia la extracción de comprobantes desde Gmail (procesa hasta 15 correos).
 */
export async function startGmailExtraction(): Promise<{
  success: boolean;
  status: string;
  authUrl?: string;
  error?: string;
}> {
  try {
    const response = await fetch('/api/start');
    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { error?: string };
      return { success: false, status: 'error', error: err.error || `Error: ${response.status}` };
    }
    const data = await response.json() as {
      status: string;
      authUrl?: string;
    };
    return {
      success: data.status === 'started' || data.status === 'already running',
      status: data.status,
      authUrl: data.authUrl,
    };
  } catch (err) {
    return {
      success: false,
      status: 'error',
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

/**
 * Detiene la extracción en curso.
 */
export async function stopGmailExtraction(): Promise<void> {
  try {
    await fetch('/api/stop');
  } catch {
    // Ignorar errores al detener
  }
}

/**
 * Obtiene el estado actual del proceso de extracción.
 */
export async function getExtractionStatus(): Promise<ExtractionStatus> {
  try {
    const response = await fetch('/api/status');
    if (!response.ok) return { isRunning: false, processed: 0, total: 0 };
    return await response.json() as ExtractionStatus;
  } catch {
    return { isRunning: false, processed: 0, total: 0 };
  }
}

/**
 * Sincroniza correos de Gmail para una gestión/diploma específica.
 * Descarga comprobantes adjuntos al directorio del servidor.
 *
 * @param diploma - Nombre de la gestión activa (ej: "DUELO", "DANZA")
 */
export async function syncGmailForDiploma(diploma: string): Promise<SyncGmailResult> {
  try {
    const response = await fetch(`/api/sync-gmail?diploma=${encodeURIComponent(diploma)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(errData.error || `Error del servidor: ${response.status}`);
    }

    const data = await response.json() as { success: boolean; message?: string; email?: string; error?: string };

    if (data.success) {
      return {
        success: true,
        processedCount: 0, // el conteo real llega por SSE
        message: data.message || 'Sincronización iniciada.',
        email: data.email,
      };
    } else {
      throw new Error(data.error || 'Sincronización fallida sin mensaje de error.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido en sincronización';
    return { success: false, processedCount: 0, message: msg };
  }
}

// ─── Server-Side Event Streaming ─────────────────────────────────────────────

/**
 * Conecta al stream SSE del servidor para recibir actualizaciones en tiempo real
 * de la extracción de Gmail email por email.
 *
 * @param callbacks - Objeto con handlers para cada tipo de evento
 * @returns Función para cerrar la conexión SSE
 */
export function subscribeToExtractionStream(callbacks: SyncStreamCallbacks): () => void {
  const eventSource = new EventSource('/api/stream');

  const safe = <T>(fn?: (data: T) => void) => (event: Event) => {
    if (!fn) return;
    try {
      const data = JSON.parse((event as MessageEvent).data as string) as T;
      fn(data);
    } catch {
      // Ignorar mensajes malformados
    }
  };

  // Evento legacy: mensaje plano (row_extracted en versiones anteriores)
  eventSource.addEventListener('message', safe<SyncRowExtractedEvent>(callbacks.onRowExtracted));

  // Nuevos eventos granulares
  eventSource.addEventListener('row_extracted',   safe<SyncRowExtractedEvent>(callbacks.onRowExtracted));
  eventSource.addEventListener('email_start',      safe<SyncEmailStartEvent>(callbacks.onEmailStart));
  eventSource.addEventListener('email_skip',       safe<SyncEmailSkipEvent>(callbacks.onEmailSkip));
  eventSource.addEventListener('sync_progress',    safe<SyncProgressEvent>(callbacks.onSyncProgress));
  eventSource.addEventListener('sync_start',       safe<SyncStartEvent>(callbacks.onSyncStart));
  eventSource.addEventListener('sync_done',        safe<SyncDoneEvent>(callbacks.onSyncDone));
  eventSource.addEventListener('batch_completed',  safe(callbacks.onBatchCompleted));

  eventSource.addEventListener('error', () => {
    eventSource.close();
  });

  return () => eventSource.close();
}
