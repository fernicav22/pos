import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import { BUSINESS_TZ, getBusinessToday } from '../utils/businessDate';

interface InventoryReportRow {
  product_id: string;
  product_name: string;
  sku: string;
  inicial: number;
  entradas: number;
  devoluciones: number;
  vendido_pos: number;
  mermas: number;
  salidas_internas: number;
  esperado: number;
  surtido: number;
  diferencia: number;
  justificado: number;
  sin_justificar: number;
}

const columns: { key: keyof InventoryReportRow; label: string }[] = [
  { key: 'inicial', label: 'Inicial' },
  { key: 'entradas', label: 'Entradas' },
  { key: 'devoluciones', label: 'Devol.' },
  { key: 'vendido_pos', label: 'Vendido POS' },
  { key: 'mermas', label: 'Mermas' },
  { key: 'salidas_internas', label: 'Salidas int.' },
  { key: 'esperado', label: 'Esperado' },
  { key: 'surtido', label: 'Surtido' },
  { key: 'diferencia', label: 'Diferencia' },
  { key: 'sin_justificar', label: 'Sin justificar' },
];

export default function InventoryReport() {
  const [rows, setRows] = useState<InventoryReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const isMountedRef = useRef(true);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      // Computed in the database from existing data (get_daily_inventory_report); nothing is stored
      const { data, error } = await supabase.rpc('get_daily_inventory_report', {
        p_date: getBusinessToday(),
        p_tz: BUSINESS_TZ,
      });
      if (error) throw error;
      if (isMountedRef.current) setRows((data || []) as InventoryReportRow[]);
    } catch (error) {
      console.error('InventoryReport: error loading report:', error);
      if (isMountedRef.current) toast.error('No se pudo cargar el reporte de inventario');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchReport();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchReport]);

  const unjustified = rows.filter(r => r.sin_justificar !== 0).length;

  return (
    <div className="bg-white shadow rounded-lg">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h2 className="text-lg font-medium text-gray-900">Inventario del día</h2>
          <p className="text-xs text-gray-500">
            Esperado = inicial + entradas + devoluciones − vendido − mermas − salidas internas.
            Diferencia = vendido POS − surtido.
          </p>
        </div>
        <button
          onClick={fetchReport}
          disabled={loading}
          className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200 touch-manipulation disabled:opacity-50"
          aria-label="Actualizar reporte"
        >
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="p-4 space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-14 bg-gray-100 animate-pulse rounded"></div>)}
        </div>
      ) : rows.length === 0 ? (
        <p className="p-4 text-gray-500">Sin movimientos de inventario hoy.</p>
      ) : (
        <>
          {unjustified > 0 && (
            <p className="m-4 text-sm bg-red-50 text-red-800 rounded-lg p-3">
              {unjustified} producto(s) con diferencia sin justificar. Registra el surtido y el motivo en cada nota.
            </p>
          )}

          {/* Mobile: cards */}
          <ul className="divide-y sm:hidden">
            {rows.map(r => (
              <li key={r.product_id} className={`p-4 text-sm ${r.sin_justificar !== 0 ? 'bg-red-50' : ''}`}>
                <p className="font-medium text-gray-900">{r.product_name}</p>
                <p className="text-xs text-gray-500 mb-2">{r.sku}</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {columns.map(c => (
                    <div key={c.key} className="contents">
                      <dt className="text-gray-500">{c.label}</dt>
                      <dd className={`text-right ${c.key === 'sin_justificar' && r.sin_justificar !== 0 ? 'font-semibold text-red-700' : 'text-gray-900'}`}>
                        {r[c.key]}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Producto</th>
                  {columns.map(c => (
                    <th key={c.key} className="px-3 py-2 text-right font-medium text-gray-500 whitespace-nowrap">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {rows.map(r => (
                  <tr key={r.product_id} className={r.sin_justificar !== 0 ? 'bg-red-50' : ''}>
                    <td className="px-3 py-2 text-gray-900">{r.product_name}</td>
                    {columns.map(c => (
                      <td
                        key={c.key}
                        className={`px-3 py-2 text-right ${c.key === 'sin_justificar' && r.sin_justificar !== 0 ? 'font-semibold text-red-700' : 'text-gray-900'}`}
                      >
                        {r[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
