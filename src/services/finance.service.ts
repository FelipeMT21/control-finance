
import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap, forkJoin, map, Observable, catchError, throwError } from 'rxjs';

// --- DATA MODELS ---

export interface Owner {
  id: string;
  name: string;
}

export interface Category {
  id?: string;
  name: string;
  color: string;
}

export interface CreditCard {
  id?: string;
  name: string;
  owner: Owner;
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
  type: TransactionType;
  purchaseDate: string;

  // Objetos completos vindos do Java (JPA)
  category: Category;
  owner: Owner;
  creditCard: CreditCard | null;

  // IDs auxiliares para o Frontend
  categoryId?: string;
  ownerId?: string;
  cardId?: string | null;
  groupId?: string;

  installmentCurrent?: number;
  installmentTotal?: number;
  effectiveMonth?: number;
  effectiveYear?: number;
}

@Injectable({
  providedIn: 'root'
})
export class FinanceService {
  private http: HttpClient = inject(HttpClient);
  private readonly API_URL = 'http://localhost:8080/transactions';
  private readonly API_URL_CATEGORIES = 'http://localhost:8080/categories';
  private readonly API_URL_OWNERS = 'http://localhost:8080/owners';
  private readonly API_URL_CARDS = 'http://localhost:8080/cards';

  // --- STATE ---

  // Settings no LocalStorage por enquanto
  readonly settings = signal<UserSettings>({ monthStartDay: 1, darkMode: false });

  // Categorias agora vêm do BACKEND (Inicializa vazio)
  readonly categories = signal<Category[]>([]);

  // Donos agora vêm do BACKEND (Inicializa vazio)
  readonly owners = signal<Owner[]>([]);

  // Cartões agora vêm do BACKEND (Inicializa vazio)
  readonly cards = signal<CreditCard[]>([]);

  // Backend managed entity (Private write, Public read-only)
  private _transactions = signal<Transaction[]>([]);
  readonly transactions = this._transactions.asReadonly();

  constructor() {
    this.loadStorageData(); // Load Cards, Settings
    this.loadCategories(); // Load Categories from API
    this.loadOwners(); // Load Owners from API
    this.loadCards(); // Load Cards from API
    this.loadAll(); // Load Transactions from API

    // Auto-save effects (Only for non-backend entities)
    effect(() => localStorage.setItem('fincontrol_settings_v2', JSON.stringify(this.settings())));
  }

  private loadStorageData() {
    const savedSettings = localStorage.getItem('fincontrol_settings_v2');
    if (savedSettings) this.settings.set(JSON.parse(savedSettings));
  }

  // --- HTTP METHODS ---

  loadCategories() {
    this.http.get<Category[]>(this.API_URL_CATEGORIES).subscribe({
      next: (data) => this.categories.set(data),
      error: (err) => console.error('Error ao carregar categorias: ', err)
    });
  }

  addCategory(name: string, color: string) {
    const newCategory = { name, color }; // Java vai gerar o ID
    this.http.post<Category>(this.API_URL_CATEGORIES, newCategory).subscribe({
      next: (newCat) => {
        this.categories.update(prev => [...prev, newCat]);
      },
      error: (err) => alert('Error ao criar categoria: ' + err.message)
    });
  }

  deleteCategory(id: string) {
    this.http.delete(`${this.API_URL_CATEGORIES}/${id}`).subscribe({
      next: () => {
        this.categories.update(prev => prev.filter(c => c.id !== id));
      },
      error: (err) => alert('Erro ao excluir categoria (pode estar em uso): ' + err.message)
    });
  }

  loadOwners() {
    this.http.get<Owner[]>(this.API_URL_OWNERS).subscribe({
      next: (data) => this.owners.set(data),
      error: (err) => console.log('Erro ao carregar donos: ', err)
    });
  }

  addOwner(name: string) {
    const newOwner = { name };
    this.http.post<Owner>(this.API_URL_OWNERS, newOwner).subscribe({
      next: (newOwner) => {
        this.owners.update(prev => [...prev, newOwner])
      },
      error: (err) => alert('Erro ao excluir dono (pode estar em uso); ' + err.message)
    });
  }

  updateOwner(id: string, name: string) {
    this.http.put<Owner>(`${this.API_URL_OWNERS}/${id}`, { name }).subscribe({
      next: (ownerUpdate) => {
        this.owners.update(prev => prev.map(o => o.id === id ? ownerUpdate : o))
      },
      error: (err) => alert('Erro ao atualizar dono: ' + err.message)
    });
  }

  deleteOwner(id: string) {
    this.http.delete(`${this.API_URL_OWNERS}/${id}`).subscribe({
      next: () => {
        this.owners.update(prev => prev.filter(o => o.id !== id))
      },
      error: (err) => alert('Erro ao excluir dono (pode ter transações vinculadas): ' + err.message)
    });
  }

  loadCards() {
    this.http.get<CreditCard[]>(this.API_URL_CARDS).subscribe({
      next: (data) => this.cards.set(data),
      error: (err) => console.log("Erro ao carregar os cartões ", err)
    });
  }

  addCard(name: string, ownerId: string, closingDay: number, dueDay: number, color: string) {
    const newCard = {
      name,
      closingDay,
      dueDay,
      color,
      owner: { id: ownerId }
    }
    this.http.post<CreditCard>(this.API_URL_CARDS, newCard).subscribe({
      next: (cardSave) => {
        this.cards.update(prev => [...prev, cardSave]);
      },
      error: (err) => alert('Erro ao criar cartão ' + err.message)
    });
  }
  updateCard(id: string, updates: Partial<CreditCard>) {
    const payload = { ...updates };
    this.http.put<CreditCard>(`${this.API_URL_CARDS}/${id}`, payload).subscribe({
      next: (cardUpdate) => {
        this.cards.update(prev => prev.map(c => c.id === id ? cardUpdate : c));
      },
      error: (err) => alert('Erro ao atualizar o cartão: ' + err.message)
    });
  }

  patchCard(id: string, updates: Partial<CreditCard>) {
    const payload = { ...updates };
    this.http.patch<CreditCard>(`${this.API_URL_CARDS}/${id}`, payload).subscribe({
      next: (cardUpdate) => {
        this.cards.update(prev => prev.map(c => c.id === id ? cardUpdate : c));
      },
      error: (err) => alert('Erro ao atualizar o cartão: ' + err.message)
    });
  }

  deleteCard(id: string) {
    this.http.delete(`${this.API_URL_CARDS}/${id}`).subscribe({
      next: () => {
        this.cards.update(prev => prev.filter(c => c.id !== id));
      },
      error: (err) => alert('Erro ao excluir cartão (verifique se há transações nele): ' + err.message)
    })
  }

  loadAll() {
    this.http.get<any[]>(this.API_URL).subscribe({
      next: (data) => {
        const mappedData: Transaction[] = data.map(t => {
          const dateObj = new Date(t.purchaseDate);

          return {
            ...t,
            // Convert Java Enum (INCOME) to Frontend (income)
            type: t.type.toLowerCase() as TransactionType,

            // Mapeamento de IDs para compatibilidade com os filtros do Componente
            categoryId: t.category?.id,
            ownerId: t.owner?.id,
            cardId: t.creditCard?.id || null,

            // Calculate effective dates for UI filtering
            effectiveMonth: dateObj.getMonth(),
            effectiveYear: dateObj.getFullYear(),
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
      const formattedDate = `${y}-${m}-${d}T12:00:00Z`

      // Construct Backend Payload
      const payload = {
        description: totalInstallments > 1 ? `${description} (${i + 1}/${totalInstallments})` : description,
        amount: amountPerInstallment,
        type: type.toUpperCase(), // Enum JAVA: INCOME, EXPENSE
        purchaseDate: formattedDate, // ISO LocalDateTime
        category: { id: categoryId },
        owner: { id: ownerId },
        creditCard: (type === 'expense' && cardId) ? { id: cardId } : null, // Envia objeto ou null
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

  // --- SETTINGS & LOCAL DATA HELPERS ---

  updateMonthStartDay(day: number) {
    this.settings.update(s => ({ ...s, monthStartDay: day }));
  }

  toggleDarkMode() {
    this.settings.update(s => ({ ...s, darkMode: !s.darkMode }));
  }

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
