
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow = null;
let pendingProjectPath = null;

function findProjectPath(args) {
  const projectPath = args.find((argument) => path.extname(argument).toLowerCase() === '.dc');
  return projectPath ? path.resolve(projectPath) : null;
}

async function sendProjectFile(projectPath) {
  if (!mainWindow || mainWindow.webContents.isLoading()) {
    pendingProjectPath = projectPath;
    return;
  }

  try {
    const contents = await fs.readFile(projectPath, 'utf8');
    mainWindow.webContents.send('design-clover:open-project', {
      fileName: path.basename(projectPath),
      contents
    });
  } catch (error) {
    mainWindow.webContents.send('design-clover:open-project', {
      fileName: path.basename(projectPath),
      error: error instanceof Error ? error.message : 'The file could not be read.'
    });
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#101411',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;

  window.once('ready-to-show', () => window.show());
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.once('did-finish-load', () => {
    if (pendingProjectPath) {
      const projectPath = pendingProjectPath;
      pendingProjectPath = null;
      void sendProjectFile(projectPath);
    }
  });

  if (!app.isPackaged) {
    window.loadURL('http://127.0.0.1:5173');
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const projectPath = findProjectPath(commandLine);
    if (projectPath) void sendProjectFile(projectPath);

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  app.whenReady().then(() => {
    pendingProjectPath = findProjectPath(process.argv.slice(1));
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
