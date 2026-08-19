import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Plus, X, Trash2, Printer, Camera, MapPin } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { useDebounce } from '../hooks/useDebounce';
import { hasPermission } from '../utils/permissions';
import { UserRole } from '../types';
import { roundCurrency } from '../utils/currency';
import toast from 'react-hot-toast';

type ShipmentType = 'local' | 'sobre_pedido';
type ShipmentStatus = 'pendiente' | 'comprando_material' | 'preparando_pedido' | 'en_ruta' | 'entregado' | 'cancelado';
type ShipmentPriority = 'normal' | 'urgente';

interface CourierOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock_quantity: number;
}

interface PurchaseOption {
  id: string;
  reference_number: string | null;
  status: string;
  supplier: { name: string } | null;
}

interface SaleOption {
  id: string;
  total: number;
  created_at: string;
  customer: { first_name: string; last_name: string; phone: string | null } | null;
  sale_items: { product_id: string; quantity: number; price: number; product: { name: string } | null }[];
}

interface Shipment {
  id: string;
  sale_id: string | null;
  purchase_id: string | null;
  created_by: string;
  courier_id: string | null;
  courier?: { first_name: string; last_name: string } | null;
  purchase?: { reference_number: string | null } | null;
  type: ShipmentType;
  status: ShipmentStatus;
  priority: ShipmentPriority;
  customer_name: string;
  customer_phone: string;
  address: string;
  address_reference: string | null;
  subtotal: number;
  shipping_cost: number;
  total: number;
  advance_paid: number;
  recipient_name: string | null;
  delivery_notes: string | null;
  delivery_photo_path: string | null;
  delivery_photo_uploaded_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ShipmentItemRecord {
  id: string;
  product_id: string;
  product?: { name: string; sku: string } | null;
  quantity: number;
  unit_price: number;
  notes: string | null;
}

interface ItemFormRow {
  product_id: string;
  quantity: number;
  notes: string;
}

interface ShipmentFormData {
  type: ShipmentType;
  customer_name: string;
  customer_phone: string;
  address: string;
  address_reference: string;
  courier_id: string;
  priority: ShipmentPriority;
  shipping_cost: number;
  advance_paid: number;
  items: ItemFormRow[];
}

const DEFAULT_FORM_DATA: ShipmentFormData = {
  type: 'local',
  customer_name: '',
  customer_phone: '',
  address: '',
  address_reference: '',
  courier_id: '',
  priority: 'normal',
  shipping_cost: 0,
  advance_paid: 0,
  items: [],
};

const STATUS_META: Record<ShipmentStatus, { label: string; emoji: string; color: string }> = {
  pendiente: { label: 'Pending', emoji: '🟡', color: 'bg-yellow-100 text-yellow-800' },
  comprando_material: { label: 'Purchasing Material', emoji: '🛒', color: 'bg-orange-100 text-orange-800' },
  preparando_pedido: { label: 'Preparing Order', emoji: '📦', color: 'bg-blue-100 text-blue-800' },
  en_ruta: { label: 'In Transit', emoji: '🚚', color: 'bg-indigo-100 text-indigo-800' },
  entregado: { label: 'Delivered', emoji: '✅', color: 'bg-green-100 text-green-800' },
  cancelado: { label: 'Cancelled', emoji: '❌', color: 'bg-red-100 text-red-800' },
};

// Delivery evidence photos live in a private bucket with no server-side TTL;
// this best-effort client cleanup prunes anything older than 15 days whenever
// the page loads (see supabase/migrations/20260819000001_create_shipments.sql).
const PHOTO_RETENTION_DAYS = 15;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function getAllowedNextStatuses(shipment: Shipment): { value: ShipmentStatus; label: string }[] {
  if (shipment.status === 'entregado' || shipment.status === 'cancelado') return [];
  const options: { value: ShipmentStatus; label: string }[] = [];
  if (shipment.status === 'pendiente') {
    options.push(
      shipment.type === 'sobre_pedido'
        ? { value: 'comprando_material', label: 'Start Purchasing Material' }
        : { value: 'preparando_pedido', label: 'Start Preparing Order' }
    );
  } else if (shipment.status === 'comprando_material') {
    options.push({ value: 'preparando_pedido', label: 'Material Received - Prepare Order' });
  } else if (shipment.status === 'preparando_pedido') {
    options.push({ value: 'en_ruta', label: 'Send Out (In Transit)' });
  } else if (shipment.status === 'en_ruta') {
    options.push({ value: 'entregado', label: 'Mark as Delivered' });
  }
  options.push({ value: 'cancelado', label: 'Cancel Shipment' });
  return options;
}

export default function Shipments() {
  const { user } = useAuthStore();
  const { formatCurrency } = useSettingsStore();

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [couriers, setCouriers] = useState<CourierOption[]>([]);
  const [purchaseOptions, setPurchaseOptions] = useState<PurchaseOption[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showRoutesToday, setShowRoutesToday] = useState(false);

  // Create/edit modal
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null);
  const [formData, setFormData] = useState<ShipmentFormData>(DEFAULT_FORM_DATA);
  const [isSavingShipment, setIsSavingShipment] = useState(false);

  // Related sale search (create mode only)
  const [recentSales, setRecentSales] = useState<SaleOption[]>([]);
  const [saleSearchQuery, setSaleSearchQuery] = useState('');
  const [linkedSale, setLinkedSale] = useState<SaleOption | null>(null);

  // Detail modal
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [selectedShipmentItems, setSelectedShipmentItems] = useState<ShipmentItemRecord[]>([]);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [assigningCourierId, setAssigningCourierId] = useState<string | null>(null);

  // Location popover
  const [locationShipment, setLocationShipment] = useState<Shipment | null>(null);

  // Mark-as-delivered modal
  const [deliveringShipment, setDeliveringShipment] = useState<Shipment | null>(null);
  const [deliverRecipient, setDeliverRecipient] = useState('');
  const [deliverComments, setDeliverComments] = useState('');
  const [deliverPhotoFile, setDeliverPhotoFile] = useState<File | null>(null);
  const [isDelivering, setIsDelivering] = useState(false);

  const fetchShipments = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('shipments')
        .select(`
          *,
          courier:users!shipments_courier_id_fkey(first_name, last_name),
          purchase:purchases(reference_number)
        `)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      setShipments(data || []);
    } catch (error) {
      console.error('Error fetching shipments:', error);
      toast.error('Failed to load shipments');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, price, stock_quantity')
        .order('name');
      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
      toast.error('Failed to load products');
    }
  }, []);

  const fetchCouriers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, role')
        .in('role', ['admin', 'manager', 'cashier'])
        .eq('active', true)
        .order('first_name');
      if (error) throw error;
      setCouriers(data || []);
    } catch (error) {
      console.error('Error fetching couriers:', error);
    }
  }, []);

  const fetchPurchaseOptions = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('purchases')
        .select('id, reference_number, status, supplier:suppliers(name)')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setPurchaseOptions(data || []);
    } catch (error) {
      console.error('Error fetching purchases for linking:', error);
    }
  }, []);

  const fetchRecentSales = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('sales')
        .select(`
          id, total, created_at,
          customer:customers(first_name, last_name, phone),
          sale_items(product_id, quantity, price, product:products(name))
        `)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      setRecentSales(data || []);
    } catch (error) {
      console.error('Error fetching recent sales:', error);
    }
  }, []);

  // Best-effort cleanup of delivery evidence photos older than the retention window.
  const cleanupExpiredDeliveryProofs = useCallback(async () => {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - PHOTO_RETENTION_DAYS);

      const { data: expired, error: fetchError } = await supabase
        .from('shipments')
        .select('id, delivery_photo_path')
        .not('delivery_photo_path', 'is', null)
        .lt('delivery_photo_uploaded_at', cutoff.toISOString())
        .limit(25);

      if (fetchError || !expired || expired.length === 0) return;

      const paths = expired
        .map((s: { delivery_photo_path: string | null }) => s.delivery_photo_path)
        .filter((p: string | null): p is string => !!p);
      if (paths.length > 0) {
        await supabase.storage.from('delivery-proofs').remove(paths);
      }

      await supabase
        .from('shipments')
        .update({ delivery_photo_path: null, delivery_photo_uploaded_at: null })
        .in('id', expired.map((s: { id: string }) => s.id));
    } catch (error) {
      console.debug('Shipments: delivery proof cleanup skipped', error);
    }
  }, []);

  useEffect(() => {
    fetchShipments();
    fetchProducts();
    fetchCouriers();
    cleanupExpiredDeliveryProofs();
  }, [fetchShipments, fetchProducts, fetchCouriers, cleanupExpiredDeliveryProofs]);

  const filteredSaleResults = useMemo(() => {
    const q = saleSearchQuery.trim().toLowerCase();
    if (!q) return recentSales;
    return recentSales.filter(sale => {
      const customerName = sale.customer ? `${sale.customer.first_name} ${sale.customer.last_name}`.toLowerCase() : '';
      return sale.id.toLowerCase().includes(q) || customerName.includes(q);
    });
  }, [recentSales, saleSearchQuery]);

  const filteredShipments = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return shipments
      .filter(s => {
        const matchesSearch =
          q === '' ||
          s.customer_name.toLowerCase().includes(q) ||
          s.customer_phone.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q);
        const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
        const createdAt = new Date(s.created_at);
        const matchesFrom = !dateFrom || createdAt >= new Date(dateFrom);
        const matchesTo = !dateTo || createdAt <= new Date(`${dateTo}T23:59:59`);
        return matchesSearch && matchesStatus && matchesFrom && matchesTo;
      })
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === 'urgente' ? -1 : 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [shipments, debouncedSearch, statusFilter, dateFrom, dateTo]);

  const routesToday = useMemo(() => {
    const enRuta = shipments.filter(s => s.status === 'en_ruta');
    const groups = new Map<string, { courierName: string; shipments: Shipment[] }>();
    enRuta.forEach(s => {
      const key = s.courier_id || 'unassigned';
      const courierName = s.courier ? `${s.courier.first_name} ${s.courier.last_name}` : 'Unassigned';
      if (!groups.has(key)) groups.set(key, { courierName, shipments: [] });
      groups.get(key)!.shipments.push(s);
    });
    groups.forEach(group => {
      group.shipments.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === 'urgente' ? -1 : 1;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
    });
    return Array.from(groups.values());
  }, [shipments]);

  const summary = useMemo(() => {
    const todayStr = new Date().toDateString();
    return {
      pending: shipments.filter(s => s.status === 'pendiente').length,
      inPreparation: shipments.filter(s => s.status === 'preparando_pedido').length,
      inTransit: shipments.filter(s => s.status === 'en_ruta').length,
      deliveredToday: shipments.filter(
        s => s.status === 'entregado' && s.delivered_at && new Date(s.delivered_at).toDateString() === todayStr
      ).length,
      madeToOrderAwaitingPurchase: shipments.filter(
        s => s.type === 'sobre_pedido' && (s.status === 'pendiente' || s.status === 'comprando_material')
      ).length,
    };
  }, [shipments]);

  const calculateSubtotal = useCallback(() => {
    return roundCurrency(
      formData.items.reduce((sum, item) => {
        const product = products.find(p => p.id === item.product_id);
        const quantity = isNaN(item.quantity) ? 0 : item.quantity;
        return sum + (product ? product.price * quantity : 0);
      }, 0)
    );
  }, [formData.items, products]);

  const calculateTotal = useCallback(() => {
    const shippingCost = isNaN(formData.shipping_cost) ? 0 : formData.shipping_cost;
    return roundCurrency(calculateSubtotal() + shippingCost);
  }, [calculateSubtotal, formData.shipping_cost]);

  const calculatePending = useCallback(() => {
    const advancePaid = isNaN(formData.advance_paid) ? 0 : formData.advance_paid;
    return roundCurrency(calculateTotal() - advancePaid);
  }, [calculateTotal, formData.advance_paid]);

  const customerNameError = useMemo(
    () => (formData.customer_name.trim() ? null : 'Customer name is required.'),
    [formData.customer_name]
  );
  const customerPhoneError = useMemo(
    () => (formData.customer_phone.trim() ? null : 'Phone number is required.'),
    [formData.customer_phone]
  );
  const addressError = useMemo(() => (formData.address.trim() ? null : 'Address is required.'), [formData.address]);
  const itemsError = useMemo(() => {
    if (formData.items.length === 0) return 'Add at least one product.';
    const hasInvalidItem = formData.items.some(
      item => !item.product_id || !item.quantity || isNaN(item.quantity) || item.quantity <= 0
    );
    return hasInvalidItem ? 'Every product needs a quantity greater than 0.' : null;
  }, [formData.items]);

  const isFormValid = !customerNameError && !customerPhoneError && !addressError && !itemsError;

  const handleAddItem = useCallback(() => {
    setFormData(prev => ({ ...prev, items: [...prev.items, { product_id: '', quantity: 1, notes: '' }] }));
  }, []);

  const handleRemoveItem = useCallback((index: number) => {
    setFormData(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  }, []);

  const handleItemChange = useCallback((index: number, field: keyof ItemFormRow, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }));
  }, []);

  const handleSelectSale = (sale: SaleOption) => {
    setLinkedSale(sale);
    setFormData(prev => ({
      ...prev,
      customer_name: sale.customer ? `${sale.customer.first_name} ${sale.customer.last_name}`.trim() : prev.customer_name,
      customer_phone: sale.customer?.phone || prev.customer_phone,
      advance_paid: sale.total,
      items: sale.sale_items.map(si => ({ product_id: si.product_id, quantity: si.quantity, notes: '' })),
    }));
  };

  const openCreateModal = () => {
    setFormData(DEFAULT_FORM_DATA);
    setEditingShipment(null);
    setLinkedSale(null);
    setSaleSearchQuery('');
    fetchCouriers();
    fetchProducts();
    fetchRecentSales();
    setShowFormModal(true);
  };

  const openEditModal = async (shipment: Shipment) => {
    if (shipment.status === 'entregado' || shipment.status === 'cancelado') {
      toast.error('Delivered or cancelled shipments cannot be edited');
      return;
    }
    fetchCouriers();
    fetchProducts();
    try {
      const { data, error } = await supabase
        .from('shipment_items')
        .select('product_id, quantity, notes')
        .eq('shipment_id', shipment.id);
      if (error) throw error;

      setFormData({
        type: shipment.type,
        customer_name: shipment.customer_name,
        customer_phone: shipment.customer_phone,
        address: shipment.address,
        address_reference: shipment.address_reference || '',
        courier_id: shipment.courier_id || '',
        priority: shipment.priority,
        shipping_cost: shipment.shipping_cost,
        advance_paid: shipment.advance_paid,
        items: (data || []).map((i: { product_id: string; quantity: number; notes: string | null }) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          notes: i.notes || '',
        })),
      });
      setEditingShipment(shipment);
      setLinkedSale(null);
      setShowFormModal(true);
    } catch (error) {
      console.error('Error loading shipment for edit:', error);
      toast.error('Could not load shipment details');
    }
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingShipment(null);
    setFormData(DEFAULT_FORM_DATA);
    setLinkedSale(null);
    setSaleSearchQuery('');
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingShipment) return;
    if (!isFormValid) {
      toast.error(customerNameError || customerPhoneError || addressError || itemsError || 'Please fix the errors before saving');
      return;
    }
    if (!user) {
      toast.error('User not authenticated');
      return;
    }

    setIsSavingShipment(true);
    try {
      const subtotal = calculateSubtotal();
      const total = calculateTotal();
      const shippingCost = isNaN(formData.shipping_cost) ? 0 : formData.shipping_cost;
      const advancePaid = isNaN(formData.advance_paid) ? 0 : formData.advance_paid;

      if (editingShipment) {
        const { error: updateError } = await supabase
          .from('shipments')
          .update({
            type: formData.type,
            customer_name: formData.customer_name.trim(),
            customer_phone: formData.customer_phone.trim(),
            address: formData.address.trim(),
            address_reference: formData.address_reference.trim() || null,
            courier_id: formData.courier_id || null,
            priority: formData.priority,
            subtotal,
            shipping_cost: shippingCost,
            total,
            advance_paid: advancePaid,
          })
          .eq('id', editingShipment.id);
        if (updateError) throw updateError;

        const { error: deleteItemsError } = await supabase
          .from('shipment_items')
          .delete()
          .eq('shipment_id', editingShipment.id);
        if (deleteItemsError) throw deleteItemsError;

        const { error: insertItemsError } = await supabase.from('shipment_items').insert(
          formData.items.map(item => ({
            shipment_id: editingShipment.id,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: products.find(p => p.id === item.product_id)?.price ?? 0,
            notes: item.notes.trim() || null,
          }))
        );
        if (insertItemsError) throw insertItemsError;

        await fetchShipments();
        toast.success('Shipment updated');
      } else {
        const { data: shipment, error: insertError } = await supabase
          .from('shipments')
          .insert([
            {
              sale_id: linkedSale?.id ?? null,
              created_by: user.id,
              courier_id: formData.courier_id || null,
              type: formData.type,
              status: 'pendiente',
              priority: formData.priority,
              customer_name: formData.customer_name.trim(),
              customer_phone: formData.customer_phone.trim(),
              address: formData.address.trim(),
              address_reference: formData.address_reference.trim() || null,
              subtotal,
              shipping_cost: shippingCost,
              total,
              advance_paid: advancePaid,
            },
          ])
          .select()
          .single();
        if (insertError) throw insertError;

        const { error: itemsInsertError } = await supabase.from('shipment_items').insert(
          formData.items.map(item => ({
            shipment_id: shipment.id,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: products.find(p => p.id === item.product_id)?.price ?? 0,
            notes: item.notes.trim() || null,
          }))
        );
        if (itemsInsertError) throw itemsInsertError;

        const courier = formData.courier_id ? couriers.find(c => c.id === formData.courier_id) : undefined;
        setShipments(prev => [
          {
            ...shipment,
            courier: courier ? { first_name: courier.first_name, last_name: courier.last_name } : null,
            purchase: null,
          },
          ...prev,
        ]);
        toast.success('Shipment created');
      }

      closeFormModal();
    } catch (error) {
      console.error('Error saving shipment:', error);
      toast.error(error instanceof Error ? error.message : 'Could not save the shipment');
    } finally {
      setIsSavingShipment(false);
    }
  };

  const fetchShipmentItems = async (shipmentId: string): Promise<ShipmentItemRecord[]> => {
    try {
      const { data, error } = await supabase
        .from('shipment_items')
        .select('*, product:products(name, sku)')
        .eq('shipment_id', shipmentId);
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching shipment items:', error);
      toast.error('Could not load the shipment items');
      return [];
    }
  };

  const openDetailModal = async (shipment: Shipment) => {
    setSelectedShipment(shipment);
    const items = await fetchShipmentItems(shipment.id);
    setSelectedShipmentItems(items);
    fetchPurchaseOptions();
    fetchCouriers();
  };

  const closeDetailModal = () => {
    setSelectedShipment(null);
    setSelectedShipmentItems([]);
  };

  const handleChangeStatus = async (shipment: Shipment, newStatus: ShipmentStatus) => {
    if (updatingStatusId) return;
    if (newStatus === 'entregado') {
      setDeliveringShipment(shipment);
      return;
    }
    if (newStatus === 'en_ruta' && !shipment.courier_id) {
      toast.error('Assign a courier before sending this shipment out');
      return;
    }

    setUpdatingStatusId(shipment.id);
    const updates: Partial<Shipment> = { status: newStatus };
    if (newStatus === 'cancelado') updates.cancelled_at = new Date().toISOString();

    try {
      setShipments(prev => prev.map(s => (s.id === shipment.id ? { ...s, ...updates } : s)));
      setSelectedShipment(prev => (prev && prev.id === shipment.id ? { ...prev, ...updates } : prev));

      const { error } = await supabase.from('shipments').update(updates).eq('id', shipment.id);
      if (error) throw error;
      toast.success('Status updated');
    } catch (error) {
      setShipments(prev => prev.map(s => (s.id === shipment.id ? shipment : s)));
      setSelectedShipment(prev => (prev && prev.id === shipment.id ? shipment : prev));
      console.error('Error updating shipment status:', error);
      toast.error('Could not update the status');
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleAssignCourier = async (shipment: Shipment, courierId: string) => {
    if (assigningCourierId) return;
    setAssigningCourierId(shipment.id);
    const courier = courierId ? couriers.find(c => c.id === courierId) : undefined;
    const updated = { courier_id: courierId || null, courier: courier ? { first_name: courier.first_name, last_name: courier.last_name } : null };

    try {
      setShipments(prev => prev.map(s => (s.id === shipment.id ? { ...s, ...updated } : s)));
      setSelectedShipment(prev => (prev && prev.id === shipment.id ? { ...prev, ...updated } : prev));

      const { error } = await supabase.from('shipments').update({ courier_id: courierId || null }).eq('id', shipment.id);
      if (error) throw error;
      toast.success('Courier assigned');
    } catch (error) {
      setShipments(prev => prev.map(s => (s.id === shipment.id ? shipment : s)));
      setSelectedShipment(prev => (prev && prev.id === shipment.id ? shipment : prev));
      console.error('Error assigning courier:', error);
      toast.error('Could not assign the courier');
    } finally {
      setAssigningCourierId(null);
    }
  };

  const handleLinkPurchase = async (shipment: Shipment, purchaseId: string) => {
    try {
      setShipments(prev => prev.map(s => (s.id === shipment.id ? { ...s, purchase_id: purchaseId || null } : s)));
      setSelectedShipment(prev => (prev && prev.id === shipment.id ? { ...prev, purchase_id: purchaseId || null } : prev));

      const { error } = await supabase.from('shipments').update({ purchase_id: purchaseId || null }).eq('id', shipment.id);
      if (error) throw error;
      toast.success('Purchase linked');
    } catch (error) {
      console.error('Error linking purchase:', error);
      toast.error('Could not link the purchase');
    }
  };

  const uploadDeliveryPhoto = async (shipmentId: string, file: File): Promise<string> => {
    if (!file.type.startsWith('image/')) {
      throw new Error('The file must be an image');
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new Error('The photo cannot be larger than 5MB');
    }
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${shipmentId}/proof.${ext}`;
    const { error } = await supabase.storage.from('delivery-proofs').upload(path, file, {
      upsert: true,
      contentType: file.type,
    });
    if (error) throw error;
    return path;
  };

  const handleConfirmDelivery = async () => {
    if (!deliveringShipment || isDelivering) return;
    setIsDelivering(true);
    try {
      let photoPath: string | null = null;
      if (deliverPhotoFile) {
        photoPath = await uploadDeliveryPhoto(deliveringShipment.id, deliverPhotoFile);
      }

      const updates: Partial<Shipment> = {
        status: 'entregado',
        delivered_at: new Date().toISOString(),
        recipient_name: deliverRecipient.trim() || null,
        delivery_notes: deliverComments.trim() || null,
      };
      if (photoPath) {
        updates.delivery_photo_path = photoPath;
        updates.delivery_photo_uploaded_at = new Date().toISOString();
      }

      const { error } = await supabase.from('shipments').update(updates).eq('id', deliveringShipment.id);
      if (error) throw error;

      setShipments(prev => prev.map(s => (s.id === deliveringShipment.id ? { ...s, ...updates } : s)));
      setSelectedShipment(prev => (prev && prev.id === deliveringShipment.id ? { ...prev, ...updates } : prev));

      toast.success('Shipment marked as delivered');
      setDeliveringShipment(null);
      setDeliverRecipient('');
      setDeliverComments('');
      setDeliverPhotoFile(null);
    } catch (error) {
      console.error('Error marking shipment as delivered:', error);
      toast.error(error instanceof Error ? error.message : 'Could not mark the shipment as delivered');
    } finally {
      setIsDelivering(false);
    }
  };

  const handlePrintDeliveryNote = () => {
    if (!selectedShipment) return;
    const s = selectedShipment;
    const lines: string[] = [];
    lines.push('DELIVERY NOTE');
    lines.push(`Shipment #${s.id.slice(0, 8).toUpperCase()}`);
    if (s.sale_id) lines.push(`Sale #${s.sale_id.slice(0, 8).toUpperCase()}`);
    lines.push(`Type: ${s.type === 'local' ? 'From Stock' : 'Made to Order'}`);
    lines.push(`Priority: ${s.priority === 'urgente' ? 'URGENT' : 'Normal'}`);
    lines.push('');
    lines.push(`Customer: ${s.customer_name}`);
    lines.push(`Phone: ${s.customer_phone}`);
    lines.push(`Address: ${s.address}`);
    if (s.address_reference) lines.push(`Reference: ${s.address_reference}`);
    if (s.courier) lines.push(`Courier: ${s.courier.first_name} ${s.courier.last_name}`);
    lines.push('');
    lines.push('Products:');
    selectedShipmentItems.forEach(item => {
      lines.push(`  ${item.quantity} x ${item.product?.name || item.product_id} - ${formatCurrency(item.unit_price * item.quantity)}`);
      if (item.notes) lines.push(`    Note: ${item.notes}`);
    });
    lines.push('');
    lines.push(`Subtotal: ${formatCurrency(s.subtotal)}`);
    lines.push(`Shipping Cost: ${formatCurrency(s.shipping_cost)}`);
    lines.push(`Total: ${formatCurrency(s.total)}`);
    lines.push(`Advance Paid: ${formatCurrency(s.advance_paid)}`);
    lines.push(`Amount Due: ${formatCurrency(roundCurrency(s.total - s.advance_paid))}`);

    try {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write('<pre style="font-family: monospace; font-size: 12px; white-space: pre-wrap; margin: 0; padding: 10px;">');
        printWindow.document.write(lines.join('\n'));
        printWindow.document.write('</pre>');
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 250);
      } else {
        toast.error('Enable pop-ups to print the delivery note');
      }
    } catch (error) {
      console.error('Error printing delivery note:', error);
      toast.error('Could not print the delivery note');
    }
  };

  if (!user || !hasPermission(user.role as UserRole, 'canAccessShipments')) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <p className="text-red-600">You need admin, manager or cashier permissions to access shipments</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Shipments</h1>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
        >
          ➕ <span className="ml-2">New Shipment</span>
        </button>
      </div>

      {/* Summary panel */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white shadow rounded-lg p-4">
          <p className="text-xs text-gray-500">Pending Shipments</p>
          <p className="text-2xl font-semibold text-gray-900">{summary.pending}</p>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <p className="text-xs text-gray-500">In Preparation</p>
          <p className="text-2xl font-semibold text-gray-900">{summary.inPreparation}</p>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <p className="text-xs text-gray-500">In Transit</p>
          <p className="text-2xl font-semibold text-gray-900">{summary.inTransit}</p>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <p className="text-xs text-gray-500">Delivered Today</p>
          <p className="text-2xl font-semibold text-gray-900">{summary.deliveredToday}</p>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <p className="text-xs text-gray-500">Made-to-Order Awaiting Purchase</p>
          <p className="text-2xl font-semibold text-gray-900">{summary.madeToOrderAwaitingPurchase}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white shadow rounded-lg p-4 space-y-4">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px] relative">
            <span className="absolute left-3 top-2.5">🔍</span>
            <input
              type="text"
              placeholder="Search by customer, phone or ID..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-10 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="all">📍 All Statuses</option>
            {(Object.keys(STATUS_META) as ShipmentStatus[]).map(status => (
              <option key={status} value={status}>
                {STATUS_META[status].emoji} {STATUS_META[status].label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowDateFilter(prev => !prev)}
            className={`inline-flex items-center px-3 py-2 border rounded-md text-sm font-medium ${
              showDateFilter ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            📅 <span className="ml-2">Filter by Date</span>
          </button>
          <button
            type="button"
            onClick={() => setShowRoutesToday(prev => !prev)}
            className={`inline-flex items-center px-3 py-2 border rounded-md text-sm font-medium ${
              showRoutesToday ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            🚚 <span className="ml-2">Today's Routes</span>
          </button>
        </div>
        {showDateFilter && (
          <div className="flex flex-wrap gap-4 items-center">
            <div>
              <label className="block text-xs font-medium text-gray-500">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="mt-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="mt-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                className="mt-5 text-sm text-gray-500 hover:text-gray-700"
              >
                Clear dates
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center p-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : showRoutesToday ? (
        <div className="space-y-4">
          {routesToday.length === 0 ? (
            <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">No shipments in transit right now</div>
          ) : (
            routesToday.map(group => (
              <div key={group.courierName} className="bg-white shadow rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">🚚 {group.courierName}</h3>
                <div className="space-y-2">
                  {group.shipments.map(shipment => (
                    <button
                      key={shipment.id}
                      onClick={() => openDetailModal(shipment)}
                      className="w-full flex justify-between items-center text-left px-3 py-2 rounded-md hover:bg-gray-50"
                    >
                      <span>
                        {shipment.priority === 'urgente' && <span className="text-red-600 font-semibold mr-1">URGENT</span>}
                        {shipment.customer_name} - {shipment.address}
                      </span>
                      <span className="text-sm text-gray-400">#{shipment.id.slice(0, 8).toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : filteredShipments.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">No shipments found</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredShipments.map(shipment => (
            <div
              key={shipment.id}
              className={`bg-white shadow rounded-lg p-4 border-l-4 ${
                shipment.priority === 'urgente' ? 'border-red-500' : 'border-transparent'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="min-w-0">
                  <p className="text-xs text-gray-400 font-mono truncate">
                    #{shipment.id.slice(0, 8).toUpperCase()}
                    {shipment.sale_id && ` · Sale #${shipment.sale_id.slice(0, 8).toUpperCase()}`}
                  </p>
                  <p className="font-medium text-gray-900 truncate">{shipment.customer_name}</p>
                  <p className="text-sm text-gray-500 truncate">{shipment.address}</p>
                </div>
                {shipment.priority === 'urgente' && (
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-800 whitespace-nowrap">
                    URGENT
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_META[shipment.status].color}`}>
                  {STATUS_META[shipment.status].emoji} {STATUS_META[shipment.status].label}
                </span>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-gray-100 text-gray-700">
                  {shipment.type === 'local' ? 'From Stock' : 'Made to Order'}
                </span>
              </div>

              <div className="mt-3 flex justify-between text-sm">
                <span className="text-gray-500">
                  Total: <span className="font-medium text-gray-900">{formatCurrency(shipment.total)}</span>
                </span>
                <span className="text-gray-500">
                  Due:{' '}
                  <span className="font-medium text-gray-900">
                    {formatCurrency(roundCurrency(shipment.total - shipment.advance_paid))}
                  </span>
                </span>
              </div>

              <p className="mt-2 text-xs text-gray-500">
                Courier: {shipment.courier ? `${shipment.courier.first_name} ${shipment.courier.last_name}` : 'Unassigned'}
              </p>

              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                <button onClick={() => openDetailModal(shipment)} className="text-blue-600 hover:text-blue-900 font-medium">
                  View
                </button>
                <button
                  onClick={() => setLocationShipment(shipment)}
                  className="text-gray-600 hover:text-gray-900 flex items-center"
                >
                  <MapPin className="h-4 w-4 mr-1" /> Location
                </button>
                {shipment.status !== 'entregado' && shipment.status !== 'cancelado' && (
                  <button
                    onClick={() => handleChangeStatus(shipment, 'entregado')}
                    disabled={updatingStatusId === shipment.id}
                    className="text-green-600 hover:text-green-900 font-medium disabled:opacity-50"
                  >
                    Mark Delivered
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New/Edit Shipment Modal */}
      {showFormModal &&
        createPortal(
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <form onSubmit={handleSubmitForm} className="p-6">
                <div className="flex justify-between items-start mb-6">
                  <h2 className="text-xl font-semibold text-gray-900">{editingShipment ? 'Edit Shipment' : 'New Shipment'}</h2>
                  <button type="button" onClick={closeFormModal} className="text-gray-400 hover:text-gray-500">
                    <X className="h-6 w-6" />
                  </button>
                </div>

                <div className="space-y-6">
                  {!editingShipment && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Related Sale (optional)</label>
                      {linkedSale ? (
                        <div className="flex items-center justify-between p-3 bg-blue-50 rounded-md">
                          <span className="text-sm text-blue-900">
                            Sale #{linkedSale.id.slice(0, 8).toUpperCase()} - {formatCurrency(linkedSale.total)}
                          </span>
                          <button type="button" onClick={() => setLinkedSale(null)} className="text-blue-600 hover:text-blue-800 text-sm">
                            Unlink
                          </button>
                        </div>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={saleSearchQuery}
                            onChange={e => setSaleSearchQuery(e.target.value)}
                            placeholder="Search recent sales by customer or ID..."
                            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                          />
                          {filteredSaleResults.length > 0 && (
                            <div className="mt-2 max-h-32 overflow-y-auto border border-gray-200 rounded-md divide-y">
                              {filteredSaleResults.map(sale => (
                                <button
                                  key={sale.id}
                                  type="button"
                                  onClick={() => handleSelectSale(sale)}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                                >
                                  #{sale.id.slice(0, 8).toUpperCase()} -{' '}
                                  {sale.customer ? `${sale.customer.first_name} ${sale.customer.last_name}` : 'Walk-in'} -{' '}
                                  {formatCurrency(sale.total)}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Shipment Type</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        disabled={!!editingShipment && editingShipment.status !== 'pendiente'}
                        onClick={() => setFormData(prev => ({ ...prev, type: 'local' }))}
                        className={`p-3 border rounded-md text-left disabled:opacity-50 disabled:cursor-not-allowed ${
                          formData.type === 'local' ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                        }`}
                      >
                        <p className="font-medium text-sm text-gray-900">📦 From Stock</p>
                        <p className="text-xs text-gray-500">Product is already in inventory and ready to prepare.</p>
                      </button>
                      <button
                        type="button"
                        disabled={!!editingShipment && editingShipment.status !== 'pendiente'}
                        onClick={() => setFormData(prev => ({ ...prev, type: 'sobre_pedido' }))}
                        className={`p-3 border rounded-md text-left disabled:opacity-50 disabled:cursor-not-allowed ${
                          formData.type === 'sobre_pedido' ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                        }`}
                      >
                        <p className="font-medium text-sm text-gray-900">🛒 Made to Order</p>
                        <p className="text-xs text-gray-500">Material must be purchased from a supplier before scheduling delivery.</p>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Customer Name</label>
                      <input
                        type="text"
                        value={formData.customer_name}
                        onChange={e => setFormData(prev => ({ ...prev, customer_name: e.target.value }))}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Phone</label>
                      <input
                        type="text"
                        value={formData.customer_phone}
                        onChange={e => setFormData(prev => ({ ...prev, customer_phone: e.target.value }))}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        required
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700">Address</label>
                      <input
                        type="text"
                        value={formData.address}
                        onChange={e => setFormData(prev => ({ ...prev, address: e.target.value }))}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        required
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700">Location Reference (optional)</label>
                      <input
                        type="text"
                        value={formData.address_reference}
                        onChange={e => setFormData(prev => ({ ...prev, address_reference: e.target.value }))}
                        placeholder="e.g. Blue gate, next to the pharmacy"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Courier (optional)</label>
                      <select
                        value={formData.courier_id}
                        onChange={e => setFormData(prev => ({ ...prev, courier_id: e.target.value }))}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      >
                        <option value="">Unassigned</option>
                        {couriers.map(courier => (
                          <option key={courier.id} value={courier.id}>
                            {courier.first_name} {courier.last_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, priority: 'normal' }))}
                          className={`flex-1 px-3 py-2 border rounded-md text-sm font-medium ${
                            formData.priority === 'normal' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700'
                          }`}
                        >
                          Normal
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, priority: 'urgente' }))}
                          className={`flex-1 px-3 py-2 border rounded-md text-sm font-medium ${
                            formData.priority === 'urgente' ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-300 text-gray-700'
                          }`}
                        >
                          Urgent
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-medium text-gray-900">Products</h3>
                      <button
                        type="button"
                        onClick={handleAddItem}
                        disabled={products.length === 0}
                        className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add Product
                      </button>
                    </div>

                    <div className="space-y-4">
                      {formData.items.map((item, index) => {
                        const product = products.find(p => p.id === item.product_id);
                        return (
                          <div key={index} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                            <div className="flex-1">
                              <select
                                value={item.product_id}
                                onChange={e => handleItemChange(index, 'product_id', e.target.value)}
                                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                required
                              >
                                <option value="">Select Product</option>
                                {products.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} ({p.sku})
                                  </option>
                                ))}
                              </select>
                              <input
                                type="text"
                                value={item.notes}
                                onChange={e => handleItemChange(index, 'notes', e.target.value)}
                                placeholder="Notes (optional)"
                                className="mt-2 block w-full rounded-md border-gray-300 shadow-sm text-sm focus:border-blue-500 focus:ring-blue-500"
                              />
                            </div>
                            <div className="w-24">
                              <input
                                type="number"
                                min="1"
                                value={isNaN(item.quantity) ? 0 : item.quantity}
                                onChange={e => handleItemChange(index, 'quantity', parseInt(e.target.value))}
                                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                placeholder="Qty"
                                required
                              />
                            </div>
                            <div className="w-32 text-right font-medium">
                              {formatCurrency((product?.price || 0) * (isNaN(item.quantity) ? 0 : item.quantity))}
                            </div>
                            <button type="button" onClick={() => handleRemoveItem(index)} className="text-red-600 hover:text-red-800">
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {itemsError && <p className="mt-2 text-sm text-red-600">{itemsError}</p>}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Shipping Cost</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={isNaN(formData.shipping_cost) ? 0 : formData.shipping_cost}
                        onChange={e => setFormData(prev => ({ ...prev, shipping_cost: parseFloat(e.target.value) }))}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Advance Paid</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={isNaN(formData.advance_paid) ? 0 : formData.advance_paid}
                        onChange={e => setFormData(prev => ({ ...prev, advance_paid: parseFloat(e.target.value) }))}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                      {linkedSale && (
                        <p className="mt-1 text-xs text-gray-400">Defaulted to the linked sale's total (already collected at checkout).</p>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-gray-200 pt-4">
                    <div className="flex justify-end">
                      <div className="text-right space-y-1">
                        <div className="text-sm text-gray-500">Subtotal: {formatCurrency(calculateSubtotal())}</div>
                        <div className="text-lg font-medium text-gray-900">Total: {formatCurrency(calculateTotal())}</div>
                        <div className="text-sm text-gray-500">Amount Due: {formatCurrency(calculatePending())}</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={closeFormModal}
                      className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!isFormValid || isSavingShipment}
                      className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSavingShipment ? 'Saving...' : editingShipment ? 'Save Changes' : 'Create Shipment'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* Shipment Detail Modal */}
      {selectedShipment &&
        createPortal(
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Shipment #{selectedShipment.id.slice(0, 8).toUpperCase()}</h2>
                    {selectedShipment.sale_id && (
                      <p className="text-sm text-gray-500">Sale #{selectedShipment.sale_id.slice(0, 8).toUpperCase()}</p>
                    )}
                  </div>
                  <button onClick={closeDetailModal} className="text-gray-400 hover:text-gray-500">
                    <X className="h-6 w-6" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 mb-6">
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_META[selectedShipment.status].color}`}>
                    {STATUS_META[selectedShipment.status].emoji} {STATUS_META[selectedShipment.status].label}
                  </span>
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-gray-100 text-gray-700">
                    {selectedShipment.type === 'local' ? 'From Stock' : 'Made to Order'}
                  </span>
                  {selectedShipment.priority === 'urgente' && (
                    <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-800">URGENT</span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-2">Customer</h3>
                    <p className="text-sm text-gray-900">{selectedShipment.customer_name}</p>
                    <p className="text-sm text-gray-500">{selectedShipment.customer_phone}</p>
                    <p className="text-sm text-gray-500 mt-1">{selectedShipment.address}</p>
                    {selectedShipment.address_reference && (
                      <p className="text-sm text-gray-400">Reference: {selectedShipment.address_reference}</p>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-2">Courier</h3>
                    <select
                      value={selectedShipment.courier_id || ''}
                      onChange={e => handleAssignCourier(selectedShipment, e.target.value)}
                      disabled={assigningCourierId === selectedShipment.id}
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
                    >
                      <option value="">Unassigned</option>
                      {couriers.map(courier => (
                        <option key={courier.id} value={courier.id}>
                          {courier.first_name} {courier.last_name}
                        </option>
                      ))}
                    </select>

                    {selectedShipment.type === 'sobre_pedido' && (
                      <div className="mt-4">
                        <h3 className="text-sm font-medium text-gray-500 mb-2">Linked Purchase</h3>
                        <select
                          value={selectedShipment.purchase_id || ''}
                          onChange={e => handleLinkPurchase(selectedShipment, e.target.value)}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        >
                          <option value="">No purchase linked</option>
                          {purchaseOptions.map(purchase => (
                            <option key={purchase.id} value={purchase.id}>
                              {purchase.reference_number || purchase.id.slice(0, 8).toUpperCase()} - {purchase.supplier?.name} ({purchase.status})
                            </option>
                          ))}
                        </select>
                        <Link to="/purchases" className="mt-1 inline-block text-xs text-blue-600 hover:text-blue-800">
                          + Create new purchase
                        </Link>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-6 mb-6">
                  <h3 className="text-sm font-medium text-gray-500 mb-4">Products</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {selectedShipmentItems.map(item => (
                          <tr key={item.id}>
                            <td className="px-4 py-2 text-sm text-gray-900">
                              {item.product?.name || item.product_id}
                              {item.notes && <span className="block text-xs text-gray-400">{item.notes}</span>}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-500 text-right">{item.quantity}</td>
                            <td className="px-4 py-2 text-sm text-gray-900 text-right">
                              {formatCurrency(item.unit_price * item.quantity)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 text-right space-y-1">
                    <p className="text-sm text-gray-500">Subtotal: {formatCurrency(selectedShipment.subtotal)}</p>
                    <p className="text-sm text-gray-500">Shipping Cost: {formatCurrency(selectedShipment.shipping_cost)}</p>
                    <p className="text-sm font-medium text-gray-900">Total: {formatCurrency(selectedShipment.total)}</p>
                    <p className="text-sm text-gray-500">Advance Paid: {formatCurrency(selectedShipment.advance_paid)}</p>
                    <p className="text-sm font-semibold text-gray-900">
                      Amount Due: {formatCurrency(roundCurrency(selectedShipment.total - selectedShipment.advance_paid))}
                    </p>
                  </div>
                </div>

                {selectedShipment.status === 'entregado' && (
                  <div className="border-t border-gray-200 pt-6 mb-6">
                    <h3 className="text-sm font-medium text-gray-500 mb-2">Delivery Evidence</h3>
                    {selectedShipment.recipient_name && (
                      <p className="text-sm text-gray-900">Received by: {selectedShipment.recipient_name}</p>
                    )}
                    {selectedShipment.delivery_notes && (
                      <p className="text-sm text-gray-500">Comments: {selectedShipment.delivery_notes}</p>
                    )}
                    {!selectedShipment.delivery_photo_path && (
                      <p className="text-xs text-gray-400">No photo on file (or it has already been auto-removed after 15 days).</p>
                    )}
                  </div>
                )}

                <div className="border-t border-gray-200 pt-6 flex flex-wrap gap-3">
                  {getAllowedNextStatuses(selectedShipment).map(option => (
                    <button
                      key={option.value}
                      onClick={() => handleChangeStatus(selectedShipment, option.value)}
                      disabled={updatingStatusId === selectedShipment.id}
                      className={`px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50 ${
                        option.value === 'cancelado'
                          ? 'bg-red-50 text-red-700 hover:bg-red-100'
                          : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                  {selectedShipment.status !== 'entregado' && selectedShipment.status !== 'cancelado' && (
                    <button
                      onClick={() => openEditModal(selectedShipment)}
                      className="px-3 py-2 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
                    >
                      Edit Shipment
                    </button>
                  )}
                  <button
                    onClick={handlePrintDeliveryNote}
                    className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
                  >
                    <Printer className="h-4 w-4 mr-1" /> Print Note
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Location Popover */}
      {locationShipment &&
        createPortal(
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            onClick={() => setLocationShipment(null)}
          >
            <div className="bg-white rounded-lg max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <MapPin className="h-5 w-5 mr-2 text-blue-600" />
                  Delivery Location
                </h3>
                <button onClick={() => setLocationShipment(null)} className="text-gray-400 hover:text-gray-500">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="text-sm text-gray-900">{locationShipment.address}</p>
              {locationShipment.address_reference && (
                <p className="text-sm text-gray-500 mt-1">Reference: {locationShipment.address_reference}</p>
              )}
              <p className="text-sm text-gray-500 mt-3">
                {locationShipment.customer_name} · {locationShipment.customer_phone}
              </p>
            </div>
          </div>,
          document.body
        )}

      {/* Mark as Delivered Modal */}
      {deliveringShipment &&
        createPortal(
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-md w-full p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Mark as Delivered</h3>
                <button
                  onClick={() => !isDelivering && setDeliveringShipment(null)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Recipient Name (optional)</label>
                  <input
                    type="text"
                    value={deliverRecipient}
                    onChange={e => setDeliverRecipient(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Comments (optional)</label>
                  <textarea
                    value={deliverComments}
                    onChange={e => setDeliverComments(e.target.value)}
                    rows={2}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Photo Evidence (optional)</label>
                  <label className="mt-1 flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-md p-4 cursor-pointer hover:border-blue-400">
                    <Camera className="h-5 w-5 text-gray-400" />
                    <span className="text-sm text-gray-500">{deliverPhotoFile ? deliverPhotoFile.name : 'Tap to choose a photo'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => setDeliverPhotoFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  <p className="mt-1 text-xs text-gray-400">Photos are automatically removed after {PHOTO_RETENTION_DAYS} days.</p>
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setDeliveringShipment(null)}
                  disabled={isDelivering}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelivery}
                  disabled={isDelivering}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                >
                  {isDelivering ? 'Saving...' : 'Confirm Delivery'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
