import { Component, inject, signal } from '@angular/core';
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
export class LoginComponent {
  username = '';
  password = '';

  isLoadingGuest = signal(false); 

  private authService = inject(AuthService);
  private router = inject(Router);
  private toastr = inject(ToastrService);

  onSubmit() {
    if (this.username && this.password) {
      this.authService.login(this.username, this.password).subscribe({
        next: (res) => {
          // Troquei o console.log por um toastr bonito
          this.toastr.success('Login realizado com sucesso!', 'Bem-vindo');
          this.router.navigate(['/dashboard']);
        },
        error: (err) => {
          console.error('Erro ao logar:', err);
          // Troquei o alert feio por um toastr de erro
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
          this.isLoadingGuest.set(false); // Garante que o spinner para
        })
      )
      .subscribe({
        next: (res: any) => {
          // Pega o token da resposta (pode vir como 'token' ou 'accessToken')
          const token = res.token || res.accessToken;

          if (token) {
            // 👇 AQUI ESTAVA O ERRO! Mude para 'vault_token'
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