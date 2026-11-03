import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AiloApi, MainEvent } from '../shared/types';

const call =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

const api: AiloApi = {
  authorizeConnection: call('authorizeConnection') as AiloApi['authorizeConnection'],
  saveConnection: call('saveConnection') as AiloApi['saveConnection'],
  removeConnection: call('removeConnection') as AiloApi['removeConnection'],
  testConnection: call('testConnection') as AiloApi['testConnection'],
  saveSkill: call('saveSkill') as AiloApi['saveSkill'],
  removeSkill: call('removeSkill') as AiloApi['removeSkill'],
  importPlugin: call('importPlugin') as AiloApi['importPlugin'],
  removePlugin: call('removePlugin') as AiloApi['removePlugin'],
  setConversationTools: call('setConversationTools') as AiloApi['setConversationTools'],
  saveAutomation: call('saveAutomation') as AiloApi['saveAutomation'],
  removeAutomation: call('removeAutomation') as AiloApi['removeAutomation'],
  runAutomation: call('runAutomation') as AiloApi['runAutomation'],
  stopAutomationRun: call('stopAutomationRun') as AiloApi['stopAutomationRun'],
  removeAutomationRun: call('removeAutomationRun') as AiloApi['removeAutomationRun'],
  getState: call('getState') as AiloApi['getState'],
  detectClis: call('detectClis') as AiloApi['detectClis'],
  addAccount: call('addAccount') as AiloApi['addAccount'],
  updateAccount: call('updateAccount') as AiloApi['updateAccount'],
  removeAccount: call('removeAccount') as AiloApi['removeAccount'],
  checkAccount: call('checkAccount') as AiloApi['checkAccount'],
  refreshUsage: call('refreshUsage') as AiloApi['refreshUsage'],
  listModels: call('listModels') as AiloApi['listModels'],
  deleteConversation: call('deleteConversation') as AiloApi['deleteConversation'],
  setConversationOptions: call('setConversationOptions') as AiloApi['setConversationOptions'],
  attachFiles: call('attachFiles') as AiloApi['attachFiles'],
  attachData: call('attachData') as AiloApi['attachData'],
  pickFiles: call('pickFiles') as AiloApi['pickFiles'],
  pathForFile: (file) => webUtils.getPathForFile(file),
  startLogin: call('startLogin') as AiloApi['startLogin'],
  submitLoginCode: call('submitLoginCode') as AiloApi['submitLoginCode'],
  cancelLogin: call('cancelLogin') as AiloApi['cancelLogin'],
  pickFolder: call('pickFolder') as AiloApi['pickFolder'],
  addProject: call('addProject') as AiloApi['addProject'],
  updateProject: call('updateProject') as AiloApi['updateProject'],
  removeProject: call('removeProject') as AiloApi['removeProject'],
  createConversation: call('createConversation') as AiloApi['createConversation'],
  renameConversation: call('renameConversation') as AiloApi['renameConversation'],
  archiveConversation: call('archiveConversation') as AiloApi['archiveConversation'],
  getTranscript: call('getTranscript') as AiloApi['getTranscript'],
  sendMessage: call('sendMessage') as AiloApi['sendMessage'],
  stop: call('stop') as AiloApi['stop'],
  respondApproval: call('respondApproval') as AiloApi['respondApproval'],
  respondQuestion: call('respondQuestion') as AiloApi['respondQuestion'],
  folderConflicts: call('folderConflicts') as AiloApi['folderConflicts'],
  setSettings: call('setSettings') as AiloApi['setSettings'],
  openExternal: call('openExternal') as AiloApi['openExternal'],
  openConversationFolder: call('openConversationFolder') as AiloApi['openConversationFolder'],
  onEvent(cb) {
    const listener = (_e: unknown, ev: MainEvent) => cb(ev);
    ipcRenderer.on('ailo:event', listener);
    return () => ipcRenderer.removeListener('ailo:event', listener);
  }
};

contextBridge.exposeInMainWorld('ailo', api);
