import { parentPort, workerData } from 'node:worker_threads'
import { inspectModelCandidates } from './model-import-inspector'

if (!parentPort) throw Error('Model import worker requires a parent port')
parentPort.postMessage(inspectModelCandidates(workerData))
