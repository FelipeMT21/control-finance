
import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap, forkJoin, map, Observable, catchError, throwError } from 'rxjs';

// --- DATA MODELS ---

export interface Owner {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
}

export interface CreditCard {
  id: string;
  name: string;
  ownerId: string;
  closingDay: number;
  dueDay: number;
  color: string;
}

export interface UserSettings {
  monthStartDay: number;
  darkMode: boolean;
}

export type TransactionType = 'income' | 'expense';

// Adjusted Interface for Backend Compatibility
export interface Transaction {
  id: string; // UUID from Backend
  description: string;
  amount: number;
  type: TransactionType; // Frontend uses lowercase, Backend expects UPPERCASE
  purchaseDate: string; // ISO LocalDateTime string
  category: string; // Backend stores the Name of the category

  // Optional fields (Frontend logic / Not persisted in current Backend entity)
  categoryId?: string;
  ownerId?: string;
  cardId?: string | null;
  groupId?: string;
  installmentCurrent?: number;
  installmentTotal?: number;

  // Computed fields (Calculated on frontend after load)
  effectiveMonth?: number;
  effectiveYear?: number;
}

@Injectable({
  providedIn: 'root'
})
export class FinanceService {
  private http: HttpClient = inject(HttpClient);
  private readonly API_URL = 'http://localhost:8080/transaction';

  // --- STATE ---

  // LocalStorage managed entities (Not in Java yet)
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
    { id: '2', name: 'Itaú', ownerId: '2', closingDay: 20, dueDay: 25, color: '#1e293b' }
  ]);
  readonly settings = signal<UserSettings>({ monthStartDay: 1, darkMode: false });

  // Backend managed entity (Private write, Public read-only)
  private _transactions = signal<Transaction[]>([]);
  readonly transactions = this._transactions.asReadonly();

  constructor() {
    this.loadStorageData(); // Load Owners, Cards, Categories, Settings
    this.loadAll(); // Load Transactions from API

    if (this.owners().length === 0) {
      this.owners.set([
        { id: '1', name: 'Titular 1' },
        { id: '2', name: 'Titular 2' }
      ]);
    }

    // Auto-save effects (Only for non-backend entities)
    effect(() => localStorage.setItem('fincontrol_categories_v2', JSON.stringify(this.categories())));
    effect(() => localStorage.setItem('fincontrol_cards_v2', JSON.stringify(this.cards())));
    effect(() => localStorage.setItem('fincontrol_owners_v2', JSON.stringify(this.owners())));
    effect(() => localStorage.setItem('fincontrol_settings_v2', JSON.stringify(this.settings())));
  }

  private loadStorageData() {
    const savedCats = localStorage.getItem('fincontrol_categories_v2');
    if (savedCats) this.categories.set(JSON.parse(savedCats));

    const savedCards = localStorage.getItem('fincontrol_cards_v2');
    if (savedCards) this.cards.set(JSON.parse(savedCards));

    const savedOwners = localStorage.getItem('fincontrol_owners_v2');
    if (savedOwners) this.owners.set(JSON.parse(savedOwners));

    const savedSettings = localStorage.getItem('fincontrol_settings_v2');
    if (savedSettings) this.settings.set(JSON.parse(savedSettings));
  }

  // --- HTTP METHODS ---

  loadAll() {
    this.http.get<any[]>(this.API_URL).subscribe({
      next: (data) => {
        // Map backend data to frontend structure
        const mappedData: Transaction[] = data.map(t => {
          const dateObj = new Date(t.purchaseDate);

          // Try to recover categoryId from Name to show correct colors
          const matchedCategory = this.categories().find(c => c.name === t.category);

          return {
            ...t,
            // Convert Java Enum (INCOME) to Frontend (income)
            type: t.type.toLowerCase() as TransactionType,

            // Restore IDs if possible (Best effort)
            categoryId: matchedCategory?.id,

            // Calculate effective dates for UI filtering
            effectiveMonth: dateObj.getMonth(),
            effectiveYear: dateObj.getFullYear(),

            // Defaults for fields missing in Backend
            installmentCurrent: 1,
            installmentTotal: 1
          };
        });
        this._transactions.set(mappedData);
      },
      error: (err) => console.error('Failed to load transactions from API', err)
    });
  }

  addTransaction(
    description: string,
    amount: number,
    type: TransactionType,
    dateStr: string,
    categoryId: string,
    ownerId: string,
    cardId: string | null,
    installments: number
  ): Observable<any> {
    // 1. Desmontando a data original
    const [yStr, mStr, dStr] = dateStr.split('-');
    const year = parseInt(yStr);
    const month = parseInt(mStr) - 1;
    const day = parseInt(dStr);

    // Resolve Category Name from ID (Backend expects String)
    const categoryName = this.categories().find(c => c.id === categoryId)?.name || 'Geral';

    let startMonth = month;
    let startYear = year;

    // 2. Credit Card Logic (Frontend Calc)
    if (type === 'expense' && cardId) {
      const card = this.cards().find(c => c.id === cardId);
      if (card && day >= card.closingDay) {
        startMonth++;
      }
    }

    const totalInstallments = (type === 'expense' && cardId) ? (installments > 0 ? installments : 1) : 1;
    const amountPerInstallment = amount / totalInstallments;

    // Gera o groupId

    const groupId = totalInstallments > 1 ? crypto.randomUUID() : null;

    // Create an array of Observables for each installment
    const requests: Observable<any>[] = [];

    for (let i = 0; i < totalInstallments; i++) {
      // 3. A Lógica de Ouro para o dia da parcela
      // Descobre o último dia do mês da parcela atual (usando o truque do dia 0)
      const lastDayOfMonth = new Date(startYear, startMonth + i + 1, 0).getDate();

      // Escolhe o dia original ou o limite do mês (o que for menor)
      const finalDay = Math.min(day, lastDayOfMonth);

      // Cria a data final da parcela
      const effectiveDate = new Date(startYear, startMonth + i, finalDay);

      // 4. Formata para o Backend (YYYY-MM-DDT00:00:00)
      const y = effectiveDate.getFullYear();
      const m = String(effectiveDate.getMonth() + 1).padStart(2, '0');
      const d = String(effectiveDate.getDate()).padStart(2, '0');
      const formattedDate = `${y}-${m}-${d}T00:00:00`

      // Construct Backend Payload
      const payload = {
        description: totalInstallments > 1 ? `${description} (${i + 1}/${totalInstallments})` : description,
        amount: amountPerInstallment,
        type: type.toUpperCase(), // Enum JAVA: INCOME, EXPENSE
        purchaseDate: formattedDate, // ISO LocalDateTime
        category: categoryName,

        // Note: ownerId, cardId, groupId are sent but Backend likely ignores them 
        // unless you add columns to your Transaction Entity.
        ownerId,
        cardId: type === 'income' ? null : cardId,
        groupId: groupId
      };

      //Teste log Installments
      console.log(`Parcela ${i + 1}: Intenção dia ${day} -> Gerado: ${formattedDate}`);
      
      requests.push(this.http.post(this.API_URL, payload));
    }

    // Execute all POSTs and refresh list
    return forkJoin(requests).pipe(
      tap(() => this.loadAll())
    );
  }

  deleteTransaction(id: string): Observable<any> {
    return this.http.delete(`${this.API_URL}/${id}`).pipe(
      tap(() => this.loadAll())
    );
  }

  deleteTransactionsBulk(ids: string[]): Observable<any> {
    // Backend doesn't have bulk delete, map to single deletes
    const requests = ids.map(id => this.http.delete(`${this.API_URL}/${id}`));
    return forkJoin(requests).pipe(
      tap(() => this.loadAll())
    );
  }

  updateTransaction(id: string, updates: Partial<Transaction>): Observable<any> {
    // Prepara o objeto para o Backend (converte type para Maiúsculo se existir)
    const payload = { ...updates };
    if (payload.type) {
      // @ts-ignore: Forçando uppercase para o Java, mesmo que o Front use lowercase
      payload.type = payload.type.toUpperCase();
    }

    return this.http.patch(`${this.API_URL}/${id}`, payload).pipe(
      tap(() => this.loadAll()), // Recarrega a lista após o sucesso
      catchError(err => {
        console.error('Erro ao atualizar:', err);
        return throwError(() => new Error('Falha ao atualizar transação.'));
      })
    );
  }

  // updateTransaction(id: string, updates: Partial<Transaction>): Observable<any> {
  //   // Placeholder: Ideally should use PUT/PATCH to backend
  //   // Since prompt focused on Load/Add/Delete, we leave basic impl
  //   // Note: Backend 'update' expects full object, frontend sends partial. 
  //   // This requires a fetch-merge-update strategy or a patch endpoint.
  //   return new Observable(observer => {
  //      observer.next();
  //      observer.complete();
  //   });
  // }

  // --- SETTINGS & LOCAL DATA HELPERS ---

  updateMonthStartDay(day: number) {
    this.settings.update(s => ({ ...s, monthStartDay: day }));
  }

  toggleDarkMode() {
    this.settings.update(s => ({ ...s, darkMode: !s.darkMode }));
  }

  addCategory(name: string, color: string) {
    this.categories.update(prev => [...prev, { id: crypto.randomUUID(), name, color }]);
  }
  deleteCategory(id: string) { this.categories.update(prev => prev.filter(c => c.id !== id)); }

  addCard(name: string, ownerId: string, closingDay: number, dueDay: number, color: string) {
    this.cards.update(prev => [...prev, { id: crypto.randomUUID(), name, ownerId, closingDay, dueDay, color }]);
  }
  updateCard(id: string, updates: Partial<CreditCard>) {
    this.cards.update(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  }
  deleteCard(id: string) { this.cards.update(prev => prev.filter(c => c.id !== id)); }

  addOwner(name: string) {
    this.owners.update(prev => [...prev, { id: crypto.randomUUID(), name }]);
  }
  updateOwner(id: string, name: string) {
    this.owners.update(prev => prev.map(o => o.id === id ? { ...o, name } : o));
  }
  deleteOwner(id: string) { this.owners.update(prev => prev.filter(o => o.id !== id)); }

  // --- READ HELPERS ---

  getGroupTransactions(groupId: string) {
    // Grouping depends on Frontend persistence which is limited with current Backend
    return this.transactions().filter(t => t.groupId === groupId).sort((a, b) => (a.installmentCurrent || 0) - (b.installmentCurrent || 0));
  }

  getCategory(idOrName: string) {
    // Try by ID first, then by Name (Backend compatibility)
    return this.categories().find(c => c.id === idOrName || c.name === idOrName);
  }

  getOwner(id: string) {
    return this.owners().find(o => o.id === id);
  }

  getCard(id: string | null) {
    if (!id) return null;
    return this.cards().find(c => c.id === id);
  }
}
