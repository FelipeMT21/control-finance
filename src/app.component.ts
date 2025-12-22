
import { Component, computed, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { FinanceService, Transaction, CreditCard, Owner } from './services/finance.service';
import { ChartComponent, ChartData } from './components/chart.component';

type BatchActionType = 'delete' | 'edit';
type BatchScope = 'single' | 'all' | 'future' | 'past';

interface PendingAction {
  type: BatchActionType;
  transaction: Transaction;
  formValue?: any; // For edits
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ChartComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  financeService = inject(FinanceService);
  fb = inject(FormBuilder);

  // --- UI State ---
  activeModal = signal<'transaction' | 'settings' | 'batch-confirm' | 'delete-confirm' | null>(null);
  settingsTab = signal<'preferences' | 'categories' | 'cards' | 'owners'>('preferences');
  
  editingTransactionId = signal<string | null>(null);
  editingOwnerId = signal<string | null>(null); 
  editingCardId = signal<string | null>(null);
  useCard = signal(false); 
  
  // Action State
  pendingAction = signal<PendingAction | null>(null);
  transactionToDelete = signal<Transaction | null>(null);

  // Installment UI State
  readonly installmentOptions = Array.from({ length: 24 }, (_, i) => i + 1);
  customInstallmentMode = signal(false);

  // Dashboard Context State
  selectedOwnerId = signal<string | null>(null); 
  selectedCardId = signal<string | null>(null); 

  // Date Navigation State
  today = new Date();
  selectedMonth = signal(this.today.getMonth()); 
  selectedYear = signal(this.today.getFullYear());

  // --- Forms ---
  transactionForm: FormGroup;
  categoryForm: FormGroup;
  cardForm: FormGroup;
  ownerForm: FormGroup;
  preferencesForm: FormGroup;

  constructor() {
    // Dark Mode Effect
    effect(() => {
      const isDark = this.financeService.settings().darkMode;
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    });

    this.transactionForm = this.fb.group({
      description: ['', Validators.required],
      amount: [null, [Validators.required, Validators.min(0.01)]],
      type: ['expense', Validators.required],
      date: [this.getISODate(this.today), Validators.required],
      ownerId: [this.financeService.owners()[0]?.id || '', Validators.required],
      categoryId: [this.financeService.categories()[0]?.id || '', Validators.required],
      cardId: [this.financeService.cards()[0]?.id || ''],
      installments: [1]
    });

    this.transactionForm.get('type')?.valueChanges.subscribe(val => {
      if (val === 'income') this.useCard.set(false);
    });

    this.transactionForm.get('cardId')?.valueChanges.subscribe(cardId => {
      if (this.useCard() && cardId) {
        const card = this.financeService.getCard(cardId);
        if (card) {
          this.transactionForm.patchValue({ ownerId: card.ownerId }, { emitEvent: false });
        }
      }
    });

    this.categoryForm = this.fb.group({
      name: ['', Validators.required],
      color: ['#3b82f6', Validators.required]
    });

    this.cardForm = this.fb.group({
      name: ['', Validators.required],
      ownerId: [this.financeService.owners()[0]?.id || '', Validators.required],
      closingDay: [1, [Validators.required, Validators.min(1), Validators.max(31)]],
      dueDay: [10, [Validators.required, Validators.min(1), Validators.max(31)]],
      color: ['#1e293b', Validators.required] 
    });

    this.ownerForm = this.fb.group({
      name: ['', Validators.required]
    });

    this.preferencesForm = this.fb.group({
      monthStartDay: [1, [Validators.required, Validators.min(1), Validators.max(31)]]
    });
  }

  // --- Computed Data ---
  
  cardsForSelectedOwner = computed(() => {
    const ownerId = this.selectedOwnerId();
    if (!ownerId) {
        return [];
    }
    return this.financeService.cards().filter(c => c.ownerId === ownerId);
  });
  
  monthName = computed(() => {
    const months = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    const name = months[this.selectedMonth()];
    const startDay = this.financeService.settings().monthStartDay;
    
    if (startDay === 1 || this.selectedCardId()) {
      return name;
    }

    const rangeStart = new Date(this.selectedYear(), this.selectedMonth(), startDay);
    const rangeEnd = new Date(this.selectedYear(), this.selectedMonth() + 1, startDay - 1);
    
    return `${name} (${rangeStart.getDate()}/${rangeStart.getMonth()+1} a ${rangeEnd.getDate()}/${rangeEnd.getMonth()+1})`;
  });

  filteredTransactions = computed(() => {
    return this.financeService.transactions().filter(t => {
      const ownerId = this.selectedOwnerId();
      const cardId = this.selectedCardId();
      
      // Additional filter for owner view
      if (ownerId && t.ownerId !== ownerId) {
        return false;
      }

      if (cardId) {
        if (t.cardId !== cardId) return false;
        return t.effectiveMonth === this.selectedMonth() && 
               t.effectiveYear === this.selectedYear();
      }

      const startDay = this.financeService.settings().monthStartDay;
      if (startDay === 1) {
        return t.effectiveMonth === this.selectedMonth() && 
               t.effectiveYear === this.selectedYear();
      }

      const periodStart = new Date(this.selectedYear(), this.selectedMonth(), startDay);
      const periodEnd = new Date(this.selectedYear(), this.selectedMonth() + 1, startDay);
      const [y, m, d] = t.purchaseDate.split('-').map(Number);
      const tDate = new Date(y, m - 1, d); 
      
      return tDate >= periodStart && tDate < periodEnd;

    }).sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());
  });

  totalIncome = computed(() => {
    if (this.selectedCardId()) return 0;
    return this.filteredTransactions()
      .filter(t => t.type === 'income')
      .reduce((acc, t) => acc + t.amount, 0);
  });

  totalExpense = computed(() => {
    return this.filteredTransactions()
      .filter(t => t.type === 'expense')
      .reduce((acc, t) => acc + t.amount, 0);
  });

  balance = computed(() => this.totalIncome() - this.totalExpense());

  invoiceInfo = computed(() => {
    const cardId = this.selectedCardId();
    if (!cardId) return null;

    const card = this.financeService.getCard(cardId);
    if (!card) return null;

    let endMonth = this.selectedMonth();
    let endYear = this.selectedYear();
    
    let startMonth = endMonth - 1;
    let startYear = endYear;
    if (startMonth < 0) {
      startMonth = 11;
      startYear--;
    }

    const startDate = new Date(startYear, startMonth, card.closingDay);
    const endDate = new Date(endYear, endMonth, card.closingDay);

    return {
      cardName: card.name,
      ownerName: this.financeService.getOwner(card.ownerId)?.name,
      closingDate: `${card.closingDay}/${this.selectedMonth() + 1}`,
      dueDate: `${card.dueDay}/${this.selectedMonth() + 1}`,
      periodStart: startDate,
      periodEnd: endDate,
      status: this.today > endDate ? 'Fechada' : 'Aberta',
      color: card.color
    };
  });

  balanceChartData = computed<ChartData[]>(() => {
    if (this.selectedCardId()) return []; 
    return [
      { label: 'Receitas', value: this.totalIncome(), color: '#10b981' }, 
      { label: 'Despesas', value: this.totalExpense(), color: '#f43f5e' }  
    ];
  });

  categoryChartData = computed<ChartData[]>(() => {
    const expenses = this.filteredTransactions().filter(t => t.type === 'expense');
    const groups: Record<string, number> = {};
    for (const t of expenses) {
      groups[t.categoryId] = (groups[t.categoryId] || 0) + t.amount;
    }
    return Object.entries(groups)
      .map(([id, total]) => {
        const cat = this.financeService.getCategory(id);
        return { 
          label: cat?.name || 'Outros', 
          value: total, 
          color: cat?.color || '#cbd5e1' 
        };
      })
      .sort((a, b) => b.value - a.value);
  });

  // --- Actions ---

  toggleDarkMode() {
    this.financeService.toggleDarkMode();
  }
  
  selectOwnerFilter(ownerId: string | null) {
    this.selectedOwnerId.set(ownerId);
    this.selectedCardId.set(null); // Reset card selection when owner changes
  }

  selectCardFilter(cardId: string | null) {
    this.selectedCardId.set(cardId);
  }

  openModal(type: 'transaction' | 'settings' | 'batch-confirm', transactionToEdit: Transaction | null = null) {
    this.activeModal.set(type);
    
    if (type === 'transaction') {
      if (transactionToEdit) {
        this.editingTransactionId.set(transactionToEdit.id);
        this.useCard.set(!!transactionToEdit.cardId);
        const total = transactionToEdit.installmentTotal;
        this.customInstallmentMode.set(total > 24);

        this.transactionForm.setValue({
          description: transactionToEdit.description.replace(/\s\(\d+\/\d+\)$/, ''), // Remove (1/3) suffix for editing
          amount: transactionToEdit.amount,
          type: transactionToEdit.type,
          date: transactionToEdit.purchaseDate,
          ownerId: transactionToEdit.ownerId,
          categoryId: transactionToEdit.categoryId,
          cardId: transactionToEdit.cardId || (this.financeService.cards()[0]?.id || ''),
          installments: 1
        });

      } else {
        this.editingTransactionId.set(null);
        this.customInstallmentMode.set(false);
        const defaultOwner = this.financeService.owners()[0]?.id || '';
        const defaultCat = this.financeService.categories()[0]?.id || '';
        const defaultCard = this.financeService.cards()[0]?.id || '';

        this.transactionForm.reset({
          type: 'expense',
          date: this.getISODate(new Date()),
          ownerId: defaultOwner,
          categoryId: defaultCat,
          cardId: defaultCard,
          installments: 1
        });
        this.useCard.set(false);
      }
    } else if (type === 'settings') {
      this.cancelOwnerEdit();
      this.cancelCardEdit();
      this.preferencesForm.setValue({
        monthStartDay: this.financeService.settings().monthStartDay
      });
    }
  }

  closeModal() {
    this.activeModal.set(null);
    this.editingTransactionId.set(null);
    this.editingOwnerId.set(null);
    this.editingCardId.set(null);
    this.pendingAction.set(null);
    this.transactionToDelete.set(null);
  }

  toggleUseCard() {
    this.useCard.update(v => !v);
  }

  onInstallmentChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    if (select.value === '0') {
      this.customInstallmentMode.set(true);
      this.transactionForm.patchValue({ installments: null });
    }
  }

  changeMonth(delta: number) {
    let m = this.selectedMonth() + delta;
    let y = this.selectedYear();

    if (m > 11) { m = 0; y++; } 
    else if (m < 0) { m = 11; y--; }

    this.selectedMonth.set(m);
    this.selectedYear.set(y);
  }

  // --- Submissions & Batch Logic ---

  initiateDelete(transaction: Transaction) {
    if (transaction.groupId) {
      this.pendingAction.set({ type: 'delete', transaction });
      this.activeModal.set('batch-confirm');
    } else {
      this.transactionToDelete.set(transaction);
      this.activeModal.set('delete-confirm');
    }
  }

  confirmDelete() {
    const transaction = this.transactionToDelete();
    if (transaction) {
      this.financeService.deleteTransaction(transaction.id);
    }
    this.closeModal();
  }

  onSubmitTransaction() {
    if (this.transactionForm.invalid) return;

    const val = this.transactionForm.value;
    const isExpense = val.type === 'expense';
    const usingCard = isExpense && this.useCard();
    const editId = this.editingTransactionId();

    if (editId) {
      // It's an Edit
      const original = this.financeService.transactions().find(t => t.id === editId);
      if (!original) return;

      if (original.groupId) {
         // Ask for scope
         this.pendingAction.set({ 
           type: 'edit', 
           transaction: original,
           formValue: val
         });
         this.activeModal.set('batch-confirm');
         return; 
      }

      // Single Edit
      this.financeService.updateTransaction(editId, {
        description: val.description,
        amount: val.amount,
        type: val.type,
        purchaseDate: val.date,
        categoryId: val.categoryId,
        ownerId: val.ownerId,
        cardId: usingCard ? val.cardId : null
      });

    } else {
      // CREATE
      this.financeService.addTransaction(
        val.description,
        val.amount,
        val.type,
        val.date,
        val.categoryId,
        val.ownerId,
        usingCard ? val.cardId : null,
        usingCard ? val.installments : 1
      );
    }

    this.closeModal();
  }

  executeBatchAction(scope: BatchScope) {
    const action = this.pendingAction();
    if (!action) return;

    const groupId = action.transaction.groupId!;
    const groupTransactions = this.financeService.getGroupTransactions(groupId);
    const currentIdx = action.transaction.installmentCurrent;

    let targetIds: string[] = [];

    // Determine targets
    if (scope === 'single') {
      targetIds = [action.transaction.id];
    } else if (scope === 'all') {
      targetIds = groupTransactions.map(t => t.id);
    } else if (scope === 'future') {
      // Current + Future
      targetIds = groupTransactions.filter(t => t.installmentCurrent >= currentIdx).map(t => t.id);
    } else if (scope === 'past') {
      // Current + Past
      targetIds = groupTransactions.filter(t => t.installmentCurrent <= currentIdx).map(t => t.id);
    }

    if (action.type === 'delete') {
      this.financeService.deleteTransactionsBulk(targetIds);
    } else if (action.type === 'edit' && action.formValue) {
      const val = action.formValue;
      const usingCard = val.type === 'expense' && this.useCard();
      
      this.financeService.updateTransactionsBulk(targetIds, {
        description: val.description, // Will overwrite "(1/3)" part
        amount: val.amount,
        type: val.type,
        purchaseDate: scope === 'single' ? val.date : undefined, 
        categoryId: val.categoryId,
        ownerId: val.ownerId,
        cardId: usingCard ? val.cardId : null
      });
    }

    this.closeModal();
  }

  // --- Category/Card/Owner/Pref handlers remain unchanged ---

  onAddCategory() {
    if (this.categoryForm.invalid) return;
    const { name, color } = this.categoryForm.value;
    this.financeService.addCategory(name, color);
    this.categoryForm.reset({ name: '', color: '#3b82f6' });
  }

  onSaveCard() {
    if (this.cardForm.invalid) return;
    const { name, ownerId, closingDay, dueDay, color } = this.cardForm.value;
    
    if (this.editingCardId()) {
      this.financeService.updateCard(this.editingCardId()!, {
        name, ownerId, closingDay, dueDay, color
      });
      this.cancelCardEdit();
    } else {
      this.financeService.addCard(name, ownerId, closingDay, dueDay, color);
      this.cancelCardEdit(); 
    }
  }
  
  editCard(card: CreditCard) {
    this.editingCardId.set(card.id);
    this.cardForm.setValue({
      name: card.name,
      ownerId: card.ownerId,
      closingDay: card.closingDay,
      dueDay: card.dueDay,
      color: card.color
    });
  }

  cancelCardEdit() {
    this.editingCardId.set(null);
    this.cardForm.reset({ 
      name: '', 
      ownerId: this.financeService.owners()[0]?.id || '',
      closingDay: 1,
      dueDay: 10,
      color: '#1e293b'
    });
  }

  onSaveOwner() {
    if (this.ownerForm.invalid) return;
    if (this.editingOwnerId()) {
      this.financeService.updateOwner(this.editingOwnerId()!, this.ownerForm.value.name);
      this.cancelOwnerEdit();
    } else {
      this.financeService.addOwner(this.ownerForm.value.name);
      this.ownerForm.reset();
    }
  }

  editOwner(owner: Owner) {
    this.editingOwnerId.set(owner.id);
    this.ownerForm.setValue({ name: owner.name });
  }

  cancelOwnerEdit() {
    this.editingOwnerId.set(null);
    this.ownerForm.reset();
  }
  
  onSavePreferences() {
    if (this.preferencesForm.invalid) return;
    const day = this.preferencesForm.value.monthStartDay;
    this.financeService.updateMonthStartDay(day);
  }

  // --- Helpers ---

  formatCurrency(val: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  }

  formatDate(isoStr: string): string {
    const [y, m, d] = isoStr.split('-');
    return `${d}/${m}`;
  }

  formatDateShort(date: Date): string {
    return `${date.getDate()}/${date.getMonth() + 1}`;
  }

  getISODate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  getCategoryColor(id: string): string {
    return this.financeService.getCategory(id)?.color || '#ccc';
  }

  getCategoryName(id: string): string {
    return this.financeService.getCategory(id)?.name || 'Outros';
  }

  getCardName(id: string): string {
    return this.financeService.getCard(id)?.name || 'Cartão';
  }

  getOwnerName(id: string): string {
    return this.financeService.getOwner(id)?.name || '-';
  }
}
