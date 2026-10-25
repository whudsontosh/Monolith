'use strict';
/*
 * The bridge between a Monolith window and the app. The page claims it once, before any game
 * code is loaded, so games never get it. Every call is also checked by the app against the
 * page that made it (the launcher, a player window, a GM window or the update window).
 */
const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const api = {
  platform: process.platform,
  appVersion: inv('app:version'),
  // the game shelf (launcher)
  shelf: inv('games:shelf'),
  installGame: inv('games:install'),
  openGame: inv('games:open'),
  onGameStatus: (fn) => { ipcRenderer.on('games:status', (e, s) => fn(s)); },
  checkAppUpdate: inv('update:check'),
  // a game window
  gameInfo: inv('game:info'),
  gameEnsure: inv('game:ensure'),
  goHome: inv('win:home'),
  // hosting (GM windows)
  serverInfo: inv('server:info'),
  hostState: inv('host:state'),
  tunnelStart: inv('tunnel:start'),
  tunnelStop: inv('tunnel:stop'),
  onTunnel: (fn) => { ipcRenderer.on('tunnel:status', (e, s) => fn(s)); },
  directStart: inv('direct:start'),
  directStop: inv('direct:stop'),
  lanIps: inv('net:lan'),
  publicIp: inv('net:publicip'),
  openPlayerWindow: inv('win:player'),
  // files
  backup: inv('backup:write'),
  openBackups: inv('backup:open'),
  openData: inv('data:open'),
  copy: inv('clip:write'),
  savePdf: inv('pdf:save'),
  // the update window
  onUpdate: (fn) => { ipcRenderer.on('update:status', (e, s) => fn(s)); },
  updateSkip: inv('update:skip'),
};
let claimed = false;
contextBridge.exposeInMainWorld('monolithDesk', { claim: () => { if (claimed) return null; claimed = true; return api; } });
