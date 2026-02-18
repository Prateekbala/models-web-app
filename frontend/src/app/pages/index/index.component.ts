import { Component, OnInit, OnDestroy } from '@angular/core';
import { MWABackendService } from 'src/app/services/backend.service';
import { MWANamespaceService } from 'src/app/services/mwa-namespace.service';
import { SSEService } from 'src/app/services/sse.service';
import { ConfigService } from 'src/app/services/config.service';
import { Clipboard } from '@angular/cdk/clipboard';
import {
  InferenceServiceK8s,
  InferenceServiceIR,
} from 'src/app/types/kfserving/v1beta1';
import { environment } from 'src/environments/environment';
import {
  NamespaceService,
  STATUS_TYPE,
  ActionEvent,
  ConfirmDialogService,
  DIALOG_RESP,
  SnackBarService,
  SnackType,
  DashboardState,
  ToolbarButton,
  SnackBarConfig,
  PollerService,
} from 'kubeflow';
import { Subscription } from 'rxjs';
import { defaultConfig, generateDeleteConfig } from './config';
import { Router } from '@angular/router';
import {
  getPredictorType,
  getK8sObjectUiStatus,
  getPredictorExtensionSpec,
} from 'src/app/shared/utils';

@Component({
  selector: 'app-index',
  templateUrl: './index.component.html',
})
export class IndexComponent implements OnInit, OnDestroy {
  env = environment;

  namespaceSubscription = new Subscription();
  sseSubscription = new Subscription();
  pollingSubscription = new Subscription();

  currentNamespace: string | string[] = '';
  config = defaultConfig;
  inferenceServices: InferenceServiceIR[] = [];
  sseEnabled = true; // Default to SSE, will be updated from config
  sseFailed = false; // Track if SSE has failed to avoid retry loops

  dashboardDisconnectedState = DashboardState.Disconnected;

  private newEndpointButton = new ToolbarButton({
    text: $localize`New Endpoint`,
    icon: 'add',
    stroked: true,
    fn: () => {
      this.router.navigate(['/new']);
    },
  });

  private viewGraphsButton = new ToolbarButton({
    text: $localize`View Graphs`,
    icon: 'account_tree',
    stroked: true,
    fn: () => {
      this.router.navigate(['/inference-graphs']);
    },
  });

  buttons: ToolbarButton[] = [this.viewGraphsButton, this.newEndpointButton];

  constructor(
    private backend: MWABackendService,
    private confirmDialog: ConfirmDialogService,
    private snack: SnackBarService,
    private router: Router,
    private clipboard: Clipboard,
    public ns: NamespaceService,
    public mwaNamespace: MWANamespaceService,
    private sse: SSEService,
    public poller: PollerService,
    private configService: ConfigService,
  ) {}

  ngOnInit(): void {
    // Check if SSE is enabled from backend config
    this.configService.getConfig().subscribe(
      config => {
        this.sseEnabled = config?.sseEnabled !== false; // Default to true if not specified
      },
      error => {
        console.warn('Failed to load config, defaulting to SSE:', error);
        this.sseEnabled = true;
      },
    );

    this.namespaceSubscription = this.mwaNamespace
      .getSelectedNamespace()
      .subscribe(ns => {
        if (!ns) {
          return;
        }

        this.currentNamespace = ns;
        if (this.sseEnabled && !this.sseFailed) {
          this.startSSEWatch(ns);
        } else {
          this.poll(ns);
        }
        this.newEndpointButton.namespaceChanged(ns, $localize`Endpoint`);
      });

    this.mwaNamespace.initialize().subscribe();
  }

  ngOnDestroy() {
    this.namespaceSubscription.unsubscribe();
    this.sseSubscription.unsubscribe();
    this.pollingSubscription.unsubscribe();
  }

  // Original polling method (fallback when SSE is disabled)
  public poll(ns: string | string[]) {
    this.pollingSubscription.unsubscribe();
    this.sseSubscription.unsubscribe();
    this.inferenceServices = [];

    const request = this.backend.getInferenceServices(ns);

    this.pollingSubscription = this.poller
      .exponential(request as any)
      .subscribe((svcs: any) => {
        this.inferenceServices = this.processIncomingData(svcs);
      }) as any;
  }

  public startSSEWatch(ns: string | string[]) {
    this.pollingSubscription.unsubscribe();
    this.sseSubscription.unsubscribe();
    this.inferenceServices = [];

    if (typeof ns === 'string') {
      this.sseSubscription = this.sse
        .watchInferenceServices<InferenceServiceK8s>(ns)
        .subscribe({
          next: event => {
            switch (event.type) {
              case 'INITIAL':
                if (event.items) {
                  this.inferenceServices = this.processIncomingData(
                    event.items,
                  );
                }
                break;
              case 'ADDED':
                if (event.object) {
                  this.addInferenceService(event.object);
                }
                break;
              case 'MODIFIED':
                if (event.object) {
                  this.updateInferenceService(event.object);
                }
                break;
              case 'DELETED':
                if (event.object) {
                  this.removeInferenceService(event.object);
                }
                break;
              case 'ERROR':
                console.error('SSE error:', event.message);
                break;
            }
          },
          error: error => {
            console.error(
              'SSE connection failed, falling back to polling:',
              error,
            );
            this.sseFailed = true;

            const snackConfiguration: SnackBarConfig = {
              data: {
                msg: $localize`Real-time updates unavailable, using polling mode`,
                snackType: SnackType.Warning,
              },
            };
            this.snack.open(snackConfiguration);

            // Automatically fall back to polling
            this.poll(ns);
          },
        });
    } else {
      console.log('Multi-namespace view not supported by SSE, using polling');
      this.poll(ns);
    }
  }

  private addInferenceService(svc: InferenceServiceK8s) {
    const svcCopy: InferenceServiceIR = JSON.parse(JSON.stringify(svc));
    this.parseInferenceService(svcCopy);
    this.inferenceServices = [...this.inferenceServices, svcCopy];
  }

  private updateInferenceService(svc: InferenceServiceK8s) {
    const index = this.inferenceServices.findIndex(
      s =>
        s.metadata?.name === svc.metadata?.name &&
        s.metadata?.namespace === svc.metadata?.namespace,
    );

    if (index !== -1) {
      const svcCopy: InferenceServiceIR = JSON.parse(JSON.stringify(svc));
      this.parseInferenceService(svcCopy);
      this.inferenceServices = [
        ...this.inferenceServices.slice(0, index),
        svcCopy,
        ...this.inferenceServices.slice(index + 1),
      ];
    }
  }

  private removeInferenceService(svc: InferenceServiceK8s) {
    this.inferenceServices = this.inferenceServices.filter(
      s =>
        !(
          s.metadata?.name === svc.metadata?.name &&
          s.metadata?.namespace === svc.metadata?.namespace
        ),
    );
  }

  // action handling functions
  public reactToAction(a: ActionEvent) {
    const inferenceService = a.data as InferenceServiceIR;

    switch (a.action) {
      case 'delete':
        this.deleteClicked(inferenceService);
        break;
      case 'copy-link':
        if (inferenceService.status?.url) {
          this.clipboard.copy(inferenceService.status.url);
          const snackConfiguration: SnackBarConfig = {
            data: {
              msg: `Copied: ${inferenceService.status.url}`,
              snackType: SnackType.Info,
            },
          };
          this.snack.open(snackConfiguration);
        }
        break;
      case 'name:link':
        /*
         * don't allow the user to navigate to the details page of a server
         * that is being deleted
         */
        if (inferenceService.ui.status.phase === STATUS_TYPE.TERMINATING) {
          a.event.stopPropagation();
          a.event.preventDefault();
          const snackConfiguration: SnackBarConfig = {
            data: {
              msg: $localize`Endpoint is being deleted, cannot show details.`,
              snackType: SnackType.Info,
            },
          };
          this.snack.open(snackConfiguration);
          return;
        }
        break;
    }
  }

  private deleteClicked(inferenceService: InferenceServiceIR) {
    const dialogConfiguration = generateDeleteConfig(inferenceService);

    const dialogRef = this.confirmDialog.open('Endpoint', dialogConfiguration);
    const applyingSub = dialogRef.componentInstance.applying$.subscribe(
      (applying: boolean) => {
        if (!applying) {
          return;
        }

        this.backend.deleteInferenceService(inferenceService).subscribe(
          (dialogResponse: any) => {
            dialogRef.close(DIALOG_RESP.ACCEPT);
          },
          err => {
            dialogConfiguration.error = err;
            dialogRef.componentInstance.applying$.next(false);
          },
        );
      },
    );

    dialogRef.afterClosed().subscribe((dialogResponse: any) => {
      applyingSub.unsubscribe();

      if (dialogResponse !== DIALOG_RESP.ACCEPT) {
        return;
      }

      inferenceService.ui.status.phase = STATUS_TYPE.TERMINATING;
      inferenceService.ui.status.message = $localize`Preparing to delete Endpoint...`;
    });
  }

  // functions for converting the response InferenceServices to the
  // Internal Representation objects
  private processIncomingData(svcs: InferenceServiceK8s[]) {
    const svcsCopy: InferenceServiceIR[] = JSON.parse(JSON.stringify(svcs));

    for (const inferenceService of svcsCopy) {
      this.parseInferenceService(inferenceService);
    }

    return svcsCopy;
  }

  private parseInferenceService(inferenceService: InferenceServiceIR) {
    inferenceService.ui = { actions: {} };
    inferenceService.ui.status = getK8sObjectUiStatus(inferenceService);
    inferenceService.ui.actions.copy =
      this.getCopyActionStatus(inferenceService);
    inferenceService.ui.actions.delete =
      this.getDeletionActionStatus(inferenceService);

    if (inferenceService.spec) {
      const predictorType = getPredictorType(inferenceService.spec.predictor);
      const predictor = getPredictorExtensionSpec(
        inferenceService.spec.predictor,
      );
      inferenceService.ui.predictorType = predictorType;
      inferenceService.ui.runtimeVersion = predictor.runtimeVersion;
      inferenceService.ui.storageUri = predictor.storageUri;
      inferenceService.ui.protocolVersion = predictor.protocolVersion || 'v1';
    }
    inferenceService.ui.link = {
      text: inferenceService.metadata?.name || '',
      url: `/details/${inferenceService.metadata?.namespace}/${inferenceService.metadata?.name}`,
    };
  }

  private getCopyActionStatus(inferenceService: InferenceServiceIR) {
    if (inferenceService.ui.status.phase !== STATUS_TYPE.READY) {
      return STATUS_TYPE.UNAVAILABLE;
    }

    return STATUS_TYPE.READY;
  }

  private getDeletionActionStatus(inferenceService: InferenceServiceIR) {
    if (inferenceService.ui.status.phase !== STATUS_TYPE.TERMINATING) {
      return STATUS_TYPE.READY;
    }

    return STATUS_TYPE.TERMINATING;
  }

  // util functions
  public inferenceServiceTrackByFn(
    index: number,
    inferenceService: InferenceServiceK8s,
  ) {
    return `${inferenceService.metadata?.name}/${inferenceService.metadata?.creationTimestamp}`;
  }
}
