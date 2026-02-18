import { Component, Input, OnDestroy } from '@angular/core';
import { MWABackendService } from 'src/app/services/backend.service';
import { SSEService } from 'src/app/services/sse.service';
import { ConfigService } from 'src/app/services/config.service';
import { ExponentialBackoff } from 'kubeflow';
import { Subscription } from 'rxjs';
import { InferenceServiceLogs } from 'src/app/types/backend';
import { InferenceServiceK8s } from 'src/app/types/kfserving/v1beta1';
import { dictIsEmpty } from 'src/app/shared/utils';

@Component({
  selector: 'app-logs',
  templateUrl: './logs.component.html',
  styleUrls: ['./logs.component.scss'],
})
export class LogsComponent implements OnDestroy {
  public goToBottom = true;
  public currentLogs: InferenceServiceLogs = {};
  public logsRequestCompleted = false;
  public loadErrorMsg = '';
  private sseEnabled = true; // Default to SSE
  private sseFailed = false; // Track if SSE has failed

  @Input()
  set inferenceService(s: InferenceServiceK8s) {
    this.inferenceServicePrivate = s;

    if (!s) {
      return;
    }

    if (this.sseSubscription) {
      this.sseSubscription.unsubscribe();
    }
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
    }

    // Check SSE config and decide which method to use
    this.configService.getConfig().subscribe(
      config => {
        this.sseEnabled = config?.sseEnabled !== false;
        if (this.sseEnabled && !this.sseFailed) {
          this.startSSEWatch(s);
        } else {
          this.startPolling(s);
        }
      },
      error => {
        console.warn('Failed to load config, defaulting to SSE:', error);
        this.sseEnabled = true;
        this.startSSEWatch(s);
      },
    );
  }

  get logsNotEmpty(): boolean {
    return !dictIsEmpty(this.currentLogs);
  }

  private inferenceServicePrivate: InferenceServiceK8s | null = null;
  private components: [string, string][] = [];
  private sseSubscription: Subscription | null = null;
  private pollingSubscription: Subscription | null = null;
  private poller = new ExponentialBackoff({
    interval: 3000,
    retries: 1,
    maxInterval: 3001,
  });

  constructor(
    public backend: MWABackendService,
    private sse: SSEService,
    private configService: ConfigService,
  ) {}

  ngOnDestroy() {
    if (this.sseSubscription) {
      this.sseSubscription.unsubscribe();
    }
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
    }
  }

  // Original polling method (fallback when SSE is disabled)
  private startPolling(svc: InferenceServiceK8s): void {
    this.pollingSubscription = this.poller.start().subscribe(() => {
      this.backend.getInferenceServiceLogs(svc).subscribe(
        logs => {
          this.currentLogs = logs;
          this.logsRequestCompleted = true;
          this.loadErrorMsg = '';
        },
        error => {
          this.logsRequestCompleted = true;
          this.loadErrorMsg = error;
        },
      );
    });
  }

  private startSSEWatch(svc: InferenceServiceK8s): void {
    const namespace = svc.metadata?.namespace;
    const name = svc.metadata?.name;

    if (!namespace || !name) {
      console.error('InferenceService missing required metadata');
      return;
    }

    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
    }

    this.sseSubscription = this.sse.watchLogs(namespace, name).subscribe({
      next: event => {
        if (event.type === 'UPDATE' && event.logs) {
          this.currentLogs = event.logs;
          this.logsRequestCompleted = true;
          this.loadErrorMsg = '';
        } else if (event.type === 'ERROR') {
          this.logsRequestCompleted = true;
          this.loadErrorMsg = event.message || 'Error loading logs';
        }
      },
      error: err => {
        console.error('SSE logs stream error, falling back to polling:', err);
        this.sseFailed = true;

        // Automatically fall back to polling
        this.startPolling(svc);
      },
    });
  }

  logsTrackFn(i: number, podLogs: any) {
    return podLogs.podName;
  }
}
