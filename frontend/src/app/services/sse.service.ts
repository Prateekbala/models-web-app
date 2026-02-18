import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface WatchEvent<T> {
  type: 'INITIAL' | 'ADDED' | 'MODIFIED' | 'DELETED' | 'ERROR' | 'UPDATE';
  object?: T;
  items?: T[];
  logs?: any;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class SSEService {
  private eventSources = new Map<string, EventSource>();

  watchInferenceServices<T>(namespace: string): Observable<WatchEvent<T>> {
    const url = `/api/sse/namespaces/${namespace}/inferenceservices`;
    return this.createStream<T>(url);
  }

  watchInferenceService<T>(
    namespace: string,
    name: string,
  ): Observable<WatchEvent<T>> {
    const url = `/api/sse/namespaces/${namespace}/inferenceservices/${name}`;
    return this.createStream<T>(url);
  }

  watchEvents<T>(namespace: string, name: string): Observable<WatchEvent<T>> {
    const url = `/api/sse/namespaces/${namespace}/inferenceservices/${name}/events`;
    return this.createStream<T>(url);
  }

  watchLogs(
    namespace: string,
    name: string,
    components?: string[],
  ): Observable<WatchEvent<any>> {
    let url = `/api/sse/namespaces/${namespace}/inferenceservices/${name}/logs`;
    if (components && components.length > 0) {
      const params = components
        .map(c => `component=${encodeURIComponent(c)}`)
        .join('&');
      url += `?${params}`;
    }
    return this.createLogsStream(url);
  }

  disconnect(url: string): void {
    const eventSource = this.eventSources.get(url);
    if (eventSource) {
      eventSource.close();
      this.eventSources.delete(url);
    }
  }

  disconnectAll(): void {
    this.eventSources.forEach(es => es.close());
    this.eventSources.clear();
  }

  private createStream<T>(url: string): Observable<WatchEvent<T>> {
    return new Observable(observer => {
      const eventSource = new EventSource(url);
      this.eventSources.set(url, eventSource);

      const eventTypes = ['initial', 'added', 'modified', 'deleted', 'error'];

      eventTypes.forEach(eventType => {
        eventSource.addEventListener(eventType, (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            observer.next({
              type: data.type || eventType.toUpperCase(),
              object: data.object,
              items: data.items,
              message: data.message,
            } as WatchEvent<T>);
          } catch (error) {
            console.error('Error parsing SSE event:', error);
          }
        });
      });

      eventSource.onerror = error => {
        console.error('SSE Error:', error);
        if (eventSource.readyState === EventSource.CLOSED) {
          observer.error(error);
        }
      };

      return () => {
        eventSource.close();
        this.eventSources.delete(url);
      };
    });
  }

  private createLogsStream(url: string): Observable<WatchEvent<any>> {
    return new Observable(observer => {
      const eventSource = new EventSource(url);
      this.eventSources.set(url, eventSource);

      // Logs use 'update' event type
      eventSource.addEventListener('update', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          observer.next({
            type: 'UPDATE',
            logs: data.logs,
          } as WatchEvent<any>);
        } catch (error) {
          console.error('Error parsing logs SSE event:', error);
        }
      });

      eventSource.addEventListener('error', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          observer.next({
            type: 'ERROR',
            message: data.message,
          } as WatchEvent<any>);
        } catch (error) {
          console.error('Error parsing error event:', error);
        }
      });

      eventSource.onerror = error => {
        console.error('SSE Error:', error);
        if (eventSource.readyState === EventSource.CLOSED) {
          observer.error(error);
        }
      };

      return () => {
        eventSource.close();
        this.eventSources.delete(url);
      };
    });
  }
}
