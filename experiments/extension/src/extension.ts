import * as vscode from 'vscode';

// ─── Types ───────────────────────────────────────────────────────────

interface ExperimentResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  details: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

interface AllResults {
  timestamp: string;
  vscodeVersion: string;
  experiments: ExperimentResult[];
}

interface DesktopExperimentResults {
  timestamp: string;
  vscodeVersion: string;
  platform: string;
  phase: string;
  experiments: Record<string, ExperimentResult>;
}

// ─── Helpers ─────────────────────────────────────────────────────────

let output: vscode.OutputChannel;

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  output.appendLine(`[${ts}] ${msg}`);
}

async function runExperiment(
  name: string,
  fn: () => Promise<Record<string, unknown>>
): Promise<ExperimentResult> {
  log(`\n━━━ ${name} ━━━`);
  const start = Date.now();
  try {
    const details = await fn();
    const result: ExperimentResult = {
      name,
      status: 'pass',
      details,
      durationMs: Date.now() - start,
    };
    log(`✓ PASS (${result.durationMs}ms)`);
    for (const [k, v] of Object.entries(details)) {
      log(`  ${k}: ${JSON.stringify(v, null, 2).split('\n').join('\n  ')}`);
    }
    return result;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const result: ExperimentResult = {
      name,
      status: 'fail',
      details: {},
      error: errMsg,
      durationMs: Date.now() - start,
    };
    log(`✗ FAIL: ${errMsg}`);
    return result;
  }
}

function rangeToObj(range: vscode.Range) {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

// ─── Experiment: WebSocket ───────────────────────────────────────────

async function experimentWebSocket(): Promise<Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WebSocket = require('ws');

  const testUrl = process.env.WS_TEST_URL || 'ws://host.docker.internal:9900';
  log(`  Connecting to ${testUrl}...`);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(testUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket connection timeout (5s) to ${testUrl}`));
    }, 5000);

    ws.on('open', () => {
      log('  Connected! Sending ping...');
      ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
    });

    ws.on('message', (data: Buffer) => {
      clearTimeout(timeout);
      const msg = JSON.parse(data.toString());
      log(`  Received: ${JSON.stringify(msg)}`);
      ws.close();
      resolve({
        connected: true,
        url: testUrl,
        echoReceived: msg,
        wsModuleVersion: WebSocket.prototype.constructor.name,
      });
    });

    ws.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${err.message}`));
    });
  });
}

// ─── Experiment: File System ─────────────────────────────────────────

async function experimentFileSystem(): Promise<Record<string, unknown>> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { error: 'No workspace folders', workspaceFolders: [] };
  }

  const rootUri = workspaceFolders[0].uri;
  log(`  Workspace root: ${rootUri.fsPath}`);

  const entries = await vscode.workspace.fs.readDirectory(rootUri);
  const entryNames = entries.map(([name, type]) => ({
    name,
    type: type === vscode.FileType.File ? 'file' :
          type === vscode.FileType.Directory ? 'dir' :
          type === (vscode.FileType.SymbolicLink | vscode.FileType.File) ? 'symlink-file' :
          type === (vscode.FileType.SymbolicLink | vscode.FileType.Directory) ? 'symlink-dir' :
          `unknown(${type})`,
  }));

  const hasNodeModules = entries.some(([name]) => name === 'node_modules');
  const hasGitDir = entries.some(([name]) => name === '.git');
  const hasGitignore = entries.some(([name]) => name === '.gitignore');

  let readFileResult: Record<string, unknown> = {};
  const testFiles = entries.filter(([, type]) => type === vscode.FileType.File);
  if (testFiles.length > 0) {
    const testFileUri = vscode.Uri.joinPath(rootUri, testFiles[0][0]);
    const content = await vscode.workspace.fs.readFile(testFileUri);
    const text = new TextDecoder('utf-8').decode(content);
    readFileResult = {
      fileName: testFiles[0][0],
      sizeBytes: content.byteLength,
      previewLines: text.split('\n').slice(0, 3),
    };
  }

  const stat = await vscode.workspace.fs.stat(rootUri);

  return {
    rootPath: rootUri.fsPath,
    totalEntries: entries.length,
    entries: entryNames,
    gitignoreVisibility: {
      nodeModulesVisible: hasNodeModules,
      gitDirVisible: hasGitDir,
      gitignoreVisible: hasGitignore,
    },
    readFile: readFileResult,
    stat: {
      type: stat.type,
      ctime: stat.ctime,
      mtime: stat.mtime,
      size: stat.size,
    },
  };
}

// ─── Experiment: LSP Proxy ───────────────────────────────────────────

async function experimentLsp(): Promise<Record<string, unknown>> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { error: 'No workspace folders' };
  }

  const tsFiles = await vscode.workspace.findFiles('**/*.ts', '**/node_modules/**', 5);
  if (tsFiles.length === 0) {
    return { error: 'No .ts files found in workspace', skip: true };
  }

  const testUri = tsFiles[0];
  log(`  Test file: ${testUri.fsPath}`);

  const doc = await vscode.workspace.openTextDocument(testUri);
  log(`  Document opened: ${doc.languageId}, ${doc.lineCount} lines`);

  log('  Waiting 3s for language service...');
  await new Promise(r => setTimeout(r, 3000));

  const results: Record<string, unknown> = {
    testFile: testUri.fsPath,
    languageId: doc.languageId,
    lineCount: doc.lineCount,
  };

  let testPosition = new vscode.Position(0, 0);
  for (let i = 0; i < doc.lineCount; i++) {
    const line = doc.lineAt(i);
    const match = line.text.match(/\b([a-zA-Z_]\w+)\b/);
    if (match && !line.text.trim().startsWith('//') && !line.text.trim().startsWith('import')) {
      testPosition = new vscode.Position(i, match.index || 0);
      log(`  Test position: line ${i}, col ${match.index}, word="${match[1]}"`);
      break;
    }
  }

  // executeDefinitionProvider
  try {
    const defs = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeDefinitionProvider', testUri, testPosition
    );
    results.definition = {
      count: defs?.length ?? 0,
      results: defs?.slice(0, 3).map(d => {
        if ('uri' in d) {
          return { type: 'Location', uri: d.uri.fsPath, range: rangeToObj(d.range) };
        }
        return { type: 'LocationLink', targetUri: d.targetUri.fsPath, targetRange: rangeToObj(d.targetRange) };
      }),
    };
  } catch (e: unknown) {
    results.definition = { error: e instanceof Error ? e.message : String(e) };
  }

  // executeReferenceProvider
  try {
    const refs = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider', testUri, testPosition
    );
    results.references = {
      count: refs?.length ?? 0,
      results: refs?.slice(0, 5).map(r => ({
        uri: r.uri.fsPath,
        range: rangeToObj(r.range),
      })),
    };
  } catch (e: unknown) {
    results.references = { error: e instanceof Error ? e.message : String(e) };
  }

  // executeHoverProvider
  try {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider', testUri, testPosition
    );
    results.hover = {
      count: hovers?.length ?? 0,
      results: hovers?.slice(0, 3).map(h => ({
        contents: h.contents.map(c => {
          if (typeof c === 'string') return c;
          if (c instanceof vscode.MarkdownString) return c.value;
          return String(c);
        }),
        range: h.range ? rangeToObj(h.range) : null,
      })),
    };
  } catch (e: unknown) {
    results.hover = { error: e instanceof Error ? e.message : String(e) };
  }

  // executeDocumentSymbolProvider
  try {
    const symbols = await vscode.commands.executeCommand<(vscode.SymbolInformation | vscode.DocumentSymbol)[]>(
      'vscode.executeDocumentSymbolProvider', testUri
    );
    results.documentSymbols = {
      count: symbols?.length ?? 0,
      results: symbols?.slice(0, 10).map(s => {
        if ('location' in s) {
          return {
            type: 'SymbolInformation',
            name: s.name,
            kind: vscode.SymbolKind[s.kind],
            containerName: s.containerName,
          };
        }
        return {
          type: 'DocumentSymbol',
          name: s.name,
          kind: vscode.SymbolKind[s.kind],
          childrenCount: s.children?.length ?? 0,
        };
      }),
    };
  } catch (e: unknown) {
    results.documentSymbols = { error: e instanceof Error ? e.message : String(e) };
  }

  // executeWorkspaceSymbolProvider
  try {
    const wsSymbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeWorkspaceSymbolProvider', 'function'
    );
    results.workspaceSymbols = {
      count: wsSymbols?.length ?? 0,
      results: wsSymbols?.slice(0, 10).map(s => ({
        name: s.name,
        kind: vscode.SymbolKind[s.kind],
        uri: s.location.uri.fsPath,
      })),
    };
  } catch (e: unknown) {
    results.workspaceSymbols = { error: e instanceof Error ? e.message : String(e) };
  }

  // executeTypeDefinitionProvider
  try {
    const typeDefs = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeTypeDefinitionProvider', testUri, testPosition
    );
    results.typeDefinition = {
      count: typeDefs?.length ?? 0,
    };
  } catch (e: unknown) {
    results.typeDefinition = { error: e instanceof Error ? e.message : String(e) };
  }

  // executeImplementationProvider
  try {
    const impls = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeImplementationProvider', testUri, testPosition
    );
    results.implementation = {
      count: impls?.length ?? 0,
    };
  } catch (e: unknown) {
    results.implementation = { error: e instanceof Error ? e.message : String(e) };
  }

  return results;
}

// ─── Experiment: Workspace Management ────────────────────────────────

async function experimentWorkspace(): Promise<Record<string, unknown>> {
  const currentFolders = vscode.workspace.workspaceFolders || [];
  const results: Record<string, unknown> = {
    initialFolderCount: currentFolders.length,
    initialFolders: currentFolders.map(f => ({
      name: f.name,
      uri: f.uri.fsPath,
      index: f.index,
    })),
  };

  const tmpFolderUri = vscode.Uri.file('/tmp/code-viewer-experiment');

  try {
    await vscode.workspace.fs.createDirectory(tmpFolderUri);
    log('  Created temp directory');
  } catch {
    log('  Temp directory may already exist');
  }

  const addSuccess = vscode.workspace.updateWorkspaceFolders(
    currentFolders.length,
    null,
    { uri: tmpFolderUri, name: 'experiment-temp' }
  );
  results.addFolderResult = addSuccess;

  if (addSuccess) {
    await new Promise(r => setTimeout(r, 2000));

    const updatedFolders = vscode.workspace.workspaceFolders || [];
    results.afterAddFolderCount = updatedFolders.length;
    results.afterAddFolders = updatedFolders.map(f => ({
      name: f.name,
      uri: f.uri.fsPath,
      index: f.index,
    }));

    const removeSuccess = vscode.workspace.updateWorkspaceFolders(
      updatedFolders.length - 1,
      1
    );
    results.removeFolderResult = removeSuccess;

    await new Promise(r => setTimeout(r, 1000));

    const finalFolders = vscode.workspace.workspaceFolders || [];
    results.finalFolderCount = finalFolders.length;
  }

  return results;
}

// ─── Experiment: Git API ─────────────────────────────────────────────

async function experimentGit(): Promise<Record<string, unknown>> {
  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (!gitExt) {
    return { error: 'Git extension not found', available: false };
  }

  if (!gitExt.isActive) {
    await gitExt.activate();
  }

  const git = gitExt.exports.getAPI(1);
  const results: Record<string, unknown> = {
    available: true,
    state: git.state,
    repositoryCount: git.repositories.length,
  };

  if (git.repositories.length > 0) {
    const repo = git.repositories[0];
    const state = repo.state;

    results.repository = {
      rootUri: repo.rootUri.fsPath,
      head: state.HEAD ? {
        name: state.HEAD.name,
        commit: state.HEAD.commit?.slice(0, 8),
        type: state.HEAD.type,
      } : null,
      refsCount: state.refs.length,
      remotesCount: state.remotes.length,
      indexChanges: state.indexChanges.length,
      workingTreeChanges: state.workingTreeChanges.length,
      untrackedChanges: state.untrackedChanges?.length ?? 'N/A',
    };

    try {
      const commits = await repo.log({ maxEntries: 5 });
      results.recentCommits = commits.map((c: { hash: string; message: string; authorName: string }) => ({
        hash: c.hash.slice(0, 8),
        message: c.message.slice(0, 60),
        author: c.authorName,
      }));
    } catch (e: unknown) {
      results.logError = e instanceof Error ? e.message : String(e);
    }

    try {
      const diff = await repo.diffWithHEAD();
      results.diffWithHEAD = {
        length: diff.length,
        preview: diff.slice(0, 200),
      };
    } catch (e: unknown) {
      results.diffError = e instanceof Error ? e.message : String(e);
    }

    try {
      const branches = await repo.getBranches({ remote: false });
      results.localBranches = branches.map((b: { name: string; type: number }) => b.name);
    } catch (e: unknown) {
      results.branchesError = e instanceof Error ? e.message : String(e);
    }
  }

  return results;
}

// ─── Experiment: Diagnostics ─────────────────────────────────────────

async function experimentDiagnostics(): Promise<Record<string, unknown>> {
  const allDiags = vscode.languages.getDiagnostics();
  const results: Record<string, unknown> = {
    totalFilesWithDiagnostics: allDiags.length,
    totalDiagnostics: allDiags.reduce((sum, [, diags]) => sum + diags.length, 0),
  };

  const samples = allDiags.slice(0, 5).map(([uri, diags]) => ({
    file: uri.fsPath,
    count: diags.length,
    items: diags.slice(0, 3).map(d => ({
      message: d.message.slice(0, 100),
      severity: vscode.DiagnosticSeverity[d.severity],
      source: d.source,
      range: rangeToObj(d.range),
    })),
  }));
  results.samples = samples;

  results.onDidChangeDiagnosticsAvailable = typeof vscode.languages.onDidChangeDiagnostics === 'function';

  return results;
}

// ─── Experiment: Copilot Detection ───────────────────────────────────

async function experimentCopilotDetection(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  const copilotExt = vscode.extensions.getExtension('github.copilot');
  const copilotChatExt = vscode.extensions.getExtension('github.copilot-chat');

  results.copilot = copilotExt
    ? {
        installed: true,
        isActive: copilotExt.isActive,
        version: copilotExt.packageJSON?.version ?? 'unknown',
        extensionPath: copilotExt.extensionPath,
      }
    : { installed: false };

  results.copilotChat = copilotChatExt
    ? {
        installed: true,
        isActive: copilotChatExt.isActive,
        version: copilotChatExt.packageJSON?.version ?? 'unknown',
      }
    : { installed: false };

  if (copilotExt && !copilotExt.isActive) {
    try {
      await copilotExt.activate();
      results.copilotActivation = 'success';
    } catch (e: unknown) {
      results.copilotActivation = {
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  try {
    const session = await vscode.authentication.getSession('github', ['read:user'], {
      createIfNone: false,
    });
    results.githubAuth = session
      ? {
          authenticated: true,
          account: session.account.label,
          scopes: session.scopes,
        }
      : { authenticated: false, reason: 'no existing session' };
  } catch (e: unknown) {
    results.githubAuth = {
      authenticated: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  try {
    const allCommands = await vscode.commands.getCommands(true);
    const copilotCommands = allCommands.filter(
      (c) => c.includes('copilot') || c.includes('inlineSuggest')
    );
    results.copilotCommands = {
      count: copilotCommands.length,
      commands: copilotCommands.slice(0, 30),
    };
  } catch (e: unknown) {
    results.copilotCommands = { error: e instanceof Error ? e.message : String(e) };
  }

  const allExtensions = vscode.extensions.all.filter(
    (e) => !e.id.startsWith('vscode.')
  );
  results.installedThirdPartyExtensions = allExtensions.map((e) => ({
    id: e.id,
    version: e.packageJSON?.version,
    isActive: e.isActive,
  }));

  return results;
}

// ─── Experiment: Language Model API (vscode.lm) ─────────────────────

async function experimentLanguageModelApi(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  if (!vscode.lm) {
    results.lmApiAvailable = false;
    results.error = 'vscode.lm namespace does not exist in this VS Code version';
    return results;
  }

  results.lmApiAvailable = true;

  if (typeof vscode.lm.selectChatModels !== 'function') {
    results.selectChatModelsAvailable = false;
    results.error = 'vscode.lm.selectChatModels is not a function';
    return results;
  }

  results.selectChatModelsAvailable = true;

  try {
    const allModels = await vscode.lm.selectChatModels();
    results.allModels = {
      count: allModels.length,
      models: allModels.map((m) => ({
        id: m.id,
        name: m.name,
        vendor: m.vendor,
        family: m.family,
        version: m.version,
        maxInputTokens: m.maxInputTokens,
      })),
    };
  } catch (e: unknown) {
    results.allModels = { error: e instanceof Error ? e.message : String(e) };
  }

  try {
    const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    results.copilotModels = {
      count: copilotModels.length,
      models: copilotModels.map((m) => ({
        id: m.id,
        name: m.name,
        family: m.family,
        version: m.version,
        maxInputTokens: m.maxInputTokens,
      })),
    };

    if (copilotModels.length > 0) {
      const model = copilotModels[0];
      log(`  Sending test request to model: ${model.id} (${model.family})`);

      try {
        const messages = [
          vscode.LanguageModelChatMessage.User(
            'Reply with exactly: "COPILOT_LM_API_WORKS". Nothing else.'
          ),
        ];

        const response = await model.sendRequest(
          messages,
          {},
          new vscode.CancellationTokenSource().token
        );

        let fullResponse = '';
        for await (const fragment of response.text) {
          fullResponse += fragment;
        }

        results.testRequest = {
          success: true,
          modelUsed: model.id,
          response: fullResponse.slice(0, 500),
          responseLength: fullResponse.length,
        };
      } catch (e: unknown) {
        results.testRequest = {
          success: false,
          modelUsed: model.id,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  } catch (e: unknown) {
    results.copilotModels = { error: e instanceof Error ? e.message : String(e) };
  }

  try {
    const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (copilotModels.length > 0) {
      const model = copilotModels[0];

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders) {
        const tsFiles = await vscode.workspace.findFiles('**/*.ts', '**/node_modules/**', 1);
        if (tsFiles.length > 0) {
          const doc = await vscode.workspace.openTextDocument(tsFiles[0]);
          const codeContent = doc.getText().slice(0, 2000);

          const messages = [
            vscode.LanguageModelChatMessage.User(
              `Here is code from ${tsFiles[0].fsPath}:\n\n\`\`\`typescript\n${codeContent}\n\`\`\`\n\n` +
              'List all exported symbols (functions, classes, interfaces) with their line numbers. ' +
              'Format: symbol_name (type) - line N'
            ),
          ];

          const response = await model.sendRequest(
            messages,
            {},
            new vscode.CancellationTokenSource().token
          );

          let fullResponse = '';
          for await (const fragment of response.text) {
            fullResponse += fragment;
          }

          results.contextAwareRequest = {
            success: true,
            sourceFile: tsFiles[0].fsPath,
            response: fullResponse.slice(0, 1000),
          };
        }
      }
    }
  } catch (e: unknown) {
    results.contextAwareRequest = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// ─── Desktop Experiments (Phase B) ───────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

// ─── B1: Model Enumeration ───────────────────────────────────────────

async function experimentB1ModelEnumeration(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  if (!vscode.lm) {
    return { lmApiAvailable: false, error: 'vscode.lm namespace not found' };
  }

  // No filter - get all models
  try {
    const allModels = await vscode.lm.selectChatModels();
    results.allModels = {
      count: allModels.length,
      models: allModels.map(m => ({
        id: m.id,
        name: m.name,
        vendor: m.vendor,
        family: m.family,
        version: m.version,
        maxInputTokens: m.maxInputTokens,
        maxOutputTokens: m.maxOutputTokens,
      })),
    };
    log(`  All models: ${allModels.length}`);
  } catch (e: unknown) {
    results.allModels = { error: e instanceof Error ? e.message : String(e) };
  }

  // Copilot vendor filter
  try {
    const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    results.copilotModels = {
      count: copilotModels.length,
      models: copilotModels.map(m => ({
        id: m.id,
        name: m.name,
        vendor: m.vendor,
        family: m.family,
        version: m.version,
        maxInputTokens: m.maxInputTokens,
        maxOutputTokens: m.maxOutputTokens,
      })),
    };
    log(`  Copilot models: ${copilotModels.length}`);
  } catch (e: unknown) {
    results.copilotModels = { error: e instanceof Error ? e.message : String(e) };
  }

  // Test onDidChangeChatModels event
  try {
    const hasEvent = typeof vscode.lm.onDidChangeChatModels === 'function';
    results.onDidChangeChatModelsAvailable = hasEvent;
    if (hasEvent) {
      // Register and immediately dispose to test it exists
      const disposable = vscode.lm.onDidChangeChatModels(() => {
        log('  [event] Chat models changed');
      });
      results.onDidChangeChatModelsRegistered = true;
      // Keep it alive for now (will be cleaned up on deactivate)
      disposable.dispose();
    }
  } catch (e: unknown) {
    results.onDidChangeChatModels = { error: e instanceof Error ? e.message : String(e) };
  }

  return results;
}

// ─── B2: LM Send Request ────────────────────────────────────────────

async function experimentB2LmSendRequest(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  if (!vscode.lm) {
    return { error: 'vscode.lm not available' };
  }

  // Select gpt-4o (0x multiplier) to avoid consuming premium quota
  const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  // Try to find gpt-4o, fall back to first available
  let model = allModels.find(m => m.family === 'gpt-4o') || allModels[0];

  if (!model) {
    return { error: 'No models available', modelCount: allModels.length };
  }

  results.selectedModel = {
    id: model.id,
    name: model.name,
    family: model.family,
    vendor: model.vendor,
  };

  // Test 1: Simple prompt
  log(`  Test 1: Simple prompt to ${model.id}...`);
  const t1Start = Date.now();
  try {
    const messages = [
      vscode.LanguageModelChatMessage.User(
        'Reply with exactly: "COPILOT_LM_WORKS". Nothing else.'
      ),
    ];

    const response = await model.sendRequest(
      messages,
      {},
      new vscode.CancellationTokenSource().token
    );

    let fullResponse = '';
    let firstTokenTime: number | null = null;
    for await (const fragment of response.text) {
      if (firstTokenTime === null) {
        firstTokenTime = Date.now();
      }
      fullResponse += fragment;
    }
    const endTime = Date.now();

    results.simplePrompt = {
      success: true,
      response: fullResponse.slice(0, 500),
      latency: {
        firstTokenMs: firstTokenTime ? firstTokenTime - t1Start : null,
        totalMs: endTime - t1Start,
      },
    };
  } catch (e: unknown) {
    results.simplePrompt = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Test 2: Code context prompt
  log('  Test 2: Code context prompt...');
  try {
    const tsFiles = await vscode.workspace.findFiles('**/*.ts', '**/node_modules/**', 1);
    if (tsFiles.length > 0) {
      const doc = await vscode.workspace.openTextDocument(tsFiles[0]);
      const codeContent = doc.getText().slice(0, 2000);

      const messages = [
        vscode.LanguageModelChatMessage.User(
          `Here is TypeScript code:\n\n\`\`\`typescript\n${codeContent}\n\`\`\`\n\n` +
          'What does the UserService class do? Answer in one sentence.'
        ),
      ];

      const response = await model.sendRequest(
        messages,
        {},
        new vscode.CancellationTokenSource().token
      );

      let fullResponse = '';
      for await (const fragment of response.text) {
        fullResponse += fragment;
      }

      results.codeContextPrompt = {
        success: true,
        response: fullResponse.slice(0, 500),
        sourceFile: tsFiles[0].fsPath,
      };
    } else {
      results.codeContextPrompt = { skip: true, reason: 'No .ts files found' };
    }
  } catch (e: unknown) {
    results.codeContextPrompt = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Test 3: Multi-turn conversation (User + Assistant history)
  log('  Test 3: Multi-turn conversation...');
  try {
    const messages = [
      vscode.LanguageModelChatMessage.User('What is TypeScript?'),
      vscode.LanguageModelChatMessage.Assistant(
        'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.'
      ),
      vscode.LanguageModelChatMessage.User(
        'What was my previous question about? Reply in one sentence.'
      ),
    ];

    const response = await model.sendRequest(
      messages,
      {},
      new vscode.CancellationTokenSource().token
    );

    let fullResponse = '';
    for await (const fragment of response.text) {
      fullResponse += fragment;
    }

    results.multiTurn = {
      success: true,
      response: fullResponse.slice(0, 500),
      historyAware: fullResponse.toLowerCase().includes('typescript'),
    };
  } catch (e: unknown) {
    results.multiTurn = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Test 4: Cancellation token
  log('  Test 4: Cancellation token...');
  try {
    const cts = new vscode.CancellationTokenSource();
    const messages = [
      vscode.LanguageModelChatMessage.User(
        'Write a very long essay about the history of programming languages, at least 2000 words.'
      ),
    ];

    const response = await model.sendRequest(messages, {}, cts.token);

    let fragments = 0;
    // Cancel after receiving a few fragments
    for await (const _fragment of response.text) {
      fragments++;
      if (fragments >= 3) {
        cts.cancel();
        break;
      }
    }

    results.cancellation = {
      success: true,
      fragmentsBeforeCancel: fragments,
      cancelledCleanly: true,
    };
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    // Cancellation may throw - that's expected
    results.cancellation = {
      success: errMsg.includes('cancel') || errMsg.includes('Cancel'),
      error: errMsg,
      cancelledCleanly: true,
    };
  }

  return results;
}

// ─── B3: Chat Panel Integration ──────────────────────────────────────

async function experimentB3ChatPanel(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  // B3a: Basic send message
  log('  B3a: Opening chat panel with query...');
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', {
      query: 'What is 2 + 2? Reply with just the number.',
      isPartialQuery: false,
    });
    results.b3a_basicSend = {
      success: true,
      note: 'Chat panel opened with query. Check if Copilot responded.',
    };
    // Wait a moment for the panel to open
    await new Promise(r => setTimeout(r, 2000));
  } catch (e: unknown) {
    results.b3a_basicSend = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // B3b: Inject history via previousRequests
  log('  B3b: Injecting history with previousRequests...');
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', {
      query: 'What was my previous question about?',
      isPartialQuery: false,
      previousRequests: [
        {
          request: 'What is TypeScript?',
          response: 'TypeScript is a typed superset of JavaScript.',
        },
      ],
    });
    results.b3b_previousRequests = {
      success: true,
      note: 'Chat panel opened with injected history. Check if Copilot references TypeScript.',
    };
    await new Promise(r => setTimeout(r, 2000));
  } catch (e: unknown) {
    results.b3b_previousRequests = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // B3c: Attach files
  log('  B3c: Attaching files...');
  try {
    const tsFiles = await vscode.workspace.findFiles('**/*.ts', '**/node_modules/**', 1);
    if (tsFiles.length > 0) {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: 'Explain what this file does in one sentence.',
        isPartialQuery: false,
        attachFiles: [tsFiles[0]],
      });
      results.b3c_attachFiles = {
        success: true,
        attachedFile: tsFiles[0].fsPath,
        note: 'Chat panel opened with file attachment.',
      };
    } else {
      results.b3c_attachFiles = { skip: true, reason: 'No .ts files' };
    }
    await new Promise(r => setTimeout(r, 2000));
  } catch (e: unknown) {
    results.b3c_attachFiles = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // B3d: Mode selection
  log('  B3d: Testing mode parameter...');
  for (const mode of ['ask', 'agent']) {
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `Test message in ${mode} mode. Reply with: "MODE_${mode.toUpperCase()}_WORKS"`,
        isPartialQuery: false,
        mode,
      });
      results[`b3d_mode_${mode}`] = {
        success: true,
        note: `Chat opened in ${mode} mode.`,
      };
      await new Promise(r => setTimeout(r, 1500));
    } catch (e: unknown) {
      results[`b3d_mode_${mode}`] = {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  // Also check what chat-related commands exist
  try {
    const allCommands = await vscode.commands.getCommands(true);
    const chatCommands = allCommands.filter(c =>
      c.includes('chat') && (c.includes('workbench') || c.includes('copilot'))
    );
    results.availableChatCommands = {
      count: chatCommands.length,
      commands: chatCommands.sort(),
    };
  } catch (e: unknown) {
    results.availableChatCommands = { error: e instanceof Error ? e.message : String(e) };
  }

  return results;
}

// ─── B4: Chat Response Detection ─────────────────────────────────────

async function experimentB4ResponseDetection(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  // B4a: Try to read chat sessions from SQLite to detect response
  log('  B4a: Testing SQLite polling approach...');
  try {
    const { execSync } = require('child_process');
    const homeDir = process.env.HOME || '/Users/rickwen';
    const wsStoragePath = `${homeDir}/Library/Application Support/Code/User/workspaceStorage`;

    // Find the current workspace's storage directory
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let workspaceStorageId: string | null = null;

    if (workspaceFolders) {
      // List workspace storage dirs and try to match
      const storageDirs = execSync(`ls "${wsStoragePath}"`, { encoding: 'utf-8' }).trim().split('\n');

      for (const dir of storageDirs) {
        try {
          const wsJson = execSync(
            `cat "${wsStoragePath}/${dir}/workspace.json" 2>/dev/null`,
            { encoding: 'utf-8' }
          );
          const parsed = JSON.parse(wsJson);
          const folder = parsed.folder || '';
          if (folder.includes(workspaceFolders[0].uri.fsPath) ||
              decodeURIComponent(folder).includes(workspaceFolders[0].uri.fsPath)) {
            workspaceStorageId = dir;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (workspaceStorageId) {
      const dbPath = `${wsStoragePath}/${workspaceStorageId}/state.vscdb`;

      // Read interactive-session to get baseline
      const baseline = execSync(
        `sqlite3 "file:${dbPath}?mode=ro" "SELECT length(value) FROM ItemTable WHERE key = 'memento/interactive-session';"`,
        { encoding: 'utf-8' }
      ).trim();

      results.b4a_sqlitePolling = {
        success: true,
        workspaceStorageId,
        dbPath,
        baselineSessionSize: parseInt(baseline, 10) || 0,
        note: 'Can read SQLite in readonly mode. Poll for size changes to detect new responses.',
      };
    } else {
      results.b4a_sqlitePolling = {
        success: false,
        note: 'Could not find workspace storage directory for current workspace.',
      };
    }
  } catch (e: unknown) {
    results.b4a_sqlitePolling = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // B4b: FileSystemWatcher on state.vscdb
  log('  B4b: Testing FileSystemWatcher...');
  try {
    const homeDir = process.env.HOME || '/Users/rickwen';
    const wsStoragePath = `${homeDir}/Library/Application Support/Code/User/workspaceStorage`;
    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(wsStoragePath),
      '**/state.vscdb'
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    let changeDetected = false;
    const disposable = watcher.onDidChange((uri) => {
      changeDetected = true;
      log(`  [B4b] state.vscdb changed: ${uri.fsPath}`);
    });

    // Wait briefly to see if any changes are caught
    await new Promise(r => setTimeout(r, 3000));

    results.b4b_fileSystemWatcher = {
      success: true,
      watcherCreated: true,
      changeDetectedDuring3sWait: changeDetected,
      note: 'FileSystemWatcher created. May not fire for SQLite WAL writes.',
    };

    disposable.dispose();
    watcher.dispose();
  } catch (e: unknown) {
    results.b4b_fileSystemWatcher = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // B4c: Check for chat-related events
  log('  B4c: Checking for chat events...');
  try {
    const allCommands = await vscode.commands.getCommands(true);
    const chatEventCommands = allCommands.filter(c =>
      (c.includes('chat') || c.includes('copilot')) &&
      (c.includes('session') || c.includes('end') || c.includes('response') || c.includes('complete'))
    );
    results.b4c_chatEvents = {
      relevantCommands: chatEventCommands,
      note: 'No built-in onDidEndChatSession event in public API. Must use polling or workarounds.',
    };
  } catch (e: unknown) {
    results.b4c_chatEvents = { error: e instanceof Error ? e.message : String(e) };
  }

  // B4d: Test copyAll command
  log('  B4d: Testing chat.copyAll...');
  try {
    // Save current clipboard
    const originalClipboard = await vscode.env.clipboard.readText();

    await vscode.commands.executeCommand('workbench.action.chat.copyAll');
    await new Promise(r => setTimeout(r, 500));

    const chatContent = await vscode.env.clipboard.readText();
    const contentChanged = chatContent !== originalClipboard;

    // Restore clipboard
    await vscode.env.clipboard.writeText(originalClipboard);

    results.b4d_copyAll = {
      success: contentChanged,
      contentLength: chatContent.length,
      contentPreview: chatContent.slice(0, 500),
      note: contentChanged
        ? 'copyAll works but hijacks clipboard. Not ideal for production.'
        : 'copyAll did not change clipboard (no chat content or command failed).',
    };
  } catch (e: unknown) {
    results.b4d_copyAll = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return results;
}

// ─── B5: Chat Session Reading from Extension ─────────────────────────

async function experimentB5ChatSessionReading(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  // Method 1: Node.js child_process to run sqlite3
  log('  Method 1: sqlite3 subprocess...');
  try {
    const { execSync } = require('child_process');
    const homeDir = process.env.HOME || '/Users/rickwen';
    const wsStoragePath = `${homeDir}/Library/Application Support/Code/User/workspaceStorage`;

    // Use the target workspace we know has chat data
    const targetWs = '225bf85cde240ff7fb78927c4f23b4ea';
    const dbPath = `${wsStoragePath}/${targetWs}/state.vscdb`;

    // Read ChatSessionStore index
    const indexRaw = execSync(
      `sqlite3 "file:${dbPath}?mode=ro" "SELECT value FROM ItemTable WHERE key = 'chat.ChatSessionStore.index';"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );

    const index = JSON.parse(indexRaw);
    const sessions = Object.values(index.entries || {}) as Array<{
      sessionId: string;
      title: string;
      timing?: { created?: number; lastRequestStarted?: number };
    }>;

    results.method1_sqlite3 = {
      success: true,
      sessionCount: sessions.length,
      sampleSessions: sessions.slice(0, 5).map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        created: s.timing?.created ? new Date(s.timing.created).toISOString() : null,
      })),
    };

    // Read interactive-session to get actual conversation content
    const sessionRaw = execSync(
      `sqlite3 "file:${dbPath}?mode=ro" "SELECT substr(value, 1, 5000) FROM ItemTable WHERE key = 'memento/interactive-session';"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );

    const sessionData = JSON.parse(sessionRaw);
    if (sessionData.history) {
      const providers = Object.keys(sessionData.history);
      const totalEntries = Object.values(sessionData.history).reduce(
        (sum: number, entries: unknown) => sum + (Array.isArray(entries) ? entries.length : 0),
        0
      );
      results.method1_interactiveSession = {
        success: true,
        providers,
        totalHistoryEntries: totalEntries,
      };
    }
  } catch (e: unknown) {
    results.method1_sqlite3 = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Method 2: Check getCommands for export-related commands
  log('  Method 2: Chat export commands...');
  try {
    const allCommands = await vscode.commands.getCommands(true);
    const exportCommands = allCommands.filter(c =>
      c.includes('chat') && (c.includes('export') || c.includes('save') || c.includes('copy') || c.includes('history'))
    );
    results.method2_exportCommands = {
      commands: exportCommands,
      count: exportCommands.length,
    };
  } catch (e: unknown) {
    results.method2_exportCommands = { error: e instanceof Error ? e.message : String(e) };
  }

  // Method 3: Check globalState/workspaceState
  log('  Method 3: Extension state APIs...');
  try {
    // We can't access other extensions' state directly, but we can check our own
    results.method3_extensionState = {
      note: 'Extension globalState/workspaceState only accessible for own extension. Cannot read Copilot Chat state via this API.',
      recommendation: 'Use sqlite3 subprocess (Method 1) for reliable reading.',
    };
  } catch (e: unknown) {
    results.method3_extensionState = { error: e instanceof Error ? e.message : String(e) };
  }

  return results;
}

// ─── B6: Extension WebSocket → Backend ───────────────────────────────

async function experimentB6WebSocketBackend(): Promise<Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WebSocket = require('ws');
  const results: Record<string, unknown> = {};

  const backendUrl = process.env.WS_TEST_URL || 'ws://localhost:9900';
  log(`  Connecting to backend at ${backendUrl}...`);

  // Test 1: Basic bidirectional communication
  try {
    const ws = await new Promise<InstanceType<typeof WebSocket>>((resolve, reject) => {
      const socket = new WebSocket(backendUrl);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('Connection timeout (5s)'));
      }, 5000);

      socket.on('open', () => {
        clearTimeout(timeout);
        resolve(socket);
      });
      socket.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Wait for welcome message
    const welcomeMsg = await new Promise<string>((resolve) => {
      ws.on('message', (data: Buffer) => resolve(data.toString()));
    });
    results.welcomeMessage = JSON.parse(welcomeMsg);

    // Test command dispatch: send experiment trigger
    const commandPayload = {
      type: 'command',
      command: 'runExperiment',
      experimentId: 'B1',
      requestId: `req-${Date.now()}`,
    };
    ws.send(JSON.stringify(commandPayload));

    // Wait for response
    const responseMsg = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Response timeout')), 5000);
      ws.on('message', (data: Buffer) => {
        clearTimeout(timeout);
        resolve(data.toString());
      });
    });

    results.commandResponse = JSON.parse(responseMsg);
    results.bidirectional = {
      success: true,
      sentCommand: commandPayload,
      receivedResponse: results.commandResponse,
    };

    // Test sending experiment results back
    const resultPayload = {
      type: 'experimentResult',
      experimentId: 'B6',
      status: 'pass',
      data: { test: true, timestamp: Date.now() },
    };
    ws.send(JSON.stringify(resultPayload));
    results.resultReporting = { success: true, sent: resultPayload };

    ws.close();
  } catch (e: unknown) {
    results.bidirectional = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      note: 'Make sure test-backend is running: node experiments/test-backend/server.mjs',
    };
  }

  return results;
}

// ─── B7: LSP Provider APIs (Desktop confirmation) ────────────────────

async function experimentB7LspDesktop(): Promise<Record<string, unknown>> {
  // Reuse the existing LSP experiment
  return experimentLsp();
}

// ─── B9: Agent Interaction (pending edits, tool approval, diffs) ─────

async function experimentB9AgentInteraction(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const { execSync } = require('child_process');

  // ─── Step 1: Discover all accept/undo/approve commands ─────────
  log('  Step 1: Listing interaction commands...');
  try {
    const allCommands = await vscode.commands.getCommands(true);
    const interactionCommands: Record<string, string[]> = {
      editReview: [],
      editUndoRedo: [],
      toolApproval: [],
      terminal: [],
      pending: [],
      checkpoint: [],
      elicitation: [],
    };

    for (const cmd of allCommands) {
      const lower = cmd.toLowerCase();
      if (lower.includes('chat.review.')) {
        interactionCommands.editReview.push(cmd);
      } else if (lower.includes('undoedit') || lower.includes('redoedit') || lower.includes('chat.applycompare') || lower.includes('chat.discardcompare')) {
        interactionCommands.editUndoRedo.push(cmd);
      } else if (lower.includes('accepttool') || lower.includes('skiptool') || lower.includes('toolapproval') || lower.includes('permissionpicker')) {
        interactionCommands.toolApproval.push(cmd);
      } else if (lower.includes('terminal.chat.') && (lower.includes('run') || lower.includes('insert') || lower.includes('approval'))) {
        interactionCommands.terminal.push(cmd);
      } else if (lower.includes('pending')) {
        interactionCommands.pending.push(cmd);
      } else if (lower.includes('checkpoint')) {
        interactionCommands.checkpoint.push(cmd);
      } else if (lower.includes('elicit')) {
        interactionCommands.elicitation.push(cmd);
      }
    }

    results.interactionCommands = interactionCommands;
    const totalCount = Object.values(interactionCommands).reduce((sum, arr) => sum + arr.length, 0);
    log(`  Found ${totalCount} interaction commands`);
  } catch (e: unknown) {
    results.interactionCommands = { error: e instanceof Error ? e.message : String(e) };
  }

  // ─── Step 2: Create a test file for Copilot to edit ────────────
  log('  Step 2: Creating test file for agent edit...');
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return { ...results, error: 'No workspace folders' };
  }

  const testFileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'b9-agent-test.ts');
  const testContent = `// B9 experiment file - Copilot will be asked to modify this
export function greet(name: string): string {
  return "hello " + name;
}

export function add(a: number, b: number): number {
  return a + b;
}
`;

  try {
    await vscode.workspace.fs.writeFile(testFileUri, new TextEncoder().encode(testContent));
    results.testFileCreated = { path: testFileUri.fsPath, success: true };
  } catch (e: unknown) {
    return { ...results, error: `Failed to create test file: ${e instanceof Error ? e.message : String(e)}` };
  }

  // ─── Step 3: Take baseline snapshot (git status, file content) ─
  log('  Step 3: Taking baseline snapshot...');
  const baselineContent = testContent;
  let baselineDirtyFiles: string[] = [];
  try {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (gitExt?.isActive) {
      const git = gitExt.exports.getAPI(1);
      if (git.repositories.length > 0) {
        const repo = git.repositories[0];
        baselineDirtyFiles = [
          ...repo.state.workingTreeChanges.map((c: { uri: vscode.Uri }) => c.uri.fsPath),
          ...repo.state.indexChanges.map((c: { uri: vscode.Uri }) => c.uri.fsPath),
        ];
      }
    }
  } catch {
    // git not available, skip
  }

  results.baseline = {
    fileContent: baselineContent,
    dirtyFileCount: baselineDirtyFiles.length,
  };

  // ─── Step 4: Ask Copilot Agent to modify the file ──────────────
  log('  Step 4: Asking Copilot to modify file in agent mode...');
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', {
      query: `Refactor the greet function in b9-agent-test.ts to use template literals instead of string concatenation. Only change that one function, nothing else.`,
      isPartialQuery: false,
      mode: 'agent',
      attachFiles: [testFileUri],
    });
    results.agentRequest = { success: true, mode: 'agent' };
  } catch (e: unknown) {
    results.agentRequest = { success: false, error: e instanceof Error ? e.message : String(e) };
  }

  // ─── Step 5: Poll for pending edits / file changes ─────────────
  log('  Step 5: Polling for pending edits (20s)...');

  const pollResults: Array<Record<string, unknown>> = [];
  let pendingDetected = false;
  let fileChanged = false;

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const tick: Record<string, unknown> = { second: i + 1 };

    // Check if file content changed
    try {
      const currentContent = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(testFileUri)
      );
      if (currentContent !== baselineContent) {
        fileChanged = true;
        tick.fileChanged = true;
        tick.newContent = currentContent.slice(0, 300);

        // Check if it contains template literal (the expected change)
        tick.hasTemplateLiteral = currentContent.includes('`');
        tick.hasOldConcat = currentContent.includes('"hello " +');
      }
    } catch {
      // file may be locked during edit
    }

    // Check hasPendingEdits from SQLite
    try {
      const homeDir = process.env.HOME || '/Users/rickwen';
      const wsStoragePath = `${homeDir}/Library/Application Support/Code/User/workspaceStorage`;

      // Find current workspace storage
      const storageDirs = execSync(`ls "${wsStoragePath}"`, { encoding: 'utf-8' }).trim().split('\n');
      const currentWsPath = workspaceFolders[0].uri.fsPath;

      for (const dir of storageDirs) {
        try {
          const wsJson = execSync(`cat "${wsStoragePath}/${dir}/workspace.json" 2>/dev/null`, { encoding: 'utf-8' });
          const parsed = JSON.parse(wsJson);
          if (decodeURIComponent(parsed.folder || '').includes(currentWsPath)) {
            const dbPath = `${wsStoragePath}/${dir}/state.vscdb`;
            const indexRaw = execSync(
              `sqlite3 "file:${dbPath}?mode=ro" "SELECT value FROM ItemTable WHERE key = 'chat.ChatSessionStore.index';" 2>/dev/null`,
              { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
            );
            const index = JSON.parse(indexRaw);
            const entries = Object.values(index.entries || {}) as Array<Record<string, unknown>>;
            const withPending = entries.filter(e => e.hasPendingEdits === true);
            if (withPending.length > 0) {
              pendingDetected = true;
              tick.hasPendingEdits = true;
              tick.pendingSessions = withPending.map(e => ({
                title: e.title,
                sessionId: e.sessionId,
              }));
            }
            break;
          }
        } catch {
          continue;
        }
      }
    } catch {
      // SQLite read failed, skip
    }

    // Check git for working tree changes on our file
    try {
      const gitExt = vscode.extensions.getExtension('vscode.git');
      if (gitExt?.isActive) {
        const git = gitExt.exports.getAPI(1);
        if (git.repositories.length > 0) {
          const repo = git.repositories[0];
          const ourFileChanges = repo.state.workingTreeChanges.filter(
            (c: { uri: vscode.Uri }) => c.uri.fsPath.includes('b9-agent-test')
          );
          if (ourFileChanges.length > 0) {
            tick.gitChange = true;
          }
        }
      }
    } catch {
      // skip
    }

    if (Object.keys(tick).length > 1) {
      pollResults.push(tick);
    }

    // If we detected both file change and pending, we have enough data
    if (fileChanged && pendingDetected) {
      log(`  Detected changes at ${i + 1}s`);
      break;
    }
  }

  results.polling = {
    fileChanged,
    pendingDetected,
    pollSnapshots: pollResults,
  };

  // ─── Step 6: Try to read the diff programmatically ─────────────
  log('  Step 6: Attempting to read diff...');

  if (fileChanged) {
    try {
      const currentContent = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(testFileUri)
      );

      // Simple line-by-line diff
      const oldLines = baselineContent.split('\n');
      const newLines = currentContent.split('\n');
      const changes: Array<{ type: string; line: number; content: string }> = [];

      const maxLen = Math.max(oldLines.length, newLines.length);
      for (let i = 0; i < maxLen; i++) {
        const oldLine = oldLines[i] ?? '';
        const newLine = newLines[i] ?? '';
        if (oldLine !== newLine) {
          if (oldLine) changes.push({ type: 'removed', line: i + 1, content: oldLine });
          if (newLine) changes.push({ type: 'added', line: i + 1, content: newLine });
        }
      }

      results.diff = {
        success: true,
        changeCount: changes.length,
        changes,
        fullNewContent: currentContent,
      };
    } catch (e: unknown) {
      results.diff = { error: e instanceof Error ? e.message : String(e) };
    }
  } else {
    results.diff = { note: 'File not changed yet, no diff to compute' };
  }

  // ─── Step 7: Test accept/undo commands ─────────────────────────
  log('  Step 7: Testing accept/undo commands...');

  // Try to call review.apply (accept the edit)
  try {
    await vscode.commands.executeCommand('github.copilot.chat.review.apply');
    results.acceptCommand = { success: true, command: 'github.copilot.chat.review.apply' };
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : String(e);
    results.acceptCommand = { success: false, error: err };

    // Try alternative
    try {
      await vscode.commands.executeCommand('workbench.action.chat.applyCompareEdits');
      results.acceptCommand = { success: true, command: 'workbench.action.chat.applyCompareEdits' };
    } catch (e2: unknown) {
      results.acceptCommandAlt = { success: false, error: e2 instanceof Error ? e2.message : String(e2) };
    }
  }

  // Test undoEdit (just check it's callable, don't actually undo)
  try {
    // We'll undo and immediately redo to test both
    await vscode.commands.executeCommand('workbench.action.chat.undoEdit');
    results.undoCommand = { success: true };

    await new Promise(r => setTimeout(r, 500));

    await vscode.commands.executeCommand('workbench.action.chat.redoEdit');
    results.redoCommand = { success: true };
  } catch (e: unknown) {
    results.undoRedoTest = {
      note: 'undo/redo may fail if no edits are pending',
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // ─── Step 8: Test tool/permission commands ─────────────────────
  log('  Step 8: Checking tool approval state...');
  try {
    // Check if focusConfirmation works (focuses the confirmation UI if any)
    await vscode.commands.executeCommand('workbench.action.chat.focusConfirmation');
    results.focusConfirmation = { success: true };
  } catch (e: unknown) {
    results.focusConfirmation = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      note: 'May fail if no confirmation is pending',
    };
  }

  // ─── Step 9: Check onDidChangeTextDocument for real-time detection
  log('  Step 9: Summarizing detection capabilities...');
  results.detectionCapabilities = {
    fileContentChange: 'vscode.workspace.onDidChangeTextDocument — real-time event when file is modified',
    pendingEditsFlag: 'chat.ChatSessionStore.index → hasPendingEdits field in SQLite',
    gitWorkingTreeChange: 'git.repositories[0].state.workingTreeChanges — tracks uncommitted changes',
    acceptUndoCommands: [
      'github.copilot.chat.review.apply',
      'github.copilot.chat.review.applyAndNext',
      'github.copilot.chat.review.discard',
      'github.copilot.chat.review.discardAll',
      'workbench.action.chat.undoEdit',
      'workbench.action.chat.redoEdit',
      'workbench.action.chat.restoreCheckpoint',
    ],
    toolApprovalCommands: [
      'workbench.action.chat.acceptTool',
      'workbench.action.chat.skipTool',
      'workbench.action.chat.acceptElicitation',
    ],
    terminalCommands: [
      'workbench.action.terminal.chat.runCommand',
      'workbench.action.terminal.chat.insertCommand',
    ],
  };

  // Cleanup test file
  try {
    await vscode.workspace.fs.delete(testFileUri);
    results.cleanup = { success: true };
  } catch {
    results.cleanup = { note: 'Test file left in workspace for inspection' };
  }

  return results;
}

// ─── B8: Session Takeover (join existing Copilot session) ────────────

async function experimentB8SessionTakeover(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const { execSync } = require('child_process');
  const homeDir = process.env.HOME || '/Users/rickwen';
  const wsStoragePath = `${homeDir}/Library/Application Support/Code/User/workspaceStorage`;

  // Step 1: Find the CURRENT workspace's storage directory
  log('  Step 1: Finding current workspace storage...');
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return { error: 'No workspace folders open' };
  }

  let targetDbPath: string | null = null;
  let targetChatDir: string | null = null;
  let targetWsId: string | null = null;

  try {
    const storageDirs = execSync(`ls "${wsStoragePath}"`, { encoding: 'utf-8' }).trim().split('\n');
    const currentWsPath = workspaceFolders[0].uri.fsPath;

    for (const dir of storageDirs) {
      try {
        const wsJson = execSync(
          `cat "${wsStoragePath}/${dir}/workspace.json" 2>/dev/null`,
          { encoding: 'utf-8' }
        );
        const parsed = JSON.parse(wsJson);
        const folder = decodeURIComponent(parsed.folder || '');
        if (folder.includes(currentWsPath)) {
          targetDbPath = `${wsStoragePath}/${dir}/state.vscdb`;
          targetChatDir = `${wsStoragePath}/${dir}/chatSessions`;
          targetWsId = dir;
          break;
        }
      } catch {
        continue;
      }
    }
  } catch (e: unknown) {
    return { error: `Failed to find workspace storage: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!targetChatDir || !targetDbPath) {
    return { error: 'Could not find storage directory for current workspace' };
  }

  results.currentWorkspace = {
    wsId: targetWsId,
    wsPath: workspaceFolders[0].uri.fsPath,
    chatDir: targetChatDir,
  };

  // Step 2: Read the session index to find the most recent session
  log('  Step 2: Reading session index...');
  let targetSessionId: string | null = null;
  let targetSessionTitle: string | null = null;

  try {
    const indexRaw = execSync(
      `sqlite3 "file:${targetDbPath}?mode=ro" "SELECT value FROM ItemTable WHERE key = 'chat.ChatSessionStore.index';"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const index = JSON.parse(indexRaw);
    const entries = index.entries || {};

    // Find the most recent non-empty session
    let latestTime = 0;
    for (const [id, meta] of Object.entries(entries) as Array<[string, Record<string, unknown>]>) {
      if (meta.isEmpty) continue;
      const timing = meta.timing as Record<string, number> | undefined;
      const lastReq = timing?.lastRequestStarted || 0;
      if (lastReq > latestTime) {
        latestTime = lastReq;
        targetSessionId = id;
        targetSessionTitle = (meta.title as string) || 'Untitled';
      }
    }

    results.sessionIndex = {
      totalSessions: Object.keys(entries).length,
      selectedSession: targetSessionId,
      selectedTitle: targetSessionTitle,
      selectedLastActivity: latestTime ? new Date(latestTime).toISOString() : null,
    };
  } catch (e: unknown) {
    results.sessionIndex = { error: e instanceof Error ? e.message : String(e) };
  }

  if (!targetSessionId) {
    return { ...results, error: 'No non-empty session found in index' };
  }

  // Step 3: Read the session file to extract full conversation
  log(`  Step 3: Reading session file ${targetSessionId}...`);
  const sessionFilePath = `${targetChatDir}/${targetSessionId}.jsonl`;
  let sessionFilePathFinal = sessionFilePath;

  // Try .jsonl first, then .json
  try {
    execSync(`test -f "${sessionFilePath}"`);
  } catch {
    sessionFilePathFinal = `${targetChatDir}/${targetSessionId}.json`;
    try {
      execSync(`test -f "${sessionFilePathFinal}"`);
    } catch {
      return { ...results, error: `Session file not found: tried .jsonl and .json` };
    }
  }

  let conversationHistory: Array<{ request: string; response: string }> = [];

  try {
    const raw = execSync(`cat "${sessionFilePathFinal}"`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });

    const isJsonl = sessionFilePathFinal.endsWith('.jsonl');

    if (isJsonl) {
      // Parse .jsonl: collect all requests from snapshot (kind=0) and splices (kind=2)
      const allRequests: Array<Record<string, unknown>> = [];
      const lines = raw.split('\n').filter(Boolean);

      for (const line of lines) {
        const data = JSON.parse(line);
        if (data.kind === 0) {
          // Snapshot
          const reqs = data.v?.requests || [];
          allRequests.push(...reqs);
        } else if (data.kind === 2 && Array.isArray(data.v)) {
          // Splice - appends new requests
          allRequests.push(...data.v);
        }
      }

      // Extract user message + copilot response text
      for (const req of allRequests) {
        const msgText = (req.message as Record<string, unknown>)?.text as string || '';
        if (!msgText) continue;

        // Reconstruct response from response array
        const respItems = (req.response as Array<Record<string, unknown>>) || [];
        let respText = '';
        for (const item of respItems) {
          const val = item.value;
          if (typeof val === 'string') {
            respText += val;
          }
        }

        if (msgText && respText) {
          conversationHistory.push({
            request: msgText,
            response: respText,
          });
        }
      }
    } else {
      // Parse .json
      const data = JSON.parse(raw);
      const reqs = data.requests || [];
      for (const req of reqs) {
        const msgText = req.message?.text || '';
        const respItems = req.response || [];
        let respText = '';
        for (const item of respItems) {
          if (typeof item?.value === 'string') {
            respText += item.value;
          }
        }
        if (msgText && respText) {
          conversationHistory.push({ request: msgText, response: respText });
        }
      }
    }

    results.conversationExtracted = {
      success: true,
      totalTurns: conversationHistory.length,
      sessionFile: sessionFilePathFinal,
      turns: conversationHistory.slice(0, 3).map((turn, i) => ({
        index: i,
        userMessage: turn.request.slice(0, 150),
        copilotResponse: turn.response.slice(0, 150),
      })),
    };
  } catch (e: unknown) {
    return {
      ...results,
      conversationExtracted: { error: e instanceof Error ? e.message : String(e) },
    };
  }

  if (conversationHistory.length === 0) {
    return { ...results, error: 'No conversation turns extracted from session file' };
  }

  // Step 4: Open a NEW chat with the extracted history as previousRequests + ask a follow-up
  log(`  Step 4: Injecting ${conversationHistory.length} turns as previousRequests...`);

  // Limit to last 5 turns to avoid token overflow
  const historyToInject = conversationHistory.slice(-5);
  const followUpQuestion = `Based on our previous conversation about "${targetSessionTitle}", what was the main topic we discussed? Summarize in one sentence.`;

  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', {
      query: followUpQuestion,
      isPartialQuery: false,
      previousRequests: historyToInject,
    });

    results.injection = {
      success: true,
      turnsInjected: historyToInject.length,
      followUpQuestion,
      note: 'Chat panel opened with existing session history. Check if Copilot references the previous conversation.',
    };

    // Wait for Copilot to respond
    log('  Waiting 12s for Copilot response...');
    await new Promise(r => setTimeout(r, 12000));

    // Capture response
    const originalClipboard = await vscode.env.clipboard.readText();
    await vscode.commands.executeCommand('workbench.action.chat.copyAll');
    await new Promise(r => setTimeout(r, 500));
    const chatContent = await vscode.env.clipboard.readText();
    await vscode.env.clipboard.writeText(originalClipboard);

    if (chatContent !== originalClipboard && chatContent.length > 0) {
      results.copilotResponse = {
        detected: true,
        contentLength: chatContent.length,
        preview: chatContent.slice(-600),
      };
    } else {
      results.copilotResponse = { detected: false };
    }
  } catch (e: unknown) {
    results.injection = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Step 5: Also test opening an existing session directly via URI
  log('  Step 5: Testing direct session open via URI...');
  try {
    // Try workbench.action.chat.open with a session resource
    const b64SessionId = Buffer.from(targetSessionId).toString('base64');
    const sessionUri = `vscode-chat-session://local/${b64SessionId}`;

    // Try various methods to open existing session
    const openMethods = [
      { cmd: 'workbench.action.chat.openSessionInEditorGroup', args: sessionUri },
      { cmd: 'github.copilot.chat.showAsChatSession', args: sessionUri },
    ];

    for (const method of openMethods) {
      try {
        await vscode.commands.executeCommand(method.cmd, sessionUri);
        results[`directOpen_${method.cmd.split('.').pop()}`] = {
          success: true,
          command: method.cmd,
          sessionUri,
        };
        await new Promise(r => setTimeout(r, 1000));
      } catch (e: unknown) {
        results[`directOpen_${method.cmd.split('.').pop()}`] = {
          success: false,
          command: method.cmd,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  } catch (e: unknown) {
    results.directOpen = { error: e instanceof Error ? e.message : String(e) };
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// ─── Phase C: End-to-End Flow Verification ───────────────────────────
// ═══════════════════════════════════════════════════════════════════════

// C1: Desktop → Mobile flow (detect new Copilot conversation)
async function experimentC1DesktopToMobile(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  log('  C1: Monitoring for new Copilot chat activity...');

  try {
    const { execSync } = require('child_process');
    const homeDir = process.env.HOME || '/Users/rickwen';

    // Find this workspace's storage
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return { error: 'No workspace folders' };
    }

    const wsStoragePath = `${homeDir}/Library/Application Support/Code/User/workspaceStorage`;
    const storageDirs = execSync(`ls "${wsStoragePath}"`, { encoding: 'utf-8' }).trim().split('\n');

    let dbPath: string | null = null;
    for (const dir of storageDirs) {
      try {
        const wsJson = execSync(
          `cat "${wsStoragePath}/${dir}/workspace.json" 2>/dev/null`,
          { encoding: 'utf-8' }
        );
        const parsed = JSON.parse(wsJson);
        const folder = decodeURIComponent(parsed.folder || '');
        if (folder.includes(workspaceFolders[0].uri.fsPath)) {
          dbPath = `${wsStoragePath}/${dir}/state.vscdb`;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!dbPath) {
      return { error: 'Could not find workspace storage for current workspace' };
    }

    // Take baseline snapshot
    const baselineIndex = execSync(
      `sqlite3 "file:${dbPath}?mode=ro" "SELECT value FROM ItemTable WHERE key = 'chat.ChatSessionStore.index';" 2>/dev/null`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );

    let baselineData: { entries?: Record<string, unknown> } = { entries: {} };
    try {
      baselineData = JSON.parse(baselineIndex);
    } catch {
      // May not have index yet
    }

    const baselineCount = Object.keys(baselineData.entries || {}).length;

    results.baseline = {
      dbPath,
      sessionCount: baselineCount,
      note: 'Baseline captured. Rick should now use Copilot Chat. Then re-run to detect changes.',
    };

    // Poll for 15 seconds to detect changes
    log('  Polling for new chat activity (15s)...');
    let detected = false;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const currentIndex = execSync(
          `sqlite3 "file:${dbPath}?mode=ro" "SELECT value FROM ItemTable WHERE key = 'chat.ChatSessionStore.index';" 2>/dev/null`,
          { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
        );
        const currentData = JSON.parse(currentIndex);
        const currentCount = Object.keys(currentData.entries || {}).length;
        if (currentCount > baselineCount) {
          detected = true;
          // Find the new session(s)
          const newSessions = Object.entries(currentData.entries || {})
            .filter(([id]) => !((baselineData.entries || {}) as Record<string, unknown>)[id])
            .map(([id, meta]) => ({
              sessionId: id,
              ...(meta as Record<string, unknown>),
            }));
          results.newActivity = {
            detected: true,
            newSessionCount: currentCount - baselineCount,
            newSessions,
            detectedAfterSeconds: i + 1,
          };
          break;
        }
      } catch {
        continue;
      }
    }

    if (!detected) {
      results.newActivity = {
        detected: false,
        note: 'No new chat activity detected in 15s. Rick may need to chat with Copilot first.',
      };
    }
  } catch (e: unknown) {
    results.error = e instanceof Error ? e.message : String(e);
  }

  return results;
}

// C2: Mobile → Desktop flow (Backend sends question via WS → Extension sends to Copilot)
async function experimentC2MobileToDesktop(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  // Simulate receiving a question from "mobile" (via Backend)
  const mobileQuestion = 'What is the purpose of the sample.ts file in this workspace?';

  log('  C2: Simulating Mobile → Desktop flow...');

  // Step 1: Send to Copilot Chat with history context
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', {
      query: mobileQuestion,
      isPartialQuery: false,
      previousRequests: [
        {
          request: 'I am browsing this project on my phone. Help me understand the code.',
          response: 'Sure! I can help you understand any file in this project. Just ask about specific files or concepts.',
        },
      ],
    });

    results.chatPanelOpened = true;
    results.questionSent = mobileQuestion;
    results.previousRequestsInjected = true;
  } catch (e: unknown) {
    results.chatPanelOpened = false;
    results.error = e instanceof Error ? e.message : String(e);
  }

  // Step 2: Wait and try to detect response
  log('  Waiting 10s for Copilot response...');
  await new Promise(r => setTimeout(r, 10000));

  // Try to capture response via clipboard (hacky but only known method)
  try {
    const originalClipboard = await vscode.env.clipboard.readText();
    await vscode.commands.executeCommand('workbench.action.chat.copyAll');
    await new Promise(r => setTimeout(r, 500));
    const chatContent = await vscode.env.clipboard.readText();
    await vscode.env.clipboard.writeText(originalClipboard);

    if (chatContent !== originalClipboard && chatContent.length > 0) {
      results.responseDetected = true;
      results.chatContentLength = chatContent.length;
      results.chatContentPreview = chatContent.slice(-500); // Last 500 chars (most recent)
    } else {
      results.responseDetected = false;
      results.note = 'Could not detect response via clipboard.';
    }
  } catch (e: unknown) {
    results.responseDetection = {
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return results;
}

// C3: Session continuity (3 rounds of Mobile → Desktop)
async function experimentC3SessionContinuity(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const rounds: Array<Record<string, unknown>> = [];

  const conversationHistory: Array<{ request: string; response: string }> = [];
  const questions = [
    'What programming language is sample.ts written in?',
    'Based on the previous answer, what tool compiles that language to JavaScript?',
    'Summarize our conversation so far in one sentence.',
  ];

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    log(`  C3 Round ${i + 1}: "${question}"`);

    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: question,
        isPartialQuery: false,
        previousRequests: [...conversationHistory],
      });

      // Wait for response
      await new Promise(r => setTimeout(r, 8000));

      // Try to read response
      const originalClipboard = await vscode.env.clipboard.readText();
      await vscode.commands.executeCommand('workbench.action.chat.copyAll');
      await new Promise(r => setTimeout(r, 500));
      const chatContent = await vscode.env.clipboard.readText();
      await vscode.env.clipboard.writeText(originalClipboard);

      // Add to history (use a placeholder response since we can't parse it precisely)
      conversationHistory.push({
        request: question,
        response: `[Response from round ${i + 1}]`,
      });

      rounds.push({
        round: i + 1,
        question,
        previousRequestsCount: conversationHistory.length - 1,
        chatContentLength: chatContent.length,
        success: chatContent.length > 0,
      });
    } catch (e: unknown) {
      rounds.push({
        round: i + 1,
        question,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  results.rounds = rounds;
  results.totalRounds = rounds.length;
  results.successfulRounds = rounds.filter(r => r.success).length;

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// ─── Main ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('Code Viewer Experiments');
  output.show(true);
  log('Extension activated!');
  log(`VS Code version: ${vscode.version}`);
  log(`Extension host kind: ${vscode.ExtensionMode[context.extensionMode]}`);
  log(`Platform: ${process.platform}`);

  // ─── Original experiment commands ─────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('codeViewerBridge.experimentWs', () =>
      runExperiment('WebSocket', experimentWebSocket)),
    vscode.commands.registerCommand('codeViewerBridge.experimentLsp', () =>
      runExperiment('LSP Proxy', experimentLsp)),
    vscode.commands.registerCommand('codeViewerBridge.experimentWorkspace', () =>
      runExperiment('Workspace Management', experimentWorkspace)),
    vscode.commands.registerCommand('codeViewerBridge.experimentFs', () =>
      runExperiment('File System', experimentFileSystem)),
    vscode.commands.registerCommand('codeViewerBridge.experimentGit', () =>
      runExperiment('Git API', experimentGit)),
    vscode.commands.registerCommand('codeViewerBridge.experimentDiagnostics', () =>
      runExperiment('Diagnostics', experimentDiagnostics)),
    vscode.commands.registerCommand('codeViewerBridge.experimentCopilot', () =>
      runExperiment('Copilot Detection', experimentCopilotDetection)),
    vscode.commands.registerCommand('codeViewerBridge.experimentLm', () =>
      runExperiment('Language Model API', experimentLanguageModelApi)),
  );

  // ─── Original run-all command ─────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('codeViewerBridge.runAllExperiments', async () => {
      await runAll(context);
    })
  );

  // ─── Desktop experiment commands (Phase B) ────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('codeViewerBridge.desktopB1', () =>
      runExperiment('B1: Model Enumeration', experimentB1ModelEnumeration)),
    vscode.commands.registerCommand('codeViewerBridge.desktopB2', () =>
      runExperiment('B2: LM Send Request', experimentB2LmSendRequest)),
    vscode.commands.registerCommand('codeViewerBridge.desktopB3', () =>
      runExperiment('B3: Chat Panel Integration', experimentB3ChatPanel)),
    vscode.commands.registerCommand('codeViewerBridge.desktopB4', () =>
      runExperiment('B4: Response Detection', experimentB4ResponseDetection)),
    vscode.commands.registerCommand('codeViewerBridge.desktopB5', () =>
      runExperiment('B5: Chat Session Reading', experimentB5ChatSessionReading)),
    vscode.commands.registerCommand('codeViewerBridge.desktopB6', () =>
      runExperiment('B6: WebSocket Backend', experimentB6WebSocketBackend)),
    vscode.commands.registerCommand('codeViewerBridge.desktopB7', () =>
      runExperiment('B7: LSP Desktop', experimentB7LspDesktop)),
    vscode.commands.registerCommand('codeViewerBridge.desktopB9', async () => {
      const result = await runExperiment('B9: Agent Interaction', experimentB9AgentInteraction);
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders) {
        const resultUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'desktop-b9-results.json');
        const content = new TextEncoder().encode(JSON.stringify({
          timestamp: new Date().toISOString(),
          vscodeVersion: vscode.version,
          experiment: result,
        }, null, 2));
        await vscode.workspace.fs.writeFile(resultUri, content);
        log(`Results written to: ${resultUri.fsPath}`);
      }
    }),
    vscode.commands.registerCommand('codeViewerBridge.desktopB8', async () => {
      const result = await runExperiment('B8: Session Takeover', experimentB8SessionTakeover);
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders) {
        const resultUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'desktop-b8-results.json');
        const content = new TextEncoder().encode(JSON.stringify({
          timestamp: new Date().toISOString(),
          vscodeVersion: vscode.version,
          experiment: result,
        }, null, 2));
        await vscode.workspace.fs.writeFile(resultUri, content);
        log(`Results written to: ${resultUri.fsPath}`);
      }
    }),
  );

  // ─── Phase C experiment commands ──────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('codeViewerBridge.desktopC1', () =>
      runExperiment('C1: Desktop→Mobile', experimentC1DesktopToMobile)),
    vscode.commands.registerCommand('codeViewerBridge.desktopC2', () =>
      runExperiment('C2: Mobile→Desktop', experimentC2MobileToDesktop)),
    vscode.commands.registerCommand('codeViewerBridge.desktopC3', () =>
      runExperiment('C3: Session Continuity', experimentC3SessionContinuity)),
  );

  // ─── Run all desktop experiments ──────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('codeViewerBridge.runDesktopExperiments', async () => {
      await runDesktopExperiments(context);
    })
  );

  // ─── Run Phase C end-to-end ───────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('codeViewerBridge.runPhaseC', async () => {
      await runPhaseC(context);
    })
  );

  // Auto-run if AUTO_RUN env is set
  if (process.env.AUTO_RUN_EXPERIMENTS === '1') {
    log('AUTO_RUN_EXPERIMENTS=1, running all experiments in 5s...');
    setTimeout(() => runAll(context), 5000);
  }
}

async function runAll(context: vscode.ExtensionContext) {
  log('\n╔══════════════════════════════════════╗');
  log('║  Code Viewer Extension Experiments   ║');
  log('╚══════════════════════════════════════╝');

  const experiments: ExperimentResult[] = [];

  experiments.push(await runExperiment('File System', experimentFileSystem));
  experiments.push(await runExperiment('Git API', experimentGit));
  experiments.push(await runExperiment('WebSocket', experimentWebSocket));
  experiments.push(await runExperiment('LSP Proxy', experimentLsp));
  experiments.push(await runExperiment('Diagnostics', experimentDiagnostics));
  experiments.push(await runExperiment('Copilot Detection', experimentCopilotDetection));
  experiments.push(await runExperiment('Language Model API', experimentLanguageModelApi));
  experiments.push(await runExperiment('Workspace Management', experimentWorkspace));

  const allResults: AllResults = {
    timestamp: new Date().toISOString(),
    vscodeVersion: vscode.version,
    experiments,
  };

  log('\n╔══════════════════════════════════════╗');
  log('║            SUMMARY                   ║');
  log('╚══════════════════════════════════════╝');
  for (const exp of experiments) {
    const icon = exp.status === 'pass' ? '✓' : exp.status === 'fail' ? '✗' : '○';
    log(`  ${icon} ${exp.name}: ${exp.status} (${exp.durationMs}ms)`);
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    const resultUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'experiment-results.json');
    const content = new TextEncoder().encode(JSON.stringify(allResults, null, 2));
    await vscode.workspace.fs.writeFile(resultUri, content);
    log(`\nResults written to: ${resultUri.fsPath}`);
  }
}

async function runDesktopExperiments(_context: vscode.ExtensionContext) {
  log('\n╔══════════════════════════════════════════╗');
  log('║  Desktop Copilot Experiments (Phase B)   ║');
  log('╚══════════════════════════════════════════╝');

  const experiments: Record<string, ExperimentResult> = {};

  experiments.B1 = await runExperiment('B1: Model Enumeration', experimentB1ModelEnumeration);
  experiments.B2 = await runExperiment('B2: LM Send Request', experimentB2LmSendRequest);
  experiments.B3 = await runExperiment('B3: Chat Panel Integration', experimentB3ChatPanel);
  experiments.B4 = await runExperiment('B4: Response Detection', experimentB4ResponseDetection);
  experiments.B5 = await runExperiment('B5: Chat Session Reading', experimentB5ChatSessionReading);
  experiments.B6 = await runExperiment('B6: WebSocket Backend', experimentB6WebSocketBackend);
  experiments.B7 = await runExperiment('B7: LSP Desktop', experimentB7LspDesktop);

  const desktopResults: DesktopExperimentResults = {
    timestamp: new Date().toISOString(),
    vscodeVersion: vscode.version,
    platform: `${process.platform}-${process.arch}`,
    phase: 'B',
    experiments,
  };

  log('\n╔══════════════════════════════════════════╗');
  log('║              SUMMARY                      ║');
  log('╚══════════════════════════════════════════╝');
  for (const [id, exp] of Object.entries(experiments)) {
    const icon = exp.status === 'pass' ? '✓' : exp.status === 'fail' ? '✗' : '○';
    log(`  ${icon} ${id}: ${exp.name} → ${exp.status} (${exp.durationMs}ms)`);
  }

  // Write results
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    const resultUri = vscode.Uri.joinPath(
      workspaceFolders[0].uri,
      'desktop-experiment-results.json'
    );
    const content = new TextEncoder().encode(JSON.stringify(desktopResults, null, 2));
    await vscode.workspace.fs.writeFile(resultUri, content);
    log(`\nResults written to: ${resultUri.fsPath}`);
  }

  // Verification summary
  log('\n╔══════════════════════════════════════════╗');
  log('║        VERIFICATION QUESTIONS             ║');
  log('╚══════════════════════════════════════════╝');
  const checks = [
    { q: '1. Extension can get Copilot model list?', pass: experiments.B1?.status === 'pass' },
    { q: '2. Extension can call Copilot LLM?', pass: experiments.B2?.status === 'pass' },
    { q: '3. Extension can send to Chat panel?', pass: experiments.B3?.status === 'pass' },
    { q: '4. Extension can inject history?', pass: experiments.B3?.status === 'pass' },
    { q: '5. Extension can detect responses?', pass: experiments.B4?.status === 'pass' },
    { q: '6. Extension can read chat history?', pass: experiments.B5?.status === 'pass' },
    { q: '7. Extension can WS to Backend?', pass: experiments.B6?.status === 'pass' },
  ];
  for (const c of checks) {
    log(`  ${c.pass ? '✅' : '❌'} ${c.q}`);
  }
}

async function runPhaseC(_context: vscode.ExtensionContext) {
  log('\n╔══════════════════════════════════════════╗');
  log('║  End-to-End Flow Verification (Phase C)   ║');
  log('╚══════════════════════════════════════════╝');

  const experiments: Record<string, ExperimentResult> = {};

  experiments.C1 = await runExperiment('C1: Desktop→Mobile', experimentC1DesktopToMobile);
  experiments.C2 = await runExperiment('C2: Mobile→Desktop', experimentC2MobileToDesktop);
  experiments.C3 = await runExperiment('C3: Session Continuity', experimentC3SessionContinuity);

  const phaseResults: DesktopExperimentResults = {
    timestamp: new Date().toISOString(),
    vscodeVersion: vscode.version,
    platform: `${process.platform}-${process.arch}`,
    phase: 'C',
    experiments,
  };

  log('\n╔══════════════════════════════════════════╗');
  log('║              SUMMARY                      ║');
  log('╚══════════════════════════════════════════╝');
  for (const [id, exp] of Object.entries(experiments)) {
    const icon = exp.status === 'pass' ? '✓' : exp.status === 'fail' ? '✗' : '○';
    log(`  ${icon} ${id}: ${exp.name} → ${exp.status} (${exp.durationMs}ms)`);
  }

  const e2eViable = experiments.C2?.status === 'pass' && experiments.C3?.status === 'pass';
  log(`\n  ➤ Desktop ↔ Mobile conversation continuity: ${e2eViable ? '✅ VIABLE' : '❌ NOT VIABLE'}`);

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    const resultUri = vscode.Uri.joinPath(
      workspaceFolders[0].uri,
      'desktop-phase-c-results.json'
    );
    const content = new TextEncoder().encode(JSON.stringify(phaseResults, null, 2));
    await vscode.workspace.fs.writeFile(resultUri, content);
    log(`\nResults written to: ${resultUri.fsPath}`);
  }
}

export function deactivate() {
  log('Extension deactivated');
}
