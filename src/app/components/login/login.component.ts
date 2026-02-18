import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastrService } from 'ngx-toastr'; // 👈 1. Importar aqui
import { finalize } from 'rxjs';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent implements OnInit {
  username = '';
  password = '';

  isServerWakingUp = signal(false);
  serverReady = signal(false);

  isLoadingGuest = signal(false);
  isLoadingLogin = signal(false);

  ngOnInit() {
    this.checkServer();
  }

  checkServer() {
    const timeoutId = setTimeout(() => {
      if (!this.serverReady()) this.isServerWakingUp.set(true);
    }, 1000);

    this.authService.checkServerStatus().subscribe({
      next: () => {
        clearTimeout(timeoutId);
        this.isServerWakingUp.set(false);
        this.serverReady.set(true);
        console.log("✅ Servidor pronto!");
      },
      error: () => {
        this.isServerWakingUp.set(true);
        setTimeout(() => this.checkServer(), 3000);
      }
    });
  }

  private authService = inject(AuthService);
  private router = inject(Router);
  private toastr = inject(ToastrService);

  onSubmit() {
    if (this.username && this.password) {
      this.isLoadingLogin.set(true);
      this.authService.login(this.username, this.password)
        .pipe(finalize(() => this.isLoadingLogin.set(false)))
        .subscribe({
          next: (res) => {
            this.toastr.success('Login realizado com sucesso!', 'Bem-vindo');
            this.router.navigate(['/dashboard']);
          },
          error: (err) => {
            console.error('Erro ao logar:', err);
            this.toastr.error('Usuário ou senha incorretos.', 'Erro de Login');
          }
        });
    } else {
      this.toastr.warning('Por favor, preencha todos os campos.', 'Atenção');
    }
  }

  handleGuestLogin() {
    this.isLoadingGuest.set(true);

    this.authService.loginAsGuest()
      .pipe(
        finalize(() => {
          this.isLoadingGuest.set(false);
        })
      )
      .subscribe({
        next: (res: any) => {
          const token = res.token || res.accessToken;

          if (token) {
            localStorage.setItem('vault_token', token);

            this.toastr.success('Modo Demonstração ativado!', 'Acesso Liberado');
            this.router.navigate(['/dashboard']);
          } else {
            this.toastr.error('Erro: Token não recebido.', 'Ops');
          }
        },
        error: (err) => {
          console.error(err);
          this.toastr.error('Não foi possível entrar.', 'Erro');
        }
      });
  }
}