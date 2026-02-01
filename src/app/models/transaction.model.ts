export type TransactionType = 'INCOME' | 'EXPENSE';

export type PaymentMethod = 'CREDIT_CARD' | 'PIX' | 'BOLETO' | 'CASH' | 'DEBIT_CARD';

export interface Transaction {
    id: string;
    // --- Dados Básicos ---
    description: string;
    amount: number;
    type: TransactionType;
    paymentMethod?: PaymentMethod;
    purchaseDate: string;
    billingDate: string;
    paid: boolean;
    createdAt: string;

    // --- INPUT (ENVIA para o Java - IDs) ---
    categoryId: string;
    ownerId: string;
    creditCardId?: string | null;
    groupId?: string;

    // --- OUTPUT (RECEBE do Java - Leitura) ---
    categoryName: string;
    categoryColor: string;
    ownerName: string;
    cardName: string | null;
    cardColor: string | null;

    installmentCurrent?: number;
    installmentTotal?: number;
    effectiveMonth?: number;
    effectiveYear?: number;
}