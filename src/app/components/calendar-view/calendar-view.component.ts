import { Component, computed, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinanceService } from '@app/services/finance.service';
import { Transaction } from '@app/models/transaction.model';

@Component({
  selector: 'app-calendar-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './calendar-view.component.html',
  styleUrl: './calendar-view.component.css',
})
export class CalendarViewComponent {
  private financeService = inject(FinanceService);

  // Data que controla o que aparece na modal
  viewDate = signal(new Date());

  // ESTOQUE LOCAL: Dados apenas para a modal
  calendarTransactions = signal<Transaction[]>([]);

  // Emite a data selecionada para o Dashboard
  daySelected = output<Date>();

  monthLabel = computed(() => {
    return this.viewDate().toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  });

  weekDays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  // --- RESUMO DO MÊS (MODAL) ---
  monthlySummary = computed(() => {
    const transactions = this.calendarTransactions();

    const totalPending = transactions
      .filter(t => !t.paid && t.type === 'EXPENSE')
      .reduce((acc, t) => acc + t.amount, 0);

    const totalPaid = transactions
      .filter(t => t.paid && t.type === 'EXPENSE')
      .reduce((acc, t) => acc + t.amount, 0);

    return { totalPending, totalPaid };
  });

  // --- GRID DE DIAS ---
  calendarDays = computed(() => {
    const date = this.viewDate();
    const year = date.getFullYear();
    const month = date.getMonth();
    const transactions = this.calendarTransactions();

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days: { day: number | null, date: Date | null, info: any }[] = [];

    for (let i = 0; i < firstDayIndex; i++) {
      days.push({ day: null, date: null, info: null });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(year, month, i);
      days.push({
        day: i,
        date: d,
        info: this.getDayStatus(d, transactions)
      });
    }
    return days;
  });

  private getDayStatus(date: Date, transactions: Transaction[]) {
    if (!transactions.length) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cellDate = new Date(date);
    cellDate.setHours(0, 0, 0, 0);

    const dayTxs = transactions.filter(t => {
      const isCard = t.paymentMethod === 'CREDIT_CARD' || !!t.creditCardId;
      let targetDate: Date;

      if (isCard && t.billingDate) {
        const [year, month] = t.billingDate.split('-').map(Number);

        const card = this.financeService.cards().find(c => c.id === t.creditCardId)
        const closingDay = card?.closingDay || 1;

        const lastDayOfInvoiceMonth = new Date(year, month, 0).getDate();
        const visualDay = Math.min(closingDay, lastDayOfInvoiceMonth);
        targetDate = new Date(year, month - 1, visualDay);
      } else {
        targetDate = new Date(t.purchaseDate);
      }

      targetDate.setHours(0, 0, 0, 0);
      return targetDate.getTime() === cellDate.getTime();
    });

    if (dayTxs.length === 0) return null;

    const expenses = dayTxs.filter(t => t.type === 'EXPENSE');
    if (expenses.length === 0) return { status: 'green', hasData: true, names: ['Receitas'] };

    // --- CAPTURA DE NOMES PARA O TOOLTIP ---
    const names = expenses.map(t => {
      if (t.paymentMethod === 'CREDIT_CARD' || !!t.creditCardId) {
        const cardName = t.cardName || this.financeService.getCard(t.creditCardId || '')?.name || 'Cartão';
        return `Fatura: ${cardName}`;
      }
      return t.description;
    });

    // PRIORIDADE 1: CARTÃO (AZUL)
    const hasCreditCard = expenses.some(t => t.paymentMethod === 'CREDIT_CARD' || !!t.creditCardId);
    if (hasCreditCard) return { status: 'blue', hasData: true, names: [...new Set(names)] };

    // PRIORIDADE 2: PENDÊNCIAS (VERMELHO/LARANJA)
    const hasPending = expenses.some(t => !t.paid);
    if (hasPending) {
      const status = cellDate.getTime() < today.getTime() ? 'red' : 'orange';
      return { status, hasData: true, names: [...new Set(names)] };
    }

    return { status: 'green', hasData: true, names: [...new Set(names)] };
  }

  // MÉTODO PARA CARREGAR DADOS
  public loadCalendarData() {
    const date = this.viewDate();
    this.financeService.fetchTransactionsSilently(date.getMonth(), date.getFullYear())
      .subscribe(data => {
        this.calendarTransactions.set(data);
      });
  }

  prevMonth() {
    const d = new Date(this.viewDate());
    d.setMonth(d.getMonth() - 1);
    this.viewDate.set(d);
    this.loadCalendarData();
  }

  nextMonth() {
    const d = new Date(this.viewDate());
    d.setMonth(d.getMonth() + 1);
    this.viewDate.set(d);
    this.loadCalendarData();
  }

  selectDay(cell: any) {
    if (cell.date) {
      this.daySelected.emit(cell.date);
    }
  }

  isToday(date: Date | null): boolean {
    if (!date) return false;
    const today = new Date();
    return date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }
}