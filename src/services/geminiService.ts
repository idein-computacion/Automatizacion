/**
 * geminiService.ts
 * Servicio para interactuar con la API de Google Gemini (OCR y parsing de comprobantes).
 *
 * SEGURIDAD:
 * - La clave API se lee de import.meta.env.VITE_GEMINI_API_KEY (variable de entorno de Vite)
 * - Se acepta una clave override por parámetro para compatibilidad con la configuración manual
 * - Las claves NUNCA se hardcodean en el código fuente
 *
 * IDeIn Computación - Extractor de Comprobantes
 */

import type { BancoType, ComprobanteData } from '../types/comprobante';

// ─── Constantes ──────────────────────────────────────────────────────────────

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Modelos a intentar en orden de preferencia (del más reciente al más estable) */
const MODEL_PRIORITY = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

// ─── Prompt del sistema para extracción de comprobantes ──────────────────────

const EXTRACTOR_PROMPT = `Analiza de manera experta este comprobante de pago bancario y extrae con máxima precisión los datos estructurados para conciliación de caja.

Reglas de extracción críticas:
1. Identifica el banco emisor: Debe ser 'MP' si es de Mercado Pago, 'MACRO' si es de Banco Macro, 'BNA' si es de Banco Nación, 'PERSONAL_PAY' si es de Personal Pay, 'MODO' si es de MODO, 'ASTRO_PAY' si es de Astro Pay, o 'OTROS' si es otro medio.
2. Identifica el Apellido y Nombre del ordenante si figura. Formatea siempre como: APELLIDO, NOMBRE (en mayúsculas).
3. Si figura un CUIT, CUIL o CUIT/CUIL del remitente (ejemplo: '27-30826835-2' o '20427619053'), extrae exclusivamente la sección de 8 dígitos intermedios correspondiente al DNI del ordenante. Si el banco es MACRO y no figura el DNI, CUIT o CUIL del remitente/ordenante, NO extraigas el CUIT/DNI del destinatario; en ese caso deja el campo "dni" totalmente vacío ("").
4. Obtén el número de operación, transacción, comprobante o ID de transferencia de manera exacta. IMPORTANTE para Banco Macro: El número de operación se encuentra en la cabecera superior al lado de la fecha y hora (ejemplo: '30/05/2026 13:38 1325295412' -> el nro de operación es '1325295412').
5. Obtén la fecha de la operación y conviértela estrictamente al formato: AAAA-MM-DD.
6. Obtén el importe o importe neto transferido como número flotante o entero.
7. Obtén el titular de la cuenta origen si se menciona de forma explícita.

Devuelve EXCLUSIVAMENTE un objeto JSON con el esquema especificado, sin texto adicional.`;

// ─── Schema JSON estricto para la respuesta de Gemini ────────────────────────

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    apellidoNombre: { type: 'STRING', description: 'Apellido y nombre del ordenante. Formato: APELLIDO, NOMBRE' },
    dni: { type: 'STRING', description: 'DNI de 8 dígitos (extraído del CUIL/CUIT si es necesario)' },
    banco: {
      type: 'STRING',
      enum: ['MP', 'MACRO', 'BNA', 'PERSONAL_PAY', 'MODO', 'ASTRO_PAY', 'OTROS'],
      description: 'Entidad bancaria o billetera virtual',
    },
    operacion: { type: 'STRING', description: 'Número de operación, transacción o comprobante único' },
    fecha: { type: 'STRING', description: 'Fecha de la operación en formato AAAA-MM-DD' },
    monto: { type: 'NUMBER', description: 'Importe neto transferido como número' },
    titular: { type: 'STRING', description: 'Titular de la cuenta origen (si figura)' },
  },
  required: ['banco', 'operacion', 'fecha', 'monto'],
};

// ─── Utilidades internas ─────────────────────────────────────────────────────

/**
 * Parsea y valida una lista de claves API desde un string separado por coma, punto y coma o espacios.
 */
function parseApiKeys(keyString: string): string[] {
  return keyString
    .split(/[,;\s]+/)
    .map((k) => k.trim())
    .filter((k) => k.startsWith('AIzaSy'));
}

/**
 * Obtiene las claves de API disponibles.
 * Prioridad: parámetro override → variable de entorno VITE_GEMINI_API_KEY → lanza error.
 */
function resolveApiKeys(overrideKeys?: string): string[] {
  const envKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;

  // 1. Intentar con claves override (ej: ingresadas manualmente en la UI)
  if (overrideKeys) {
    const parsed = parseApiKeys(overrideKeys);
    if (parsed.length > 0) return parsed;
  }

  // 2. Intentar con clave del entorno
  if (envKey) {
    const parsed = parseApiKeys(envKey);
    if (parsed.length > 0) return parsed;
  }

  return [];
}

/**
 * Realiza una llamada a la API de Gemini con backoff exponencial.
 * Rota entre claves disponibles si se produce error 429 (quota exceeded).
 */
async function callGeminiWithRetry(
  payload: object,
  apiKeys: string[],
  model = MODEL_PRIORITY[0]
): Promise<unknown> {
  const url = `${GEMINI_API_BASE}/${model}:generateContent`;

  let lastError: Error | null = null;

  for (let keyIdx = 0; keyIdx < apiKeys.length; keyIdx++) {
    const key = apiKeys[keyIdx];
    let delay = 1000;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`${url}?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          return await response.json();
        }

        if (response.status === 429) {
          // Quota excedida: rotar a la siguiente clave
          console.warn(`[geminiService] Cuota 429 en clave ${key.substring(0, 8)}... Rotando.`);
          lastError = new Error('QUOTA_EXCEEDED');
          break;
        }

        if (response.status >= 500) {
          // Error del servidor: reintentar con backoff
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
          continue;
        }

        // Error del cliente (4xx que no es 429)
        const errBody = await response.json().catch(() => ({}));
        const errMsg = (errBody as { error?: { message?: string } })?.error?.message;
        throw new Error(errMsg || `Error de Gemini API: ${response.status}`);
      } catch (err) {
        if (err instanceof Error && err.message === 'QUOTA_EXCEEDED') break;
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === 1) break;
      }
    }
  }

  throw lastError || new Error('No se pudo conectar con Gemini API.');
}

// ─── API Pública ─────────────────────────────────────────────────────────────

export interface GeminiProcessOptions {
  /** Clave(s) de API override (pueden ser múltiples separadas por coma) */
  apiKeyOverride?: string;
  /** Contexto adicional: asunto del correo */
  emailSubject?: string;
  /** Contexto adicional: cuerpo del correo */
  emailBody?: string;
}

/**
 * Procesa una imagen o PDF de comprobante con Gemini AI.
 * Lee la clave API de import.meta.env.VITE_GEMINI_API_KEY (prioridad) o del override.
 *
 * @param base64Data - Contenido del archivo en Base64 (sin prefijo data:...)
 * @param mimeType - MIME type del archivo (ej: "image/jpeg", "application/pdf")
 * @param options - Opciones adicionales (override de clave, contexto del email)
 * @returns Datos estructurados del comprobante
 */
export async function processComprobanteWithGemini(
  base64Data: string,
  mimeType: string,
  options: GeminiProcessOptions = {}
): Promise<ComprobanteData> {
  const apiKeys = resolveApiKeys(options.apiKeyOverride);

  if (apiKeys.length === 0) {
    throw new Error(
      'API_KEY_EMPTY: No hay clave de Gemini configurada. ' +
      'Agrega VITE_GEMINI_API_KEY en tu archivo .env.local o configúrala en la sección de Automatizar.'
    );
  }

  // Construir el prompt con contexto del email si está disponible
  let fullPrompt = EXTRACTOR_PROMPT;
  if (options.emailSubject || options.emailBody) {
    fullPrompt += `\n\nCONTEXTO DEL CORREO:\nAsunto: "${options.emailSubject || ''}"\nCuerpo: "${options.emailBody || ''}"`;
  }

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: fullPrompt },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.1, // Baja temperatura para respuestas más deterministas
    },
  };

  // Intentar con cada modelo en orden de prioridad
  let lastModelError: Error | null = null;
  for (const model of MODEL_PRIORITY) {
    try {
      const result = await callGeminiWithRetry(payload, apiKeys, model);
      const text = (result as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
        ?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) throw new Error('Respuesta vacía de Gemini.');

      // Limpiar posibles bloques markdown en la respuesta
      const cleanText = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const data = JSON.parse(cleanText) as Partial<ComprobanteData>;

      // Normalizar y validar los datos extraídos
      return {
        apellidoNombre: data.apellidoNombre || '',
        dni: (data.dni || '').replace(/\./g, ''),
        banco: (data.banco as BancoType) || 'OTROS',
        operacion: data.operacion || '',
        fecha: data.fecha || '',
        monto: typeof data.monto === 'number' ? data.monto : parseFloat(String(data.monto || '0')) || 0,
        titular: data.titular || '',
      };
    } catch (err) {
      lastModelError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[geminiService] Error con modelo ${model}:`, lastModelError.message);
      // Continuar al siguiente modelo
    }
  }

  throw lastModelError || new Error('No se pudo extraer datos con Gemini.');
}

/**
 * Verifica el estado de configuración de la API de Gemini.
 */
export function getGeminiConfigStatus(apiKeyOverride?: string): {
  isConfigured: boolean;
  keyHint: string | null;
  keyCount: number;
  source: 'env' | 'manual' | 'none';
} {
  const envKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;

  // Verificar claves manuales override
  if (apiKeyOverride) {
    const keys = parseApiKeys(apiKeyOverride);
    if (keys.length > 0) {
      return {
        isConfigured: true,
        keyHint: keys[0].substring(0, 8) + '...',
        keyCount: keys.length,
        source: 'manual',
      };
    }
  }

  // Verificar variable de entorno
  if (envKey) {
    const keys = parseApiKeys(envKey);
    if (keys.length > 0) {
      return {
        isConfigured: true,
        keyHint: keys[0].substring(0, 8) + '...',
        keyCount: keys.length,
        source: 'env',
      };
    }
  }

  return {
    isConfigured: false,
    keyHint: null,
    keyCount: 0,
    source: 'none',
  };
}
