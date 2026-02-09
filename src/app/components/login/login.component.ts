import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

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

  private authService = inject(AuthService);
  private router = inject(Router);

  onSubmit() {
    if (this.username && this.password) {
      this.authService.login(this.username, this.password).subscribe({
        next: (res) => {
          console.log('Login realizado com sucesso! Token gerado.');
          this.router.navigate(['/dashboard']); 
        },
        error: (err) => {
          console.error('Erro ao logar:', err);
          alert('Usuário ou senha incorretos. Tente novamente!');
        }
      });
    } else {
      alert('Por favor, preencha todos os campos.');
    }
  }
}