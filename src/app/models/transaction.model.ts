import { Category } from "./category.model";
import { CreditCard } from "./creditCard.model";
import { Owner } from "./owner.model";

export type TransactionType = 'income' | 'expense';

// ✅ NOVO: Define os valores exatos que vêm do Java
export type PaymentMethod = 'CREDIT_CARD' | 'PIX' | 'BOLETO' | 'CASH' | 'DEBIT_CARD';

export interface Transaction {
    id?: string; // UUID from backend
    description: string;
    amount: number;
    type: TransactionType;
    purchaseDate: string;
    billingDate: string;
    paid: boolean;
    paymentMethod?: PaymentMethod;

    // Objetos completos vindo do Java (JPA)
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