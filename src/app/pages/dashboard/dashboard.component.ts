import { Component, computed, inject, signal, effect, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';

import { FinanceService } from '../../services/finance.service';
import { Owner } from '@app/models/owner.model';
import { CreditCard } from '@app/models/creditCard.model';
import { Transaction, TransactionType } from '@app/models/transaction.model';
import { ChartComponent, ChartData } from '../../components/chart.component';
import { forkJoin } from 'rxjs';
import { ButtonComponent } from '@app/components/button/button.component';
import { CalendarViewComponent } from '@app/components/calendar-view/calendar-view.component';
import { Router } from '@angular/router';
import { AuthService } from '@app/services/auth.service';

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
  imports: [CommonModule, ReactiveFormsModule, ChartComponent, ButtonComponent, CalendarViewComponent],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent {
  financeService = inject(FinanceService);
  fb = inject(FormBuilder);

  public authService = inject(AuthService);
  private router = inject(Router);

  @ViewChild(CalendarViewComponent) calendarComponent!: CalendarViewComponent;

  // --- UI State ---
  activeModal = signal<'transaction' | 'settings' | 'batch-confirm' | 'calendar' | null>(null);
  settingsTab = signal<'preferences' | 'categories' | 'cards' | 'owners'>('preferences');

  isSaving = signal(false);

  editingTransactionId = signal<string | null>(null);
  updatingTransactionId = signal<string | null>(null);

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
  selectedDay = signal<number | null>(null);
  statusFilter = signal<'all' | 'paid' | 'pending'>('all');
  sortConfig = signal<{ key: string, direction: 'asc' | 'desc' }>({ key: 'date', direction: 'desc' });

  // --- BUSCA (ATUALIZADO) ---
  searchQuery = signal('');
  isSearchOpen = signal(false);
  @ViewChild('searchInput') searchInput!: ElementRef;
  windowWidth = window.innerWidth;
  @HostListener('window:resize')
  onResize() {
    this.windowWidth = window.innerWidth;
  }

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

    this.financeService.reloadData(this.selectedMonth(), this.selectedYear());

    // Inicialização dos formulários
    this.transactionForm = this.fb.group({
      description: ['', Validators.required],
      amount: [null, [Validators.required, Validators.min(0.01)]],
      type: ['EXPENSE', Validators.required],
      date: [this.getISODate(this.today), Validators.required],
      ownerId: [this.financeService.owners()[0]?.id || '', Validators.required],
      categoryId: [this.financeService.categories()[0]?.id || '', Validators.required],

      // NOVOS CAMPOS:
      useCard: [false],
      creditCardId: [this.financeService.cards()[0]?.id || ''],
      paymentMethod: ['PIX'], // Valor padrão inicial

      installments: [1]
    });

    // Observa mudanças no tipo (Receita/Despesa)
    this.transactionForm.get('useCard')?.valueChanges.subscribe(val => {
      this.useCard.set(val); // <--- Atualiza o sinal para o HTML mostrar/esconder o select

      if (val) {
        // Se ligou o cartão: Define método como Crédito
        this.transactionForm.patchValue({
          paymentMethod: 'CREDIT_CARD',
          creditCardId: this.financeService.cards()[0]?.id || ''
        });
      } else {
        // Se desligou: Volta para Pix e limpa o cartão
        this.transactionForm.patchValue({
          paymentMethod: 'PIX',
          creditCardId: null
        });
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
    const transaction = this.financeService.transactions();
    const { key, direction } = this.sortConfig();
    const query = this.searchQuery().toLowerCase().trim();

    // --- NOVOS FILTROS ---
    const dayFilter = this.selectedDay();
    const currentMonth = this.selectedMonth();
    const currentYear = this.selectedYear();

    const filtered = transaction.filter(t => {
      const currentCardId = this.selectedCardId();
      const currentOwnerId = this.selectedOwnerId();
      const currentStatus = this.statusFilter();

      // 1. Filtro de Mês e Ano (Sempre ativo)
      const dateMatch = t.effectiveMonth === currentMonth &&
        t.effectiveYear === currentYear;
      if (!dateMatch) return false;

      // 2. FILTRO POR DIA (Ativado ao clicar no dia do calendário)
      if (dayFilter) {
        const tDate = new Date(t.purchaseDate);
        // Comparamos o dia do mês (1-31)
        if (tDate.getDate() !== dayFilter) return false;
      }

      // 3. Filtro de Cartão
      if (currentCardId) {
        const tCardId = t.creditCardId;
        if (tCardId !== currentCardId) return false;
      }

      // 4. Filtro de Dono
      if (currentOwnerId) {
        const tOwnerId = t.ownerId;
        if (tOwnerId !== currentOwnerId) return false;
      }

      // 5. Filtro de Status (Pago/Pendente)
      if (currentStatus === 'paid' && !t.paid) return false;
      if (currentStatus === 'pending' && t.paid) return false;

      // 6. Busca por texto
      if (query) {
        const descText = t.description.toLowerCase();
        const catText = (t.categoryName || this.getCategoryName(t.categoryId)).toLowerCase();
        const ownerText = (t.ownerName || this.getOwnerName(t.ownerId)).toLowerCase();

        const descriptionMatch = descText.includes(query);
        const categoryMatch = catText.includes(query);
        const ownerMatch = ownerText.includes(query);

        if (!descriptionMatch && !categoryMatch && !ownerMatch) return false;
      }

      return true;
    });

    // --- ORDENAÇÃO ---
    return filtered.sort((a, b) => {
      if (key === 'description' || key === 'category') {
        const valA = key === 'description' ? a.description : this.getCategoryName(a.categoryId).trim();
        const valB = key === 'description' ? b.description : this.getCategoryName(b.categoryId).trim();

        const comparison = valA.localeCompare(valB, 'pt-BR', { sensitivity: 'base' });
        return direction === 'asc' ? comparison : -comparison;
      }

      let numA: number;
      let numB: number;

      if (key === 'amount') {
        numA = a.amount;
        numB = b.amount;
      } else {
        numA = new Date(a.purchaseDate).getTime();
        numB = new Date(b.purchaseDate).getTime();
      }

      if (numA < numB) return direction === 'asc' ? -1 : 1;
      if (numA > numB) return direction === 'asc' ? 1 : -1;
      return 0;
    });
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
      .filter(t => t.type === 'INCOME')
      .reduce((acc, t) => acc + t.amount, 0);
  });

  totalExpense = computed(() => {
    return this.filteredTransactions()
      .filter(t => t.type === 'EXPENSE')
      .reduce((acc, t) => acc + t.amount, 0);
  });

  balance = computed(() => this.totalIncome() - this.totalExpense());

  invoiceInfo = computed(() => {
    const cardId = this.selectedCardId();
    if (!cardId) return null;

    const card = this.financeService.getCard(cardId);
    if (!card || !card.owner.id) {
      console.warn('Cartão selecionado está incompleto ou não foi encontrado.');
      return null;
    }

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
    const expenses = this.filteredTransactions().filter(t => t.type === 'EXPENSE');
    const groups: Record<string, number> = {};
    for (const t of expenses) {
      // FIX: Agora t.category é um objeto, pegamos o ID direto.
      const key = t.categoryId || 'Outros';
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

    const nextOwnerId = this.selectedOwnerId() === ownerId ? null : ownerId;

    this.selectedOwnerId.set(nextOwnerId);
    this.selectedCardId.set(null); // Reset card when switching owner context
  }

  selectCardFilter(cardId: string | null) {

    const nextCardId = this.selectedCardId() === cardId ? null : cardId;

    this.selectedCardId.set(nextCardId);
  }

  // --- CRUD & Batch Logic ---

  initiateDelete(transaction: Transaction) {
    if (!transaction.id) return;

    // Define que a ação é deletar
    this.pendingAction.set({ type: 'delete', transaction });

    // Abre o modal 'batch-confirm' (que agora está híbrido no HTML)
    this.activeModal.set('batch-confirm');
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
    if (!action || !action.transaction) return;

    // --- LÓGICA DE PAGAMENTO ---
    if (action.type === 'pay') {
      const isPaying = !action.transaction.paid;
      let targetIds: string[] = [];

      if (scope === 'single') {
        // Opção 1: Pagar apenas este item
        if (action.transaction.id) targetIds = [action.transaction.id];
      } else {
        // Opção 2: Pagar Fatura Inteira (scope === 'all')
        const currentCardId = action.transaction.creditCardId;

        if (!currentCardId) {
          console.warn('Tentativa de pagar fatura sem cartão identificado.');
          return;
        }

        targetIds = this.financeService.transactions()
          .filter(t => t.creditCardId === currentCardId)
          .map(t => t.id)
          .filter((id): id is string => !!id);
      }

      if (targetIds.length === 0) return;

      this.isSaving.set(true);

      const requests = targetIds.map(id =>
        this.financeService.updateTransaction(id, { paid: isPaying })
      );

      forkJoin(requests).subscribe({
        next: () => {
          this.financeService.updateTransactionsLocally(targetIds, { paid: isPaying });
          this.isSaving.set(false);
          this.closeModal();
        },
        error: (err) => {
          this.isSaving.set(false);
          alert('Erro ao atualizar pagamento em lote: ' + err.message);
        }
      });
      return;
    }

    // --- LÓGICA DE EXCLUSÃO (DELETE) ---
    if (action.type === 'delete') {
      this.isSaving.set(true);

      const groupId = action.transaction.groupId;

      // Se for uma transação em lote (Parcelada/Recorrente)
      if (groupId) {
        this.financeService.fetchGroup(groupId).subscribe(groupTransactions => {
          const currentIndex = groupTransactions.findIndex(t => t.id === action.transaction.id);
          if (currentIndex === -1) { 
            this.isSaving.set(false);
            this.closeModal(); 
            return; 
          }

          let targetIds: (string | undefined)[] = [];
          if (scope === 'single') targetIds = [action.transaction.id];
          else if (scope === 'all') targetIds = groupTransactions.map(t => t.id);
          else if (scope === 'future') targetIds = groupTransactions.slice(currentIndex).map(t => t.id);
          else if (scope === 'past') targetIds = groupTransactions.slice(0, currentIndex + 1).map(t => t.id);

          const validIds = targetIds.filter((id): id is string => !!id);

          if (validIds.length === 0) {
            this.isSaving.set(false);
            return;
          }

          this.financeService.deleteTransactionsBulk(validIds).subscribe({
            next: () => {
              this.financeService.deleteTransactionLocally(validIds);
              this.isSaving.set(false);
              this.closeModal();
            },
            error: (err) => {
              this.isSaving.set(false);
              alert('Erro ao excluir em lote: ' + err.message);
            }
          });
        });
      } 
      // Se for uma transação simples (Única)
      else {
        if (!action.transaction.id) {
          this.isSaving.set(false);
          return;
        }

        this.financeService.deleteTransactionsBulk([action.transaction.id]).subscribe({
          next: () => {
            this.financeService.deleteTransactionLocally([action.transaction.id!]);
            this.isSaving.set(false);
            this.closeModal();
          },
          error: (err) => {
            this.isSaving.set(false);
            alert('Erro ao excluir transação: ' + err.message);
          }
        });
      }
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
    this.isSaving.set(true);
    const val = this.transactionForm.value;

    const rawType = val.type ? val.type.toUpperCase() : 'EXPENSE';
    const isExpense = rawType === 'EXPENSE';

    const usingCard = isExpense && val.useCard;
    const currentCardId = val.creditCardId;

    // 1. Define o Método de Pagamento
    const finalPaymentMethod = usingCard ? 'CREDIT_CARD' : (val.paymentMethod || 'PIX');

    let isPaidAutomatic = false;

    if (!isExpense) {
      isPaidAutomatic = true; // Receitas entram como pagas
    } else {
      if (finalPaymentMethod === 'CREDIT_CARD' || 'BOLETO') {
        isPaidAutomatic = false;
      } else {
        const immediateMethods = ['PIX', 'CASH', 'DEBIT_CARD'];
        isPaidAutomatic = immediateMethods.includes(finalPaymentMethod);
      }
    }

    const editId = this.editingTransactionId();
    const scope = this.batchEditScope();

    if (editId) {
      const updatePayload: Partial<Transaction> = {
        description: val.description,
        amount: val.amount,
        type: rawType,
        purchaseDate: `${val.date}T12:00:00Z`,
        categoryId: val.categoryId,
        creditCardId: usingCard ? currentCardId : null,
        ownerId: val.ownerId,
        paymentMethod: finalPaymentMethod as any
      };

      if (!scope || scope === 'single') {
        this.financeService.updateTransaction(editId, updatePayload).subscribe({
          next: (updated) => {
            // this.closeModal();
            // this.financeService.loadByMonth(this.selectedMonth(), this.selectedYear());
            this.financeService.updateTransactionLocally(editId, updated);
            this.handleModalClose();
          },
          error: (err) => {
            this.isSaving.set(false);
            alert('Erro ao atualizar: ' + (err.error?.message || err.message))
          }
        });
      } else {
        const original = this.financeService.transactions().find(t => t.id === editId);
        if (original && original.groupId) {
          this.financeService.fetchGroup(original.groupId).subscribe(groupTransactions => {
            const currentIndex = groupTransactions.findIndex(t => t.id === original.id);
            let targetTransactions: Transaction[] = [];
            if (scope === 'all') targetTransactions = groupTransactions;
            else if (scope === 'future') targetTransactions = groupTransactions.slice(currentIndex);
            else if (scope === 'past') targetTransactions = groupTransactions.slice(0, currentIndex + 1);

            const requests = targetTransactions
              .filter((t): t is Transaction & { id: string } => !!t.id)
              .map(t => {
                const batchPayload = { ...updatePayload };
                batchPayload.purchaseDate = t.purchaseDate;
                batchPayload.description = t.description;
                batchPayload.amount = val.amount;
                return this.financeService.updateTransaction(t.id, batchPayload);
              });

            if (requests.length === 0) return;
            forkJoin(requests).subscribe({
              next: () => {
                this.closeModal();
                this.financeService.loadByMonth(this.selectedMonth(), this.selectedYear());
              },
              error: (err) => {
                const msg = err.error?.message || 'Ocorreu um erro ao salvar a transação.';
                console.error('Erro no cadastro:', err);
                alert('Não foi possível salvar: ' + msg);
              }
            });
          });
        }
      }

    } else {
      // --- CREATE LOGIC  ---
      const numInstallments = isExpense ? Number(val.installments) : 1;

      this.financeService.addTransaction(
        val.description,
        val.amount,
        rawType as TransactionType,
        val.date,
        val.categoryId,
        val.ownerId,
        usingCard ? currentCardId : null,
        numInstallments,
        finalPaymentMethod,
        isPaidAutomatic
      ).subscribe({
        next: () => {
          this.financeService.loadByMonth(this.selectedMonth(), this.selectedYear());
          this.handleModalClose();
        },
        error: (err) => {
          this.isSaving.set(false);
          alert('Erro ao salvar no servidor: ' + err.message)
        }
      });
    }
  }

  private handleModalClose() {
    setTimeout(() => {
      this.isSaving.set(false);
      this.closeModal();
    }, 100);
  }

  togglePaid(transaction: Transaction) {
    if (transaction.creditCardId) {
      this.pendingAction.set({
        type: 'pay',
        transaction: transaction
      });
      this.activeModal.set('batch-confirm');
      return;
    }

    if (transaction.id) {
      this.executeTogglePaid(transaction.id, !transaction.paid);
    } else {
      console.warn('Não é possível alterar o status de uma transação sem ID.');
    }
  }

  private executeTogglePaid(id: string, novoStatus: boolean) {
    this.updatingTransactionId.set(id);

    this.financeService.updateTransaction(id, { paid: novoStatus }).subscribe({
      next: () => {
        //this.financeService.loadByMonth(this.selectedMonth(), this.selectedYear())
        this.financeService.updateTransactionLocally(id, { paid: novoStatus });
      },
      error: (err) => {
        console.error('Erro ao atualizar status:', err);
        alert('Não foi possível atualizar o pagamento. Tente novamente.');
      },
      complete: () => {
        this.updatingTransactionId.set(null);
      }
    });
  }

  toggleSort(key: string) {
    const current = this.sortConfig();
    if (current.key === key) {
      this.sortConfig.set({ key, direction: current.direction === 'asc' ? 'desc' : 'asc' })
    } else {
      const direction = key === 'amount' ? 'desc' : 'asc';
      this.sortConfig.set({ key, direction });
    }
  }

  toggleSearch() {
    this.isSearchOpen.update(v => !v);

    if (this.isSearchOpen()) {
      setTimeout(() => {
        if (this.searchInput) {
          this.searchInput.nativeElement.focus();
        }
      }, 100);
    } else {
      this.searchQuery.set('');
    }
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

  onLogout() {
    this.financeService.resetState();
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  openModal(type: 'transaction' | 'settings' | 'batch-confirm' | 'calendar', transactionToEdit: Transaction | null = null) {
    this.activeModal.set(type);

    // 1. Lógica do Calendário
    if (type === 'calendar') {
      const syncDate = new Date(this.selectedYear(), this.selectedMonth(), 1);
      setTimeout(() => {
        if (this.calendarComponent) {
          this.calendarComponent.viewDate.set(syncDate);
          this.calendarComponent.loadCalendarData();
        }
      }, 10);
      return;
    }

    // 2. Lógica de Configurações
    if (type === 'settings') {
      this.cancelOwnerEdit();
      this.cancelCardEdit();
      this.preferencesForm.patchValue({
        monthStartDay: this.financeService.settings().monthStartDay
      });
      return;
    }

    // Se não for transação, para por aqui
    if (type !== 'transaction') return;

    // --- LÓGICA DE EDIÇÃO (EXISTE ID) ---
    if (transactionToEdit?.id) {
      this.editingTransactionId.set(transactionToEdit.id);

      // A. Extração de IDs
      const tOwnerId = transactionToEdit.ownerId || '';
      const tCatId = transactionToEdit.categoryId || '';
      const tCardId = transactionToEdit.creditCardId || '';

      // B. Definição de Variáveis Auxiliares (AQUI ESTÁ O HASCARD)
      const hasCard = !!tCardId; // True se tiver ID, False se for vazio

      // C. Atualiza o Signal Visual
      this.useCard.set(hasCard);
      this.customInstallmentMode.set((transactionToEdit.installmentTotal || 1) > 24);

      // D. Define o Método de Pagamento
      // Se veio do banco, usa. Se não, infere: Tem cartão? Crédito. Não tem? Pix.
      const currentMethod = transactionToEdit.paymentMethod || (hasCard ? 'CREDIT_CARD' : 'PIX');

      // E. Preenche o Formulário
      this.transactionForm.setValue({
        description: transactionToEdit.description || '',
        amount: transactionToEdit.amount || 0,
        type: transactionToEdit.type?.toUpperCase() || 'EXPENSE',
        date: transactionToEdit.purchaseDate ? transactionToEdit.purchaseDate.split('T')[0] : '',
        ownerId: tOwnerId,
        categoryId: tCatId,

        // Campos Novos
        useCard: hasCard, // Usa a variável criada acima
        creditCardId: tCardId,
        paymentMethod: currentMethod,

        installments: transactionToEdit.installmentTotal || 1
      });
    }
    // --- LÓGICA DE NOVO CADASTRO (NÃO EXISTE HASCARD AQUI) ---
    else {
      this.editingTransactionId.set(null);
      this.batchEditScope.set(null);
      this.customInstallmentMode.set(false);

      const filteredCardId = this.selectedCardId();
      const hasFilterCard = !!filteredCardId;

      this.useCard.set(hasFilterCard);

      const ownerParaOForm = this.selectedOwnerId() || this.financeService.owners()[0]?.id || '';
      const cardParaOForm = this.selectedCardId() || this.financeService.cards()[0]?.id || '';

      this.transactionForm.reset({
        type: 'EXPENSE',
        date: this.getISODate(new Date()),
        ownerId: ownerParaOForm,
        categoryId: this.financeService.categories()[0]?.id || '',
        creditCardId: cardParaOForm,

        // Padrões Iniciais
        useCard: hasFilterCard, // Aqui usamos false direto
        paymentMethod: hasFilterCard ? 'CREDIT_CARD' : 'PIX',
        installments: 1
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

    // 1. Atualiza mês e ano
    this.selectedMonth.set(m);
    this.selectedYear.set(y);

    // 2. RESET DO DIA: Ao mudar de mês pelas setas, 
    // queremos ver todos os lançamentos do mês novo.
    this.selectedDay.set(null);

    // 3. Carrega os dados globais para o Dashboard
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
    if (this.cardForm.invalid) return;

    const val = this.cardForm.value;
    const cardId = this.editingCardId();

    if (cardId) {
      // Passamos o valor do formulário DIRETO. 
      // O Service que se vire para transformar 'ownerId' em 'Owner'.
      this.financeService.updateCard(cardId, val);
    } else {
      this.financeService.addCard(val.name, val.ownerId, val.closingDay, val.dueDay, val.color);
    }

    this.cancelCardEdit();
  }

  editCard(card: CreditCard) {
    this.editingCardId.set(card.id ?? null);
    this.cardForm.patchValue({
      name: card.name,
      ownerId: card.owner?.id,
      closingDay: card.closingDay,
      dueDay: card.dueDay,
      color: card.color
    });
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
    if (!owner.id) return;
    this.editingOwnerId.set(owner.id);
    this.ownerForm.patchValue({ name: owner.name });
  }

  onDashboardCalendarSelect(date: Date) {
    // 1. Atualiza os signals de contexto
    this.selectedMonth.set(date.getMonth());
    this.selectedYear.set(date.getFullYear());
    this.selectedDay.set(date.getDate()); // Ativa o filtro do dia específico

    // 2. Limpa a busca por texto para evitar confusão no filtro
    this.searchQuery.set('');
    this.isSearchOpen.set(false);

    // 3. Recarrega os dados do mês no service global
    this.financeService.loadByMonth(date.getMonth(), date.getFullYear());

    // 4. Fecha o modal
    this.closeModal();
  }

  clearDayFilter() {
    this.selectedDay.set(null);
  }
}