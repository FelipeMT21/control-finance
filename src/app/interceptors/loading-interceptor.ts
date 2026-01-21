import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { LoadingService } from '@app/services/loading.service';
import { count } from 'console';
import { catchError, finalize, retry, throwError, timeout, timer } from 'rxjs';

export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  const loadingService = inject(LoadingService);

  loadingService.show();
  
  return next(req).pipe(
    timeout(4500),
    retry({
      count: 3,
      delay: (error, retryCount) => {
        console.warn(`Tentativa ${retryCount} de acordar o Render...`);
        return timer(2000);
      }
    }),
    finalize(() => {
      loadingService.hide();
    }),
    catchError((err) => {
      console.error('O Render não acordou a tempo ', err);
      return throwError(() => err);
    })
  );
};
