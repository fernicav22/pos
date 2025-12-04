import { supabase } from '../lib/supabase';

interface StockItem {
  product_id: string;
  quantity: number;
}

export async function checkStock(items: StockItem[]) {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, stock_quantity')
      .in('id', items.map(item => item.product_id));

    if (error) throw error;

    const stockMap = new Map(products.map(p => [p.id, p.stock_quantity]));
    
    // Check if all items have sufficient stock
    const insufficientItems = items.filter(item => {
      const currentStock = stockMap.get(item.product_id) || 0;
      return currentStock < item.quantity;
    });

    return {
      hasStock: insufficientItems.length === 0,
      insufficientItems
    };
  } catch (error) {
    console.error('Error checking stock:', error);
    throw error;
  }
}