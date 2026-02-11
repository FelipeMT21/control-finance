import { HttpClient } from "@angular/common/http";
import { inject, Injectable, signal } from "@angular/core";
import { Observable, tap } from "rxjs";
import { environment } from "src/environments/environment";

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly API_URL = `${environment.apiUrl}/auth`;
  http = inject(HttpClient);
  
  isGuestSignal = signal<boolean>(localStorage.getItem('username') === 'visitante_demo');
  usernameSignal = signal<string>(localStorage.getItem('username') || 'Usuário');

  login(username: string, password: string) {
    return this.http.post<{ token: string }>(`${this.API_URL}/login`, { username, password })
      .pipe(
        tap(res => {
          localStorage.setItem('vault_token', res.token);
          localStorage.setItem('username', username);
          this.usernameSignal.set(username);
          this.isGuestSignal.set(false);
        })
      );
  }

  loginAsGuest(): Observable<any> {
    return this.http.post(`${this.API_URL}/login/guest-demo`, {}).pipe(
      tap((res: any) => {
        if (res.token) {
          localStorage.setItem('vault_token', res.token);
          this.usernameSignal.set('visitante_demo');
          localStorage.setItem('username', 'visitante_demo');
          this.isGuestSignal.set(true);
        }
      })
    );
  }

  logout() {
    localStorage.removeItem('vault_token');
    localStorage.removeItem('username');
    this.isGuestSignal.set(false);
  }

  getToken() {
    return localStorage.getItem('vault_token');
  }

  isGuestUser(): boolean {
    return this.isGuestSignal();
  }
}