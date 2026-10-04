import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';

export interface StaffMember {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
}

export interface FulfillmentSaleItem {
  id: string;
  product_id: string;
  quantity: number;
  product: { name: string } | null;
}

// Must match the CHECK constraint on inventory_discrepancies.reason
const discrepancyReasons: Record<string, string> = {
  dano: 'Daño',
  merma: 'Merma',
  muestra: 'Muestra',
  uso_interno: 'Uso interno',
  salida_sin_nota: 'Salida sin nota',
  error_captura: 'Error de captura',
  otro: 'Otro',
};

interface FulfillmentFormProps {
  saleId: string;
  items: FulfillmentSaleItem[];
  staff: StaffMember[];
  canWrite: boolean;
}

interface ProductGap {
  productId: string;
  name: string;
  sold: number;
  fulfilled: number;
  justified: number;
  pending: number;
}

const selectClass = 'mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-50';

export default function FulfillmentForm({ saleId, items, staff, canWrite }: FulfillmentFormProps) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickedBy, setPickedBy] = useState('');
  const [deliveredBy, setDeliveredBy] = useState('');
  const [loadedBy, setLoadedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [justifiedByProduct, setJustifiedByProduct] = useState<Record<string, number>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    const load = async () => {
      setLoading(true);
      try {
        const [fulfillmentRes, discRes] = await Promise.all([
          supabase
            .from('sale_fulfillments')
            .select('picked_by, delivered_by, loaded_by, notes, items:sale_fulfillment_items(sale_item_id, quantity_fulfilled)')
            .eq('sale_id', saleId)
            .maybeSingle(),
          supabase
            .from('inventory_discrepancies')
            .select('product_id, quantity')
            .eq('sale_id', saleId),
        ]);
        if (fulfillmentRes.error) throw fulfillmentRes.error;
        if (discRes.error) throw discRes.error;
        if (!isMountedRef.current) return;

        const f = fulfillmentRes.data as {
          picked_by: string | null; delivered_by: string | null; loaded_by: string | null; notes: string | null;
          items: { sale_item_id: string; quantity_fulfilled: number }[];
        } | null;
        setPickedBy(f?.picked_by ?? '');
        setDeliveredBy(f?.delivered_by ?? '');
        setLoadedBy(f?.loaded_by ?? '');
        setNotes(f?.notes ?? '');
        const saved: Record<string, string> = {};
        for (const item of items) {
          const existing = f?.items.find(i => i.sale_item_id === item.id);
          saved[item.id] = String(existing ? existing.quantity_fulfilled : item.quantity);
        }
        setQuantities(saved);

        const justified: Record<string, number> = {};
        for (const d of (discRes.data || []) as { product_id: string; quantity: number }[]) {
          justified[d.product_id] = (justified[d.product_id] ?? 0) + d.quantity;
        }
        setJustifiedByProduct(justified);
        setReasons({});
      } catch (error) {
        console.error('FulfillmentForm: error loading fulfillment:', error);
        if (isMountedRef.current) toast.error('No se pudo cargar el surtido');
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    };
    load();
    return () => {
      isMountedRef.current = false;
    };
  }, [saleId, items]);

  // Gap per product = sold - fulfilled - already justified; any non-zero gap needs a reason
  const gaps: ProductGap[] = useMemo(() => {
    const byProduct: Record<string, ProductGap> = {};
    for (const item of items) {
      const gap = byProduct[item.product_id] ??= {
        productId: item.product_id,
        name: item.product?.name ?? 'Producto',
        sold: 0,
        fulfilled: 0,
        justified: justifiedByProduct[item.product_id] ?? 0,
        pending: 0,
      };
      gap.sold += item.quantity;
      gap.fulfilled += parseInt(quantities[item.id] ?? '', 10) || 0;
    }
    return Object.values(byProduct).map(g => ({ ...g, pending: g.sold - g.fulfilled - g.justified }));
  }, [items, quantities, justifiedByProduct]);

  const pendingGaps = gaps.filter(g => g.pending !== 0);

  const handleSave = async () => {
    if (!canWrite) return;
    for (const item of items) {
      const qty = parseInt(quantities[item.id] ?? '', 10);
      if (isNaN(qty) || qty < 0) {
        toast.error(`Cantidad surtida inválida para ${item.product?.name ?? 'producto'}`);
        return;
      }
    }
    const missingReason = pendingGaps.find(g => !reasons[g.productId]);
    if (missingReason) {
      toast.error(`Selecciona el motivo de la diferencia de ${missingReason.name}`);
      return;
    }

    setSaving(true);
    try {
      const { data: fulfillment, error: fError } = await supabase
        .from('sale_fulfillments')
        .upsert({
          sale_id: saleId,
          picked_by: pickedBy || null,
          delivered_by: deliveredBy || null,
          loaded_by: loadedBy || null,
          notes: notes.trim() || null,
        }, { onConflict: 'sale_id' })
        .select('id')
        .single();
      if (fError) throw fError;

      const { error: itemsError } = await supabase
        .from('sale_fulfillment_items')
        .upsert(items.map(item => ({
          fulfillment_id: fulfillment.id,
          sale_item_id: item.id,
          quantity_fulfilled: parseInt(quantities[item.id], 10),
        })), { onConflict: 'fulfillment_id,sale_item_id' });
      if (itemsError) throw itemsError;

      // Append-only justification: only the still-unexplained part of each gap is recorded.
      // Stock is never modified here.
      if (pendingGaps.length > 0) {
        const { error: discError } = await supabase
          .from('inventory_discrepancies')
          .insert(pendingGaps.map(g => ({
            product_id: g.productId,
            quantity: g.pending,
            reason: reasons[g.productId],
            notes: notes.trim() || null,
            sale_id: saleId,
            user_id: user!.id,
          })));
        if (discError) throw discError;
        if (isMountedRef.current) {
          setJustifiedByProduct(prev => {
            const next = { ...prev };
            for (const g of pendingGaps) next[g.productId] = (next[g.productId] ?? 0) + g.pending;
            return next;
          });
          setReasons({});
        }
      }
      toast.success('Surtido guardado');
    } catch (error) {
      console.error('FulfillmentForm: error saving fulfillment:', error);
      toast.error('No se pudo guardar el surtido');
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  };

  if (loading) {
    return <div className="h-24 bg-gray-100 animate-pulse rounded"></div>;
  }

  const staffSelect = (label: string, value: string, onChange: (v: string) => void) => (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} disabled={!canWrite} className={selectClass}>
        <option value="">—</option>
        {staff.map(s => (
          <option key={s.id} value={s.id}>{`${s.first_name} ${s.last_name}`.trim()}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-3 border rounded-lg p-3">
      <h4 className="text-sm font-medium text-gray-900">Surtido</h4>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {staffSelect('Surtió', pickedBy, setPickedBy)}
        {staffSelect('Entregó', deliveredBy, setDeliveredBy)}
        {staffSelect('Cargó', loadedBy, setLoadedBy)}
      </div>

      <ul className="divide-y border rounded-lg">
        {items.map(item => (
          <li key={item.id} className="p-3 flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-gray-900 truncate">{item.product?.name ?? 'Producto'}</p>
              <p className="text-gray-500">Vendido: {item.quantity}</p>
            </div>
            <label className="shrink-0 w-24">
              <span className="sr-only">Cantidad surtida</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={quantities[item.id] ?? ''}
                onChange={e => setQuantities(prev => ({ ...prev, [item.id]: e.target.value }))}
                disabled={!canWrite}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </label>
          </li>
        ))}
      </ul>

      {pendingGaps.map(g => (
        <label key={g.productId} className="block text-sm bg-red-50 rounded-lg p-3">
          <span className="text-red-800">
            {g.name}: diferencia de {g.pending} sin justificar (vendido {g.sold}, surtido {g.fulfilled}
            {g.justified !== 0 && `, ya justificado ${g.justified}`})
          </span>
          <select
            value={reasons[g.productId] ?? ''}
            onChange={e => setReasons(prev => ({ ...prev, [g.productId]: e.target.value }))}
            disabled={!canWrite}
            className={selectClass}
          >
            <option value="">Motivo (obligatorio)…</option>
            {Object.entries(discrepancyReasons).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      ))}

      <label className="block text-sm">
        <span className="text-gray-700">Observaciones</span>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          disabled={!canWrite}
          className={selectClass}
        />
      </label>

      {canWrite && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium touch-manipulation disabled:opacity-50"
        >
          Guardar surtido
        </button>
      )}
    </div>
  );
}
