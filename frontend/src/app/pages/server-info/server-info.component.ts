import { Component, OnInit, OnDestroy } from '@angular/core';
import { Observable, of, forkJoin, Subscription } from 'rxjs';
import { tap, map, concatMap, timeout, catchError } from 'rxjs/operators';
import { Router, ActivatedRoute } from '@angular/router';
import {
  NamespaceService,
  ExponentialBackoff,
  ToolbarButton,
  Condition,
  ConfirmDialogService,
  DIALOG_RESP,
  SnackBarService,
  SnackType,
  SnackBarConfig,
  Status,
} from 'kubeflow';
import { MWABackendService } from 'src/app/services/backend.service';
import { SSEService } from 'src/app/services/sse.service';
import { ConfigService } from 'src/app/services/config.service';
import { isEqual } from 'lodash-es';
import { generateDeleteConfig } from '../index/config';
import { HttpClient } from '@angular/common/http';
import { InferenceServiceK8s } from 'src/app/types/kfserving/v1beta1';
import {
  InferenceServiceOwnedObjects,
  ComponentOwnedObjects,
} from 'src/app/types/backend';
import { getK8sObjectUiStatus } from 'src/app/shared/utils';

@Component({
  selector: 'app-server-info',
  templateUrl: './server-info.component.html',
  styleUrls: ['./server-info.component.scss'],
})
export class ServerInfoComponent implements OnInit, OnDestroy {
  public serverName!: string;
  public namespace!: string;
  public serverInfoLoaded = false;
  public inferenceService!: InferenceServiceK8s;
  public ownedObjects: InferenceServiceOwnedObjects = {};
  public grafanaFound = true;
  public isEditing = false;
  public editingIsvc!: InferenceServiceK8s;
  public resourceUpdatedWhileEditing = false;
  public sseEnabled = true; // Default to SSE, will be updated from config
  public sseFailed = false; // Track if SSE has failed to avoid retry loops

  public buttonsConfig: ToolbarButton[] = [
    new ToolbarButton({
      text: 'EDIT',
      icon: 'edit',
      fn: () => {
        this.editingIsvc = JSON.parse(JSON.stringify(this.inferenceService));
        this.isEditing = true;
      },
    }),
    new ToolbarButton({
      text: $localize`DELETE`,
      icon: 'delete',
      fn: () => {
        this.deleteInferenceService();
      },
    }),
  ];

  private sseSubscription = new Subscription();
  private initialLoadSubscription = new Subscription();
  private pollingSubscription = new Subscription();
  private poller = new ExponentialBackoff({
    interval: 4000,
    maxInterval: 4001,
    retries: 1,
  });

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router,
    private ns: NamespaceService,
    private backend: MWABackendService,
    private confirmDialog: ConfirmDialogService,
    private snack: SnackBarService,
    private configService: ConfigService,
    private sse: SSEService,
  ) {}

  ngOnInit() {
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

    this.route.params.subscribe(params => {
      this.ns.updateSelectedNamespace(params.namespace);

      this.serverName = params.name;
      this.namespace = params.namespace;

      this.initialLoadSubscription = this.getBackendObjects().subscribe();

      if (this.sseEnabled && !this.sseFailed) {
        this.startSSEWatch(params.namespace, params.name);
      } else {
        this.startPolling();
      }
    });

    this.configService.getConfig().subscribe(
      config => {
        this.checkGrafanaAvailability(config.grafanaPrefix);
      },
      error => {
        console.error('Failed to load configuration:', error);
        this.checkGrafanaAvailability('/grafana');
      },
    );
  }

  ngOnDestroy() {
    this.sseSubscription.unsubscribe();
    this.initialLoadSubscription.unsubscribe();
    this.pollingSubscription.unsubscribe();
  }

  get status(): Status {
    return getK8sObjectUiStatus(this.inferenceService);
  }

  public cancelEdit() {
    this.isEditing = false;
    this.resourceUpdatedWhileEditing = false;
  }

  public navigateBack() {
    this.router.navigate(['/']);
  }

  public deleteInferenceService() {
    const inferenceService = this.inferenceService;
    const dialogConfiguration = generateDeleteConfig(inferenceService);

    const dialogRef = this.confirmDialog.open(
      $localize`Endpoint`,
      dialogConfiguration,
    );
    const applyingSub = dialogRef.componentInstance.applying$.subscribe(
      (applying: boolean) => {
        if (!applying) {
          return;
        }

        this.backend.deleteInferenceService(inferenceService).subscribe(
          (dialogResponse: any) => {
            dialogRef.close(DIALOG_RESP.ACCEPT);
            this.sseSubscription.unsubscribe();

            const snackConfiguration: SnackBarConfig = {
              data: {
                msg: $localize`$Delete request was sent.`,
                snackType: SnackType.Info,
              },
            };
            this.snack.open(snackConfiguration);

            this.router.navigate(['']);
          },
          err => {
            dialogConfiguration.error = err;
            dialogRef.componentInstance.applying$.next(false);
          },
        );
      },
    );

    dialogRef.afterClosed().subscribe((dialogResponse: string) => {
      applyingSub.unsubscribe();

      if (dialogResponse !== DIALOG_RESP.ACCEPT) {
        return;
      }
    });
  }

  // Original polling method (fallback when SSE is disabled)
  private startPolling() {
    this.pollingSubscription.unsubscribe();
    this.sseSubscription.unsubscribe();

    this.pollingSubscription = this.poller.start().subscribe(() => {
      this.getBackendObjects().subscribe();
    });
  }

  private startSSEWatch(namespace: string, name: string) {
    this.sseSubscription.unsubscribe();
    this.pollingSubscription.unsubscribe();

    this.sseSubscription = this.sse
      .watchInferenceService<InferenceServiceK8s>(namespace, name)
      .subscribe({
        next: event => {
          switch (event.type) {
            case 'INITIAL':
              if (event.object) {
                this.updateInferenceService(event.object);
              }
              break;
            case 'MODIFIED':
              if (this.isEditing) {
                this.resourceUpdatedWhileEditing = true;
                const snackConfiguration: SnackBarConfig = {
                  data: {
                    msg: $localize`This resource has been updated. Your changes may conflict.`,
                    snackType: SnackType.Warning,
                  },
                };
                this.snack.open(snackConfiguration);
              } else if (event.object) {
                this.updateInferenceService(event.object);
              }
              break;
            case 'DELETED':
              const snackConfiguration: SnackBarConfig = {
                data: {
                  msg: $localize`InferenceService has been deleted`,
                  snackType: SnackType.Info,
                },
              };
              this.snack.open(snackConfiguration);
              this.router.navigate(['/']);
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
          this.startPolling();
        },
      });
  }

  private getBackendObjects(): Observable<any> {
    return this.backend
      .getInferenceService(this.namespace, this.serverName)
      .pipe(
        tap(inferenceService => {
          this.updateInferenceService(inferenceService);

          const components = ['predictor', 'transformer', 'explainer'];
          const obs: Observable<[string, ComponentOwnedObjects]>[] = [];

          components.forEach(component => {
            obs.push(this.getOwnedObjects(inferenceService, component));
          });

          forkJoin(obs).subscribe(objects => {
            const ownedObjects: InferenceServiceOwnedObjects = {};
            for (const obj of objects) {
              const component = obj[0] as keyof InferenceServiceOwnedObjects;
              ownedObjects[component] = obj[1];
            }

            this.ownedObjects = ownedObjects;
            this.serverInfoLoaded = true;
          });
        }),
      );
  }

  /**
   * The component will update only specific sections of its saved object
   * based on the data it got. It won't create a new object for every backend
   * request.
   */
  private updateInferenceService(inferenceService: InferenceServiceK8s) {
    if (!this.inferenceService) {
      this.inferenceService = inferenceService;
      return;
    }

    if (!isEqual(this.inferenceService.metadata, inferenceService.metadata)) {
      this.inferenceService.metadata = inferenceService.metadata;
    }

    if (!isEqual(this.inferenceService.spec, inferenceService.spec)) {
      this.inferenceService.spec = inferenceService.spec;
    }

    if (!isEqual(this.inferenceService.status, inferenceService.status)) {
      this.inferenceService.status = inferenceService.status;
    }
  }

  private getOwnedObjects(
    inferenceService: InferenceServiceK8s,
    component: string,
  ): Observable<any> {
    if (
      !inferenceService.status ||
      !inferenceService.status.components ||
      !(component in inferenceService.status.components)
    ) {
      return of([component, {}]);
    }

    // Check deployment mode
    const deploymentMode = this.getDeploymentMode(inferenceService);

    if (deploymentMode === 'ModelMesh') {
      return this.backend
        .getModelMeshObjects(
          this.namespace,
          inferenceService.metadata!.name!,
          component,
        )
        .pipe(
          map(objects => [component, objects]),
          catchError(error => {
            console.error(
              `Error fetching ModelMesh objects for ${component}:`,
              error,
            );
            return of([component, {}]);
          }),
        );
    } else if (deploymentMode === 'Standard') {
      return this.backend
        .getStandardDeploymentObjects(
          this.namespace,
          inferenceService.metadata!.name!,
          component,
        )
        .pipe(
          map(objects => [component, objects]),
          catchError(error => {
            console.error(
              `Error fetching Standard objects for ${component}:`,
              error,
            );
            return of([component, {}]);
          }),
        );
    } else {
      const componentStatus = (inferenceService.status.components as any)[
        component
      ];
      const revName = componentStatus?.latestCreatedRevision;
      const objects: Partial<ComponentOwnedObjects> = {};

      return this.backend.getKnativeRevision(this.namespace, revName).pipe(
        tap(r => (objects.revision = r)),
        map(r => r.metadata?.ownerReferences?.[0]?.name!),
        concatMap(confName =>
          this.backend.getKnativeConfiguration(this.namespace, confName),
        ),
        tap(c => (objects.configuration = c)),
        map(c => c.metadata?.ownerReferences?.[0]?.name!),
        concatMap(svcName =>
          this.backend.getKnativeService(this.namespace, svcName),
        ),
        tap(svc => (objects.knativeService = svc)),
        map(svc => svc.metadata?.name!),
        concatMap(routeName =>
          this.backend.getKnativeRoute(this.namespace, routeName),
        ),
        tap(route => (objects.route = route)),
        map(() => [component, objects as ComponentOwnedObjects]),
      );
    }
  }

  private checkGrafanaAvailability(grafanaPrefix: string): void {
    const grafanaApi = grafanaPrefix + '/api/search';

    this.http
      .get(grafanaApi)
      .pipe(timeout(1000))
      .subscribe({
        next: resp => {
          if (!Array.isArray(resp)) {
            this.grafanaFound = false;
            return;
          }

          this.grafanaFound = true;
        },
        error: () => {
          this.grafanaFound = false;
        },
      });
  }

  private isStandardDeployment(inferenceService: InferenceServiceK8s): boolean {
    const annotations = inferenceService.metadata?.annotations || {};

    // Check for the KServe annotation
    const deploymentMode =
      annotations['serving.kserve.io/deploymentMode'] || '';
    // allowing rawdeployment for backward compatibility
    if (
      deploymentMode.toLowerCase() === 'rawdeployment' ||
      deploymentMode.toLowerCase() === 'standard'
    ) {
      return true;
    }

    // Check for legacy annotation
    const rawMode = annotations['serving.kubeflow.org/raw'] || 'false';
    if (rawMode.toLowerCase() === 'true') {
      return true;
    }

    return false;
  }

  private isModelMeshDeployment(
    inferenceService: InferenceServiceK8s,
  ): boolean {
    const annotations = inferenceService.metadata?.annotations || {};
    const deploymentMode =
      annotations['serving.kserve.io/deploymentMode'] || '';
    return deploymentMode.toLowerCase() === 'modelmesh';
  }

  private getDeploymentMode(inferenceService: InferenceServiceK8s): string {
    if (this.isModelMeshDeployment(inferenceService)) {
      return 'ModelMesh';
    } else if (this.isStandardDeployment(inferenceService)) {
      return 'Standard';
    } else {
      return 'Serverless';
    }
  }
}
