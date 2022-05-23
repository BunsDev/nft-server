import cluster, { Worker } from "cluster";
import { cpus } from "os";
import { randomUUID as uuid } from "crypto";
import { getLogger, TLogger } from "./logger";
import { IMarketOnChainProvider } from "../interfaces";
import { throws } from "assert";
import { workerData } from "worker_threads";

enum WorkerState {
  INITIALIZING = "initializing",
  BUSY = "busy",
  FREE = "free",
  ERROR = "error",
}

enum WorkerMessageMethod {
  UPDATE_STATE = "UPDATE_STATE",
  PONG = "PONG",
}

enum WorkState {
  SUBMITTED = "submitted",
  QUEUED = "queued",
  PROEGRESSING = "progressing",
  REJECTED = "rejected",
  DONE = "done",
}

enum ClusterMemberEvents {
  DISCONNECT = "disconnect",
  ERROR = "error",
  EXIT = "exit",
  MESSAGE = "message",
  ONLINE = "online",
}

enum WorkerEvents {
  MESSAGE = "message",
  EXIT = "exit",
  ERROR = "error",
}

type DeferredWork = {
  resolve(result: unknown): void;
  reject(reason: unknown): void;
  promise: Promise<unknown>;
};

type ClusterMember = {
  __state: WorkerState;
  uuid: string;
  worker: Worker;
};

type WorkerWork = {
  __state: WorkState;
  worker?: string;
  uuid: string;
  method?: string;
  data?: unknown;
  deferred?: DeferredWork;
  result?: unknown;
};

type WorkerMessage = {
  __state?: WorkerState;
  uuid?: string;
  work?: WorkerWork;
  method: WorkerMessageMethod;
};

interface IClusterManager {
  workers: Map<string, ClusterMember>;
  start(): void;
  get maxWorkerCount(): number;
}

interface IClusterWorker {
  uuid: string;
  adapterName: string;
}

export interface IClusterProvider {
  withCluster(kluster: IClusterManager): void;
  withWorker(worker: IClusterWorker): void;
  dispatchWorkMethod(method: string, ...args: Array<unknown>): Promise<unknown>;
}

type Callback = () => unknown;

const MAX_FORK_LEN = cpus().length - 1;
const __clusters: Record<string, IClusterManager> = {};

export class ClusterManager implements IClusterManager {
  private _currentWorker = -1;
  private _workerEnv: Record<string, unknown> = {};
  private LOGGER: TLogger;
  public workers: Map<string, ClusterMember> = new Map();
  private work: Map<string, Array<WorkerWork>> = new Map();

  static create(
    adapterName: string,
    provider: IClusterProvider
  ): ClusterManager {
    const instance = new ClusterManager(adapterName, provider);
    return instance;
  }

  constructor(public adapterName: string, public provider: IClusterProvider) {
    if (
      __clusters[adapterName] &&
      __clusters[adapterName] instanceof ClusterManager
    ) {
      return __clusters[adapterName] as ClusterManager;
    }
    __clusters[adapterName] = this;
    this.init();
  }

  private init() {
    this.LOGGER = getLogger(`CLUSTER_MANAGER_${this.adapterName}`, {
      datadog: !!process.env.DATADOG_API_KEY,
    });

    this.provider.withCluster(this);
  }

  get maxWorkerCount(): number {
    return MAX_FORK_LEN;
  }

  get currentWorkerCount(): number {
    return this.workers.size;
  }

  get workerUuids(): Array<string> {
    return Array.from(this.workers.keys());
  }

  get currentWorker(): ClusterMember {
    return Array.from(this.workers.values())[
      this._currentWorker > this.currentWorkerCount - 1
        ? 0
        : this._currentWorker
    ];
  }

  get nextWorker(): ClusterMember {
    this._currentWorker =
      this._currentWorker + 1 > MAX_FORK_LEN - 1 ? 0 : this._currentWorker + 1;
    return this.currentWorker;
  }

  get availableWorkerCount(): number {
    let count = 0;
    for (const w of this.workers.values()) {
      if ([WorkerState.FREE, WorkerState.BUSY].indexOf(w.__state) > -1) {
        count++;
      }
    }
    return count;
  }

  public start(workerEnv?: Record<string, unknown>) {
    this._workerEnv = workerEnv;
    for (let i = 0; i < MAX_FORK_LEN; i++) {
      this.spawnWorker(uuid(), workerEnv);
    }
    return this;
  }

  public sendPing(): void {
    for (const member of this.workers.values()) {
      member.worker.send({ method: "PING" });
    }
  }

  public parallelizeMethod(
    method: string,
    indexedData: Array<unknown>,
    ...otherArgs: Array<unknown>
  ): Promise<unknown> {
    const parallelism = this.availableWorkerCount;
    if (parallelism < 1) {
      throw new Error("No available workers");
    }

    const remainder = indexedData.length % parallelism;
    const groupSize = (indexedData.length - remainder) / parallelism;
    const results: Array<Promise<unknown>> = [];
    for (let i = 0; i < parallelism; i++) {
      const deferred = getDeferred();
      results.push(deferred.promise);
      this.LOGGER.info(`Parallelize method group`, { groupSize, i, method });
      this.submitWork(method, deferred, [
        indexedData.slice(i * groupSize, i * groupSize + groupSize),
        ...otherArgs,
      ]);
    }
    return Promise.all(results);
  }

  public submitWork(
    method: string,
    deferred: DeferredWork,
    data: unknown
  ): Array<string> {
    const clusterWorker = this.nextWorker;
    if (
      [WorkerState.BUSY, WorkerState.FREE].indexOf(clusterWorker.__state) < 0
    ) {
      return this.submitWork(method, deferred, data);
    }

    const worker = clusterWorker.worker;
    const workerUuid = this.workerUuids[this._currentWorker];
    const currentWork: Array<WorkerWork> = this.work.get(workerUuid) || [];
    const workUuid = uuid();
    const newWork = {
      __state: WorkState.SUBMITTED,
      worker: workerUuid,
      uuid: workUuid,
      method,
      data,
      deferred,
    };
    this.work.set(workerUuid, [...currentWork, newWork]);
    this.LOGGER.info(`Sending work: ${workerUuid}`, { ...newWork, data: null });
    worker.send({ uuid: workUuid, method, data });
    return [workerUuid, workUuid];
  }

  private respawnWorker(workerUuid: string) {
    this.LOGGER.info(`Respawn worker`, { uuid: workerUuid });
    const worker = this.workers.get(workerUuid).worker;
    const allWork = this.work.get(workerUuid);
    if (worker && worker.isConnected()) {
      worker.disconnect();
    }
    this.workers.delete(workerUuid);
    this.spawnWorker(uuid(), this._workerEnv);
    this.reassignWork(allWork);
    this.work.delete(workerUuid);
  }

  private reassignWork(allWork: Array<WorkerWork>) {
    for (const work of allWork) {
      this.submitWork(work.method, work.deferred, work.data);
    }
  }

  private spawnWorker(
    workerUuid: string,
    workerEnv?: Record<string, unknown>
  ): Worker {
    if (this.currentWorkerCount >= MAX_FORK_LEN) {
      return null;
    }

    this.LOGGER.info(`Spawn Worker`, { uuid: workerUuid });
    const worker: Worker = cluster.fork({
      WORKER_UUID: workerUuid,
      DATADOG_API_KEY: process.env.DATADOG_API_KEY,
      ...(workerEnv || {}),
    });
    this.workers.set(workerUuid, {
      __state: WorkerState.INITIALIZING,
      worker,
      uuid: workerUuid,
    });
    this.setupWorker(workerUuid, worker);

    return worker;
  }

  private updateWorkerState(workerUuid: string, newState: WorkerState): void {
    const worker = this.workers.get(workerUuid);
    this.workers.set(workerUuid, {
      ...worker,
      __state: newState,
    });
  }

  private updateWorkState(
    workerUuid: string,
    workUuid: string,
    newState: WorkState
  ): void {
    const work = this.getWork(workerUuid, workUuid);
    if (work) {
      work.__state = newState;
    }
  }

  private setupWorker(workerUuid: string, worker: Worker): void {
    for (const event of Object.values(ClusterMemberEvents)) {
      worker.on(event, (...args: unknown[]) =>
        this.handleWorkerEvent(event, workerUuid, ...args)
      );
    }
  }

  private getWorkDeferred(workerUuid: string, workUuid: string): DeferredWork {
    const work = this.getWork(workerUuid, workUuid);
    return work && work.deferred;
  }

  private getWork(workerUuid: string, workUuid: string): WorkerWork {
    const allWork = this.work.get(workerUuid);
    for (const work of allWork) {
      if (work.uuid === workUuid) {
        return work;
      }
    }
    return null;
  }

  private handleWorkerEvent(
    event: ClusterMemberEvents,
    workerUuid: string,
    ...args: unknown[]
  ): void {
    this.LOGGER.info(`Worker Event: ${event}`, {
      event,
      uuid: workerUuid,
      args,
    });
    switch (event) {
      case ClusterMemberEvents.ERROR: {
        const [error] = args;
        this.updateWorkerState(workerUuid, WorkerState.ERROR);
        break;
      }
      case ClusterMemberEvents.DISCONNECT:
      case ClusterMemberEvents.EXIT: {
        const [code, signal] = args;
        this.updateWorkerState(workerUuid, WorkerState.ERROR);
        this.respawnWorker(workerUuid);
        break;
      }
      case ClusterMemberEvents.MESSAGE: {
        const [message, handle] = args;
        this.handleWorkerMessage(message as WorkerMessage, workerUuid);
        break;
      }
      case ClusterMemberEvents.ONLINE: {
        this.LOGGER.info(`Worker ONLINE`, { uuid: workerUuid });
        this.updateWorkerState(workerUuid, WorkerState.FREE);
        break;
      }
    }
  }

  private handleWorkerMessage(
    { __state: workerState, method, work: workUpdate }: WorkerMessage,
    workerUuid: string
  ) {
    if (method === "PONG") {
      return this.LOGGER.info(`Worker: PONG`, { uuid: workerUuid });
    }

    switch (method) {
      case WorkerMessageMethod.UPDATE_STATE: {
        const work = this.getWork(workerUuid, workUpdate.uuid);
        if (!work) {
          this.LOGGER.error(`Lost work`, {
            workerState,
            method,
            workUpdate,
            workerUuid,
          });
          return;
        }
        const deferred = work.deferred;
        this.updateWorkState(workerUuid, work.uuid, workUpdate.__state);
        if (workUpdate.__state === WorkState.DONE) {
          this.LOGGER.info(`Work State DONE`, {
            method,
            workerUuid,
            uuid: work.uuid,
          });
          deferred.resolve(work.result);
        }
      }
    }
  }
}

export class ClusterWorker implements IClusterWorker {
  private LOGGER: TLogger;
  private __state: WorkerState;

  static create(
    uuid: string,
    adapterName: string,
    provider: IClusterProvider
  ): ClusterWorker {
    const instance = new ClusterWorker(uuid, adapterName, provider);
    return instance;
  }

  constructor(
    public uuid: string,
    public adapterName: string,
    public provider: IClusterProvider
  ) {
    this.init();
  }

  public init(): void {
    this.LOGGER = getLogger(`CLUSTER_WORKER_${this.adapterName}`, {
      datadog: !!process.env.DATADOG_API_KEY,
    });

    for (const event of Object.values(WorkerEvents)) {
      process.on(event, (...args: Array<unknown>) =>
        this.handleWorkerEvent(event, args)
      );
    }

    this.provider.withWorker(this);
  }

  private handleWorkerEvent(event: string, args: Array<unknown>) {
    switch (event) {
      case WorkerEvents.MESSAGE: {
        const [message, handle] = args;
        this.handleMessage(message as WorkerWork);
        break;
      }
      case WorkerEvents.ERROR: {
        this.LOGGER.error(`Worker Error Event`, { args });
        break;
      }
      case WorkerEvents.EXIT: {
        this.LOGGER.error(`Worker Exit Event`, { args });
        break;
      }
    }
  }

  private async handleMessage({ uuid, method, data }: WorkerWork) {
    if (method === "PING") {
      this.LOGGER.info(`Worker PING`, { method, data });
      this.sendPong();
    } else {
      try {
        this.__state = WorkerState.BUSY;
        this.sendMessage({
          __state: WorkerState.BUSY,
          uuid: this.uuid,
          method: WorkerMessageMethod.UPDATE_STATE,
          work: {
            __state: WorkState.SUBMITTED,
            uuid,
          },
        });
        const dispatchResult = await this.provider.dispatchWorkMethod(
          method,
          data as Array<unknown>
        );

        this.sendMessage({
          __state: WorkerState.FREE,
          uuid: this.uuid,
          method: WorkerMessageMethod.UPDATE_STATE,
          work: {
            __state: WorkState.DONE,
            uuid,
            result: dispatchResult,
          },
        });
      } catch (e) {
        this.LOGGER.error(`Worker Error`, { e, uuid, method });
      }
    }
  }

  private sendPong(): void {
    process.send({ method: "PONG" });
  }

  private sendMessage(message: WorkerMessage) {
    process.send(message);
  }

  private updateWorkState(state: WorkState, workUuid: string) {
    this.sendMessage({
      method: WorkerMessageMethod.UPDATE_STATE,
      work: {
        __state: state,
        uuid: workUuid,
      },
    });
  }
}

function getDeferred(): DeferredWork {
  const deferred: DeferredWork = {
    promise: null,
    resolve: null,
    reject: null,
  };
  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  return deferred;
}
