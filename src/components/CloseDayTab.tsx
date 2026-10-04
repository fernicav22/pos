import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';
import { RefreshCw, Lock } from 'lucide-react';
import { useSettingsStore } from '../store/settingsStore';
import { BUSINESS_TZ, getBusinessToday } from '../utils/businessDate';

interface ChecklistItem {
  ok: boolean;
  pendientes?: number;
}

interface Checklist {
  ventas_revisadas: ChecklistItem;
  dinero_conciliado: ChecklistItem;
  material_revisado: ChecklistItem;
  personal_registrado: ChecklistItem;
  diferencias_pendientes: ChecklistItem;
  incidencias_pendientes: ChecklistItem;
}

const checklistLabels: { key: keyof Checklist; label: string }[] = [
  { key: 'ventas_revisadas', label: 'Ventas revisadas' },
  { key: 'dinero_conciliado', label: 'Dinero conciliado' },
  { key: 'material_revisado', label: 'Material revisado (surtido)' },
  { key: 'personal_registrado', label: 'Personal registrado' },
  { key: 'diferencias_pendientes', label: 'Sin diferencias de inventario pendientes' },
  { key: 'incidencias_pendientes', label: 'Sin incidencias pendientes' },
];

interface InventoryRow {
  product_id: string;
  product_name: string;
  sin_justificar: number;
}

interface IncidentRow {
  id: string;
  type: string;
  description: string;
  status: string;
}

interface DailyClosing {
  id: string;
  closing_date: string;
  closed_at: string;
  manager_id: string;
  totals: { sales_count: number; sales_total: number };
  discrepancies: InventoryRow[];
  incidents: IncidentRow[];
  checklist: Checklist;
}

interface CloseDayTabProps {
  canWrite: boolean;
}

export default function CloseDayTab({ canWrite }: CloseDayTabProps) {
  const { formatCurrency } = useSettingsStore();
  const { user } = useAuthStore();
  const [selectedDate, setSelectedDate] = useState(getBusinessToday());
  const [closing, setClosing] = useState<DailyClosing | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [closingInProgress, setClosingInProgress] = useState(false);
  const isMountedRef = useRef(true);

  const fetchState = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const { data: closingRow, error: closingError } = await supabase
        .from('daily_closings')
        .select('id, closing_date, closed_at, manager_id, totals, discrepancies, incidents, checklist')
        .eq('closing_date', date)
        .maybeSingle();
      if (closingError) throw closingError;

      if (closingRow) {
        if (isMountedRef.current) {
          setClosing(closingRow as unknown as DailyClosing);
          setChecklist(null);
        }
        return;
      }

      const { data: checklistData, error: checklistError } = await supabase.rpc('get_daily_closing_checklist', {
        p_date: date,
        p_tz: BUSINESS_TZ,
      });
      if (checklistError) throw checklistError;
      if (isMountedRef.current) {
        setClosing(null);
        setChecklist(checklistData as Checklist | null);
      }
    } catch (error) {
      console.error('CloseDayTab: error loading closing state:', error);
      if (isMountedRef.current) toast.error('No se pudo cargar el estado del día');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchState(selectedDate);
    return () => {
      isMountedRef.current = false;
    };
  }, [selectedDate, fetchState]);

  const handleCloseDay = async () => {
    if (!canWrite || !user || closingInProgress) return;
    setClosingInProgress(true);
    try {
      const { error } = await supabase.rpc('close_day', { p_date: selectedDate, p_tz: BUSINESS_TZ });
      if (error) throw error;
      toast.success('Día cerrado');
      await fetchState(selectedDate);
    } catch (error) {
      console.error('CloseDayTab: error closing day:', error);
      toast.error('No se pudo cerrar el día');
    } finally {
      if (isMountedRef.current) setClosingInProgress(false);
    }
  };

  const pendingWarnings = checklist
    ? checklistLabels.filter(({ key }) => !checklist[key]?.ok)
    : [];

  return (
    <div className="space-y-4">
      <div className="bg-white shadow rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="text-sm text-gray-700">
          Día
          <input
            type="date"
            value={selectedDate}
            max={getBusinessToday()}
            onChange={e => setSelectedDate(e.target.value)}
            className="ml-2 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </label>
        <button
          onClick={() => fetchState(selectedDate)}
          disabled={loading}
          className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200 touch-manipulation disabled:opacity-50 sm:ml-auto"
          aria-label="Actualizar"
        >
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="bg-white shadow rounded-lg p-4 space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-10 bg-gray-100 animate-pulse rounded"></div>)}
        </div>
      ) : closing ? (
        <div className="bg-white shadow rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2 text-gray-900">
            <Lock className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-medium">Día cerrado</h2>
          </div>
          <p className="text-sm text-gray-500">
            Cerrado el {new Date(closing.closed_at).toLocaleString()}. Esta es la foto guardada al momento del cierre,
            no un recálculo en vivo.
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-500">Ventas</dt>
            <dd className="text-gray-900">{closing.totals.sales_count}</dd>
            <dt className="text-gray-500">Total</dt>
            <dd className="text-gray-900">{formatCurrency(closing.totals.sales_total)}</dd>
          </dl>
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-2">Checklist al cierre</h3>
            <ul className="space-y-1 text-sm">
              {checklistLabels.map(({ key, label }) => (
                <li key={key} className={closing.checklist[key]?.ok ? 'text-green-700' : 'text-red-700'}>
                  {closing.checklist[key]?.ok ? '✓' : '✗'} {label}
                  {!closing.checklist[key]?.ok && closing.checklist[key]?.pendientes
                    ? ` (${closing.checklist[key].pendientes})`
                    : ''}
                </li>
              ))}
            </ul>
          </div>
          {closing.discrepancies.filter(d => d.sin_justificar !== 0).length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-2">Diferencias de inventario sin justificar</h3>
              <ul className="text-sm text-gray-700 list-disc list-inside">
                {closing.discrepancies.filter(d => d.sin_justificar !== 0).map(d => (
                  <li key={d.product_id}>{d.product_name}: {d.sin_justificar}</li>
                ))}
              </ul>
            </div>
          )}
          {closing.incidents.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-2">Incidencias del día</h3>
              <ul className="text-sm text-gray-700 list-disc list-inside">
                {closing.incidents.map(i => (
                  <li key={i.id}>{i.type}: {i.description} ({i.status})</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg p-4 space-y-4">
          <h2 className="text-lg font-medium text-gray-900">Checklist de cierre</h2>
          {checklist ? (
            <>
              <ul className="space-y-1 text-sm">
                {checklistLabels.map(({ key, label }) => (
                  <li key={key} className={checklist[key]?.ok ? 'text-green-700' : 'text-red-700'}>
                    {checklist[key]?.ok ? '✓' : '✗'} {label}
                    {!checklist[key]?.ok && checklist[key]?.pendientes ? ` (${checklist[key].pendientes})` : ''}
                  </li>
                ))}
              </ul>
              {pendingWarnings.length > 0 && (
                <p className="text-sm bg-yellow-50 text-yellow-800 rounded-lg p-3">
                  Hay {pendingWarnings.length} punto(s) pendiente(s). Puedes cerrar el día de todas formas; quedarán
                  registrados en el cierre.
                </p>
              )}
              {canWrite ? (
                <button
                  onClick={handleCloseDay}
                  disabled={closingInProgress}
                  className="w-full py-3 rounded-lg bg-red-600 text-white font-medium touch-manipulation disabled:opacity-50"
                >
                  Cerrar día
                </button>
              ) : (
                <p className="text-sm text-gray-500">Solo el gerente puede cerrar el día.</p>
              )}
            </>
          ) : (
            <p className="text-gray-500">Sin datos para este día.</p>
          )}
        </div>
      )}
    </div>
  );
}
