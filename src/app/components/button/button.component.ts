import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-button',
  imports: [],
  templateUrl: './button.component.html',
  styleUrl: './button.component.css',
})
export class ButtonComponent {
  isActive = input<boolean>(false);
  customColor = input<string>('');
  clicked = output<void>();

  onClick() {
    this.clicked.emit();
  }

}
