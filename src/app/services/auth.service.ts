import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { tap } from "rxjs";
import { environment } from "src/environments/environment";

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private readonly API_URL = `${environment.apiUrl}/auth`;

    http = inject(HttpClient);
    
    login(username: string, password: string) {
        return this.http.post<{token: string}>(`${this.API_URL}/login`, { username, password })
        .pipe(
            tap(res => {
                localStorage.setItem('vault_token', res.token);
            })
        );
    }

    logout() {
        localStorage.removeItem('vault_token');
    }

    getToken() {
        return localStorage.getItem('vault_token');
    }
}