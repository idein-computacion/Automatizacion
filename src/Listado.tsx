/**
 * Listado.tsx
 * Componente de planilla diaria de comprobantes (tabla interactiva).
 *
 * IDeIn Computación - Extractor de Comprobantes
 *
 * NOTA: Este es un componente stub. Reemplazar con la implementación completa
 * de la planilla de registros con edición inline, filtros y exportación.
 */

import React, { useState } from 'react';
import type { RegistroComprobante } from './types/comprobante';

// ─── Tipos exportados (compatibles con Extractor.tsx) ────────────────────────

/**
 * Formatea un número de operación: elimina espacios y caracteres no numéricos.
 */
export function formatOperationNumber(op: string | number | null | undefined): string {
  if (!op) return '';
  return String(op).replace(/\s+/g, '').replace(/[^0-9]/g, '');
}

/**
 * Convierte una fecha al formato DD-MM-AAAA.
 * Soporta formatos: AAAA-MM-DD, DD/MM/AAAA, DD-MM-AAAA.
 */
export function formatToDdMmYyyy(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const clean = String(dateStr).trim();

  // Ya está en formato DD-MM-AAAA
  if (/^\d{2}-\d{2}-\d{4}$/.test(clean)) return clean;

  // Formato AAAA-MM-DD (ISO)
  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;

  // Formato DD/MM/AAAA
  const slashMatch = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) return `${slashMatch[1]}-${slashMatch[2]}-${slashMatch[3]}`;

  return clean;
}

/**
 * Obtiene la fecha actual en formato DD-MM-AAAA.
 */
export function getCurrentFormattedDate(): string {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const y = String(now.getFullYear());
  return `${d}-${m}-${y}`;
}

// ─── Props del componente ─────────────────────────────────────────────────────

interface ListadoProps {
  records: RegistroComprobante[];
  setRecords: (records: RegistroComprobante[]) => void;
  showNotification: (message: string, type?: string) => void;
  activeDiploma: string;
  onlyMissingData: boolean;
  setOnlyMissingData: (value: boolean) => void;
}

// ─── Componente Listado ───────────────────────────────────────────────────────

export default function Listado({
  records,
  setRecords,
  showNotification,
  activeDiploma,
  onlyMissingData,
  setOnlyMissingData,
}: ListadoProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = records.filter((r) => {
    const q = searchQuery.toLowerCase();
    if (onlyMissingData && r.apellidoNombre && r.dni) return false;
    if (!q) return true;
    return (
      r.apellidoNombre?.toLowerCase().includes(q) ||
      r.dni?.includes(q) ||
      r.operacion?.includes(q)
    );
  });

  const handleDelete = (id: number) => {
    setRecords(records.filter((r) => r.id !== id));
    showNotification('Registro eliminado', 'info');
  };

  return (
    <div className="fintech-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-slate-100">
        <div>
          <h2 className="text-base font-black text-slate-800">
            Planilla Diaria — {activeDiploma}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {records.length} comprobante{records.length !== 1 ? 's' : ''} cargado{records.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Buscar..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:outline-none w-48"
          />
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyMissingData}
              onChange={(e) => setOnlyMissingData(e.target.checked)}
              className="accent-indigo-600"
            />
            Solo incompletos
          </label>
        </div>
      </div>

      {/* Tabla */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <span className="text-3xl mb-3">📋</span>
          <p className="text-sm font-bold">Sin registros</p>
          <p className="text-xs mt-1">
            {records.length === 0
              ? 'Usa el Lector OCR para importar comprobantes'
              : 'No hay resultados para la búsqueda actual'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {['#', 'Apellido y Nombre', 'DNI', 'Banco', 'Operación', 'Fecha', 'Monto', ''].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left text-[10px] font-black uppercase text-slate-400 tracking-wider whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((rec) => (
                <tr key={rec.id} className="hover:bg-indigo-50/20 transition-colors">
                  <td className="px-3 py-2.5 font-bold text-slate-400 tabular-nums">{rec.id}</td>
                  <td className="px-3 py-2.5 font-semibold text-slate-800 max-w-[180px] truncate">
                    {rec.apellidoNombre || (
                      <span className="text-rose-400 italic">Sin nombre</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-600">
                    {rec.dni || <span className="text-rose-400 italic">Sin DNI</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {rec.banco}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-600 tabular-nums">{rec.operacion}</td>
                  <td className="px-3 py-2.5 text-slate-600 tabular-nums">{rec.fecha}</td>
                  <td className="px-3 py-2.5 font-black text-slate-800 tabular-nums">
                    ${rec.monto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => handleDelete(rec.id)}
                      className="text-rose-400 hover:text-rose-600 transition-colors p-1"
                      title="Eliminar"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
