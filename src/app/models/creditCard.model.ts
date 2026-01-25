import { Owner } from "./owner.model";

export interface CreditCard {
    id?: string;
    name: string;
    closingDay: number;
    dueDay: number;
    color: string;
    owner: Owner;
}