import { Component, computed, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';

import { FinanceService, Transaction, CreditCard, Owner } from '../../services/finance.service';
import { ChartComponent, ChartData } from '../../components/chart.component';
import { forkJoin } from 'rxjs';
import { ButtonComponent } from '@app/components/button/button.component';

type BatchActionType = 'delete' | 'edit' | 'pay';
type BatchScope = 'single' | 'all' | 'future' | 'past';

interface PendingAction {
  type: BatchActionType;
  transaction: Transaction;
  formValue?: any; // For edits
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ChartComponent, ButtonComponent],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent {
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
  batchEditScope = signal<BatchScope | null>(null); // Stores the scope selected during Edit flow

  // Installment UI State
  readonly installmentOptions = Array.from({ length: 24 }, (_, i) => i + 1);
  customInstallmentMode = signal(false);

  // Dashboard Context State
  selectedOwnerId = signal<string | null>(null); // New: Filter by Owner first
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

    // Faz o carregamento inicial filtrado pelo mês e ano que foi definido nos signals
    this.financeService.loadByMonth(this.selectedMonth(), this.selectedYear());

    // Inicialização dos formulários
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

    // Observa mudanças no tipo (Receita/Despesa)
    this.transactionForm.get('type')?.valueChanges.subscribe(val => {
      if (val === 'income') this.useCard.set(false);
    });

    // Observa mudança de cartão para setar o dono automaticamente
    this.transactionForm.get('cardId')?.valueChanges.subscribe(cardId => {
      if (this.useCard() && cardId) {
        const card = this.financeService.getCard(cardId);
        if (card) {
          this.transactionForm.patchValue({ ownerId: card.owner.id }, { emitEvent: false });
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
    return months[this.selectedMonth()];
  });

  filteredTransactions = computed(() => {
    return this.financeService.transactions().filter(t => {
      const currentCardId = this.selectedCardId();
      const currentOwnerId = this.selectedOwnerId();

      // 1. Filtro de Mês e Ano (Prioridade total aos campos do Java)
      const dateMatch = t.effectiveMonth === this.selectedMonth() &&
        t.effectiveYear === this.selectedYear();

      if (!dateMatch) return false;

      // 2. Filtro por CARTÃO
      if (currentCardId) {
        const tCardId = t.creditCard?.id || t.cardId;
        if (tCardId !== currentCardId) return false;
      }

      // 3. Filtro por DONO
      if (currentOwnerId) {
        const tOwnerId = t.owner?.id || t.ownerId;
        if (tOwnerId !== currentOwnerId) return false;
      }

      return true;

    }).sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());
  });

  // Helper to get cards for the sub-menu
  ownerCards = computed(() => {
    const ownerId = this.selectedOwnerId();
    if (!ownerId) return [];
    // AJUSTE: Acessando o ID dentro do objeto owner
    return this.financeService.cards().filter(c => c.owner.id === ownerId);
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
    const endDate = new Date(endYear, endMonth, card.closingDay - 1);

    return {
      cardName: card.name,
      ownerName: this.financeService.getOwner(card.owner.id)?.name,
      closingDate: `${card.closingDay}/${endMonth + 1}`,
      dueDate: `${card.dueDay}/${endMonth + 1}`,
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
      // FIX: Agora t.category é um objeto, pegamos o ID direto.
      const key = t.categoryId || t.category?.id || 'Outros';
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

  // --- Navigation Actions ---

  selectOwnerFilter(ownerId: string | null) {
    this.selectedOwnerId.set(ownerId);
    this.selectedCardId.set(null); // Reset card when switching owner context
  }

  selectCardFilter(cardId: string | null) {
    this.selectedCardId.set(cardId);
  }

  // --- CRUD & Batch Logic ---

  initiateDelete(transaction: Transaction) {
    if (transaction.groupId) {
      this.pendingAction.set({ type: 'delete', transaction });
      this.activeModal.set('batch-confirm');
    } else {
      if (confirm('Excluir esta movimentação?')) {
        this.financeService.deleteTransaction(transaction.id).subscribe({
          next: () => {
            this.closeModal();
            this.financeService.loadByMonth(this.selectedMonth(), this.selectedYear());
          },
          error: (err) => alert('Erro ao excluir: ' + err.message)
        });
      }
    }
  }

  initiateEdit(transaction: Transaction) {
    if (transaction.groupId) {
      // Ask for scope first
      this.pendingAction.set({ type: 'edit', transaction });
      this.activeModal.set('batch-confirm');
    } else {
      // Normal edit
      this.batchEditScope.set(null);
      this.openModal('transaction', transaction);
    }
  }

  executeBatchAction(scope: BatchScope) {
    const action = this.pendingAction();
    if (!action) return;

    // --- LÓGICA DE PAGAMENTO (NOVO) ---
    if (action.type === 'pay' as any) {
      const isPaying = !action.transaction.paid;
      let targetIds: string[] = [];

      if (scope === 'single') {
        targetIds = [action.transaction.id];
      } else {
        // Pega todas as transações do MESMO cartão que estão visíveis no dashboard agora
        targetIds = this.filteredTransactions()
          .filter(t => (t.creditCard?.id || t.cardId) === (action.transaction.creditCard?.id || action.transaction.cardId))
          .map(t => t.id);
      }

      const requests = targetIds.map(id =>
        this.financeService.updateTransaction(id, { paid: isPaying })
      );

      forkJoin(requests).subscribe({
        next: () => {
          this.closeModal();
          this.financeService.loadByMonth(this.selectedMonth(), this.selectedYear());
        },
        error: (err) => alert('Erro ao atualizar pagamento em lote: ' + err.message)
      });
      return;
    }

    // --- LÓGICA DE EXCLUSÃO (DELETE) ---
    if (action.type === 'delete') {
      const groupId = action.transaction.groupId!;
      this.financeService.fetchGroup(groupId).subscribe(groupTransactions => {
        const currentIndex = groupTransactions.findIndex(t => t.id === action.transaction.id);
        if (currentIndex === -1) { this.closeModal(); return; }

        let targetIds: string[] = [];
        if (scope === 'single') targetIds = [action.transaction.id];
        else if (scope === 'all') targetIds = groupTransactions.map(t => t.id);
        else if (scope === 'future') targetIds = groupTransactions.slice(currentIndex).map(t => t.id);
        else if (scope === 'past') targetIds = groupTransactions.slice(0, currentIndex + 1).map(t => t.id);

        this.financeService.deleteTransactionsBulk(targetIds).subscribe({
          next: () => {
            this.closeModal();
            this.financeService.loadByMonth(this.selectedMonth(), this.selectedYear());
          },
          error: (err) => alert('Erro ao excluir em lote: ' + err.message)
        });
      });
      return;
    }

    // --- LÓGICA DE EDIÇÃO ---
    if (action.type === 'edit') {
      this.batchEditScope.set(scope);
      this.activeModal.set(null);
      setTimeout(() => {
        this.openModal('transaction', action.transaction);
      }, 50);
    }
  }

  onSubmitTransaction() {
    if (this.transactionForm.invalid) return;

    const val = this.transactionForm.value;
    const isExpense = val.type === 'expense';
    const usingCard = isExpense && this.useCard();
    const editId = this.editingTransactionId();
    const scope = this.batchEditScope();

    if (editId) {
      // --- UPDATE LOGIC ---
      const updatePayload: Partial<Transaction> = {
        description: val.description,
        amount: val.amount,
        type: val.type,
        purchaseDate: `${val.date}T12:00:00Z`,
        category: { id: val.categoryId } as any,
        owner: { id: val.ownerId } as any,
        categoryId: val.categoryId,
        cardId: usingCard ? val.cardId : null,
        ownerId: val.ownerId
      };

      if (!scope || scope === 'single') {
        // Single Update
        this.financeService.updateTransaction(editId, updatePayload).subscribe({
          next: () => {
            this.closeModal();
            this.financeService.loadByMonth(this.selectedMonth(), this.selectedYear());
          },
          error: (err) => alert('Erro ao atualizar: ' + err.message)
        });
      } else {
        // --- BATCH UPDATE LOGIC ---
        const original = this.financeService.transactions().find(t => t.id === editId);

        if (original && original.groupId) {
          this.financeService.fetchGroup(original.groupId).subscribe(groupTransactions => {

            const currentIndex = groupTransactions.findIndex(t => t.id === original.id);
            let targetTransactions: Transaction[] = [];

            if (scope === 'all') targetTransactions = groupTransactions;
            else if (scope === 'future') targetTransactions = groupTransactions.slice(currentIndex);
            else if (scope === 'past') targetTransactions = groupTransactions.slice(0, currentIndex + 1);

            const requests = targetTransactions.map(t => {
              const batchPayload = { ...updatePayload };
              batchPayload.purchaseDate = t.purchaseDate;
              batchPayload.description = t.description;
              batchPayload.amount = val.amount;
              return this.financeService.updateTransaction(t.id, batchPayload);
            });

            forkJoin(requests).subscribe({
              next: () => {
                this.closeModal();
                this.financeService.loadByMonth(this.selectedMonth(), this.selectedYear());
              },
              error: (err) => alert('Erro ao atualizar em lote: ' + err.message)
            });
          });
        }
      }

    } else {
      // --- CREATE LOGIC ---
      const numInstallments = isExpense ? Number(val.installments) : 1;

      this.financeService.addTransaction(
        val.description,
        val.amount,
        val.type,
        val.date,
        val.categoryId,
        val.ownerId,
        usingCard ? val.cardId : null,
        numInstallments
      ).subscribe({
        next: () => {
          this.closeModal();
          this.financeService.loadByMonth(this.selectedMonth(), this.selectedYear());
        },
        error: (err) => alert('Erro ao salvar no servidor: ' + err.message)
      });
    }
  }

  togglePaid(transaction: Transaction) {
    if (transaction.cardId) {
      this.pendingAction.set({
        type: 'pay' as any,
        transaction: transaction
      });
      this.activeModal.set('batch-confirm');
    } else {
      this.executeTogglePaid(transaction.id, !transaction.paid);
    }
  }

  private executeTogglePaid(id: string, novoStatus: boolean) {
    this.financeService.updateTransaction(id, { paid: novoStatus }).subscribe({
      next: () => this.financeService.loadByMonth(this.selectedMonth(), this.selectedYear()),
      error: (err) => console.error('Erro ao atualizar status:', err)
    });
  }

  // --- Modals & UI Helpers ---

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

        const tOwnerId = transactionToEdit.owner?.id || transactionToEdit.ownerId || null;
        const tCatId = transactionToEdit.category?.id || transactionToEdit.categoryId || null;
        const tCardId = transactionToEdit.creditCard?.id || transactionToEdit.cardId || null;

        this.useCard.set(!!tCardId);

        const total = transactionToEdit.installmentTotal || 1;
        this.customInstallmentMode.set(total > 24);

        this.transactionForm.setValue({
          description: transactionToEdit.description,
          amount: transactionToEdit.amount,
          type: transactionToEdit.type,
          date: transactionToEdit.purchaseDate.split('T')[0],
          ownerId: tOwnerId || '',
          categoryId: tCatId || '',
          cardId: tCardId || '',
          installments: 1
        });

      } else {
        // NEW Transaction
        this.editingTransactionId.set(null);
        this.batchEditScope.set(null);
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
    this.batchEditScope.set(null);
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
    this.financeService.loadByMonth(m, y);
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

  getCardName(id: string | null | undefined): string {
    if (!id) return '';
    return this.financeService.getCard(id)?.name || 'Cartão';
  }

  getOwnerName(id: string | null | undefined): string {
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
    this.editingCardId.set(card.id ?? null);
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