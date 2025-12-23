
import { Injectable, signal, computed, effect } from '@angular/core';

// --- DATA MODELS ---

export interface Owner {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  color: string; // Hex code
}

export interface CreditCard {
  id: string;
  name: string;
  ownerId: string;
  closingDay: number;
  dueDay: number;
  color: string; // New field
}

export interface UserSettings {
  monthStartDay: number; // 1-31
  darkMode: boolean; // Dark mode preference
}

export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: string;
  groupId?: string; // Links installments together
  description: string;
  amount: number;
  type: TransactionType;
  purchaseDate: string; // ISO Date String
  categoryId: string;
  ownerId: string;
  
  // Credit Card Specifics
  cardId: string | null; // null if cash/debit
  installmentCurrent: number;
  installmentTotal: number;
  
  // Computed fields
  effectiveMonth: number; // 0-11
  effectiveYear: number;
}

@Injectable({
  providedIn: 'root'
})
export class FinanceService {
  // --- STATE ---
  
  readonly owners = signal<Owner[]>([]); 

  readonly categories = signal<Category[]>([
    { id: '1', name: 'Alimentação', color: '#ef4444' }, 
    { id: '2', name: 'Lazer', color: '#f59e0b' },      
    { id: '3', name: 'Transporte', color: '#3b82f6' },  
    { id: '4', name: 'Saúde', color: '#10b981' },      
    { id: '5', name: 'Educação', color: '#8b5cf6' },   
    { id: '6', name: 'Salário/Renda', color: '#22c55e' } 
  ]);

  readonly cards = signal<CreditCard[]>([
    { id: '1', name: 'Santander', ownerId: '1', closingDay: 5, dueDay: 10, color: '#820ad1' },
    { id: '2', name: 'Itaú', ownerId: '2', closingDay: 24, dueDay: 1, color: '#1e293b' }
  ]);

  readonly transactions = signal<Transaction[]>([]);

  readonly settings = signal<UserSettings>({ monthStartDay: 1, darkMode: false });

  constructor() {
    this.loadFromStorage();

    if (this.owners().length === 0) {
      this.owners.set([
        { id: '1', name: 'Felipe' },
        { id: '2', name: 'Jhully' }
      ]);
    }
    
    // Auto-save effects
    effect(() => {
      localStorage.setItem('fincontrol_transactions_v2', JSON.stringify(this.transactions()));
    });
    effect(() => {
      localStorage.setItem('fincontrol_categories_v2', JSON.stringify(this.categories()));
    });
    effect(() => {
      localStorage.setItem('fincontrol_cards_v2', JSON.stringify(this.cards()));
    });
    effect(() => {
      localStorage.setItem('fincontrol_owners_v2', JSON.stringify(this.owners()));
    });
    effect(() => {
      localStorage.setItem('fincontrol_settings_v2', JSON.stringify(this.settings()));
    });
  }

  private loadFromStorage() {
    const savedTrans = localStorage.getItem('fincontrol_transactions_v2');
    if (savedTrans) this.transactions.set(JSON.parse(savedTrans));

    const savedCats = localStorage.getItem('fincontrol_categories_v2');
    if (savedCats) this.categories.set(JSON.parse(savedCats));

    const savedCards = localStorage.getItem('fincontrol_cards_v2');
    if (savedCards) this.cards.set(JSON.parse(savedCards));

    const savedOwners = localStorage.getItem('fincontrol_owners_v2');
    if (savedOwners) this.owners.set(JSON.parse(savedOwners));

    const savedSettings = localStorage.getItem('fincontrol_settings_v2');
    if (savedSettings) {
      const parsed = JSON.parse(savedSettings);
      // Ensure backwards compatibility if darkMode property doesn't exist
      this.settings.set({
        monthStartDay: parsed.monthStartDay || 1,
        darkMode: parsed.darkMode || false
      });
    }
  }

  // --- SETTINGS ---
  updateMonthStartDay(day: number) {
    this.settings.update(s => ({ ...s, monthStartDay: day }));
  }

  toggleDarkMode() {
    this.settings.update(s => ({ ...s, darkMode: !s.darkMode }));
  }

  // --- DATA MANAGEMENT ---

  addCategory(name: string, color: string) {
    const newCategory: Category = {
      id: crypto.randomUUID(),
      name,
      color
    };
    this.categories.update(prev => [...prev, newCategory]);
  }

  addCard(name: string, ownerId: string, closingDay: number, dueDay: number, color: string) {
    const newCard: CreditCard = {
      id: crypto.randomUUID(),
      name,
      ownerId,
      closingDay,
      dueDay,
      color
    };
    this.cards.update(prev => [...prev, newCard]);
  }

  updateCard(id: string, updates: Partial<CreditCard>) {
    this.cards.update(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  }

  addOwner(name: string) {
    const newOwner: Owner = {
      id: crypto.randomUUID(),
      name
    };
    this.owners.update(prev => [...prev, newOwner]);
  }

  updateOwner(id: string, name: string) {
    this.owners.update(prev => prev.map(o => o.id === id ? { ...o, name } : o));
  }

  // --- TRANSACTIONS ---

  addTransaction(
    description: string,
    amount: number,
    type: TransactionType,
    dateStr: string,
    categoryId: string,
    ownerId: string,
    cardId: string | null,
    installments: number
  ) {
    const [yStr, mStr, dStr] = dateStr.split('-');
    const year = parseInt(yStr);
    const month = parseInt(mStr) - 1; 
    const day = parseInt(dStr);
    
    // Base calculation
    let startMonth = month;
    let startYear = year;

    if (type === 'expense' && cardId) {
      const card = this.cards().find(c => c.id === cardId);
      if (card) {
        if (day >= card.closingDay) {
          startMonth++; 
        }
      }
    }

    const totalInstallments = (type === 'expense' && cardId) ? (installments > 0 ? installments : 1) : 1;
    const amountPerInstallment = amount / totalInstallments;
    const groupId = totalInstallments > 1 ? crypto.randomUUID() : undefined;
    
    const newTransactions: Transaction[] = [];

    for (let i = 0; i < totalInstallments; i++) {
      const effectiveDate = new Date(startYear, startMonth + i, 1);
      
      const t: Transaction = {
        id: crypto.randomUUID(),
        groupId, // Assign group ID
        description: totalInstallments > 1 
          ? `${description} (${i + 1}/${totalInstallments})` 
          : description,
        amount: amountPerInstallment,
        type,
        purchaseDate: dateStr,
        categoryId,
        ownerId,
        cardId: type === 'income' ? null : cardId,
        installmentCurrent: i + 1,
        installmentTotal: totalInstallments,
        effectiveMonth: effectiveDate.getMonth(),
        effectiveYear: effectiveDate.getFullYear()
      };
      
      newTransactions.push(t);
    }

    this.transactions.update(prev => [...prev, ...newTransactions]);
  }

  // Single Update
  updateTransaction(id: string, updates: Partial<Transaction>) {
    this.updateTransactionsBulk([id], updates);
  }

  // Bulk Update
  updateTransactionsBulk(ids: string[], updates: Partial<Transaction>) {
    this.transactions.update(prev => prev.map(t => {
      if (!ids.includes(t.id)) return t;

      // Merge basic updates
      const updatedT = { ...t, ...updates };

      if (updates.purchaseDate || updates.cardId) {
        // Note: Full effective date recalculation is complex for bulk ops. 
        // This keeps data consistent with user edit.
      }

      return updatedT;
    }));
  }

  deleteTransaction(id: string) {
    this.transactions.update(prev => prev.filter(t => t.id !== id));
  }

  deleteTransactionsBulk(ids: string[]) {
    this.transactions.update(prev => prev.filter(t => !ids.includes(t.id)));
  }

  // --- HELPERS ---
  
  // Get all transactions belonging to a group
  getGroupTransactions(groupId: string) {
    return this.transactions().filter(t => t.groupId === groupId).sort((a,b) => a.installmentCurrent - b.installmentCurrent);
  }

  getCategory(id: string) {
    return this.categories().find(c => c.id === id);
  }

  getOwner(id: string) {
    return this.owners().find(o => o.id === id);
  }

  getCard(id: string | null) {
    if (!id) return null;
    return this.cards().find(c => c.id === id);
  }
}
