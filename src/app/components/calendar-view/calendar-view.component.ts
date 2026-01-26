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

  // ESTOQUE LOCAL: Dados apenas para a modal, sem quebrar o Dashboard atrás
  calendarTransactions = signal<Transaction[]>([]);

  // Emite a data selecionada para o Dashboard
  daySelected = output<Date>();

  monthLabel = computed(() => {
    return this.viewDate().toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  });

  weekDays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  // --- RESUMO DO MÊS (MODAL) ---
  // Calcula com base no calendarTransactions (o estoque local)
  monthlySummary = computed(() => {
    const transactions = this.calendarTransactions();

    const totalPending = transactions
      .filter(t => !t.paid && t.type === 'expense')
      .reduce((acc, t) => acc + t.amount, 0);

    const totalPaid = transactions
      .filter(t => t.paid && t.type === 'expense')
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

  // LÓGICA DAS BOLINHAS REVISADA
  private getDayStatus(date: Date, transactions: Transaction[]) {
    if (!transactions.length) return null;

    // Filtra transações deste dia específico
    const dayTxs = transactions.filter(t => {
      const dateToCompare = t.cardId ? t.billingDate : t.purchaseDate;
      const tDate = new Date(dateToCompare);
      
      return tDate.getDate() === date.getDate() &&
        tDate.getMonth() === date.getMonth() &&
        tDate.getFullYear() === date.getFullYear();
    });

    const expenses = dayTxs.filter(t => t.type === 'expense');
    if (expenses.length === 0) return null;

    // Se houver 10 e 1 não estiver paga -> Vermelho (Pendente)
    const hasPending = expenses.some(t => !t.paid);

    return {
      hasPending: hasPending, // true = vermelho, false = verde
      hasData: true
    };
  }

  // MÉTODO PARA CARREGAR DADOS SEM QUEBRAR O FUNDO
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