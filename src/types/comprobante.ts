/**
 * Tipos compartidos para el sistema de control de comprobantes bancarios.
 * Extractor de Comprobantes - IDeIn Computación
 */

// ─── Tipos de Banco ──────────────────────────────────────────────────────────

export type BancoType =
  | 'MP'
  | 'MACRO'
  | 'BNA'
  | 'PERSONAL_PAY'
  | 'MODO'
  | 'ASTRO_PAY'
  | 'OTROS';

export const BANCOS: BancoType[] = [
  'MP',
  'MACRO',
  'BNA',
  'PERSONAL_PAY',
  'MODO',
  'ASTRO_PAY',
  'OTROS',
];

// ─── Datos extraídos de un comprobante bancario ──────────────────────────────

export interface ComprobanteData {
  /** Apellido y Nombre del ordenante. Formato: APELLIDO, NOMBRE */
  apellidoNombre: string;
  /** DNI de 8 dígitos del ordenante (extraído del CUIL/CUIT si es necesario) */
  dni: string;
  /** Entidad bancaria o billetera virtual del pago */
  banco: BancoType;
  /** Número de operación, transacción o comprobante único */
  operacion: string;
  /** Fecha de la operación en formato DD-MM-AAAA */
  fecha: string;
  /** Importe neto transferido como número */
  monto: number;
  /** Titular de la cuenta origen (si figura explícitamente) */
  titular: string;
}

// ─── Registro completo en la planilla diaria ─────────────────────────────────

export interface RegistroComprobante extends ComprobanteData {
  /** ID secuencial en la planilla diaria */
  id: number;
  /** ID en el registro consolidado histórico */
  consolidatedId?: number;
  /** Nombre del archivo renombrado (ej: "1-GARCIA.png") */
  archivoRenombrado?: string;
  /** Data URL del archivo para descarga */
  fileDataUrl?: string;
}

// ─── Estado de la conexión con Gmail API ─────────────────────────────────────

export type GmailConnectionStatus = 'connected' | 'disconnected' | 'loading' | 'error';

export interface GmailStatus {
  status: GmailConnectionStatus;
  email?: string;
  messagesTotal?: number;
  authUrl?: string;
  error?: string;
}

// ─── Estado de la API de Gemini ──────────────────────────────────────────────

export type GeminiApiStatus = 'configured' | 'unconfigured' | 'error' | 'quota_exceeded';

export interface GeminiStatus {
  status: GeminiApiStatus;
  /** Hint de las primeras letras de la clave configurada */
  keyHint?: string;
  activeKeysCount?: number;
  totalKeysCount?: number;
  error?: string;
}

// ─── Resultado de extracción OCR ─────────────────────────────────────────────

export interface OcrResult extends ComprobanteData {
  /** Nombre original del archivo procesado */
  originalName: string;
  /** Extensión original del archivo */
  originalExtension: string;
  /** Data URL del archivo para previsualización */
  fileDataUrl?: string;
}
