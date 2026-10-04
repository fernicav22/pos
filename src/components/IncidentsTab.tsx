import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';
import { RefreshCw, CheckCircle } from 'lucide-react';
import { StaffMember } from './FulfillmentForm';

// Must match the CHECK constraint on incidents.type
const typeLabels: Record<string, string> = {
  material_danado: 'Material dañado',
  faltante: 'Faltante',
  cliente_inconforme: 'Cliente inconforme',
  diferencia_caja: 'Diferencia de caja',
  descuento_especial: 'Descuento especial',
  entrega_incorrecta: 'Entrega incorrecta',
  salida_sin_nota: 'Salida sin nota',
  otro: 'Otro',
};

interface Incident {
  id: string;
  type: string;
  description: string;
  status: 'pendiente' | 'resuelta';
  person_id: string | null;
  created_at: string;
}

interface IncidentsTabProps {
  canWrite: boolean;
  staff: StaffMember[];
}

export default function IncidentsTab({ canWrite, staff }: IncidentsTabProps) {
  const { user } = useAuthStore();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const [type, setType] = useState('otro');
  const [description, setDescription] = useState('');
  const [personId, setPersonId] = useState('');
  const [saving, setSaving] = useState(false);

  const isMountedRef = useRef(true);

  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('incidents')
        .select('id, type, description, status, person_id, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      if (isMountedRef.current) setIncidents((data || []) as Incident[]);
    } catch (error) {
      console.error('IncidentsTab: error loading incidents:', error);
      if (isMountedRef.current) toast.error('No se pudieron cargar las incidencias');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchIncidents();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchIncidents]);

  const personName = (id: string | null) => {
    if (!id) return null;
    const member = staff.find(s => s.id === id);
    return member ? `${member.first_name} ${member.last_name}`.trim() : null;
  };

  const handleSubmit = async () => {
    if (!canWrite || !user) return;
    const desc = description.trim();
    if (!desc) {
      toast.error('La descripción es obligatoria');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('incidents').insert({
        type,
        description: desc,
        person_id: personId || null,
        user_id: user.id,
      });
      if (error) throw error;
      toast.success('Incidencia registrada');
      setDescription('');
      setPersonId('');
      setType('otro');
      await fetchIncidents();
    } catch (error) {
      console.error('IncidentsTab: error saving incident:', error);
      toast.error('No se pudo registrar la incidencia');
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  };

  const handleResolve = async (id: string) => {
    if (!canWrite || resolvingId) return;
    setResolvingId(id);
    try {
      const { error } = await supabase.from('incidents').update({ status: 'resuelta' }).eq('id', id);
      if (error) throw error;
      if (isMountedRef.current) {
        setIncidents(prev => prev.map(i => (i.id === id ? { ...i, status: 'resuelta' } : i)));
      }
      toast.success('Incidencia resuelta');
    } catch (error) {
      console.error('IncidentsTab: error resolving incident:', error);
      toast.error('No se pudo resolver la incidencia');
    } finally {
      if (isMountedRef.current) setResolvingId(null);
    }
  };

  const pending = incidents.filter(i => i.status === 'pendiente');
  const resolved = incidents.filter(i => i.status === 'resuelta');

  const renderIncident = (incident: Incident) => (
    <li key={incident.id} className="p-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{typeLabels[incident.type] ?? incident.type}</span>
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${incident.status === 'pendiente' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
            {incident.status}
          </span>
        </div>
        <p className="text-sm text-gray-700 mt-1 break-words">{incident.description}</p>
        <p className="text-xs text-gray-500 mt-1">
          {personName(incident.person_id) ? `${personName(incident.person_id)} · ` : ''}
          {new Date(incident.created_at).toLocaleString()}
        </p>
      </div>
      {canWrite && incident.status === 'pendiente' && (
        <button
          onClick={() => handleResolve(incident.id)}
          disabled={resolvingId === incident.id}
          className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg bg-green-600 text-white text-sm font-medium touch-manipulation disabled:opacity-50"
        >
          <CheckCircle className="h-4 w-4" /> Resolver
        </button>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="bg-white shadow rounded-lg p-4 space-y-3">
          <h2 className="text-lg font-medium text-gray-900">Nueva incidencia</h2>
          <label className="block text-sm">
            <span className="text-gray-700">Tipo</span>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Descripción</span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Persona (opcional, solo personal)</span>
            <select
              value={personId}
              onChange={e => setPersonId(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="">—</option>
              {staff.map(s => (
                <option key={s.id} value={s.id}>{`${s.first_name} ${s.last_name}`.trim()}</option>
              ))}
            </select>
          </label>
          <button
            onClick={handleSubmit}
            disabled={saving || !description.trim()}
            className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium touch-manipulation disabled:opacity-50"
          >
            Registrar
          </button>
        </div>
      )}

      <div className="bg-white shadow rounded-lg">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-medium text-gray-900">Incidencias ({pending.length} pendientes)</h2>
          <button
            onClick={fetchIncidents}
            disabled={loading}
            className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200 touch-manipulation disabled:opacity-50"
            aria-label="Actualizar"
          >
            <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loading ? (
          <div className="p-4 space-y-3">
            {[0, 1, 2].map(i => <div key={i} className="h-16 bg-gray-100 animate-pulse rounded"></div>)}
          </div>
        ) : incidents.length === 0 ? (
          <p className="p-4 text-gray-500">Sin incidencias registradas.</p>
        ) : (
          <ul className="divide-y">
            {pending.map(renderIncident)}
            {resolved.map(renderIncident)}
          </ul>
        )}
      </div>
    </div>
  );
}
