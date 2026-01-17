import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  // O RouterOutlet é essencial aqui para que o Angular saiba onde renderizar o Dashboard
  imports: [RouterOutlet],
  templateUrl: './app.component.html'
})
export class AppComponent {
    protected readonly title = signal('test-tailwind');
}