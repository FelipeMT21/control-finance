import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LoadingService } from './services/loading.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  // O RouterOutlet é essencial aqui para que o Angular saiba onde renderizar o Dashboard
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.component.html'
})
export class AppComponent {
    constructor(public loadingService: LoadingService) {}
}