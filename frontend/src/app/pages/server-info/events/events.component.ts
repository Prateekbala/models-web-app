import { Component, Input, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { PollerService } from 'kubeflow';
import { MWABackendService } from 'src/app/services/backend.service';
import { SSEService } from 'src/app/services/sse.service';
import { ConfigService } from 'src/app/services/config.service';
import { defaultConfig } from './config';
import { InferenceServiceK8s } from 'src/app/types/kfserving/v1beta1';
import { EventObject } from '../../../types/event';

@Component({
  selector: 'app-events',
  templateUrl: './events.component.html',
  styleUrls: ['./events.component.scss'],
})
export class EventsComponent implements OnDestroy {
  public events: EventObject[] = [];
  public config = defaultConfig;
  private sseSubscription = new Subscription();
  private pollingSubscription = new Subscription();
  private inferenceServicePrivate!: InferenceServiceK8s;
  private sseEnabled = true; // Default to SSE
  private sseFailed = false; // Track if SSE has failed

  @Input()
  set inferenceService(s: InferenceServiceK8s) {
    this.inferenceServicePrivate = s;

    // Check SSE config and decide which method to use
    this.configService.getConfig().subscribe(
      config => {
        this.sseEnabled = config?.sseEnabled !== false;
        if (this.sseEnabled && !this.sseFailed) {
          this.startSSEWatch(s);
        } else {
          this.poll(s);
        }
      },
      error => {
        console.warn('Failed to load config, defaulting to SSE:', error);
        this.sseEnabled = true;
        this.startSSEWatch(s);
      },
    );
  }
  get inferenceService(): InferenceServiceK8s {
    return this.inferenceServicePrivate;
  }

  constructor(
    public backend: MWABackendService,
    private sse: SSEService,
    public poller: PollerService,
    private configService: ConfigService,
  ) {}

  ngOnDestroy(): void {
    if (this.sseSubscription) {
      this.sseSubscription.unsubscribe();
    }
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
    }
  }

  // Original polling method (fallback when SSE is disabled)
  private poll(inferenceService: InferenceServiceK8s) {
    this.pollingSubscription.unsubscribe();
    this.sseSubscription.unsubscribe();

    const request = this.backend.getInferenceServiceEvents(inferenceService);

    this.pollingSubscription = this.poller
      .exponential(request)
      .subscribe(events => {
        this.events = events;
      });
  }

  private startSSEWatch(inferenceService: InferenceServiceK8s) {
    if (
      !inferenceService?.metadata?.namespace ||
      !inferenceService?.metadata?.name
    ) {
      return;
    }

    this.sseSubscription.unsubscribe();
    this.pollingSubscription.unsubscribe();

    const namespace = inferenceService.metadata.namespace;
    const name = inferenceService.metadata.name;

    this.sseSubscription = this.sse
      .watchEvents<EventObject>(namespace, name)
      .subscribe({
        next: event => {
          switch (event.type) {
            case 'INITIAL':
              if (event.items) {
                this.events = event.items;
              }
              break;
            case 'ADDED':
              if (event.object) {
                this.addEvent(event.object);
              }
              break;
            case 'MODIFIED':
              if (event.object) {
                this.updateEvent(event.object);
              }
              break;
            case 'DELETED':
              if (event.object) {
                this.removeEvent(event.object);
              }
              break;
            case 'ERROR':
              console.error('SSE error:', event.message);
              break;
          }
        },
        error: error => {
          console.error(
            'SSE connection failed for events, falling back to polling:',
            error,
          );
          this.sseFailed = true;

          // Automatically fall back to polling
          this.poll(inferenceService);
        },
      });
  }

  private addEvent(event: EventObject) {
    this.events = [event, ...this.events];
  }

  private updateEvent(event: EventObject) {
    const index = this.events.findIndex(
      e => e.metadata?.uid === event.metadata?.uid,
    );

    if (index !== -1) {
      this.events = [
        ...this.events.slice(0, index),
        event,
        ...this.events.slice(index + 1),
      ];
    }
  }

  private removeEvent(event: EventObject) {
    this.events = this.events.filter(
      e => e.metadata?.uid !== event.metadata?.uid,
    );
  }
}
