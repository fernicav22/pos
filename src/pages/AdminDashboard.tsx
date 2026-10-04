import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useSettingsStore } from '../store/settingsStore';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import CloseDayTab from '../components/CloseDayTab';
import { BUSINESS_TZ, getBusinessToday } from '../utils/businessDate';

interface CashSummary {
  sales_count: number;
  sales_total: number;
  descuentos: number;
}

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

interface UnjustifiedRow {
  product_id: string;
  product_name: string;
  sin_justificar: number;
}

interface DiscountSale {
  id: string;
  total: number;
  discount: number;
  created_at: string;
}

interface NoNoteExit {
  id: string;
  product_id: string;
  quantity: number;
  notes: string | null;
  created_at: string;
}

interface AfterClosingSale {
  sale_id: string;
  sale_created_at: string;
  closing_date: string;
  closed_at: string;
}

export default function AdminDashboard() {
  const { formatCurrency } = useSettingsStore();
  const [loading, setLoading] = useState(true);
  const [cash, setCash] = useState<CashSummary | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [unjustified, setUnjustified] = useState<UnjustifiedRow[]>([]);
  const [discountSales, setDiscountSales] = useState<DiscountSale[]>([]);
  const [noNoteExits, setNoNoteExits] = useState<NoNoteExit[]>([]);
  const [afterClosing, setAfterClosing] = useState<AfterClosingSale[]>([]);
  const isMountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const today = getBusinessToday();
      const [cashRes, checklistRes, inventoryRes, discountRes, noteRes, afterRes] = await Promise.all([
        supabase.rpc('get_daily_cash_summary', { p_date: today, p_tz: BUSINESS_TZ }),
        supabase.rpc('get_daily_closing_checklist', { p_date: today, p_tz: BUSINESS_TZ }),
        supabase.rpc('get_daily_inventory_report', { p_date: today, p_tz: BUSINESS_TZ }),
        supabase.from('sales').select('id, total, discount, created_at').gt('discount', 0).order('created_at', { ascending: false }).limit(20),
        supabase.from('inventory_discrepancies').select('id, product_id, quantity, notes, created_at').eq('reason', 'salida_sin_nota').order('created_at', { ascending: false }).limit(20),
        supabase.rpc('get_sales_after_closing', { p_tz: BUSINESS_TZ }),
      ]);

      const errors = [cashRes.error, checklistRes.error, inventoryRes.error, discountRes.error, noteRes.error, afterRes.error].filter(Boolean);
      if (errors.length > 0) {
        console.error('AdminDashboard: error loading data:', errors);
        if (isMountedRef.current) toast.error('Algunos datos del panel no se pudieron cargar');
      }

      if (isMountedRef.current) {
        setCash((cashRes.data as CashSummary | null) ?? null);
        setChecklist((checklistRes.data as Checklist | null) ?? null);
        setUnjustified(((inventoryRes.data || []) as UnjustifiedRow[]).filter(r => r.sin_justificar !== 0));
        setDiscountSales((discountRes.data || []) as DiscountSale[]);
        setNoNoteExits((noteRes.data || []) as NoNoteExit[]);
        setAfterClosing((afterRes.data || []) as AfterClosingSale[]);
      }
    } catch (error) {
      console.error('AdminDashboard: unexpected error loading data:', error);
      if (isMountedRef.current) toast.error('No se pudo cargar el panel de administración');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchAll();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchAll]);

  const alerts = [
    { key: 'stock', label: 'Falta de inventario', count: unjustified.length, active: unjustified.length > 0 },
    { key: 'money', label: 'Falta de dinero (caja sin conciliar)', count: checklist && !checklist.dinero_conciliado.ok ? 1 : 0, active: !!checklist && !checklist.dinero_conciliado.ok },
    { key: 'notes', label: 'Salidas sin nota', count: noNoteExits.length, active: noNoteExits.length > 0 },
    { key: 'discount', label: 'Ventas con descuento', count: discountSales.length, active: discountSales.length > 0 },
    { key: 'after', label: 'Venta después del cierre', count: afterClosing.length, active: afterClosing.length > 0 },
  ];
  const activeAlerts = alerts.filter(a => a.active);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Administración</h1>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200 touch-manipulation disabled:opacity-50"
          aria-label="Actualizar"
        >
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Normal results */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="bg-white shadow rounded-lg p-4">
          <p className="text-xs sm:text-sm font-medium text-gray-500">Ventas hoy</p>
          <p className="mt-1 text-lg sm:text-2xl font-semibold text-gray-900">{loading ? '…' : cash?.sales_count ?? 0}</p>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <p className="text-xs sm:text-sm font-medium text-gray-500">Total hoy</p>
          <p className="mt-1 text-lg sm:text-2xl font-semibold text-gray-900">{loading ? '…' : formatCurrency(cash?.sales_total ?? 0)}</p>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <p className="text-xs sm:text-sm font-medium text-gray-500">Verificaciones pendientes</p>
          <p className="mt-1 text-lg sm:text-2xl font-semibold text-gray-900">{loading ? '…' : checklist?.ventas_revisadas.pendientes ?? 0}</p>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <p className="text-xs sm:text-sm font-medium text-gray-500">Surtido pendiente</p>
          <p className="mt-1 text-lg sm:text-2xl font-semibold text-gray-900">{loading ? '…' : checklist?.material_revisado.pendientes ?? 0}</p>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <p className="text-xs sm:text-sm font-medium text-gray-500">Personal sin registrar</p>
          <p className="mt-1 text-lg sm:text-2xl font-semibold text-gray-900">{loading ? '…' : checklist?.personal_registrado.pendientes ?? 0}</p>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <p className="text-xs sm:text-sm font-medium text-gray-500">Incidencias pendientes</p>
          <p className="mt-1 text-lg sm:text-2xl font-semibold text-gray-900">{loading ? '…' : checklist?.incidencias_pendientes.pendientes ?? 0}</p>
        </div>
      </div>

      {/* Alerts */}
      <div className="bg-white shadow rounded-lg">
        <h2 className="text-lg font-medium text-gray-900 p-4 border-b">Alertas</h2>
        {loading ? (
          <div className="p-4 space-y-3">{[0, 1].map(i => <div key={i} className="h-10 bg-gray-100 animate-pulse rounded"></div>)}</div>
        ) : activeAlerts.length === 0 ? (
          <p className="p-4 text-gray-500">Sin alertas activas.</p>
        ) : (
          <ul className="divide-y">
            {activeAlerts.map(a => (
              <li key={a.key} className="p-4 flex items-center gap-3 text-sm">
                <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                <span className="text-gray-900 font-medium">{a.label}</span>
                <span className="ml-auto px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-800">{a.count}</span>
              </li>
            ))}
          </ul>
        )}

        {discountSales.length > 0 && (
          <div className="p-4 border-t">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Ventas con descuento (recientes)</h3>
            <ul className="text-sm text-gray-700 space-y-1">
              {discountSales.map(s => (
                <li key={s.id}>#{s.id.slice(0, 8)} · descuento {formatCurrency(s.discount)} · total {formatCurrency(s.total)}</li>
              ))}
            </ul>
          </div>
        )}

        {noNoteExits.length > 0 && (
          <div className="p-4 border-t">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Salidas sin nota (recientes)</h3>
            <ul className="text-sm text-gray-700 space-y-1">
              {noNoteExits.map(e => (
                <li key={e.id}>{new Date(e.created_at).toLocaleString()} · cantidad {e.quantity}{e.notes ? ` · ${e.notes}` : ''}</li>
              ))}
            </ul>
          </div>
        )}

        {afterClosing.length > 0 && (
          <div className="p-4 border-t">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Ventas después del cierre</h3>
            <ul className="text-sm text-gray-700 space-y-1">
              {afterClosing.map(s => (
                <li key={s.sale_id}>
                  #{s.sale_id.slice(0, 8)} · venta {new Date(s.sale_created_at).toLocaleString()} · cierre del {s.closing_date} a las{' '}
                  {new Date(s.closed_at).toLocaleTimeString()}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Each day's closing status with its snapshot - admin is read-only (canWrite=false) */}
      <div>
        <h2 className="text-lg font-medium text-gray-900 mb-3">Estado de cierre por día</h2>
        <CloseDayTab canWrite={false} />
      </div>
    </div>
  );
}
