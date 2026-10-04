import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useSettingsStore } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { roundCurrency } from '../utils/currency';
import { X, CheckCircle, Edit3, RefreshCw } from 'lucide-react';
import FulfillmentForm, { StaffMember } from '../components/FulfillmentForm';
import InventoryReport from '../components/InventoryReport';
import CashTab from '../components/CashTab';
import IncidentsTab from '../components/IncidentsTab';
import CloseDayTab from '../components/CloseDayTab';

// Higher than the Transactions page limit because the day's summary is computed from this list
const SALES_LIMIT = 500;

type VerificationStatus = 'pendiente' | 'verificada' | 'ajustada';

interface DaySale {
  id: string;
  created_at: string;
  total: number;
  subtotal: number;
  tax: number;
  discount: number;
  payment_method: string;
  payment_status: string;
  user_id: string;
  user: { first_name: string; last_name: string } | null;
  customer: { first_name: string; last_name: string } | null;
}

interface SaleItemDetail {
  id: string;
  product_id: string;
  quantity: number;
  price: number;
  subtotal: number;
  discount: number;
  product: { name: string; sku: string } | null;
}

interface SaleAdjustment {
  id: string;
  field: string;
  original_value: string | null;
  new_value: string | null;
  reason: string;
  created_at: string;
  user: { first_name: string; last_name: string } | null;
}

interface DayCounts {
  discrepancies: number;
  incidents: number;
  closedAt: string | null;
}

interface AdjustField {
  key: string;
  label: string;
  original: string;
}

const paymentLabels: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  other: 'Otro / Transferencia',
};

const statusStyles: Record<VerificationStatus, string> = {
  pendiente: 'bg-yellow-100 text-yellow-800',
  verificada: 'bg-green-100 text-green-800',
  ajustada: 'bg-blue-100 text-blue-800',
};

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const localDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  return { start: start.toISOString(), end: end.toISOString(), localDate };
}

function personName(p: { first_name: string; last_name: string } | null, fallback: string) {
  return p ? `${p.first_name} ${p.last_name}`.trim() : fallback;
}

function ManagerDashboard() {
  const { formatCurrency } = useSettingsStore();
  const { user } = useAuthStore();
  const canWrite = user?.role === 'manager'; // admin is read-only (RLS: only manager can write)

  const [sales, setSales] = useState<DaySale[]>([]);
  const [verifications, setVerifications] = useState<Record<string, VerificationStatus>>({});
  const [counts, setCounts] = useState<DayCounts>({ discrepancies: 0, incidents: 0, closedAt: null });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'notas' | 'inventario' | 'caja' | 'incidencias' | 'cierre'>('notas');
  const [staff, setStaff] = useState<StaffMember[]>([]);

  const [selectedSale, setSelectedSale] = useState<DaySale | null>(null);
  const [items, setItems] = useState<SaleItemDetail[]>([]);
  const [adjustments, setAdjustments] = useState<SaleAdjustment[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [adjusting, setAdjusting] = useState(false);
  const [adjustFieldKey, setAdjustFieldKey] = useState('');
  const [adjustNewValue, setAdjustNewValue] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [saving, setSaving] = useState(false);

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchDay = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    const { start, end, localDate } = getTodayRange();

    setLoading(true);
    try {
      const { data: salesData, error: salesError } = await supabase
        .from('sales')
        .select(`
          id, created_at, total, subtotal, tax, discount, payment_method, payment_status, user_id,
          user:users(first_name, last_name),
          customer:customers(first_name, last_name)
        `)
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: false })
        .limit(SALES_LIMIT)
        .abortSignal(signal);

      if (salesError) throw salesError;
      const daySales = (salesData || []) as unknown as DaySale[];
      const saleIds = daySales.map(s => s.id);

      const [verifRes, discRes, incRes, closingRes] = await Promise.all([
        saleIds.length > 0
          ? supabase.from('sale_verifications').select('sale_id, status').in('sale_id', saleIds).abortSignal(signal)
          : Promise.resolve({ data: [], error: null }),
        supabase.from('inventory_discrepancies').select('id', { count: 'exact', head: true })
          .gte('created_at', start).lt('created_at', end).abortSignal(signal),
        supabase.from('incidents').select('id', { count: 'exact', head: true })
          .gte('created_at', start).lt('created_at', end).abortSignal(signal),
        supabase.from('daily_closings').select('closed_at').eq('closing_date', localDate).abortSignal(signal).maybeSingle(),
      ]);

      const managerErrors = [verifRes.error, discRes.error, incRes.error, closingRes.error].filter(Boolean);
      if (managerErrors.length > 0) {
        console.error('ManagerDashboard: error loading manager tables:', managerErrors);
        if (isMountedRef.current) {
          toast.error('No se pudieron cargar los datos de control del gerente');
        }
      }

      const verifMap: Record<string, VerificationStatus> = {};
      for (const v of (verifRes.data || []) as { sale_id: string; status: VerificationStatus }[]) {
        verifMap[v.sale_id] = v.status;
      }

      if (isMountedRef.current) {
        setSales(daySales);
        setVerifications(verifMap);
        setCounts({
          discrepancies: discRes.count ?? 0,
          incidents: incRes.count ?? 0,
          closedAt: (closingRes.data as { closed_at: string } | null)?.closed_at ?? null,
        });
        if (daySales.length === SALES_LIMIT) {
          toast.error(`Se muestran solo las primeras ${SALES_LIMIT} notas del día`);
        }
      }
    } catch (error) {
      // Supabase errors are plain objects, not Error instances — match Transactions.tsx by name
      if ((error as { name?: string } | null)?.name === 'AbortError') return;
      console.error('ManagerDashboard: error loading sales:', error);
      if (isMountedRef.current) {
        toast.error('No se pudieron cargar las notas del día');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchDay();
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchDay]);

  // users RLS hides other staff from managers; get_staff_directory exposes only id/name/role
  useEffect(() => {
    supabase.rpc('get_staff_directory').then(({ data, error }) => {
      if (error) {
        console.error('ManagerDashboard: error loading staff directory:', error);
        return;
      }
      if (isMountedRef.current) setStaff((data || []) as StaffMember[]);
    });
  }, []);

  const sellerName = (sale: DaySale) => {
    if (sale.user) return personName(sale.user, '—');
    const member = staff.find(s => s.id === sale.user_id);
    return personName(member ?? null, '—');
  };

  const statusOf = useCallback(
    (saleId: string): VerificationStatus => verifications[saleId] ?? 'pendiente',
    [verifications]
  );

  const summary = useMemo(() => {
    const completed = sales.filter(s => s.payment_status === 'completed');
    const sum = (list: DaySale[]) => roundCurrency(list.reduce((acc, s) => acc + (Number(s.total) || 0), 0));
    return {
      total: sum(completed),
      count: sales.length,
      cash: sum(completed.filter(s => s.payment_method === 'cash')),
      nonCash: sum(completed.filter(s => s.payment_method !== 'cash')),
      pending: sales.filter(s => statusOf(s.id) === 'pendiente').length,
    };
  }, [sales, statusOf]);

  const summaryCards = [
    { name: 'Ventas', value: formatCurrency(summary.total) },
    { name: 'Notas', value: summary.count },
    { name: 'Efectivo', value: formatCurrency(summary.cash) },
    { name: 'Tarjeta / Transferencia', value: formatCurrency(summary.nonCash) },
    { name: 'Pendientes', value: summary.pending },
    { name: 'Diferencias inventario', value: counts.discrepancies },
    { name: 'Incidencias', value: counts.incidents },
    {
      name: 'Cierre',
      value: counts.closedAt
        ? `Cerrado ${new Date(counts.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : 'Abierto',
    },
  ];

  const openSale = async (sale: DaySale) => {
    setSelectedSale(sale);
    setItems([]);
    setAdjustments([]);
    setAdjusting(false);
    setDetailLoading(true);
    try {
      const [itemsRes, adjRes] = await Promise.all([
        supabase
          .from('sale_items')
          .select('id, product_id, quantity, price, subtotal, discount, product:products(name, sku)')
          .eq('sale_id', sale.id),
        supabase
          .from('sale_adjustments')
          .select('id, field, original_value, new_value, reason, created_at, user:users(first_name, last_name)')
          .eq('sale_id', sale.id)
          .order('created_at', { ascending: true }),
      ]);
      if (itemsRes.error) throw itemsRes.error;
      if (adjRes.error) throw adjRes.error;
      if (isMountedRef.current) {
        setItems((itemsRes.data || []) as unknown as SaleItemDetail[]);
        setAdjustments((adjRes.data || []) as unknown as SaleAdjustment[]);
      }
    } catch (error) {
      console.error('ManagerDashboard: error loading sale detail:', error);
      if (isMountedRef.current) {
        toast.error('No se pudo cargar el detalle de la nota');
      }
    } finally {
      if (isMountedRef.current) {
        setDetailLoading(false);
      }
    }
  };

  const closeSale = () => {
    setSelectedSale(null);
    setAdjusting(false);
  };

  const adjustFields: AdjustField[] = useMemo(() => {
    if (!selectedSale) return [];
    const fields: AdjustField[] = [
      { key: 'total', label: 'Total', original: String(selectedSale.total) },
      { key: 'discount', label: 'Descuento', original: String(selectedSale.discount ?? 0) },
      { key: 'payment_method', label: 'Forma de pago', original: selectedSale.payment_method },
    ];
    for (const item of items) {
      const name = item.product?.name ?? 'Producto';
      fields.push({ key: `item:${item.id}:quantity`, label: `Cantidad — ${name}`, original: String(item.quantity) });
      fields.push({ key: `item:${item.id}:price`, label: `Precio — ${name}`, original: String(item.price) });
    }
    return fields;
  }, [selectedSale, items]);

  const selectedAdjustField = adjustFields.find(f => f.key === adjustFieldKey);

  const startAdjust = () => {
    setAdjustFieldKey(adjustFields[0]?.key ?? '');
    setAdjustNewValue('');
    setAdjustReason('');
    setAdjusting(true);
  };

  const setVerificationStatus = async (saleId: string, status: VerificationStatus) => {
    const { error } = await supabase
      .from('sale_verifications')
      .upsert({ sale_id: saleId, status, user_id: user!.id }, { onConflict: 'sale_id' });
    if (error) throw error;
    if (isMountedRef.current) {
      setVerifications(prev => ({ ...prev, [saleId]: status }));
    }
  };

  const handleVerify = async () => {
    if (!selectedSale || !canWrite) return;
    setSaving(true);
    try {
      await setVerificationStatus(selectedSale.id, 'verificada');
      toast.success('Nota verificada');
    } catch (error) {
      console.error('ManagerDashboard: error verifying sale:', error);
      toast.error('No se pudo verificar la nota');
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  };

  const handleAdjust = async () => {
    if (!selectedSale || !canWrite || !selectedAdjustField) return;
    const newValue = adjustNewValue.trim();
    const reason = adjustReason.trim();
    if (!reason) {
      toast.error('El motivo es obligatorio');
      return;
    }
    if (!newValue) {
      toast.error('Captura el valor nuevo');
      return;
    }
    if (newValue === selectedAdjustField.original) {
      toast.error('El valor nuevo es igual al original');
      return;
    }

    setSaving(true);
    try {
      // Audit row first: it is the source of truth; the sale itself is never modified
      const { data: inserted, error } = await supabase
        .from('sale_adjustments')
        .insert({
          sale_id: selectedSale.id,
          field: selectedAdjustField.key,
          original_value: selectedAdjustField.original,
          new_value: newValue,
          reason,
          user_id: user!.id,
        })
        .select('id, field, original_value, new_value, reason, created_at, user:users(first_name, last_name)')
        .single();
      if (error) throw error;

      if (isMountedRef.current) {
        setAdjustments(prev => [...prev, inserted as unknown as SaleAdjustment]);
        setAdjusting(false);
      }

      try {
        await setVerificationStatus(selectedSale.id, 'ajustada');
      } catch (statusError) {
        console.error('ManagerDashboard: adjustment saved but status update failed:', statusError);
        toast.error('Ajuste guardado, pero no se pudo marcar la nota como ajustada');
        return;
      }
      toast.success('Ajuste registrado');
    } catch (error) {
      console.error('ManagerDashboard: error saving adjustment:', error);
      toast.error('No se pudo guardar el ajuste');
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  };

  const fieldLabel = (key: string) => adjustFields.find(f => f.key === key)?.label ?? key;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Gerencia — Hoy</h1>
        <button
          onClick={fetchDay}
          disabled={loading}
          className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200 touch-manipulation disabled:opacity-50"
          aria-label="Actualizar"
        >
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {!canWrite && (
        <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">Vista de solo lectura para administrador.</p>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summaryCards.map(card => (
          <div key={card.name} className="bg-white shadow rounded-lg p-4">
            <p className="text-xs sm:text-sm font-medium text-gray-500 truncate">{card.name}</p>
            {loading ? (
              <div className="mt-2 h-7 w-20 bg-gray-200 animate-pulse rounded"></div>
            ) : (
              <p className="mt-1 text-lg sm:text-2xl font-semibold text-gray-900 truncate">{card.value}</p>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {(['notas', 'inventario', 'caja', 'incidencias', 'cierre'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg font-medium touch-manipulation whitespace-nowrap ${
              tab === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 shadow'
            }`}
          >
            {{ notas: 'Notas', inventario: 'Inventario', caja: 'Caja', incidencias: 'Incidencias', cierre: 'Cerrar día' }[t]}
          </button>
        ))}
      </div>

      {tab === 'inventario' && <InventoryReport />}
      {tab === 'caja' && <CashTab canWrite={canWrite} />}
      {tab === 'incidencias' && <IncidentsTab canWrite={canWrite} staff={staff} />}
      {tab === 'cierre' && <CloseDayTab canWrite={canWrite} />}

      {/* Day's sales */}
      {tab === 'notas' && (
      <div className="bg-white shadow rounded-lg">
        <h2 className="text-lg font-medium text-gray-900 p-4 border-b">Notas del día</h2>
        {loading ? (
          <div className="p-4 space-y-3">
            {[0, 1, 2].map(i => <div key={i} className="h-14 bg-gray-100 animate-pulse rounded"></div>)}
          </div>
        ) : sales.length === 0 ? (
          <p className="p-4 text-gray-500">Aún no hay notas hoy.</p>
        ) : (
          <ul className="divide-y">
            {sales.map(sale => {
              const status = statusOf(sale.id);
              return (
                <li key={sale.id}>
                  <button
                    onClick={() => openSale(sale)}
                    className="w-full text-left p-4 hover:bg-gray-50 active:bg-gray-100 touch-manipulation flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">#{sale.id.slice(0, 8)}</p>
                      <p className="text-sm text-gray-500 truncate">
                        {new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {' · '}{personName(sale.customer, 'Mostrador')}
                        {' · '}{paymentLabels[sale.payment_method] ?? sale.payment_method}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-gray-900">{formatCurrency(sale.total)}</p>
                      <span className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusStyles[status]}`}>
                        {status}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      )}

      {/* Sale detail */}
      {selectedSale && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center sm:p-4 z-50">
          <div className="bg-white w-full sm:max-w-lg h-full sm:h-auto sm:max-h-[90vh] sm:rounded-lg overflow-y-auto">
            <div className="sticky top-0 bg-white flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Nota #{selectedSale.id.slice(0, 8)}</h3>
                <span className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusStyles[statusOf(selectedSale.id)]}`}>
                  {statusOf(selectedSale.id)}
                </span>
              </div>
              <button onClick={closeSale} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 touch-manipulation" aria-label="Cerrar">
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-gray-500">Fecha / hora</dt>
                <dd className="text-gray-900">{new Date(selectedSale.created_at).toLocaleString()}</dd>
                <dt className="text-gray-500">Cliente</dt>
                <dd className="text-gray-900">{personName(selectedSale.customer, 'Mostrador')}</dd>
                <dt className="text-gray-500">Vendedor</dt>
                <dd className="text-gray-900">{sellerName(selectedSale)}</dd>
                <dt className="text-gray-500">Forma de pago</dt>
                <dd className="text-gray-900">{paymentLabels[selectedSale.payment_method] ?? selectedSale.payment_method}</dd>
              </dl>

              {detailLoading ? (
                <div className="h-24 bg-gray-100 animate-pulse rounded"></div>
              ) : (
                <ul className="divide-y border rounded-lg">
                  {items.map(item => (
                    <li key={item.id} className="p-3 text-sm">
                      <p className="font-medium text-gray-900">{item.product?.name ?? 'Producto'}</p>
                      <p className="text-gray-500">
                        {item.quantity} × {formatCurrency(item.price)}
                        {Number(item.discount) > 0 && <> · desc. {formatCurrency(item.discount)}</>}
                        {' = '}{formatCurrency(item.subtotal)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-gray-500">Subtotal</dt>
                <dd className="text-right text-gray-900">{formatCurrency(selectedSale.subtotal)}</dd>
                <dt className="text-gray-500">Descuento</dt>
                <dd className="text-right text-gray-900">{formatCurrency(selectedSale.discount ?? 0)}</dd>
                <dt className="text-gray-500">Impuesto</dt>
                <dd className="text-right text-gray-900">{formatCurrency(selectedSale.tax)}</dd>
                <dt className="font-semibold text-gray-900">Total</dt>
                <dd className="text-right font-semibold text-gray-900">{formatCurrency(selectedSale.total)}</dd>
              </dl>

              {!detailLoading && !adjusting && items.length > 0 && (
                <FulfillmentForm saleId={selectedSale.id} items={items} staff={staff} canWrite={canWrite} />
              )}

              {adjustments.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Ajustes registrados</h4>
                  <ul className="space-y-2">
                    {adjustments.map(adj => (
                      <li key={adj.id} className="text-sm bg-blue-50 rounded-lg p-3">
                        <p className="text-gray-900">
                          {fieldLabel(adj.field)}: <span className="line-through">{adj.original_value}</span> → {adj.new_value}
                        </p>
                        <p className="text-gray-600">{adj.reason}</p>
                        <p className="text-xs text-gray-500">
                          {personName(adj.user, '—')} · {new Date(adj.created_at).toLocaleString()}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {canWrite && adjusting && (
                <div className="space-y-3 border rounded-lg p-3">
                  <label className="block text-sm">
                    <span className="text-gray-700">Campo</span>
                    <select
                      value={adjustFieldKey}
                      onChange={e => { setAdjustFieldKey(e.target.value); setAdjustNewValue(''); }}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      {adjustFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </label>
                  <p className="text-sm text-gray-500">
                    Valor original: <span className="font-medium text-gray-900">
                      {selectedAdjustField?.key === 'payment_method'
                        ? paymentLabels[selectedAdjustField.original] ?? selectedAdjustField.original
                        : selectedAdjustField?.original}
                    </span>
                  </p>
                  <label className="block text-sm">
                    <span className="text-gray-700">Valor nuevo</span>
                    {selectedAdjustField?.key === 'payment_method' ? (
                      <select
                        value={adjustNewValue}
                        onChange={e => setAdjustNewValue(e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      >
                        <option value="">Selecciona…</option>
                        {Object.entries(paymentLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step={selectedAdjustField?.key.endsWith(':quantity') ? '1' : '0.01'}
                        value={adjustNewValue}
                        onChange={e => setAdjustNewValue(e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    )}
                  </label>
                  <label className="block text-sm">
                    <span className="text-gray-700">Motivo (obligatorio)</span>
                    <textarea
                      value={adjustReason}
                      onChange={e => setAdjustReason(e.target.value)}
                      rows={2}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAdjusting(false)}
                      disabled={saving}
                      className="flex-1 py-3 rounded-lg border border-gray-300 text-gray-700 touch-manipulation disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleAdjust}
                      disabled={saving || !adjustReason.trim()}
                      className="flex-1 py-3 rounded-lg bg-blue-600 text-white font-medium touch-manipulation disabled:opacity-50"
                    >
                      Guardar ajuste
                    </button>
                  </div>
                </div>
              )}
            </div>

            {canWrite && !adjusting && !detailLoading && (
              <div className="sticky bottom-0 bg-white border-t p-4 flex gap-2">
                <button
                  onClick={handleVerify}
                  disabled={saving || statusOf(selectedSale.id) !== 'pendiente'}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-green-600 text-white font-medium touch-manipulation disabled:opacity-50"
                >
                  <CheckCircle className="h-5 w-5" /> Verificar
                </button>
                <button
                  onClick={startAdjust}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-blue-600 text-white font-medium touch-manipulation disabled:opacity-50"
                >
                  <Edit3 className="h-5 w-5" /> Ajustar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ManagerDashboard;
