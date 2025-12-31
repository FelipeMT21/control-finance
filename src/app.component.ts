
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
  activeModal = signal<'transaction' | 'settings' | 'batch-confirm' | null>(null);
  settingsTab = signal<'preferences' | 'categories' | 'cards' | 'owners'>('preferences');

  editingTransactionId = signal<string | null>(null);
  editingOwnerId = signal<string | null>(null);
  editingCardId = signal<string | null>(null);
  useCard = signal(false);

  // Batch Action State
  pendingAction = signal<PendingAction | null>(null);

  // Installment UI State
  readonly installmentOptions = Array.from({ length: 24 }, (_, i) => i + 1);
  customInstallmentMode = signal(false);

  // Dashboard Context State
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

    return `${name} (${rangeStart.getDate()}/${rangeStart.getMonth() + 1} a ${rangeEnd.getDate()}/${rangeEnd.getMonth() + 1})`;
  });

  filteredTransactions = computed(() => {
    return this.financeService.transactions().filter(t => {
      const currentCardId = this.selectedCardId();

      // Ensure effectiveMonth is present (fallback for safety)
      const eMonth = t.effectiveMonth ?? new Date(t.purchaseDate).getMonth();
      const eYear = t.effectiveYear ?? new Date(t.purchaseDate).getFullYear();

      if (currentCardId) {
        if (t.cardId !== currentCardId) return false;
        return eMonth === this.selectedMonth() && eYear === this.selectedYear();
      }

      const startDay = this.financeService.settings().monthStartDay;
      if (startDay === 1) {
        return eMonth === this.selectedMonth() && eYear === this.selectedYear();
      }

      const periodStart = new Date(this.selectedYear(), this.selectedMonth(), startDay);
      const periodEnd = new Date(this.selectedYear(), this.selectedMonth() + 1, startDay);
      const [y, m, d] = t.purchaseDate.split('T')[0].split('-').map(Number);
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
      // Use category ID if available, otherwise use Name (Backend) as key
      const key = t.categoryId || t.category || 'Outros';
      groups[key] = (groups[key] || 0) + t.amount;
    }
    return Object.entries(groups)
      .map(([key, total]) => {
        const cat = this.financeService.getCategory(key);
        return {
          label: cat?.name || key,
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

  selectCardFilter(cardId: string | null) {
    this.selectedCardId.set(cardId);
  }

  cancelOwnerEdit() {
    this.editingOwnerId.set(null);
    this.ownerForm.reset();
  }

  cancelCardEdit() {
    this.editingCardId.set(null);
    this.cardForm.reset({
      closingDay: 1,
      dueDay: 10,
      color: '#1e293b',
      ownerId: this.financeService.owners()[0]?.id || ''
    });
  }

  openModal(type: 'transaction' | 'settings' | 'batch-confirm', transactionToEdit: Transaction | null = null) {
    this.activeModal.set(type);

    if (type === 'transaction') {
      if (transactionToEdit) {
        this.editingTransactionId.set(transactionToEdit.id);
        this.useCard.set(!!transactionToEdit.cardId);
        const total = transactionToEdit.installmentTotal || 1;
        this.customInstallmentMode.set(total > 24);

        // Find Category ID by Name if missing (Backend logic reverse lookup)
        let catId = transactionToEdit.categoryId;
        if (!catId && transactionToEdit.category) {
          const cat = this.financeService.categories().find(c => c.name === transactionToEdit.category);
          if (cat) catId = cat.id;
        }

        this.transactionForm.setValue({
          description: transactionToEdit.description.replace(/\s\(\d+\/\d+\)$/, ''),
          amount: transactionToEdit.amount,
          type: transactionToEdit.type,
          date: transactionToEdit.purchaseDate.split('T')[0],
          ownerId: transactionToEdit.ownerId || (this.financeService.owners()[0]?.id || ''),
          categoryId: catId || (this.financeService.categories()[0]?.id || ''),
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
      if (confirm('Excluir esta movimentação?')) {
        // Updated to use Subscription
        this.financeService.deleteTransaction(transaction.id).subscribe({
          next: () => this.closeModal(),
          error: (err) => alert('Erro ao excluir: ' + err.message)
        });
      }
    }
  }

  onSubmitTransaction() {
    if (this.transactionForm.invalid) return;

    const val = this.transactionForm.value;
    const isExpense = val.type === 'expense';
    const usingCard = isExpense && this.useCard();
    const editId = this.editingTransactionId();

    if (editId) {
      // --- LÓGICA DE EDIÇÃO (UPDATE) ---
      const original = this.financeService.transactions().find(t => t.id === editId);
      
      // Se for parcelado, mantém a lógica de batch (ainda não implementada no backend, mas segura no front)
      if (original?.groupId) {
         this.pendingAction.set({ type: 'edit', transaction: original, formValue: val });
         this.activeModal.set('batch-confirm');
         return; 
      }

      // Edição Simples: Mapeia o formulário para o formato do Backend
      const updatePayload: Partial<Transaction> = {
        description: val.description,
        amount: val.amount,
        type: val.type, // O Service vai converter para UpperCase
        purchaseDate: `${val.date}T00:00:00`, // Formato ISO LocalDateTime
        category: this.financeService.getCategory(val.categoryId)?.name || 'Outros', // Envia NOME, não ID
        cardId: usingCard ? val.cardId : null
      };

      this.financeService.updateTransaction(editId, updatePayload).subscribe({
        next: () => this.closeModal(),
        error: (err) => alert('Erro ao atualizar: ' + err.message)
      });

    } else {
      // --- LÓGICA DE CRIAÇÃO (CREATE) ---
      this.financeService.addTransaction(
        val.description,
        val.amount,
        val.type,
        val.date,
        val.categoryId,
        val.ownerId,
        usingCard ? val.cardId : null,
        usingCard ? val.installments : 1
      ).subscribe({
        next: () => this.closeModal(),
        error: (err) => alert('Erro ao salvar no servidor: ' + err.message)
      });
    }
  }

  executeBatchAction(scope: BatchScope) {
    const action = this.pendingAction();
    if (!action) return;

    const groupId = action.transaction.groupId!;
    const groupTransactions = this.financeService.getGroupTransactions(groupId);
    const currentIdx = action.transaction.installmentCurrent || 1;

    let targetIds: string[] = [];

    // Determine targets
    if (scope === 'single') {
      targetIds = [action.transaction.id];
    } else if (scope === 'all') {
      targetIds = groupTransactions.map(t => t.id);
    } else if (scope === 'future') {
      targetIds = groupTransactions.filter(t => (t.installmentCurrent || 0) >= currentIdx).map(t => t.id);
    } else if (scope === 'past') {
      targetIds = groupTransactions.filter(t => (t.installmentCurrent || 0) <= currentIdx).map(t => t.id);
    }

    if (action.type === 'delete') {
      this.financeService.deleteTransactionsBulk(targetIds).subscribe({
        next: () => this.closeModal(),
        error: (err) => alert('Erro ao excluir em lote: ' + err.message)
      });
    } else if (action.type === 'edit') {
      // Batch edit logic would go here
      this.closeModal();
    }
  }

  // --- Helpers ---

  formatCurrency(val: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  }

  formatDate(isoStr: string): string {
    const [y, m, d] = isoStr.split('T')[0].split('-');
    return `${d}/${m}`;
  }

  formatDateShort(date: Date): string {
    return `${date.getDate()}/${date.getMonth() + 1}`;
  }

  getISODate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  getCategoryColor(idOrName: string | undefined): string {
    if (!idOrName) return '#ccc';
    return this.financeService.getCategory(idOrName)?.color || '#ccc';
  }

  getCategoryName(idOrName: string | undefined): string {
    if (!idOrName) return 'Outros';
    return this.financeService.getCategory(idOrName)?.name || idOrName;
  }

  getCardName(id: string | null): string {
    if (!id) return '';
    return this.financeService.getCard(id)?.name || 'Cartão';
  }

  getOwnerName(id: string | undefined): string {
    if (!id) return '-';
    return this.financeService.getOwner(id)?.name || '-';
  }

  onSavePreferences() {
    this.financeService.updateMonthStartDay(this.preferencesForm.value.monthStartDay);
  }

  onAddCategory() {
    if (this.categoryForm.valid) {
      this.financeService.addCategory(this.categoryForm.value.name, this.categoryForm.value.color);
      this.categoryForm.reset({ color: '#3b82f6' });
    }
  }

  onSaveCard() {
    if (this.cardForm.valid) {
      if (this.editingCardId()) {
        this.financeService.updateCard(this.editingCardId()!, this.cardForm.value);
      } else {
        const val = this.cardForm.value;
        this.financeService.addCard(val.name, val.ownerId, val.closingDay, val.dueDay, val.color);
      }
      this.cancelCardEdit();
    }
  }

  editCard(card: CreditCard) {
    this.editingCardId.set(card.id);
    this.cardForm.patchValue(card);
  }

  onSaveOwner() {
    if (this.ownerForm.valid) {
      if (this.editingOwnerId()) {
        this.financeService.updateOwner(this.editingOwnerId()!, this.ownerForm.value.name);
      } else {
        this.financeService.addOwner(this.ownerForm.value.name);
      }
      this.cancelOwnerEdit();
    }
  }

  editOwner(owner: Owner) {
    this.editingOwnerId.set(owner.id);
    this.ownerForm.patchValue({ name: owner.name });
  }
}
