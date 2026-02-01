
import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap, forkJoin, map, Observable, catchError, throwError, delay } from 'rxjs';
import { environment } from '../../environments/environment';

// --- MODELS ---
import { UserSettings } from '@app/models/user-settings.model';
import { Transaction, TransactionType } from '@app/models/transaction.model';
import { Category } from '@app/models/category.model';
import { Owner } from '@app/models/owner.model';
import { CreditCard } from '@app/models/creditCard.model';

interface CardFormData {
  name: string;
  ownerId: string; // O service recebe ID, não o objeto
  closingDay: number;
  dueDay: number;
  color: string;
}

@Injectable({
  providedIn: 'root'
})
export class FinanceService {
  private http: HttpClient = inject(HttpClient);

  private readonly BASE_URL = environment.apiUrl;

  private readonly API_URL = `${this.BASE_URL}/transactions`;
  private readonly API_URL_CATEGORIES = `${this.BASE_URL}/categories`;
  private readonly API_URL_OWNERS = `${this.BASE_URL}/owners`;
  private readonly API_URL_CARDS = `${this.BASE_URL}/cards`;

  // --- CONTROLE DE ESTADO DO FILTRO ---
  private lastViewedMonth = new Date().getMonth();
  private lastViewedYear = new Date().getFullYear();

  // --- STATE ---

  // Settings no LocalStorage por enquanto
  readonly settings = signal<UserSettings>({ monthStartDay: 1, darkMode: false });
  readonly categories = signal<Category[]>([]);
  readonly owners = signal<Owner[]>([]);
  readonly cards = signal<CreditCard[]>([]);

  // Backend managed entity
  private _transactions = signal<Transaction[]>([]);
  readonly transactions = this._transactions.asReadonly();

  constructor() {
    this.loadStorageData(); // Load Cards, Settings
    this.loadCategories(); // Load Categories from API
    this.loadOwners(); // Load Owners from API
    this.loadCards(); // Load Cards from API

    this.loadByMonth(this.lastViewedMonth, this.lastViewedYear);

    // Auto-save effects (Only for non-backend entities)
    effect(() => localStorage.setItem('fincontrol_settings_v2', JSON.stringify(this.settings())));
  }

  private loadStorageData() {
    const savedSettings = localStorage.getItem('fincontrol_settings_v2');
    if (savedSettings) this.settings.set(JSON.parse(savedSettings));
  }

  // --- MÉTODOS DE MAPEAMENTO CENTRALIZADO (O "Tradutor") ---

  private mapTransaction(t: any): Transaction {
    // Data de referência (Prioridade para billingDate no Dashboard)
    const dateRef = new Date(t.billingDate || t.purchaseDate);

    return {
      id: t.id,
      description: t.description,
      amount: t.amount,
      type: t.type,
      paymentMethod: t.paymentMethod,
      paid: t.paid,
      createdAt: t.createdAt,
      purchaseDate: t.purchaseDate,
      billingDate: t.billingDate,

      categoryId: t.categoryId,
      ownerId: t.ownerId,
      creditCardId: t.creditCardId,
      groupId: t.groupId,

      categoryName: t.categoryName,
      categoryColor: t.categoryColor,
      ownerName: t.ownerName,
      cardName: t.cardName,
      cardColor: t.cardColor,

      // --- METADADOS CALCULADOS NO FRONT ---
      effectiveMonth: dateRef.getUTCMonth(),
      effectiveYear: dateRef.getUTCFullYear(),
      installmentCurrent: t.installmentCurrent || 1,
      installmentTotal: t.installmentTotal || 1,

    } as Transaction;
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
  updateCard(id: string, formData: CardFormData) {
    // 1. LÓGICA: O Service busca o Dono na lista que ele já tem
    const fullOwner = this.owners().find(o => o.id === formData.ownerId);

    // Validação de segurança
    if (!fullOwner) {
      alert('Erro: Dono não encontrado na lista.');
      return;
    }

    // 2. MONTAGEM: O Service prepara o payload para o Backend
    const payload = {
      id: id,
      name: formData.name,
      closingDay: Number(formData.closingDay),
      dueDay: Number(formData.dueDay),
      color: formData.color,
      owner: fullOwner // Manda o objeto completo (agrada o TS e o Java)
    };

    // 3. ENVIO
    this.http.put<CreditCard>(`${this.API_URL_CARDS}/${id}`, payload).subscribe({
      next: (cardUpdate) => {
        this.cards.update(prev => prev.map(c => c.id === id ? cardUpdate : c));
      },
      error: (err) => alert('Erro na API: ' + err.message)
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
        const mappedData = data.map(t => this.mapTransaction(t));
        this._transactions.set(mappedData);
      },
      error: (err) => console.error('Failed to load transactions from API', err)
    });
  }

  loadByMonth(month: number, year: number) {
    this.lastViewedMonth = month;
    this.lastViewedYear = year;
    const javaMonth = month + 1; // JS 0-11 -> Java 1-12
    this.http.get<any[]>(`${this.API_URL}/filter`, {
      params: { month: javaMonth.toString(), year: year.toString() }
    }).pipe(
      map(data => data.map(t => this.mapTransaction(t)))
    ).subscribe({
      next: (mappedData) => {
        this._transactions.set(mappedData);
      },
      error: (err) => {
        console.error('Erro ao carregar transações:', err)
        alert('Não foi possível carregar as transações. Tente novamente mais tarde.')
      }
    });
  }

  fetchTransactionsSilently(month: number, year: number): Observable<Transaction[]> {
    const javaMonth = month + 1;
    return this.http.get<any[]>(`${this.API_URL}/filter`, {
      params: { month: javaMonth.toString(), year: year.toString() }
    }).pipe(
      map(data => data.map(t => this.mapTransaction(t))),
      catchError(err => {
        console.error('Erro na busca silenciosa do calendário:', err);
        return throwError(() => err);
      })
    );
  }

  addTransaction(
    description: string,
    amount: number,
    type: TransactionType,
    dateStr: string,
    categoryId: string,
    ownerId: string,
    cardId: string | null,
    installments: number,
    paymentMethod: string,
    paid: boolean
  ): Observable<any> {
    // 1. Desmontando a data original
    const [yStr, mStr, dStr] = dateStr.split('-');
    const year = parseInt(yStr);
    const month = parseInt(mStr) - 1;
    const day = parseInt(dStr);

    const totalInstallments = (type === 'EXPENSE') ? (installments > 0 ? installments : 1) : 1;
    const amountPerInstallment = amount / totalInstallments;
    const groupId = totalInstallments > 1 ? this.generateUUID() : undefined;

    const requests: Observable<any>[] = [];

    for (let i = 0; i < totalInstallments; i++) {
      const lastDayOfMonth = new Date(year, month + i + 1, 0).getDate();

      // Escolhe o dia original ou o limite do mês (o que for menor)
      const finalDay = Math.min(day, lastDayOfMonth);

      // Cria a data final da parcela
      const effectiveDate = new Date(year, month + i, finalDay);

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

        categoryId: categoryId,
        ownerId: ownerId,
        creditCardId: (type.toUpperCase() === 'EXPENSE' && cardId) ? cardId : null, // Envia string ou null

        paymentMethod: paymentMethod,
        groupId: groupId,
        paid: paid
      };

      //Teste log Installments
      console.log(`Parcela ${i + 1}: Intenção dia ${day} -> Gerado: ${formattedDate} | Método: ${paymentMethod}`);

      requests.push(this.http.post(this.API_URL, payload));
    }

    return forkJoin(requests);
  }

  deleteTransaction(id: string): Observable<any> {
    return this.http.delete(`${this.API_URL}/${id}`);
  }

  deleteTransactionsBulk(ids: string[]): Observable<any> {
    // Backend doesn't have bulk delete, map to single deletes
    const requests = ids.map(id => this.http.delete(`${this.API_URL}/${id}`));
    return forkJoin(requests);
  }

  updateTransaction(id: string, updates: Partial<Transaction>): Observable<any> {
    // Prepara o objeto para o Backend (converte type para Maiúsculo se existir)
    const payload: any = {
      description: updates.description,
      amount: updates.amount,
      purchaseDate: updates.purchaseDate,
      paid: updates.paid,

      categoryId: updates.categoryId,
      ownerId: updates.ownerId,
      creditCardId: updates.creditCardId,

      paymentMethod: updates.paymentMethod,
      groupId: updates.groupId
    };
    if (updates.type) {
      payload.type = updates.type.toUpperCase();
    }

    // Remove chaves undefined/null que não devem ser enviadas (opcional, mas bom para PATCH)
    Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

    return this.http.patch(`${this.API_URL}/${id}`, payload).pipe(
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

  // Função manual para gerar UUID (funciona em HTTP e HTTPS)
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  fetchGroup(groupId: string): Observable<Transaction[]> {
    return this.http.get<any[]>(this.API_URL).pipe(
      map(data =>
        data
          .filter(t => t.groupId === groupId) // Filtra pelo ID do grupo
          .map(t => this.mapTransaction(t))
          .sort((a, b) => new Date(a.purchaseDate).getTime() - new Date(b.purchaseDate).getTime())
      )
    );
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
