import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { Observable, tap } from "rxjs";
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

    loginAsGuest(): Observable<any> {
    return this.http.post(`${this.API_URL}/login/guest-demo`, {}).pipe(
      tap((response: any) => {
        // Se o login der certo, salva o token automaticamente
        if (response.token) {
          localStorage.setItem('auth-token', response.token);
          // Opcional: Salvar o username para mostrar avisos depois
          localStorage.setItem('username', 'visitante_demo'); 
        }
      })
    );
  }
  
  // Método auxiliar útil para saber se é visitante
  isGuestUser(): boolean {
    return localStorage.getItem('username') === 'visitante_demo';
  } 
}