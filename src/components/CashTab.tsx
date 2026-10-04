import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useSettingsStore } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { RefreshCw } from 'lucide-react';
import { BUSINESS_TZ, getBusinessToday } from '../utils/businessDate';

interface CashSummary {
  sales_count: number;
  sales_total: number;
  devoluciones: number;
  descuentos: number;
  expected: { cash: number; card: number; other: number; abonos: number };
  received: { cash: number; card: number; other: number; abonos: number; counted_at: string } | null;
  difference: { cash: number; card: number; other: number; abonos: number } | null;
}

const methodLabels: { key: 'cash' | 'card' | 'other' | 'abonos'; label: string }[] = [
  { key: 'cash', label: 'Efectivo' },
  { key: 'card', label: 'Tarjeta / Transferencia' },
  { key: 'other', label: 'Otro' },
  { key: 'abonos', label: 'Abonos' },
];

interface CashTabProps {
  canWrite: boolean;
}

export default function CashTab({ canWrite }: CashTabProps) {
  const { formatCurrency } = useSettingsStore();
  const { user } = useAuthStore();
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ cash: '', card: '', other: '', abonos: '' });
  const [submitting, setSubmitting] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [explained, setExplained] = useState(false);
  const [savingIncident, setSavingIncident] = useState(false);
  const isMountedRef = useRef(true);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_daily_cash_summary', {
        p_date: getBusinessToday(),
        p_tz: BUSINESS_TZ,
      });
      if (error) throw error;
      const s = data as CashSummary | null;
      if (isMountedRef.current) {
        setSummary(s);
        setExplained(false);
        if (s?.received) {
          setCounts({
            cash: String(s.received.cash),
            card: String(s.received.card),
            other: String(s.received.other),
            abonos: String(s.received.abonos),
          });
        }
      }
    } catch (error) {
      console.error('CashTab: error loading cash summary:', error);
      if (isMountedRef.current) toast.error('No se pudo cargar el corte de caja');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchSummary();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchSummary]);

  const hasDifference = !!summary?.difference && (
    summary.difference.cash !== 0 || summary.difference.card !== 0 ||
    summary.difference.other !== 0 || summary.difference.abonos !== 0
  );

  const handleSaveCount = async () => {
    if (!canWrite || !user) return;
    const parsed = {
      cash: parseFloat(counts.cash || '0'),
      card: parseFloat(counts.card || '0'),
      other: parseFloat(counts.other || '0'),
      abonos: parseFloat(counts.abonos || '0'),
    };
    if (Object.values(parsed).some(v => isNaN(v) || v < 0)) {
      toast.error('Captura montos válidos');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('cash_counts').insert({ ...parsed, user_id: user.id });
      if (error) throw error;
      toast.success('Conteo guardado');
      setExplanation('');
      await fetchSummary();
    } catch (error) {
      console.error('CashTab: error saving cash count:', error);
      toast.error('No se pudo guardar el conteo');
    } finally {
      if (isMountedRef.current) setSubmitting(false);
    }
  };

  const handleRegisterIncident = async () => {
    if (!canWrite || !user) return;
    const reason = explanation.trim();
    if (!reason) {
      toast.error('La explicación es obligatoria');
      return;
    }
    setSavingIncident(true);
    try {
      const { error } = await supabase.from('incidents').insert({
        type: 'diferencia_caja',
        description: reason,
        user_id: user.id,
      });
      if (error) throw error;
      toast.success('Incidencia registrada');
      setExplained(true);
    } catch (error) {
      console.error('CashTab: error registering cash difference incident:', error);
      toast.error('No se pudo registrar la incidencia');
    } finally {
      if (isMountedRef.current) setSavingIncident(false);
    }
  };

  return (
    <div className="bg-white shadow rounded-lg">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-medium text-gray-900">Caja — Hoy</h2>
        <button
          onClick={fetchSummary}
          disabled={loading}
          className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200 touch-manipulation disabled:opacity-50"
          aria-label="Actualizar"
        >
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="p-4 space-y-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-14 bg-gray-100 animate-pulse rounded"></div>)}
        </div>
      ) : (
        <div className="p-4 space-y-4">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Forma de pago</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Esperado</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Contado</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {methodLabels.map(({ key, label }) => {
                  const diff = summary?.difference?.[key] ?? null;
                  return (
                    <tr key={key}>
                      <td className="px-3 py-2 text-gray-900">{label}</td>
                      <td className="px-3 py-2 text-right text-gray-900">{formatCurrency(summary?.expected[key] ?? 0)}</td>
                      <td className="px-3 py-2 text-right">
                        {canWrite ? (
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={counts[key]}
                            onChange={e => setCounts(prev => ({ ...prev, [key]: e.target.value }))}
                            className="w-28 text-right rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                          />
                        ) : (
                          formatCurrency(summary?.received?.[key] ?? 0)
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right font-medium ${diff ? (diff === 0 ? 'text-gray-900' : 'text-red-600') : 'text-gray-400'}`}>
                        {diff === null ? '—' : formatCurrency(diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canWrite && (
            <button
              onClick={handleSaveCount}
              disabled={submitting}
              className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium touch-manipulation disabled:opacity-50"
            >
              {summary?.received ? 'Guardar recuento' : 'Guardar conteo'}
            </button>
          )}

          {hasDifference && !explained && (
            <div className="space-y-3 border rounded-lg p-3 bg-red-50">
              <p className="text-sm font-medium text-red-800">
                Hay diferencia de caja. Explica el motivo para registrar la incidencia.
              </p>
              {canWrite ? (
                <>
                  <textarea
                    value={explanation}
                    onChange={e => setExplanation(e.target.value)}
                    rows={2}
                    placeholder="Motivo de la diferencia (obligatorio)"
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleRegisterIncident}
                    disabled={savingIncident || !explanation.trim()}
                    className="w-full py-3 rounded-lg bg-red-600 text-white font-medium touch-manipulation disabled:opacity-50"
                  >
                    Registrar incidencia
                  </button>
                </>
              ) : (
                <p className="text-sm text-red-700">Sin explicación registrada todavía.</p>
              )}
            </div>
          )}

          {hasDifference && explained && (
            <p className="text-sm bg-green-50 text-green-800 rounded-lg p-3">Incidencia de diferencia de caja registrada.</p>
          )}
        </div>
      )}
    </div>
  );
}
